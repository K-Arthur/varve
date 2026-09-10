#!/usr/bin/env node
/**
 * Depth model verification harness — integrity + contract + inference parity.
 *
 * Downloads (if needed) the pinned Depth Anything V2 Small INT8 model,
 * verifies its SHA-256, introspects the ONNX contract (input/output names and
 * dims), and runs deterministic fixtures with known depth ordering through
 * the same documented preprocessing the app uses (letterbox to 518x518,
 * ImageNet normalization, NCHW). Metrics:
 *
 *   - non-finite fraction per fixture (must be 0)
 *   - Spearman rank correlation between the canonicalized prediction and the
 *     fixture's expected near/far ordering (must exceed a threshold)
 *   - plane separation for the two-plane fixture (near mean must be
 *     significantly below far mean in canonical 0=near, 1=far space)
 *   - depth-edge alignment: the predicted near-region silhouette vs the known
 *     fixture silhouette (boundary disagreement within a tolerance)
 *   - cold load + warm inference p50/p95 latency
 *
 * Evidence is written to
 * apps/desktop/public/models/quantized/depth-anything-v2-small-validation-report.json
 * (same directory convention as the u2netp/realesr INT8 reports) and the exit
 * code reflects PASS/FAIL so the gate is scriptable.
 *
 * Usage:
 *   node scripts/models/verify-depth-model.mjs [--model <path>]
 *   VARVE_DEPTH_MODEL_PATH=<path> node scripts/models/verify-depth-model.mjs
 *
 * The report's validation summary feeds the manifest's validation block
 * (validation.inferenceVerified) — promotion is a manual, reviewed step.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE_REQ = createRequire(join(ROOT, 'packages/engine', 'package.json'));

const MODEL_ID = 'depth-anything-v2-small';
const MODEL_FILENAME = 'depth_anything_v2_small_int8.onnx';
const MODEL_URL =
  'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_int8.onnx';
const PINNED_SHA256 = '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001';
const INPUT_SIZE = 518;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const REPORT_PATH = join(
  ROOT,
  'apps/desktop/public/models/quantized/depth-anything-v2-small-validation-report.json',
);
const DEFAULT_MODEL_PATH = join(ROOT, 'apps/desktop/public/models', MODEL_FILENAME);

const args = process.argv.slice(2);
const modelArg = args.includes('--model')
  ? args[args.indexOf('--model') + 1]
  : process.env.VARVE_DEPTH_MODEL_PATH;
const modelPath = modelArg ? resolve(modelArg) : DEFAULT_MODEL_PATH;

/** Deterministic 32-bit xorshift for reproducible fixtures. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

/** Build a raw RGBA fixture. Each entry: {data: Uint8ClampedArray, width, height}. */
function fixtureTwoPlane(seed = 7) {
  const width = 800;
  const height = 600;
  const data = new Uint8ClampedArray(width * height * 4);
  const cx = Math.round(width * 0.4);
  const cy = Math.round(height * 0.5);
  const radius = Math.round(height * 0.22);
  const noise = rng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const inCircle = dx * dx + dy * dy <= radius * radius;
      if (inCircle) {
        // Near red subject with spherical shading (light from top-left).
        const dist = Math.sqrt(dx * dx + dy * dy) / radius;
        const shade = 1 - 0.35 * Math.max(0, dist * dist);
        const light = 0.85 + 0.15 * Math.max(0, (dx + dy) / (2 * radius));
        const v = Math.round(210 * shade * light + noise() * 8);
        data[o] = v;
        data[o + 1] = Math.round(18 * shade);
        data[o + 2] = Math.round(30 * shade);
      } else {
        // Far background: soft sky-to-ground gradient plus texture, and a
        // contact shadow under the circle for a grounding cue.
        const ground = y > height * 0.62;
        const t = ground ? (y - height * 0.62) / (height * 0.38) : y / (height * 0.62);
        const horizonGlow = ground ? 0.5 + 0.5 * (1 - t) : 1;
        let r = 90 + 40 * t;
        let g = 110 + 50 * t;
        let b = 150 + 60 * (1 - t);
        const inShadow =
          Math.abs(x - cx) < radius * 1.35 &&
          dy > 0 &&
          Math.hypot(x - cx, y - (cy + radius * 0.35)) < radius * 1.5;
        if (inShadow) {
          const depth = 1 - Math.hypot(x - cx, y - (cy + radius * 0.35)) / (radius * 1.5);
          r *= 1 - 0.4 * depth;
          g *= 1 - 0.4 * depth;
          b *= 1 - 0.4 * depth;
        }
        data[o] = Math.round(r * horizonGlow + noise() * 10);
        data[o + 1] = Math.round(g * horizonGlow + noise() * 10);
        data[o + 2] = Math.round(b * horizonGlow + noise() * 10);
      }
      data[o + 3] = 255;
    }
  }
  return {
    data,
    width,
    height,
    expectedNear: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2,
  };
}

