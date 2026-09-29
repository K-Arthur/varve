# Tonal control measurements — 2026-09-28

The bounded kernel harness is
`packages/engine/src/bench/tonalControls.bench.ts`. Run it through the heavy
lease with one worker:

```bash
node scripts/quality/heavy-lease.mjs 'tonal controls' -- \
  pnpm exec vitest bench --config vitest.bench.config.ts \
  packages/engine/src/bench/tonalControls.bench.ts --run --maxWorkers=1 \
  --outputJson reports/tonal-controls.json
```

Measured on the available Linux x86-64 host using Node 22.23.2 and Vitest
4.1.10. The harness warms each case, uses a deterministic midrange RGB fixture,
and bounds each case to 150ms requested measurement time / at least three
iterations after warmup. The existing configuration runs both node and jsdom
projects; these are two environments, not two independent hardware trials.
The final harness gives every in-place operator a fresh input RGBA copy;
Gaussian returns its own result. Do not infer relative rankings between unrelated
algorithms from this harness. It does not measure UI latency, cold browser
startup, GPU performance, physical low-end devices or resident process memory.

The initial node-project means before the split-tone optimization were below.
That exploratory harness reused the Curves input between iterations, so its
Curves/white-balance numbers are historical observations rather than a valid
fresh-source comparison. The final harness repairs that fixture lifetime.

| Case | Pixels | Mean |
| --- | ---: | ---: |
| Compiled curves | 1,048,576 | 23.30ms |
| Relative white balance | 1,048,576 | 19.48ms |
| Split tone | 262,144 | 348.90ms |
| Gaussian linear sharpen, radius 3 | 262,144 | 187.53ms |
| Gaussian linear sharpen, radius 12 | 262,144 | 296.49ms |
| Legacy box sharpen, radius 12 | 262,144 | 911.34ms |

The Gaussian radius-12 implementation was about 3.07 times faster than the
legacy box path on this workload. They deliberately have different operators;
this is not a promise that Gaussian and box sharpening produce identical
pixels. The independent full 2D Gaussian reference checks correctness across
stripe/block boundaries. Large radii still require substantial CPU work.

The measured split-tone bottleneck led to a 256-entry decoded-sRGB table,
compiled tonal-range parameters and direct shared Lab-to-linear-RGB conversion
for in-gamut pixels. Out-of-gamut pixels still use the existing shared gamut
compressor. Byte-compatibility fixtures cover thousands of colors and partial
alpha. Separate before/after runs varied substantially with host load, so
those runs are not used to claim an improvement. A paired rerun includes the
original v1 implementation as a benchmark-only helper alongside the optimized
operator, on the same fixture in the same process:

| Environment | Original split tone | Optimized split tone | Reduction in mean |
| --- | ---: | ---: | ---: |
| node | 232.69ms | 160.86ms | 30.9% |
| jsdom | 237.64ms | 163.65ms | 31.1% |

Each split-tone case has three measured iterations. Optimized relative error
is ±13.20% in node and ±10.64% in jsdom, so the mean is a workload observation,
not a hardware-independent latency guarantee. The byte-parity tests are a
separate correctness gate. The paired node run also measures curves at
15.72ms/1MP, white balance at 12.73ms/1MP, and Gaussian radius 3/12 at
132.38ms/202.12ms per 262k pixels. These timings demonstrate why large spatial
or Oklab surfaces cannot be advertised as immediate synchronous previews.

Durable raw results: [initial](tonal-controls-2026-09-28/benchmark.json) and
[paired](tonal-controls-2026-09-28/benchmark-paired.json). The original helper
has no production consumers and exists only to reproduce this comparison.

The [final fresh-source run](tonal-controls-2026-09-28/benchmark-final.json)
measures node Curves 28.29ms/1MP and white balance 20.79ms/1MP including copies.
Node Gaussian radius 3/12 is 129.41ms/202.12ms per 262k pixels. Split tone is
371.90ms original / 155.21ms optimized in node, and 354.45ms / 255.12ms in
jsdom. The different reduction (58.3% versus 28.0%) and wide relative errors
show substantial shared-host load variation. The earlier paired 30.9%/31.1%
observation is retained with its uncertainty; none is a controlled hardware
performance certificate. The heavy lease serialized participating tasks, but
cannot control unrelated browser/process load or eliminate sequential-order
bias. No benchmark threshold or architecture baseline was weakened.

## Actual browser diagnostic latency

The real Chromium sharpening/reopen spec observes captured UI clicks and
completed output canvas uploads for a 128×128 document-pixel comparison,
including its spatial halo, on the 512×384 reference. The app is already
loaded. A new region took 32.0ms; another uncached region took 27.2ms; returning
to the first cached upstream source took 30.2ms. The selected filter still
evaluates on the cached-source request. All three preserve the expected
input/output hashes, including after fit view and offline reopen.

Raw [detail latency](tonal-controls-2026-09-28/detail-latency.json) records the
measurement boundary. This is three requests, not a latency distribution or
peak-memory sample. It establishes useful requested-detail behavior on this
host without certifying cold app startup, full-document refinement, mixed
drawing/panning responsiveness or physical low-end devices.

Memory limits are implementation bounds, not sampled resident-memory claims:
Gaussian scratch is at most 16MiB in floating stripes/64-row blocks including
halos; RGBA source/result are additional. The diagnostic cache holds at most
eight entries and 2MiB of pixel payload. Overview samples are at most 256px;
requested document detail refuses halo surfaces above one megapixel. Original
source detail reuses the decoded cache and allocates a 128px crop. The source
cache itself, browser canvas backing stores and document resources are outside
these bounds.

These kernels are synchronous reference operators. A large split-tone or
sharpen surface can delay the main thread; the measurements do not justify a
60fps or universal low-end responsiveness claim. The existing render scheduler
owns preview coalescing; no new scheduler/model/vectorscope workload was added.
Physical Chromebook Duet browser and ARM64/Crostini timings, cold/warm end-to-end
preview latency and mixed drawing/navigation profiling remain separate manual
qualification. A bounded diagnostic view is not a reduced-quality export.
