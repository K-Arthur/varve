/**
 * Precision capability detection — hardware-aware INT8 acceleration probing.
 *
 * ONNX Runtime's CPU EP only accelerates INT8 GEMM when the CPU has
 * AVX-512 VNNI (Ice Lake+, Zen 4+) or ARM dot-product instructions.
 * On AVX2-only CPUs (Coffee Lake, Zen 2/3, most laptops before 2020),
 * INT8 dynamic quantization adds dequantization overhead with no compute
 * savings — making it ~6x *slower* than FP32 for small Conv models.
 *
 * This module provides a cached, lazily-evaluated capability probe that
 * combines static provider detection with an optional runtime micro-
 * benchmark. The result feeds the precision selection policy.
 *
 * Research basis:
 *   - ONNX Runtime CPU EP: QDQ (QuantizeDequantize) pattern requires
 *     AVX-512 VNNI for VNNI-accelerated dp4a; AVX2 falls back to
 *     VPBROADCASTW + VPMADDWD with FP32 multiply-add (no net win).
 *   - Measured on Ryzen 3 5300U (Zen 2, AVX2): INT8 6.2x slower than
 *     FP32 for u2netp (Conv-heavy, 119 Conv nodes) — see
 *     apps/desktop/public/models/quantized/u2netp-benchmark.json.
 *   - WebGPU: WGSL has no i8 dot-product; FP16 is the native reduced
 *     precision. INT8 is not a WebGPU target.
 */

export interface PrecisionCapabilities {
  /** True when INT8 GEMM is hardware-accelerated in the active EP. */
  int8Accelerated: boolean;
  /** True when FP16 is natively supported (WebGPU, some GPUs). */
  fp16Supported: boolean;
  /** The execution provider this assessment was made for. */
  provider: string;
  /** How the determination was made. */
  detectionMethod: 'static' | 'benchmark' | 'override' | 'default';
  /** Human-readable reason for the determination. */
  reason: string;
  /** Measured INT8/FP32 speedup ratio (1.0 = same speed). null if not benchmarked. */
  measuredSpeedup: number | null;
  /** When this assessment was made (ms since epoch). */
  evaluatedAt: number;
}

/** Serialized cache key. */
const CACHE_KEY = 'strata-precision-capabilities';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

let cachedCapabilities: PrecisionCapabilities | null = null;
let pendingEvaluation: Promise<PrecisionCapabilities> | null = null;

/**
 * Static detection based on provider and environment.
 *
 * This is intentionally conservative: it only returns `true` for
 * int8Accelerated when we have positive evidence. The absence of
 * evidence (e.g. unknown CPU) is treated as "not accelerated".
 */
function detectStaticCapabilities(provider: string): PrecisionCapabilities {
  const evaluatedAt = Date.now();

  // WebGPU / WebGL: no INT8 dot-product in WGSL/GLSL. FP16 is native.
  if (provider === 'webgpu') {
    return {
      int8Accelerated: false,
      fp16Supported: true,
      provider,
      detectionMethod: 'static',
      reason: 'WebGPU has no INT8 dot-product instruction; FP16 is the native reduced precision.',
      measuredSpeedup: null,
      evaluatedAt,
    };
  }

  if (provider === 'webgl') {
    return {
      int8Accelerated: false,
      fp16Supported: true,
      provider,
      detectionMethod: 'static',
      reason: 'WebGL has no INT8 compute; FP16 is supported via half-float textures.',
      measuredSpeedup: null,
      evaluatedAt,
    };
  }

  // Native (Tauri Rust onnxruntime): same CPU ISA limits apply.
  // We cannot read CPUID from JS, so we default to conservative false.
  // A runtime benchmark can override this.
  if (provider === 'native') {
    return {
      int8Accelerated: false,
      fp16Supported: false,
      provider,
      detectionMethod: 'static',
      reason:
        'Native ONNX Runtime INT8 acceleration requires AVX-512 VNNI; cannot detect from JS. Defaulting to FP32-safe.',
      measuredSpeedup: null,
      evaluatedAt,
    };
  }

  // WASM: no AVX-512, no VNNI. INT8 is never accelerated.
  if (provider === 'wasm') {
    return {
      int8Accelerated: false,
      fp16Supported: false,
      provider,
      detectionMethod: 'static',
      reason:
        'WASM SIMD has no INT8 dot-product; INT8 dequantization overhead dominates on AVX2-only CPUs.',
      measuredSpeedup: null,
      evaluatedAt,
    };
  }

  // Unknown provider: conservative default.
  return {
    int8Accelerated: false,
    fp16Supported: false,
    provider,
    detectionMethod: 'default',
    reason: `Unknown provider '${provider}'; defaulting to FP32-safe.`,
    measuredSpeedup: null,
    evaluatedAt,
  };
}

