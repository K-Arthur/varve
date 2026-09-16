import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Threaded-WASM probe (G4).
 *
 * The editor's shared inference worker pins `ort.env.wasm.numThreads = 1`
 * because starting ORT's pthread pool inside that worker deadlocked on
 * Chromium headless/AMD. That is a policy decision, and until it is measured
 * it must not be reported as either "threading works" or "threading cannot
 * work". This probe owns the whole runtime lifecycle in throwaway workers —
 * one configuration per worker, because `ort.env.wasm` flags are global and
 * must be set before the first session is created, never mutated afterwards.
 *
 * It records, per configuration:
 *   - whether a real shipped graph's session was created and run;
 *   - mean wall time over repeated runs, so single- and multi-thread runs are
 *     comparable on the same machine, model bytes, and browser;
 *   - the fetched runtime asset names, so the build actually used is recorded
 *     rather than assumed;
 *   - the largest shared-memory reservation the browser allows.
 *
 * It deliberately does NOT promote the platform: the matrix cell in
 * `packages/engine/src/inference/platformEvidence.ts` is only updated from a
 * completed run reviewed against this evidence.
 *
 * Enable with VARVE_THREADED_WASM_PROBE=1. Threading needs SharedArrayBuffer,
 * so the probe page sets COOP/COEP itself and does not depend on the dev
 * server's headers.
 */

interface ThreadProbeFacts {
  crossOriginIsolated: boolean | null;
  sharedArrayBuffer: boolean;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  /** Largest shared WebAssembly.Memory maximum that could be reserved (pages). */
  sharedMemoryCapacityPages: number | null;
  userAgent: string;
}

interface ThreadConfigResult extends ThreadProbeFacts {
  requestedThreads: number;
  importedModule: string;
  runtimeAssets: string[];
  inputNames: string[];
  inputShapes: number[][];
  sessionCreated: boolean;
  ranOk: boolean;
  createMs: number | null;
  runMs: number | null;
  sampleValue: number | null;
  errors: string[];
  /** Last worker phase reported before completion or watchdog termination. */
  lastPhase: string | null;
  outcome: 'ran' | 'session-create-failed' | 'run-failed' | 'timed-out' | 'worker-failed';
}

interface ThreadProbeResult extends ThreadProbeFacts {
  modelPath: string;
  configs: ThreadConfigResult[];
  notes: string[];
  measuredAt: string;
}

/**
 * Model-under-test: the shipped YuNet face detector (233 KB, input
 * `[1,3,640,640]`). A real catalog graph gives the comparison a real workload
 * and removes any question of whether a synthetic graph would engage the
 * thread pool.
 *
 * `onnxruntime-web` does not expose per-input shapes the way the Node binding
 * does, so the probe takes the declared contract from the caller and records
 * the input names the session actually reported.
 */
const PROBE_MODEL_PATH = process.env.VARVE_THREADED_WASM_MODEL ?? '/models/yunet-face-detect.onnx';
const PROBE_INPUT_SHAPE = (process.env.VARVE_THREADED_WASM_INPUT_SHAPE ?? '1,3,640,640')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isSafeInteger(value) && value > 0);

/**
 * Worker source, passed to the page as data. One configuration per worker:
 * `ort.env.wasm` is global to the runtime instance and must be set before any
 * session exists.
 */
