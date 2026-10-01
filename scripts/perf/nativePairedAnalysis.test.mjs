import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeNativeCell, decideQualification } from './nativePairedAnalysis.mjs';

function nativeRun({ renderer, block, p95, scenarioHash = 'scenario-a' }) {
  const values = Array.from({ length: 120 }, (_, index) => p95 + (index % 5) * 0.001);
  const events = values.map((value, index) => ({
    type: 'benchmarkInteraction',
    index: index + 1,
    fixture: 'vector-1k',
    workload: 'pan',
    block,
    foreground: true,
    inputSource: 'os',
    inputTrusted: true,
    inputIdentity: `input-${renderer}-${block}-${index}`,
    inputClockId: 'host-monotonic',
    inputMonotonicTimestampMs: 1000 + index * 100,
    frameChanged: true,
    frameIdentity: `frame-${renderer}-${block}-${index}`,
    presentationClockTrust: 'trusted',
    presentationClockId: 'host-monotonic',
    presentationMonotonicTimestampMs: 1000 + index * 100 + value,
    presentationClockCorrelation: null,
    declaredPresentationSource: 'optical',
    declaredPresentationUncertaintyMs: 0.2,
    declaredInputToPresentationMs: value,
    inputToPresentationMs: 1000 + index * 100 + value - (1000 + index * 100),
    presentationUncertaintyMs: 0.2,
    rendererPath: renderer === 'webgl2' ? 'webgl2' : renderer,
    gpuSubmittedItems: renderer === 'webgl2' ? 12 : null,
    gpuTextureBytes: renderer === 'webgl2' ? 1024 : null,
    gpuTextureEntries: renderer === 'webgl2' ? 1 : null,
    applicationCacheBytes: 2048,
    throttlingEvidence: {
      cpu: { status: 'clear', source: 'linux-thermal-counters' },
      gpu: { status: 'clear', source: 'vendor-driver-telemetry' },
    },
    ...(renderer === 'webgl2'
      ? {
          hardwareExecution: 'verified-hardware',
          gpuSubmissionIdentity: `submission-${block}-${index}`,
          hardwareExecutionEvidence: {
            source: 'gpu-trace',
            submissionIdentity: `submission-${block}-${index}`,
            executionIdentity: `execution-${block}-${index}`,
            deviceProfileId: 'device-profile-hash',
            softwareRenderer: false,
          },
        }
      : {}),
  }));
  const ascending = events.map((event) => event.inputToPresentationMs).sort((a, b) => a - b);
  return {
    mode: 'benchmark',
    status: 'passed',
    source: { dirty: false, commit: 'a'.repeat(40), binarySha256: 'b'.repeat(64) },
    scenario: {
      sha256: scenarioHash === 'scenario-a' ? 'c'.repeat(64) : 'd'.repeat(64),
      fixtureId: 'vector-1k',
      gestureId: 'pan',
      fixtureSha256: 'e'.repeat(64),
      gestureSequenceSha256: 'f'.repeat(64),
      assetSha256s: ['1'.repeat(64)],
    },
    host: { platform: 'linux', arch: 'x64', sessionType: 'wayland', wayland: true },
    renderer,
    fixture: 'vector-1k',
    workload: 'pan',
    block,
    driverExit: { code: 0, signal: null },
    blockers: [],
    invalidEvents: [],
    nativeInteractions: events.length,
    authoritativePresentationSamples: events.length,
    presentationUnavailableSamples: 0,
    hardwareExecution:
      renderer === 'webgl2' ? 'driver-reported-hardware' : 'not-applicable-canvas2d-api',
    inputToPresentationMs: {
      count: values.length,
      p50: ascending[59],
      p95: ascending[113],
      p99: ascending[118],
      max: ascending[119],
    },
    events,
  };
}