/** Perspective corridor: convergence cues make the centre read as farther. */
function fixtureCorridor(seed = 11) {
  const width = 800;
  const height = 600;
  const data = new Uint8ClampedArray(width * height * 4);
  const horizon = Math.round(height * 0.45);
  const noise = rng(seed);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const belowHorizon = y > horizon;
      // Perspective floor: converging dark wedges on a light floor.
      const scale = belowHorizon ? (y - horizon) / (height - horizon) : 1;
      const halfWidth = Math.round((width / 2) * scale) + 10;
      const centered = Math.abs(x - width / 2) < halfWidth;
      if (!belowHorizon) {
        // Sky: brighter near the horizon edge, darker at top.
        const t = (horizon - y) / Math.max(1, horizon);
        const v = Math.round(140 + 60 * (1 - t) + noise() * 8);
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = Math.round(180 + 30 * (1 - t));
      } else if (centered && ((x + y) >> 4) % 5 === 0) {
        const v = Math.round(60 + noise() * 20);
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
      } else {
        const t = scale;
        const v = Math.round(200 + 30 * t + noise() * 10);
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
      }
      data[o + 3] = 255;
    }
  }
  // Expected ordering: the corridor recedes toward the horizon centre.
  const expectedNear = (x, y) => !(y > horizon && Math.abs(x - width / 2) < 90);
  return { data, width, height, expectedNear };
}

/** Flat uniform field — degenerate case; must still yield finite output. */
function fixtureUniform(seed = 3) {
  const width = 512;
  const height = 512;
  const data = new Uint8ClampedArray(width * height * 4);
  const noise = rng(seed);
  for (let i = 0; i < data.length; i += 4) {
    const v = 128 + Math.round(noise() * 4);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { data, width, height, expectedNear: () => false };
}

/**
 * Portrait-like silhouette: a head-and-shoulders figure on a graded
 * background. People are the strongest near-cue class for a model trained on
 * photography, so this fixture tests the cue that Depth Blur relies on most.
 */
function fixturePortrait(seed = 23) {
  const width = 640;
  const height = 800;
  const data = new Uint8ClampedArray(width * height * 4);
  const noise = rng(seed);
  const cx = Math.round(width / 2);
  const headY = Math.round(height * 0.3);
  const headR = Math.round(width * 0.14);
  const shoulderY = Math.round(height * 0.52);
  const shoulderHalf = Math.round(width * 0.34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inHead = (x - cx) ** 2 + (y - headY) ** 2 <= headR * headR;
      const inNeck = Math.abs(x - cx) < headR * 0.45 && y > headY + headR * 0.6 && y < shoulderY;
      const inShoulders =
        y >= shoulderY &&
        Math.abs(x - cx) <=
          shoulderHalf * Math.max(0.15, 1 - ((y - shoulderY) / (height - shoulderY)) * 0.6);
      if (inHead || inNeck || inShoulders) {
        // Figure: dark clothing with gentle shading and texture.
        const shade = 0.82 + 0.18 * Math.max(0, (x - cx) / width);
        const v = Math.round(70 * shade + noise() * 12);
        data[o] = v;
        data[o + 1] = Math.round(64 * shade + noise() * 10);
        data[o + 2] = Math.round(78 * shade + noise() * 12);
      } else {
        // Background: sky-to-floor gradient with soft bokeh-like discs.
        const t = y / height;
        const r = Math.round(170 - 60 * t + noise() * 8);
        const g = Math.round(190 - 70 * t + noise() * 8);
        const b = Math.round(210 - 90 * t + noise() * 8);
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        const disc = ((x * 37 + y * 53) % 251) - 125;
        if (disc > 60) {
          data[o] = Math.min(255, data[o] + Math.round(disc * 0.12));
          data[o + 1] = Math.min(255, data[o + 1] + Math.round(disc * 0.12));
          data[o + 2] = Math.min(255, data[o + 2] + Math.round(disc * 0.12));
        }
      }
      data[o + 3] = 255;
    }
  }
  const expectedNear = (x, y) => {
    const inHead = (x - cx) ** 2 + (y - headY) ** 2 <= headR * headR;
    const inNeck = Math.abs(x - cx) < headR * 0.45 && y > headY + headR * 0.6 && y < shoulderY;
    const inShoulders =
      y >= shoulderY &&
      Math.abs(x - cx) <=
        shoulderHalf * Math.max(0.15, 1 - ((y - shoulderY) / (height - shoulderY)) * 0.6);
    return inHead || inNeck || inShoulders;
  };
  return { data, width, height, expectedNear };
}

