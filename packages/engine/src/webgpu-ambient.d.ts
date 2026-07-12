/**
 * Ambient WebGPU globals for gpuAccelerator.ts, sourced from the real
 * `@webgpu/types` package instead of a hand-maintained subset (which drifted
 * from the spec — see git history for the 547-line version this replaced).
 *
 * A real `/// <reference types>` directive rather than a package.json
 * `"types"` array entry: other workspace packages type-check @strata/engine's
 * .ts sources directly (no project-reference build boundary), so the ambient
 * globals need to leak the same way the old hand-rolled .d.ts did.
 */
/// <reference types="@webgpu/types" />