test('native comparison independently recomputes paired presentation p95s and uncertainty', () => {
  const result = analyzeNativeCell({
    id: 'vector-1k/pan',
    fixture: 'vector-1k',
    workload: 'pan',
    baselineRenderer: 'canvas2d-worker',
    pairs: [1, 2, 3].map((block) => ({
      block,
      canvas2d: nativeRun({ renderer: 'canvas2d-worker', block, p95: 40 }),
      webgl2: nativeRun({ renderer: 'webgl2', block, p95: 28 }),
    })),
  });
  assert.equal(result.validPairCount, 3, JSON.stringify(result.rejectedBlocks[0]));
  assert.ok(Math.abs(result.medianCanvas2dRunP95Ms - 40.004) < 1e-9);
  assert.ok(Math.abs(result.medianWebgl2RunP95Ms - 28.004) < 1e-9);
  assert.ok(result.improvementInterval95.lower95 > 20);
  assert.equal(result.rejectedBlocks.length, 0);
});

test('native comparison rejects mismatched scenario provenance instead of pooling hosts', () => {
  const result = analyzeNativeCell({
    id: 'vector-1k/pan',
    fixture: 'vector-1k',
    workload: 'pan',
    baselineRenderer: 'canvas2d-main',
    pairs: [1, 2, 3].map((block) => ({
      block,
      canvas2d: nativeRun({ renderer: 'canvas2d-main', block, p95: 40 }),
      webgl2: nativeRun({
        renderer: 'webgl2',
        block,
        p95: 28,
        scenarioHash: block === 3 ? 'other-scenario' : 'scenario-a',
      }),
    })),
  });
  assert.equal(result.validPairCount, 2, JSON.stringify(result.rejectedBlocks[0]));
  assert.ok(
    result.rejectedBlocks[0].blockers.includes(
      'paired-runs-differ-in-source-binary-host-or-scenario',
    ),
  );
  const decision = decideQualification({
    slowTarget: result,
    otherWorkloads: [],
    correctnessPassed: true,
    memoryPassed: true,
  });
  assert.equal(decision.outcome, 'inconclusive');
  assert.ok(decision.blockers.includes('fewer-than-three-valid-paired-blocks'));
});

test('native comparison revalidates timing arithmetic from stored clock identities and timestamps', () => {
  const baseline = nativeRun({ renderer: 'canvas2d-worker', block: 1, p95: 40 });
  const webgl = nativeRun({ renderer: 'webgl2', block: 1, p95: 28 });
  webgl.events[0].presentationMonotonicTimestampMs += 10;
  const result = analyzeNativeCell({
    id: 'vector-1k/pan',
    fixture: 'vector-1k',
    workload: 'pan',
    baselineRenderer: 'canvas2d-worker',
    pairs: [{ block: 1, canvas2d: baseline, webgl2: webgl }],
  });
  assert.equal(result.validPairCount, 0);
  assert.ok(result.rejectedBlocks[0].blockers.includes('event-1:presentation-evidence-invalid'));
});

test('native comparison rejects reused OS input and content-frame identities', () => {
  const baseline = nativeRun({ renderer: 'canvas2d-worker', block: 1, p95: 40 });
  const webgl = nativeRun({ renderer: 'webgl2', block: 1, p95: 28 });
  baseline.events[1].inputIdentity = baseline.events[0].inputIdentity;
  webgl.events[1].frameIdentity = webgl.events[0].frameIdentity;
  const result = analyzeNativeCell({
    id: 'vector-1k/pan',
    fixture: 'vector-1k',
    workload: 'pan',
    baselineRenderer: 'canvas2d-worker',
    pairs: [{ block: 1, canvas2d: baseline, webgl2: webgl }],
  });
  assert.equal(result.validPairCount, 0);
  assert.ok(result.rejectedBlocks[0].blockers.includes('event-2:input-identity-reused'));
  assert.ok(result.rejectedBlocks[0].blockers.includes('event-2:content-frame-identity-reused'));
});