/**
 * Run a micro-benchmark using the actual bundled u2netp model at a tiny
 * input size to determine whether INT8 is faster than FP32 on this CPU.
 *
 * Uses 64x64 input (vs normal 320x320) to keep the benchmark under ~2s
 * while still exercising the Conv-heavy graph enough to reveal the
 * dequantization overhead that dominates on AVX2-only hardware.
 *
 * Returns the measured INT8/FP32 speedup ratio (e.g. 0.16 means INT8
 * was 6.25x slower). Returns null if the benchmark cannot run.
 */
export async function runPrecisionBenchmark(
  provider = 'wasm',
): Promise<{ speedup: number; fp32Ms: number; int8Ms: number } | null> {
  try {
    const ort = (await import('onnxruntime-web')) as unknown as {
      InferenceSession: {
        create: (
          path: string,
          opts?: { executionProviders?: string[] },
        ) => Promise<{
          run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
          release: () => Promise<void>;
          inputNames: readonly string[];
          outputNames: readonly string[];
        }>;
      };
      Tensor: new (
        type: string,
        data: ArrayLike<number>,
        dims: number[],
      ) => {
        dispose: () => void;
      };
      env: { wasm: { wasmPaths: string | Record<string, string> } };
    };

    ort.env.wasm.wasmPaths = '/ort-wasm/';

    const { getManifestEntry } = await import('./modelManifest');
    const fp32Entry = await getManifestEntry('u2netp');
    const int8Entry = await getManifestEntry('u2netp-int8');

    if (!fp32Entry?.localPath || !int8Entry?.localPath) {
      return null;
    }

    const inputSize = 64;
    const warmupRuns = 2;
    const benchRuns = 5;

    const fp32Session = await ort.InferenceSession.create(fp32Entry.localPath, {
      executionProviders: [provider === 'native' ? 'cpu' : provider],
    });
    const int8Session = await ort.InferenceSession.create(int8Entry.localPath, {
      executionProviders: [provider === 'native' ? 'cpu' : provider],
    });

    const dummyInput = new Float32Array(1 * 3 * inputSize * inputSize);
    const fp32InputName = fp32Session.inputNames[0];
    const int8InputName = int8Session.inputNames[0];
    if (!fp32InputName || !int8InputName) return null;

    // Warmup
    for (let i = 0; i < warmupRuns; i++) {
      const t = new ort.Tensor('float32', dummyInput, [1, 3, inputSize, inputSize]);
      try {
        await fp32Session.run({ [fp32InputName]: t } as Record<string, unknown>);
      } finally {
        t.dispose();
      }
      const t2 = new ort.Tensor('float32', dummyInput, [1, 3, inputSize, inputSize]);
      try {
        await int8Session.run({ [int8InputName]: t2 } as Record<string, unknown>);
      } finally {
        t2.dispose();
      }
    }

    // Benchmark FP32
    const fp32Times: number[] = [];
    for (let i = 0; i < benchRuns; i++) {
      const t = new ort.Tensor('float32', dummyInput, [1, 3, inputSize, inputSize]);
      const start = performance.now();
      try {
        await fp32Session.run({ [fp32InputName]: t } as Record<string, unknown>);
      } finally {
        t.dispose();
      }
      fp32Times.push(performance.now() - start);
    }

    // Benchmark INT8
    const int8Times: number[] = [];
    for (let i = 0; i < benchRuns; i++) {
      const t = new ort.Tensor('float32', dummyInput, [1, 3, inputSize, inputSize]);
      const start = performance.now();
      try {
        await int8Session.run({ [int8InputName]: t } as Record<string, unknown>);
      } finally {
        t.dispose();
      }
      int8Times.push(performance.now() - start);
    }

    await fp32Session.release();
    await int8Session.release();

    fp32Times.sort((a, b) => a - b);
    int8Times.sort((a, b) => a - b);
    const fp32Median = fp32Times[Math.floor(fp32Times.length / 2)];
    const int8Median = int8Times[Math.floor(int8Times.length / 2)];
    if (fp32Median === undefined || int8Median === undefined) return null;
    if (fp32Median <= 0) return null;

    return {
      speedup: int8Median / fp32Median,
      fp32Ms: fp32Median,
      int8Ms: int8Median,
    };
  } catch {
    return null;
  }
}