/**
 * Letterbox + bilinear resize + ImageNet normalization + NCHW packing,
 * matching the documented contract used by the app's inference worker
 * (DEPTH_ANYTHING_TENSOR_SPEC: 518x518, mean/std ImageNet, zero padding).
 * Returns { tensor, transform } where transform maps model pixels back to
 * fixture pixels: fixtureX = (modelX - offsetX) / scale.
 */
function preprocess(data, width, height) {
  const scale = Math.min(INPUT_SIZE / width, INPUT_SIZE / height);
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  const offsetX = Math.round((INPUT_SIZE - sw) / 2);
  const offsetY = Math.round((INPUT_SIZE - sh) / 2);

  const resized = new Float32Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    const sy = Math.min(height - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const tx = sx - x0;
      const out = (y * sw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const i00 = (y0 * width + x0) * 4 + c;
        const i10 = (y0 * width + x1) * 4 + c;
        const i01 = (y1 * width + x0) * 4 + c;
        const i11 = (y1 * width + x1) * 4 + c;
        resized[out + c] =
          data[i00] * (1 - tx) * (1 - ty) +
          data[i10] * tx * (1 - ty) +
          data[i01] * (1 - tx) * ty +
          data[i11] * tx * ty;
      }
    }
  }

  const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let y = 0; y < INPUT_SIZE; y++) {
    for (let x = 0; x < INPUT_SIZE; x++) {
      const inBounds = y >= offsetY && y < offsetY + sh && x >= offsetX && x < offsetX + sw;
      for (let c = 0; c < 3; c++) {
        const raw = inBounds ? resized[((y - offsetY) * sw + (x - offsetX)) * 3 + c] : 0;
        const normalized = (raw / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
        tensor[c * INPUT_SIZE * INPUT_SIZE + y * INPUT_SIZE + x] = normalized;
      }
    }
  }
  return { tensor, transform: { scale, offsetX, offsetY } };
}

/** Map a model-space pixel back into fixture coordinates (letterbox-aware). */
function toFixture(transform, fixtureWidth, fixtureHeight, x, y) {
  return {
    x: Math.min(
      fixtureWidth - 1,
      Math.max(0, Math.round((x - transform.offsetX) / transform.scale)),
    ),
    y: Math.min(
      fixtureHeight - 1,
      Math.max(0, Math.round((y - transform.offsetY) / transform.scale)),
    ),
  };
}

/**
 * Canonicalize a raw prediction to the Varve convention (0 = near, 1 = far).
 * The model's raw sign is measured per fixture; `invert` is chosen so the
 * two-plane fixture's circle ends up near, then applied to all fixtures.
 */
function canonicalize(raw, width, height, invert) {
  const values = new Float32Array(width * height);
  const finite = [];
  for (let i = 0; i < raw.length; i++) {
    if (Number.isFinite(raw[i])) finite.push(raw[i]);
  }
  finite.sort((a, b) => a - b);
  const low = finite[Math.floor(finite.length * 0.02)] ?? 0;
  const high = finite[Math.floor(finite.length * 0.98)] ?? 1;
  const range = high - low;
  for (let i = 0; i < raw.length; i++) {
    const v = Number.isFinite(raw[i]) ? (raw[i] - low) / Math.max(1e-9, range) : 0.5;
    const clamped = Math.max(0, Math.min(1, v));
    values[i] = invert ? 1 - clamped : clamped;
  }
  return { values, low, high };
}

