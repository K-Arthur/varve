/**
 * Live effects family — non-destructive procedural effects on the shared
 * Adjustment pipeline.
 *
 * Each module implements a self-contained, deterministic ImageData kernel
 * with plain serializable parameters. The filter dispatch in
 * filterCompositor.ts maps FilterIR variants onto these kernels; effect
 * metadata (working space, alpha convention, export behaviour, bounds
 * expansion) lives in effectContract.ts / adjustmentPipeline.ts.
 */

export * from './bloom';
export * from './caustics';
export * from './crt';
export * from './dispatch';
export * from './dither';
export * from './lensFlare';
export * from './lightLeak';
export * from './lightShafts';
export * from './paletteCore';
export * from './paletteSnap';
export * from './presets';
export * from './prng';
export * from './quality';
export * from './rgbSplit';
export * from './vhs';