/**
 * Determine precision capabilities for the given provider.
 *
 * Resolution order:
 * 1. Cached result (if fresh).
 * 2. localStorage persisted result (if fresh).
 * 3. Static detection (always available, conservative).
 * 4. Runtime benchmark (if `runBenchmark` is true) — overrides static.
 */
export async function detectPrecisionCapabilities(
  provider: string,
  runBenchmark = false,
): Promise<PrecisionCapabilities> {
  // 1. In-memory cache
  if (cachedCapabilities && Date.now() - cachedCapabilities.evaluatedAt < CACHE_TTL_MS) {
    return cachedCapabilities;
  }

  // 2. localStorage cache
  const persisted = readCachedCapabilities();
  if (persisted && Date.now() - persisted.evaluatedAt < CACHE_TTL_MS) {
    cachedCapabilities = persisted;
    return cachedCapabilities;
  }

  // 3. Static detection (always available)
  let result = detectStaticCapabilities(provider);

  // 4. Optional runtime benchmark
  if (runBenchmark) {
    // Deduplicate concurrent benchmark calls
    if (!pendingEvaluation) {
      pendingEvaluation = (async () => {
        try {
          const bench = await runPrecisionBenchmark(provider);
          if (bench) {
            const int8Faster = bench.speedup < 0.8; // INT8 faster if < 80% of FP32 time
            result = {
              int8Accelerated: int8Faster,
              fp16Supported: result.fp16Supported,
              provider,
              detectionMethod: 'benchmark',
              reason: int8Faster
                ? `Benchmark: INT8 ${(1 / bench.speedup).toFixed(1)}x faster than FP32 on this CPU.`
                : `Benchmark: INT8 ${(bench.speedup * 100).toFixed(0)}% of FP32 speed (${(1 / bench.speedup).toFixed(1)}x slower). Using FP32.`,
              measuredSpeedup: bench.speedup,
              evaluatedAt: Date.now(),
            };
          }
        } catch {
          // keep static result
        } finally {
          pendingEvaluation = null;
        }
        return result;
      })();
    }
    result = await pendingEvaluation;
  }

  cachedCapabilities = result;
  persistCapabilities(result);
  return result;
}

/**
 * Fast synchronous check — returns cached/assessed capabilities or a
 * conservative default without running a benchmark.
 */
export function getPrecisionCapabilitiesSync(provider = 'wasm'): PrecisionCapabilities {
  if (cachedCapabilities) return cachedCapabilities;
  const persisted = readCachedCapabilities();
  if (persisted) {
    cachedCapabilities = persisted;
    return persisted;
  }
  return detectStaticCapabilities(provider);
}

/**
 * Record whether INT8 is faster on this CPU — the single decision point
 * for the precision selection policy.
 *
 * Separated from the full capability object so the policy can call it
 * without triggering a benchmark.
 */
export async function isInt8FasterOnThisCpu(provider = 'wasm'): Promise<boolean> {
  const caps = await detectPrecisionCapabilities(provider);
  return caps.int8Accelerated;
}

function readCachedCapabilities(): PrecisionCapabilities | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PrecisionCapabilities;
  } catch {
    return null;
  }
}

function persistCapabilities(caps: PrecisionCapabilities): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(caps));
  } catch {
    // storage unavailable — in-memory cache still works
  }
}

/**
 * Invalidate cached capabilities (e.g. after runtime update, or when
 * the user requests a re-benchmark).
 */
export function resetPrecisionCapabilities(): void {
  cachedCapabilities = null;
  pendingEvaluation = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Manually override capabilities (e.g. from a developer tool or when
 * the user explicitly opts into INT8 despite the benchmark).
 */
export function overridePrecisionCapabilities(
  int8Accelerated: boolean,
  reason: string,
  provider = 'wasm',
): PrecisionCapabilities {
  const result: PrecisionCapabilities = {
    int8Accelerated,
    fp16Supported: detectStaticCapabilities(provider).fp16Supported,
    provider,
    detectionMethod: 'override',
    reason,
    measuredSpeedup: null,
    evaluatedAt: Date.now(),
  };
  cachedCapabilities = result;
  persistCapabilities(result);
  return result;
}