function spearman(a, b, sample = null) {
  const n = a.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (sample) {
    idx.length = 0;
    const step = Math.max(1, Math.floor(n / sample));
    for (let i = 0; i < n; i += step) idx.push(i);
  }
  const rank = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v || p.i - q.i);
    const r = new Float64Array(arr.length);
    // Tie-averaged ranks: percentile clamping produces many exact ties at
    // 0 and 1, and index-ordered tie-breaking would corrupt the correlation.
    for (let k = 0; k < sorted.length; ) {
      let end = k + 1;
      while (end < sorted.length && sorted[end].v === sorted[k].v) end++;
      const avg = (k + end - 1) / (2 * Math.max(1, sorted.length - 1));
      for (let j = k; j < end; j++) r[sorted[j].i] = avg;
      k = end;
    }
    return r;
  };
  const ra = rank(idx.map((i) => a[i]));
  const rb = rank(idx.map((i) => b[i]));
  let sum = 0;
  let sa = 0;
  let sb = 0;
  for (let k = 0; k < idx.length; k++) {
    sa += ra[k];
    sb += rb[k];
  }
  const ma = sa / idx.length;
  const mb = sb / idx.length;
  for (let k = 0; k < idx.length; k++) {
    sum += (ra[k] - ma) * (rb[k] - mb);
  }
  let da = 0;
  let db = 0;
  for (let k = 0; k < idx.length; k++) {
    da += (ra[k] - ma) ** 2;
    db += (rb[k] - mb) ** 2;
  }
  return sum / Math.sqrt(da * db);
}

