/**
 * Detection-to-segmentation memory-handoff trace (G3).
 *
 * Measures the two orderings the lifecycle decision actually chooses between,
 * in one process each so the numbers are not contaminated by a previous
 * session that the runtime has not returned:
 *
 *   overlap — create the segmenter while the detector is still resident
 *             (one detector run, then segmenter create + run, then release);
 *   handoff — run detection, materialize compact detections, release the
 *             detector and await the release, then create and run the
 *             segmenter (the ordering the editor implements).
 *
 * Domains are reported separately and never summed as if disjoint:
 * `rss` (whole process), `heapUsed` (JS), `external`/`arrayBuffers` (typed
 * arrays), plus explicit stage timestamps. A release that does not shrink RSS
 * is reported as allocator retention, not as failure — and a release that
 * fails is reported as unresolved residency.
 *
 * Node CPU is not the browser WASM domain. This trace is evidence about the
 * lifecycle protocol and its ordering, not a browser memory claim.
 *
 * Usage:
 *   node --experimental-strip-types scripts/bench/handoff-peak-trace.ts --mode=handoff
 *   node --experimental-strip-types scripts/bench/handoff-peak-trace.ts --mode=overlap
 *   node --experimental-strip-types scripts/bench/handoff-peak-trace.ts --mode=compare
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import {
  decodeMobileSamDecoderOutput,
  encodeMobileSamPrompts,
  preprocessMobileSamImageData,
} from '../../packages/engine/src/inference/models/mobileSam.ts';

const OUTPUT_DIR = process.env.VARVE_HANDOFF_TRACE_DIR ?? resolve('reports/inference-platform');
const MOBILE_DIR = process.env.VARVE_MOBILE_SAM_MODEL_DIR ?? '';
const DETECTOR_PATH =
  process.env.VARVE_HANDOFF_DETECTOR ??
  resolve('apps/desktop/public/models/yunet-face-detect.onnx');
const SAMPLE_INTERVAL_MS = 50;
const PHOTO = resolve('tests/e2e/fixtures/real-life-elephant.jpg');

/**
 * Resolve runtime dependencies from the engine package. pnpm's layout does not
 * hoist `onnxruntime-node` to the repository root, so a bare import from this
 * script cannot resolve it.
 */
const engineRequire = createRequire(join(resolve('packages/engine'), 'package.json'));

async function loadOrtNode(): Promise<typeof import('onnxruntime-node')> {
  const loaded = (await import(engineRequire.resolve('onnxruntime-node'))) as {
    InferenceSession?: unknown;
    default?: unknown;
  };
  return (loaded.InferenceSession ? loaded : loaded.default) as typeof import('onnxruntime-node');
}

type OrtSession = Awaited<ReturnType<typeof import('onnxruntime-node').InferenceSession.create>>;
type OrtTensor = InstanceType<typeof import('onnxruntime-node').Tensor>;

if (typeof globalThis.ImageData === 'undefined') {
  class NodeImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof NodeImageData }).ImageData = NodeImageData;
}

interface Sample {
  atMs: number;
  phase: string;
  rss: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface Stage {
  phase: string;
  atMs: number;
  rss: number;
  note: string;
}

type MemoryUsage = ReturnType<typeof process.memoryUsage>;

function usage(): MemoryUsage {
  return process.memoryUsage();
}

const startedAt = Date.now();
const samples: Sample[] = [];
const stages: Stage[] = [];
let currentPhase = 'start';

const sampler = setInterval(() => {
  const memory = usage();
  samples.push({
    atMs: Date.now() - startedAt,
    phase: currentPhase,
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  });
}, SAMPLE_INTERVAL_MS);

function mark(phase: string, note: string): void {
  currentPhase = phase;
  const memory = usage();
  stages.push({ phase, atMs: Date.now() - startedAt, rss: memory.rss, note });
  console.log(
    `[${String(Date.now() - startedAt).padStart(6)}ms] ${phase.padEnd(28)} rss ${(memory.rss / 1e6).toFixed(0)}MB external ${(memory.external / 1e6).toFixed(0)}MB ${note}`,
  );
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function decodePhoto(): Promise<ImageData> {
  const jpeg = engineRequire('jpeg-js') as {
    decode: (
      data: Uint8Array,
      options: { useTArray: boolean },
    ) => {
      data: Uint8Array;
      width: number;
      height: number;
    };
  };
  const decoded = jpeg.decode(readFileSync(PHOTO), { useTArray: true });
  // Half scale keeps the trace fast; the mask geometry is not the subject.
  const width = Math.floor(decoded.width / 2);
  const height = Math.floor(decoded.height / 2);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * 2 * decoded.width + x * 2) * 4;
      const to = (y * width + x) * 4;
      out[to] = decoded.data[from] as number;
      out[to + 1] = decoded.data[from + 1] as number;
      out[to + 2] = decoded.data[from + 2] as number;
      out[to + 3] = 255;
    }
  }
  return new ImageData(out, width, height);
}