function workerSource(): string {
  return [
    'self.onmessage = async (event) => {',
    '  const { ortUrl, wasmBase, numThreads, modelBytes, runCount, declaredShape } = event.data;',
    '  const result = {',
    '    requestedThreads: numThreads,',
    '    importedModule: ortUrl,',
    '    runtimeAssets: [],',
    '    inputNames: [],',
    '    inputShapes: [],',
    '    sessionCreated: false,',
    '    ranOk: false,',
    '    createMs: null,',
    '    runMs: null,',
    '    sampleValue: null,',
    '    errors: [],',
    '    lastPhase: null,',
    "    outcome: 'worker-failed',",
    '  };',
    '  const progress = (phase) => {',
    '    result.lastPhase = phase;',
    '    self.postMessage({ __progress: phase });',
    '  };',
    '  const recordAssets = () => {',
    '    try {',
    "      result.runtimeAssets = performance.getEntriesByType('resource')",
    '        .map((entry) => entry.name)',
    '        .filter((name) => /ort-wasm/i.test(name))',
    "        .map((name) => name.split('/').pop());",
    '    } catch (error) {',
    "      result.errors.push('asset-list: ' + String(error && error.message ? error.message : error));",
    '    }',
    '  };',
    '  try {',
    '    const ort = await import(ortUrl);',
    "    progress('imported');",
    '    ort.env.wasm.wasmPaths = wasmBase;',
    '    ort.env.wasm.numThreads = numThreads;',
    '    ort.env.wasm.proxy = false;',
    "    ort.env.logLevel = 'error';",
    "    progress('creating');",
    '    const createAt = performance.now();',
    '    const model = await ort.InferenceSession.create(modelBytes, {',
    "      executionProviders: ['wasm'],",
    '    });',
    '    result.createMs = performance.now() - createAt;',
    '    result.sessionCreated = true;',
    "    progress('created');",
    '    recordAssets();',
    '    result.inputNames = model.inputNames.slice();',
    '    const feeds = {};',
    '    let converted = 0;',
    '    for (const name of model.inputNames) {',
    '      const metadata = model.inputMetadata ? model.inputMetadata[name] : undefined;',
    '      const declared = (metadata && metadata.shape ? metadata.shape : []).filter(',
    "        (dim) => typeof dim === 'number' && dim > 0,",
    '      );',
    '      const shape = declared.length > 0 ? declared : declaredShape;',
    '      if (!shape || shape.length === 0) {',
    "        throw new Error('no shape available for input ' + name + '; pass declaredShape');",
    '      }',
    "      const type = (metadata && metadata.type) || 'float32';",
    "      if (type !== 'float32') {",
    "        throw new Error('probe expects float32 inputs; got ' + type + ' for ' + name);",
    '      }',
    '      const size = shape.reduce((total, dim) => total * dim, 1);',
    '      result.inputShapes.push(shape);',
    "      feeds[name] = new ort.Tensor('float32', new Float32Array(size), shape);",
    '      converted += 1;',
    '    }',
    "    if (converted === 0) throw new Error('session reported no inputs');",
    "    progress('running');",
    '    const runAt = performance.now();',
    '    let lastOutputs = null;',
    '    for (let index = 0; index < runCount; index += 1) {',
    '      lastOutputs = await model.run(feeds);',
    '    }',
    '    result.runMs = (performance.now() - runAt) / runCount;',
    '    const first = lastOutputs ? lastOutputs[model.outputNames[0]] : null;',
    "    if (first && first.data && typeof first.data[0] === 'number') {",
    '      result.sampleValue = first.data[0];',
    '    }',
    '    result.ranOk = true;',
    "    result.outcome = 'ran';",
    '    try { await model.release(); } catch (error) {',
    "      result.errors.push('release: ' + String(error && error.message ? error.message : error));",
    '    }',
    '  } catch (error) {',
    '    const message = String(error && error.message ? error.message : error);',
    '    result.errors.push(message);',
    "    if (!result.sessionCreated) result.outcome = 'session-create-failed';",
    "    else if (!result.ranOk) result.outcome = 'run-failed';",
    '  }',
    '  recordAssets();',
    '  self.postMessage(result);',
    '};',
  ].join('\n');
}