/** Average boundary distance between predicted near region and expected. */
function edgeAlignment(values, width, height, expectedNear) {
  let sum = 0;
  let count = 0;
  for (let y = 8; y < height - 8; y += 2) {
    for (let x = 8; x < width - 8; x += 2) {
      if (expectedNear(x, y)) continue;
      let best = Infinity;
      for (let dy = -6; dy <= 6; dy += 2) {
        for (let dx = -6; dx <= 6; dx += 2) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (expectedNear(nx, ny)) {
            const d = Math.hypot(dx, dy);
            if (d < best) best = d;
          }
        }
      }
      if (best === Infinity) continue;
      const predictedNear = values[y * width + x] < 0.4;
      if (predictedNear === best < 4) {
        sum += 1;
      }
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

async function main() {
  const ort = ENGINE_REQ('onnxruntime-node');
  console.log(`[depth-verify] ort ${ort.env?.versions?.onnxruntime ?? '?'} (onnxruntime-node)`);

  // 1. Acquire + integrity
  if (!existsSync(modelPath)) {
    console.log(`[depth-verify] model missing at ${modelPath}; downloading from HF…`);
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length') ?? 0);
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) {
        process.stdout.write(`\r[depth-verify] download ${Math.round((received / total) * 100)}%`);
      }
    }
    process.stdout.write('\n');
    mkdirSync(dirname(modelPath), { recursive: true });
    writeFileSync(modelPath, Buffer.concat(chunks));
  }
  const bytes = readFileSync(modelPath);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const integrityPassed = sha === PINNED_SHA256;
  console.log(`[depth-verify] sha256 ${sha} ${integrityPassed ? 'MATCHES pinned' : 'MISMATCH!'}`);

  // 2. Contract introspection
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
  const inputNames = session.inputNames;
  const outputNames = session.outputNames;
  console.log(`[depth-verify] inputs ${inputNames.join(',')} outputs ${outputNames.join(',')}`);
  const inputName = inputNames.find((n) =>
    ['pixel_values', 'input', 'input_image', 'image', 'x'].includes(n.toLowerCase()),
  );
  if (!inputName) throw new Error(`no known image input name in ${inputNames.join(',')}`);
  const outputName = outputNames.find((n) =>
    ['predicted_depth', 'output', 'depth'].includes(n.toLowerCase()),
  );
  if (!outputName) throw new Error(`no known depth output name in ${outputNames.join(',')}`);

  // 3. Fixtures
  const fixtures = [
    { key: 'two_plane', ...fixtureTwoPlane() },
    { key: 'corridor', ...fixtureCorridor() },
    { key: 'portrait', ...fixturePortrait() },
    { key: 'flat_uniform', ...fixtureUniform() },
  ];

  // 4. Latency: one cold run (first after session creation), then warm runs.
  const latencies = [];
  const results = [];
  for (let pass = 0; pass < 3; pass++) {
    console.log(`[depth-verify] latency pass ${pass + 1}/3 (under load ${osLoad()})`);
    const start = performance.now();
    for (const fixture of fixtures) {
      const { tensor } = preprocess(fixture.data, fixture.width, fixture.height);
      const feeds = {
        [inputName]: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
      };
      const out = await session.run(feeds);
      const output = out[outputName];
      if (
        output.dims.length !== 3 ||
        output.dims[1] !== INPUT_SIZE ||
        output.dims[2] !== INPUT_SIZE
      ) {
        throw new Error(`unexpected output dims ${JSON.stringify(output.dims)}`);
      }
    }
    latencies.push(performance.now() - start);
  }
  latencies.sort((a, b) => a - b);
  const coldLoad = latencies[0];
  const p50 = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95))];

  // 5. Metric evaluation on dedicated runs (fresh inference per fixture).
  // Each fixture measures its OWN raw sign: monocular relative depth can
  // carry a per-image sign ambiguity, and a fixed inversion assumption must
  // not hide that from the report.
  let observedNearIsHigh = null;
  const perFixtureConventions = [];
  for (const fixture of fixtures) {
    const { tensor, transform } = preprocess(fixture.data, fixture.width, fixture.height);
    const feeds = {
      [inputName]: new ort.Tensor('float32', tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]),
    };
    const out = await session.run(feeds);
    const output = out[outputName];
    const raw = output.data;
    const dims = output.dims;
    const h = dims[dims.length - 2];
    const w = dims[dims.length - 1];

    const nanFraction = countNonFinite(raw) / raw.length;

    // Raw near/far means for THIS fixture (letterbox-aware mapping).
    let rawNearMean = 0;
    let rawFarMean = 0;
    let nearCount = 0;
    let farCount = 0;
    if (fixture.key !== 'flat_uniform') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const { x: sx, y: sy } = toFixture(transform, fixture.width, fixture.height, x, y);
          const v = raw[y * w + x];
          if (fixture.expectedNear(sx, sy)) {
            rawNearMean += v;
            nearCount++;
          } else {
            rawFarMean += v;
            farCount++;
          }
        }
      }
      rawNearMean /= Math.max(1, nearCount);
      rawFarMean /= Math.max(1, farCount);
    }
    const fixtureNearIsHigh = rawNearMean > rawFarMean;
    perFixtureConventions.push({
      fixture: fixture.key,
      nearIsHigh: fixtureNearIsHigh,
      rawNearMean,
      rawFarMean,
    });
    if (fixture.key !== 'flat_uniform' && observedNearIsHigh === null) {
      observedNearIsHigh = fixtureNearIsHigh;
      console.log(
        `[depth-verify] raw convention (${fixture.key}): ` +
          `nearIs${fixtureNearIsHigh ? 'High' : 'Low'} ` +
          `(near mean ${rawNearMean.toFixed(3)}, far mean ${rawFarMean.toFixed(3)})`,
      );
    }

    // Canonicalize with THIS fixture's own sign so ordering metrics measure
    // the model's true near/far agreement, not the sign assumption. Sign
    // consistency across fixtures is reported and gated separately.
    const invert = fixtureNearIsHigh;
    const canonical = canonicalize(raw, w, h, invert);
    let rho = 0;
    let separation = 0;
    let edgeScore = 0;
    if (fixture.key !== 'flat_uniform') {
      const expected = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const { x: sx, y: sy } = toFixture(transform, fixture.width, fixture.height, x, y);
          expected[y * w + x] = fixture.expectedNear(sx, sy) ? 0 : 1;
        }
      }
      rho = spearman(canonical.values, expected, 12000);
      let nearMean = 0;
      let farMean = 0;
      let nc = 0;
      let fc = 0;
      for (let i = 0; i < expected.length; i++) {
        if (expected[i] === 0) {
          nearMean += canonical.values[i];
          nc++;
        } else {
          farMean += canonical.values[i];
          fc++;
        }
      }
      nearMean /= Math.max(1, nc);
      farMean /= Math.max(1, fc);
      separation = farMean - nearMean;
      edgeScore = edgeAlignment(canonical.values, w, h, fixture.expectedNear);
    }

    const entry = {
      fixture: fixture.key,
      output_dims: dims,
      nan_fraction: nanFraction,
      inf_fraction: countNonFinite(raw) / raw.length,
      spearman_rho: rho,
      plane_separation: separation,
      edge_alignment: edgeScore,
      normalization_range: [canonical.low, canonical.high],
      raw_convention: fixtureNearIsHigh ? 'nearIsHigh' : 'nearIsLow',
      raw_near_mean: rawNearMean,
      raw_far_mean: rawFarMean,
    };
    results.push(entry);
    console.log(
      `[depth-verify] ${fixture.key.padEnd(12)} nan=${nanFraction.toFixed(4)} ` +
        `rho=${rho.toFixed(3)} sep=${separation.toFixed(3)} edge=${edgeScore.toFixed(3)}`,
    );
  }

  // 6. Gate. Thresholds are evidence-based lower bounds set from the first
  // verified run (2026-08-13): synthetic fixtures are pessimistic for a model
  // trained on real imagery, so the gate targets regressions (NaN/Inf, sign
  // flips, degenerate outputs, contract drift) rather than top synthetic
  // accuracy. Corridor cues (perspective wedges) are the weakest fixture.
  const twoPlane = results.find((r) => r.fixture === 'two_plane');
  const corridor = results.find((r) => r.fixture === 'corridor');
  const uniform = results.find((r) => r.fixture === 'flat_uniform');
  void uniform; // flat-uniform fixture is recorded in metrics below
  const checks = {
    integrity: {
      passed: integrityPassed,
      message: integrityPassed ? 'SHA-256 matches pinned' : 'SHA-256 mismatch',
    },
    contract: {
      passed: true,
      message: `inputs ${inputNames.join(',')}, outputs ${outputNames.join(',')}, output dims [1,518,518]`,
    },
    nan_free: {
      passed: results.every((r) => r.nan_fraction === 0),
      message: 'no NaN/Inf in any fixture output',
    },
    two_plane_ordering: {
      passed: (twoPlane?.spearman_rho ?? 0) > 0.25 && (twoPlane?.plane_separation ?? 0) > 0.2,
      message: `two-plane rho ${(twoPlane?.spearman_rho ?? 0).toFixed(3)}, separation ${(twoPlane?.plane_separation ?? 0).toFixed(3)}`,
    },
    corridor_ordering: {
      passed: (corridor?.spearman_rho ?? 0) > 0.2,
      message: `corridor rho ${(corridor?.spearman_rho ?? 0).toFixed(3)}`,
    },
    portrait_ordering: {
      passed: (results.find((r) => r.fixture === 'portrait')?.spearman_rho ?? 0) > 0.2,
      message: `portrait rho ${(results.find((r) => r.fixture === 'portrait')?.spearman_rho ?? 0).toFixed(3)}`,
    },
    sign_consistency: {
      passed:
        new Set(
          perFixtureConventions
            .filter((c) => c.fixture !== 'flat_uniform')
            .map((c) => c.nearIsHigh),
        ).size === 1,
      message: perFixtureConventions
        .filter((c) => c.fixture !== 'flat_uniform')
        .map((c) => `${c.fixture}=nearIs${c.nearIsHigh ? 'High' : 'Low'}`)
        .join(', '),
    },
    edge_alignment: {
      passed: (twoPlane?.edge_alignment ?? 0) > 0.55,
      message: `two-plane edge agreement ${(twoPlane?.edge_alignment ?? 0).toFixed(3)}`,
    },
  };
  const passed = Object.values(checks).every((c) => c.passed);

  const report = {
    model_id: MODEL_ID,
    model_file: MODEL_FILENAME,
    model_path: modelPath,
    sha256: sha,
    pinned_sha256: PINNED_SHA256,
    ort_version: ort.env?.versions?.onnxruntime ?? 'unknown',
    runtime: 'onnxruntime-node cpu',
    preprocessing: 'letterbox 518x518, ImageNet normalize, NCHW, zero pad',
    output_contract: {
      input_name: inputName,
      output_name: outputName,
      dims: [1, INPUT_SIZE, INPUT_SIZE],
    },
    raw_convention: observedNearIsHigh ? 'nearIsHigh' : 'nearIsLow',
    per_fixture_conventions: perFixtureConventions,
    canonical_convention: '0 = near, 1 = far',
    latency_ms: { cold_first_pass: coldLoad, warm_p50: p50, warm_p95: p95 },
    checks,
    metrics: results,
    overall_passed: passed,
    generation_timestamp: new Date().toISOString(),
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[depth-verify] report written to ${REPORT_PATH}`);
  console.log(`[depth-verify] overall ${passed ? 'PASS' : 'FAIL'}`);
  process.exitCode = passed ? 0 : 1;
}

function osLoad() {
  return loadavg()[0]?.toFixed(1) ?? '?';
}

function countNonFinite(data) {
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) count++;
  }
  return count;
}

main().catch((error) => {
  console.error('[depth-verify] failed:', error);
  process.exit(1);
});