export interface HandoffTrace {
  mode: 'handoff' | 'overlap';
  measuredAt: string;
  runtime: string;
  detector: { path: string; sha256: string; sizeBytes: number };
  segmenter: { artifacts: Record<string, string> };
  source: { path: string; sha256: string };
  stages: Stage[];
  samples: Sample[];
  peaks: {
    detectorPhaseRss: number;
    transitionRss: number;
    segmenterPhaseRss: number;
    wholeRunRss: number;
  };
  release: {
    requested: boolean;
    resolvedMs: number | null;
    rssBefore: number | null;
    rssAfter: number | null;
    rssDelta: number | null;
    error: string | null;
  };
  notes: string[];
}

async function run(mode: 'handoff' | 'overlap'): Promise<HandoffTrace> {
  const ort = await loadOrtNode();
  const ortVersion = (engineRequire('onnxruntime-node/package.json') as { version: string })
    .version;
  if (!existsSync(MOBILE_DIR)) {
    throw new Error(
      'Set VARVE_MOBILE_SAM_MODEL_DIR to a directory with mobile_sam_image_encoder.onnx and sam_mask_decoder_multi.onnx',
    );
  }

  const detectorPath = DETECTOR_PATH;
  mark('detector-session-create', 'loading detector graph');
  const detector = await ort.InferenceSession.create(detectorPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  mark('detector-run', 'one forward pass on the source');
  const detectorInput = new ort.Tensor(
    'float32',
    new Float32Array(1 * 3 * 640 * 640),
    [1, 3, 640, 640],
  );
  const detectorFeeds: Record<string, OrtTensor> = {};
  for (const name of detector.inputNames) detectorFeeds[name] = detectorInput;
  const detectorOutputs = (await detector.run(detectorFeeds)) as unknown as Record<
    string,
    OrtTensor
  >;

  mark('detections-materialized', 'compact output copied into plain data');
  const compactDetections = detector.outputNames.map((name) => {
    const tensor = detectorOutputs[name];
    return {
      name,
      dims: tensor ? [...tensor.dims] : [],
      bytes: tensor ? tensor.data.byteLength : 0,
    };
  });

  let segmenterEncoder: OrtSession | null = null;
  let segmenterDecoder: OrtSession | null = null;

  if (mode === 'overlap') {
    // The anti-pattern the lifecycle must avoid: both models resident.
    mark('segmenter-create-while-detector-resident', 'worst-case ordering');
    segmenterEncoder = await ort.InferenceSession.create(
      join(MOBILE_DIR, 'mobile_sam_image_encoder.onnx'),
      { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
    );
    segmenterDecoder = await ort.InferenceSession.create(
      join(MOBILE_DIR, 'sam_mask_decoder_multi.onnx'),
      { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
    );
  }

  let releaseRequested = false;
  let resolvedMs: number | null = null;
  let rssBefore: number | null = null;
  let rssAfter: number | null = null;
  let releaseError: string | null = null;

  if (mode === 'handoff') {
    mark('detector-release-requested', 'awaiting the runtime release');
    releaseRequested = true;
    rssBefore = usage().rss;
    const releaseStarted = Date.now();
    try {
      await detector.release();
      resolvedMs = Date.now() - releaseStarted;
    } catch (error) {
      releaseError = error instanceof Error ? error.message : String(error);
    }
    rssAfter = usage().rss;
    mark(
      'detector-release-returned',
      `release ${resolvedMs ?? 'n/a'}ms, rss ${(rssBefore / 1e6).toFixed(0)} -> ${(rssAfter / 1e6).toFixed(0)}MB`,
    );
    mark('segmenter-create-after-release', 'new admission decision after the barrier');
    segmenterEncoder = await ort.InferenceSession.create(
      join(MOBILE_DIR, 'mobile_sam_image_encoder.onnx'),
      { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
    );
    segmenterDecoder = await ort.InferenceSession.create(
      join(MOBILE_DIR, 'sam_mask_decoder_multi.onnx'),
      { executionProviders: ['cpu'], graphOptimizationLevel: 'all' },
    );
  }

  if (!segmenterEncoder || !segmenterDecoder)
    throw new Error('segmenter sessions were not created');
  mark('segmenter-run', 'encode + decode with a click prompt');
  const image = await decodePhoto();
  const preprocessed = preprocessMobileSamImageData(image);
  const encoderOutputs = (await segmenterEncoder.run({
    [segmenterEncoder.inputNames[0]!]: new ort.Tensor('float32', preprocessed.tensor, [
      preprocessed.height,
      preprocessed.width,
      3,
    ]),
  })) as unknown as Record<string, OrtTensor>;
  const encoded = encodeMobileSamPrompts(
    { points: [{ x: 0.52, y: 0.62, label: 1 }] },
    image.width,
    image.height,
  );
  const decoderOutputs = (await segmenterDecoder.run({
    image_embeddings: encoderOutputs.image_embeddings!,
    point_coords: new ort.Tensor('float32', encoded.point_coords!.data, encoded.point_coords!.dims),
    point_labels: new ort.Tensor('float32', encoded.point_labels!.data, encoded.point_labels!.dims),
    mask_input: new ort.Tensor('float32', encoded.mask_input!.data, encoded.mask_input!.dims),
    has_mask_input: new ort.Tensor(
      'float32',
      encoded.has_mask_input!.data,
      encoded.has_mask_input!.dims,
    ),
    orig_im_size: new ort.Tensor('float32', encoded.orig_im_size!.data, encoded.orig_im_size!.dims),
  })) as unknown as Record<string, OrtTensor>;
  const decoded = decodeMobileSamDecoderOutput(
    decoderOutputs.masks!.data as Float32Array,
    [...decoderOutputs.masks!.dims],
    decoderOutputs.iou_predictions!.data as Float32Array,
    [...decoderOutputs.iou_predictions!.dims],
    image.width,
    image.height,
    decoderOutputs.low_res_masks?.data as Float32Array | undefined,
    decoderOutputs.low_res_masks ? [...decoderOutputs.low_res_masks.dims] : undefined,
  );

  mark('segmenter-decoded', `${decoded.masks.length} candidates materialized`);

  if (mode === 'overlap') {
    releaseRequested = true;
    rssBefore = usage().rss;
    const releaseStarted = Date.now();
    try {
      await detector.release();
      resolvedMs = Date.now() - releaseStarted;
    } catch (error) {
      releaseError = error instanceof Error ? error.message : String(error);
    }
    rssAfter = usage().rss;
    mark('detector-release-after-segmenter', 'released only after both models ran');
  }

  mark('final', 'no further work');
  clearInterval(sampler);

  const peakIn = (phases: string[]): number => {
    const stagePeak = stages
      .filter((stage) => phases.includes(stage.phase))
      .reduce((max, stage) => Math.max(max, stage.rss), 0);
    const samplePeak = samples
      .filter((sample) => phases.includes(sample.phase))
      .reduce((max, sample) => Math.max(max, sample.rss), 0);
    return Math.max(stagePeak, samplePeak);
  };
  const wholeRunRss = Math.max(
    samples.reduce((max, sample) => Math.max(max, sample.rss), 0),
    stages.reduce((max, stage) => Math.max(max, stage.rss), 0),
  );

  return {
    mode,
    measuredAt: new Date().toISOString(),
    runtime: `onnxruntime-node ${ortVersion} · CPU · ${process.platform} ${process.arch} · default intra-op threads (unspecified)`,
    detector: {
      path: detectorPath,
      sha256: sha256(detectorPath),
      sizeBytes: readFileSync(detectorPath).byteLength,
    },
    segmenter: {
      artifacts: Object.fromEntries(
        ['mobile_sam_image_encoder.onnx', 'sam_mask_decoder_multi.onnx'].map((name) => [
          name,
          sha256(join(MOBILE_DIR, name)),
        ]),
      ),
    },
    source: { path: PHOTO, sha256: sha256(PHOTO) },
    stages,
    samples,
    peaks: {
      detectorPhaseRss: peakIn([
        'detector-session-create',
        'detector-run',
        'detections-materialized',
      ]),
      transitionRss: peakIn([
        'detector-release-requested',
        'detector-release-returned',
        'segmenter-create-after-release',
        'segmenter-create-while-detector-resident',
        'detector-release-after-segmenter',
      ]),
      segmenterPhaseRss: peakIn(['segmenter-run', 'segmenter-decoded', 'final']),
      wholeRunRss,
    },
    release: {
      requested: releaseRequested,
      resolvedMs,
      rssBefore,
      rssAfter,
      rssDelta: rssBefore !== null && rssAfter !== null ? rssAfter - rssBefore : null,
      error: releaseError,
    },
    notes: [
      'RSS is the whole process; heapUsed/external/arrayBuffers are reported separately and are not summed.',
      'Node CPU allocation behaviour is not browser WASM; a stable RSS after release is allocator retention, not proof of reclamation.',
      'compactDetections records the materialized output shape/size, not the tensors themselves.',
      `detections: ${JSON.stringify(compactDetections)}`,
    ],
  };
}

async function compare(): Promise<void> {
  const handoff = JSON.parse(
    readFileSync(join(OUTPUT_DIR, 'handoff-trace-handoff.json'), 'utf8'),
  ) as HandoffTrace;
  const overlap = JSON.parse(
    readFileSync(join(OUTPUT_DIR, 'handoff-trace-overlap.json'), 'utf8'),
  ) as HandoffTrace;
  const detectorOnly = Math.max(handoff.peaks.detectorPhaseRss, overlap.peaks.detectorPhaseRss);
  const rows = [
    ['detector phase peak rss', detectorOnly],
    ['overlap whole-run peak rss', overlap.peaks.wholeRunRss],
    ['handoff whole-run peak rss', handoff.peaks.wholeRunRss],
  ] as const;
  console.log('HANDOFF COMPARISON (Node CPU, whole-process RSS)');
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(34)} ${(value / 1e6).toFixed(0)} MB`);
  }
  const improvement = overlap.peaks.wholeRunRss - handoff.peaks.wholeRunRss;
  console.log(
    `  ${'handoff improvement'.padEnd(34)} ${(improvement / 1e6).toFixed(0)} MB (${((improvement / overlap.peaks.wholeRunRss) * 100).toFixed(1)}%)`,
  );
  const summary = {
    generatedAt: new Date().toISOString(),
    detectorOnlyPeakRss: detectorOnly,
    overlapPeakRss: overlap.peaks.wholeRunRss,
    handoffPeakRss: handoff.peaks.wholeRunRss,
    improvementBytes: improvement,
    improvementPercent: (improvement / overlap.peaks.wholeRunRss) * 100,
    handoffRelease: handoff.release,
    overlapRelease: overlap.release,
    notes: [
      'The two orderings were measured in separate processes so a previous session cannot inflate the next one.',
      'This is the Node CPU runtime. The browser WASM detector transition remains unmeasured (see the audit ledger).',
    ],
  };
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, 'handoff-trace-comparison.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(`HANDOFF COMPARISON: ${join(OUTPUT_DIR, 'handoff-trace-comparison.json')}`);
}

const modeArg = process.argv.find((value) => value.startsWith('--mode='))?.slice('--mode='.length);
if (modeArg === 'compare') {
  await compare();
} else if (modeArg === 'handoff' || modeArg === 'overlap') {
  const trace = await run(modeArg);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const target = join(OUTPUT_DIR, `handoff-trace-${modeArg}.json`);
  writeFileSync(target, `${JSON.stringify(trace, null, 2)}\n`);
  console.log(
    `HANDOFF TRACE (${modeArg}): ${target} peak ${(trace.peaks.wholeRunRss / 1e6).toFixed(0)}MB`,
  );
} else {
  console.error('Pass --mode=handoff | --mode=overlap | --mode=compare');
  process.exit(2);
}

// The sampler interval is cleared on the trace path; exiting explicitly keeps
// this script usable in a pipeline even if a stray timer remains.
process.exit(0);