test.describe('threaded WASM probe', () => {
  test.skip(
    !process.env.VARVE_THREADED_WASM_PROBE,
    'Set VARVE_THREADED_WASM_PROBE=1 (threading needs a cross-origin isolated page)',
  );

  test('measures single- and multi-threaded WASM on one real shipped graph', async ({
    browser,
  }, testInfo) => {
    test.setTimeout(10 * 60_000);
    const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:1420';

    /**
     * Each configuration runs in its own browser context and its own minimal
     * page. Two reasons: a renderer crash (the failure mode under memory
     * pressure) cannot take the other measurement with it, and a probe page
     * with no editor, React, or canvas is a fraction of the memory — which
     * matters precisely when the machine is tight.
     *
     * The fulfilled document sets COOP/COEP itself, so the probe states the
     * exact capability a threaded runtime needs instead of inheriting whatever
     * headers the dev server happens to send.
     */
    const runConfig = async (numThreads: number): Promise<ThreadConfigResult> => {
      const context = await browser.newContext({ baseURL, viewport: { width: 640, height: 480 } });
      const page = await context.newPage();
      const empty: ThreadConfigResult = {
        requestedThreads: numThreads,
        importedModule: '',
        runtimeAssets: [],
        inputNames: [],
        inputShapes: [],
        sessionCreated: false,
        ranOk: false,
        createMs: null,
        runMs: null,
        sampleValue: null,
        errors: [],
        outcome: 'worker-failed',
        lastPhase: null,
        crossOriginIsolated: null,
        sharedArrayBuffer: false,
        hardwareConcurrency: null,
        deviceMemoryGb: null,
        sharedMemoryCapacityPages: null,
        userAgent: '',
      };
      try {
        await page.route('**/probe.html', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/html',
            headers: {
              'Cross-Origin-Opener-Policy': 'same-origin',
              'Cross-Origin-Embedder-Policy': 'require-corp',
            },
            body: '<!doctype html><html><head><title>threaded probe</title></head><body></body></html>',
          }),
        );
        await page.goto('/probe.html', { timeout: 30_000 });
        const result = (await page.evaluate(
          async ({
            modelPath,
            workerScript,
            ortPath,
            wasmPath,
            requestedThreads,
            declaredShape,
          }) => {
            const modelResponse = await fetch(modelPath, { cache: 'force-cache' });
            if (!modelResponse.ok) {
              throw new Error(`probe model fetch failed: ${modelResponse.status}`);
            }
            const modelReady = await modelResponse.arrayBuffer();
            // A blob-URL module worker cannot resolve a root-relative specifier
            // against its blob base, so hand the worker absolute URLs.
            const ortUrl = new URL(ortPath, location.href).href;
            const wasmBase = new URL(wasmPath, location.href).href;

            const sharedMemoryCapacityPages = (() => {
              for (const candidate of [65536, 49152, 32768, 16384]) {
                try {
                  const memory = new WebAssembly.Memory({
                    initial: 1,
                    maximum: candidate,
                    shared: true,
                  });
                  if (memory.buffer.byteLength > 0) return candidate;
                } catch {
                  // Try the next-lower ceiling.
                }
              }
              return null;
            })();

            const outcome = await new Promise<Record<string, unknown>>((resolve) => {
              const blobUrl = URL.createObjectURL(
                new Blob([workerScript], { type: 'text/javascript' }),
              );
              const worker = new Worker(blobUrl, { type: 'module' });
              const timeoutMs = requestedThreads > 1 ? 120_000 : 60_000;
              let lastPhase: string | null = null;
              const finish = (payload: Record<string, unknown>) => {
                window.clearTimeout(timer);
                worker.terminate();
                URL.revokeObjectURL(blobUrl);
                resolve({ lastPhase, ...payload });
              };
              const timer = window.setTimeout(() => {
                finish({
                  requestedThreads,
                  importedModule: ortUrl,
                  runtimeAssets: [],
                  inputNames: [],
                  inputShapes: [],
                  sessionCreated: false,
                  ranOk: false,
                  createMs: null,
                  runMs: null,
                  sampleValue: null,
                  errors: [
                    `watchdog: no result within ${timeoutMs}ms; worker terminated during phase '${lastPhase ?? 'import'}'; the threaded runtime never returned from that phase`,
                  ],
                  outcome: 'timed-out',
                });
              }, timeoutMs);
              worker.onmessage = (event) => {
                const data = event.data as Record<string, unknown>;
                if (data && typeof data.__progress === 'string') {
                  lastPhase = data.__progress;
                  return;
                }
                finish(data);
              };
              worker.onerror = (event) => {
                finish({
                  requestedThreads,
                  importedModule: ortUrl,
                  runtimeAssets: [],
                  inputNames: [],
                  inputShapes: [],
                  sessionCreated: false,
                  ranOk: false,
                  createMs: null,
                  runMs: null,
                  sampleValue: null,
                  errors: [`worker error: ${event.message ?? 'unknown'}`],
                  outcome: 'worker-failed',
                });
              };
              worker.postMessage({
                ortUrl,
                wasmBase,
                numThreads: requestedThreads,
                modelBytes: modelReady,
                runCount: 3,
                declaredShape,
              });
            });

            const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
            return {
              ...outcome,
              crossOriginIsolated:
                typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : null,
              sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
              hardwareConcurrency: navigator.hardwareConcurrency ?? null,
              deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
              sharedMemoryCapacityPages,
              userAgent: navigator.userAgent,
            };
          },
          {
            modelPath: PROBE_MODEL_PATH,
            workerScript: workerSource(),
            ortPath: '/node_modules/onnxruntime-web/dist/ort.bundle.min.mjs',
            wasmPath: '/ort-wasm/',
            requestedThreads: numThreads,
            declaredShape: PROBE_INPUT_SHAPE,
          },
        )) as unknown as ThreadConfigResult;
        await context.close();
        return result;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await context.close().catch(() => undefined);
        return { ...empty, errors: [`probe context failed: ${reason}`] };
      }
    };

    const single = await runConfig(1);
    const multithreaded = single.inputNames.length > 0 ? await runConfig(2) : null;

    const results: ThreadProbeResult = {
      userAgent: single.userAgent,
      modelPath: PROBE_MODEL_PATH,
      crossOriginIsolated: single.crossOriginIsolated,
      sharedArrayBuffer: single.sharedArrayBuffer,
      hardwareConcurrency: single.hardwareConcurrency,
      deviceMemoryGb: single.deviceMemoryGb,
      sharedMemoryCapacityPages: single.sharedMemoryCapacityPages,
      configs: multithreaded ? [single, multithreaded] : [single],
      notes: [
        'One worker, one configuration, one browser context per measurement: ort.env.wasm flags are global and are never mutated after a session exists, and a renderer crash cannot take the other measurement with it.',
        'runMs is the mean of 3 runs of the shipped model on zero-filled inputs; it measures runtime throughput, not detection quality.',
        'Actual pthread pool size is not exposed by the public ORT API; requestedThreads plus the fetched runtime assets are recorded instead.',
        'sharedMemoryCapacityPages is an address-space reservation, not committed memory.',
        'The probe page is a minimal fulfilled document with COOP/COEP set explicitly; the editor is not loaded.',
        'This probe does not promote any matrix cell by itself; the recorded outcome is reviewed and then recorded in platformEvidence.ts.',
      ],
      measuredAt: new Date().toISOString(),
    };

    const evidenceDir = path.resolve('reports/inference-platform');
    await mkdir(evidenceDir, { recursive: true });
    const evidencePath = path.join(
      evidenceDir,
      `threaded-wasm-${process.env.VARVE_E2E_PORT ?? 'default'}.json`,
    );
    await writeFile(evidencePath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
    await testInfo.attach('threaded-wasm-probe', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
    console.log(`THREADED WASM PROBE: ${evidencePath}`);
    for (const config of results.configs) {
      console.log(
        `threads=${config.requestedThreads} outcome=${config.outcome} created=${config.sessionCreated} ran=${config.ranOk} createMs=${config.createMs?.toFixed(1) ?? 'n/a'} runMs=${config.runMs?.toFixed(1) ?? 'n/a'} sample=${config.sampleValue ?? 'n/a'} assets=${config.runtimeAssets.join(',') || 'none'} errors=${config.errors.join('; ') || 'none'}`,
      );
    }

    // Contract: whatever the outcome, it must be *recorded*, and a completed
    // run must have produced a finite value from the graph.
    expect(results.configs.length).toBeGreaterThanOrEqual(1);
    expect(results.configs[0]?.requestedThreads).toBe(1);
    expect(results.configs[0]?.inputNames.length).toBeGreaterThan(0);
    for (const config of results.configs) {
      if (config.outcome === 'ran') {
        expect(config.sessionCreated).toBe(true);
        expect(Number.isFinite(config.sampleValue)).toBe(true);
        expect(config.runMs).toBeGreaterThan(0);
      }
    }
  });
});
