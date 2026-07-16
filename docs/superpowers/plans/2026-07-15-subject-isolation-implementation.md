# Subject Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Strata's preview-only image background-removal prototype with a source-resolution, cancellable, non-destructive native raster-mask workflow that works through every UI, persistence, rendering, and export path.

**Architecture:** Extend the existing scene `Mask` model with immutable document-owned raster mask assets, centralize source/image/mask coordinate conversion, and route every command through one revision-checked subject-isolation service. Browser inference runs in an application-owned ONNX worker with WebGPU/WASM provider selection; desktop uses the same protocol through a bounded native provider. Rendering, refinement, thumbnails, and exports consume the same raster mask and placement metadata.

**Tech Stack:** TypeScript strict mode, React, Vitest, Playwright, Canvas2D/OffscreenCanvas, ONNX Runtime Web, Tauri 2, Rust, serde, image, optional native ONNX Runtime.

---

## File Map

- `packages/scene/src/types.ts`: native raster mask and asset contracts.
- `packages/scene/src/document.ts`: document-owned raster mask asset table and immutable operations.
- `packages/scene/src/masks.ts`: mask validation/CRUD for leaf raster masks and container masks.
- `packages/scene/src/version.ts`: legacy `backgroundRemoval` migration.
- `packages/scene/src/documentCodec.ts`: resource-bound validation and normalization.
- `packages/engine/src/imagePlacement.ts`: canonical source/local placement and inverse mapping.
- `packages/engine/src/backgroundRemoval/protocol.ts`: request/result/progress protocol with revisions.
- `packages/engine/src/backgroundRemoval/worker.ts`: app-owned worker provider selection and request IDs.
- `packages/engine/src/backgroundRemoval/workerPool.ts`: safe cancellation/termination/replacement.
- `packages/engine/src/backgroundRemoval/reconstructMask.ts`: model-space to source-space reconstruction.
- `packages/editor/src/context/useBackgroundRemoval.ts`: thin integration with the service.
- `packages/editor/src/backgroundRemoval/SubjectIsolationService.ts`: decode, inference, stale checks, commit preparation, cleanup.
- `packages/editor/src/tools/imageMaskCoordinates.ts`: tool pointer to source-mask pixels.
- `packages/editor/src/tools/RefineMaskTool.ts`: pressure/coalesced restore/remove brush.
- `packages/editor/src/tools/TrimapEditTool.ts`: transformed trimap painting and live overlay.
- `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`: canonical controls.
- `packages/editor/src/components/SelectionQuickBar/quickBarActions.ts`: shared-command quick access.
- `packages/editor/src/components/LayersPanel/useThumbnail.ts`: masked thumbnail rendering.
- `packages/codegen/src/svg.ts`: aligned SVG image masks.
- `crates/strata-print/src/lib.rs`: PDF soft-mask or deliberate raster flattening.
- `packages/editor/src/packageExport.ts`: extracted/deduplicated mask assets.
- `tests/e2e/effects/bgRemoval.spec.ts`: real apply/refine/persist/export workflow.
- `tests/fixtures/background-removal/`: licensed fixture corpus plus provenance manifest.

## Task 1: Native raster-mask contract and legacy migration

**Files:**

- Modify: `packages/scene/src/types.ts`
- Modify: `packages/scene/src/document.ts`
- Modify: `packages/scene/src/masks.ts`
- Modify: `packages/scene/src/version.ts`
- Modify: `packages/scene/src/documentCodec.ts`
- Test: `packages/scene/src/__tests__/rasterMask.test.ts`
- Test: `packages/scene/src/version.test.ts`

- [ ] **Step 1: Write failing scene tests**

Add tests that construct a document with one image shape and prove all of these behaviors independently:

```ts
it('attaches a source-pixel raster alpha mask to an image shape', () => {
  const { doc, imageId } = makeImageDocument();
  const next = addRasterMaskAsset(doc, imageId, makeRasterAsset('mask-1', 64, 32));
  expect(next.nodes[imageId]?.mask?.rasterMask).toEqual({
    assetId: 'mask-1',
    coordinateSpace: 'source-image-pixels',
    sourceFingerprint: 'sha256:image-a',
    sourcePixelRevision: 1,
  });
  expect(next.rasterMaskAssets?.['mask-1']?.width).toBe(64);
});

it('migrates legacy backgroundRemoval into a native raster mask', () => {
  const decoded = DocumentCodec.decode(JSON.stringify(makeLegacyBackgroundRemovalDocument()));
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  const image = decoded.document.nodes['1'];
  expect(image?.mask?.type).toBe('alpha');
  expect(image?.mask?.rasterMask?.coordinateSpace).toBe('source-image-pixels');
  expect('backgroundRemoval' in (image ?? {})).toBe(false);
});

it('rejects oversized raster mask payloads during decode', () => {
  const decoded = DocumentCodec.decode(JSON.stringify(makeOversizedRasterMaskDocument()));
  expect(decoded.ok).toBe(false);
  if (decoded.ok) return;
  expect(decoded.error).toMatch(/raster mask.*limit/i);
});
```

- [ ] **Step 2: Run the tests and verify the expected RED state**

Run:

```bash
pnpm exec vitest run packages/scene/src/__tests__/rasterMask.test.ts packages/scene/src/version.test.ts
```

Expected: failure because `RasterMaskAsset`, `NodeBase.mask`, and `addRasterMaskAsset` do not exist and version `2.1` is unsupported.

- [ ] **Step 3: Implement the minimal native model**

Add these contracts, then make `mask?: Mask` a `NodeBase` property and remove duplicate declarations from container interfaces:

```ts
export interface RasterMaskAsset {
  id: string;
  mimeType: 'image/png';
  dataUrl: string;
  width: number;
  height: number;
  byteLength: number;
  checksum?: string;
}

export interface RasterMaskData {
  assetId: string;
  coordinateSpace: 'source-image-pixels';
  sourceFingerprint: string;
  sourcePixelRevision: number;
  editRevision?: number;
  staleReason?: 'source-replaced' | 'source-changed';
  provenance?: BackgroundRemovalProvenance;
}

export interface BackgroundRemovalProvenance {
  method: 'quick' | 'ai-balanced' | 'ai-quality';
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  runtime: 'typescript' | 'wasm' | 'webgpu' | 'native-cpu' | 'native-accelerated';
  generatedAt: number;
  confidence?: number;
}

export interface Mask {
  type: MaskType;
  sourceNodeId?: NodeId;
  vectorMask?: VectorMaskData;
  rasterMask?: RasterMaskData;
  visible: boolean;
  inverted?: boolean;
  feather?: number;
  density?: number;
  linked?: boolean;
  transform?: Affine;
  hideMaskSource?: boolean;
  fillRule?: MaskFillRule;
}
```

Add `rasterMaskAssets?: Record<string, RasterMaskAsset>` to `Document`, immutable asset attach/update/remove helpers, exactly-one-source validation, version `2.1`, and a migration that creates stable asset IDs from node IDs. Decode limits are 16,384 pixels per dimension, 268,435,456 decoded pixels, and 128 MiB encoded payload per asset.

- [ ] **Step 4: Run focused scene tests until GREEN**

Run the same Vitest command. Expected: all new tests pass with no warnings.

- [ ] **Step 5: Run the mandatory architecture-change protocol**

Run in order:

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:emoji
pnpm audit:tokens
```

Expected: 17/17 typecheck packages, zero new lint errors, all tests passing, zero emoji violations, and all token contrast pairs passing.

- [ ] **Step 6: Commit**

```bash
git add packages/scene/src/types.ts packages/scene/src/document.ts packages/scene/src/masks.ts packages/scene/src/version.ts packages/scene/src/documentCodec.ts packages/scene/src/__tests__/rasterMask.test.ts packages/scene/src/version.test.ts
git commit -m "feat(scene): add native raster alpha masks"
```

## Task 2: Canonical source-pixel placement

**Files:**

- Create: `packages/engine/src/imagePlacement.ts`
- Create: `packages/engine/src/imagePlacement.test.ts`
- Modify: `packages/engine/src/replay.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/editor/src/tools/imageMaskCoordinates.ts`
- Create: `packages/editor/src/tools/__tests__/imageMaskCoordinates.test.ts`

- [ ] **Step 1: Write failing table-driven placement tests**

Use a 4000 by 3000 source in an 800 by 800 local rectangle and assert forward/inverse round trips for `fit`, `fill`, and `stretch`, offsets, crop-equivalent offsets, nested affine transforms, 90-degree rotation, non-uniform scale, horizontal/vertical flips, and out-of-bounds points:

```ts
for (const fit of ['fit', 'fill', 'stretch'] as const) {
  it(`round-trips source pixels through ${fit} placement`, () => {
    const placement = computeImagePlacement({
      sourceWidth: 4000,
      sourceHeight: 3000,
      bounds: { x: 0, y: 0, width: 800, height: 800 },
      fit,
      offsetX: 0.1,
      offsetY: -0.2,
      scale: 1.25,
    });
    const local = sourcePixelToLocal({ x: 1234, y: 987 }, placement);
    const roundTrip = localToSourcePixel(local, placement);
    expect(roundTrip.x).toBeCloseTo(1234, 6);
    expect(roundTrip.y).toBeCloseTo(987, 6);
  });
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run packages/engine/src/imagePlacement.test.ts packages/editor/src/tools/__tests__/imageMaskCoordinates.test.ts
```

Expected: module-not-found failures for the new leaf utilities.

- [ ] **Step 3: Extract placement math without changing pixels**

Implement `computeImagePlacement`, `sourcePixelToLocal`, and `localToSourcePixel` as pure functions. Replace the private image-placement branch in `replay.ts` with the utility. Add the editor adapter that applies `nodeWorldTransform`, affine inversion, and the engine placement inverse. Keep `CanvasArea.tsx` and `Shell.tsx` import counts unchanged.

- [ ] **Step 4: Verify unit and render parity**

Run:

```bash
pnpm exec vitest run packages/engine/src/imagePlacement.test.ts packages/engine/src/replay.test.ts packages/editor/src/tools/__tests__/imageMaskCoordinates.test.ts
```

Expected: new tests pass and existing replay goldens remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/imagePlacement.ts packages/engine/src/imagePlacement.test.ts packages/engine/src/replay.ts packages/engine/src/index.ts packages/editor/src/tools/imageMaskCoordinates.ts packages/editor/src/tools/__tests__/imageMaskCoordinates.test.ts
git commit -m "refactor(engine): centralize image pixel placement"
```

## Task 3: Revision-safe worker protocol and fallback buffers

**Files:**

- Create: `packages/engine/src/backgroundRemoval/protocol.ts`
- Modify: `packages/engine/src/backgroundRemoval/types.ts`
- Modify: `packages/engine/src/backgroundRemoval/worker.ts`
- Modify: `packages/engine/src/backgroundRemoval/workerPool.ts`
- Modify: `packages/engine/src/backgroundRemoval/providers/dispatch.ts`
- Test: `packages/engine/src/backgroundRemoval/__tests__/workerPool.test.ts`
- Test: `packages/engine/src/backgroundRemoval/__tests__/dispatchCancellation.test.ts`

- [ ] **Step 1: Write race and detached-buffer reproductions**

```ts
it('never resolves job B with a late result from cancelled job A', async () => {
  const first = runPooledInference(imageA, options, path, model, abortA.signal);
  abortA.abort();
  const second = runPooledInference(imageB, options, path, model);
  workers[0]!.emitMessage(resultMessage(firstRequestId, resultA));
  workers[1]!.emitMessage(resultMessage(secondRequestId, resultB));
  await expect(first).rejects.toThrow(/cancelled/i);
  await expect(second).resolves.toEqual(resultB);
});

it('gives the fallback provider intact pixels after worker failure', async () => {
  workerProvider.remove.mockRejectedValue(new Error('worker failed'));
  directProvider.remove.mockImplementation(async (pixels) => {
    expect(pixels.data.byteLength).toBeGreaterThan(0);
    return resultB;
  });
  await expect(dispatchBackgroundRemoval(imageA, options)).resolves.toEqual(resultB);
});
```

- [ ] **Step 2: Verify RED**

Run the two focused test files. Expected: the late response resolves the wrong job or the fallback receives a detached buffer.

- [ ] **Step 3: Implement request IDs and hard cancellation**

Every command/progress/result/error includes `requestId`. A timed-out or cancelled active job terminates its Worker, rejects only its matching promise, creates a replacement Worker, and dispatches no new work to the old instance. Provider dispatch keeps an immutable source buffer and sends a clone/transfer-owned buffer to each destructive provider attempt.

- [ ] **Step 4: Verify GREEN and worker cleanup**

Run all background-removal worker/provider tests. Expected: no unhandled rejection, each job resolves exactly once, and worker counts return to the configured bound.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/backgroundRemoval/protocol.ts packages/engine/src/backgroundRemoval/types.ts packages/engine/src/backgroundRemoval/worker.ts packages/engine/src/backgroundRemoval/workerPool.ts packages/engine/src/backgroundRemoval/providers/dispatch.ts packages/engine/src/backgroundRemoval/__tests__/workerPool.test.ts packages/engine/src/backgroundRemoval/__tests__/dispatchCancellation.test.ts
git commit -m "fix(engine): make subject isolation cancellation race-safe"
```

## Task 4: Source-resolution reconstruction and alpha correctness

**Files:**

- Create: `packages/engine/src/backgroundRemoval/reconstructMask.ts`
- Create: `packages/engine/src/backgroundRemoval/__tests__/reconstructMask.test.ts`
- Modify: `packages/engine/src/backgroundRemoval/worker.ts`
- Modify: `packages/engine/src/backgroundRemoval/providers/directOnnxProvider.ts`
- Modify: `crates/strata-bgremove/src/inference.rs`
- Test: `crates/strata-bgremove/src/lib.rs`

- [ ] **Step 1: Write failing reconstruction tests**

Test portrait and panorama letterbox transforms, exact source dimensions, no one-pixel translation, holes, thin lines, original-alpha multiplication, and transparent hidden RGB:

```ts
it('reconstructs a letterboxed matte into exact source coordinates', () => {
  const transform = makeLetterboxTransform(4000, 1000, 1024, 1024);
  const sourceMask = reconstructModelMask(makeCenteredModelMask(), transform);
  expect(sourceMask.width).toBe(4000);
  expect(sourceMask.height).toBe(1000);
  expect(edgeBounds(sourceMask.alpha)).toEqual({ left: 1000, top: 0, right: 2999, bottom: 999 });
});

it('never increases existing source alpha', () => {
  expect(composeSourceAndSubjectAlpha(Uint8Array.of(32), Uint8Array.of(255))).toEqual(Uint8Array.of(32));
});
```

- [ ] **Step 2: Verify RED**

Run TypeScript and Rust focused tests. Expected: current direct-square resize cannot reconstruct a letterbox transform and output dimensions remain preview-sized.

- [ ] **Step 3: Implement shared transform metadata and reconstruction**

Store the exact source-to-model transform in each result. Reconstruct the soft matte to natural oriented source dimensions, apply edge-band refinement in bounded tiles with overlap, and multiply by source alpha. Keep `previewMaxDimension` only as the global inference input constraint, not final output dimensions.

- [ ] **Step 4: Verify browser/native numeric parity**

Run the TypeScript fixture vectors and equivalent Rust vectors. Expected per-pixel difference is at most 1 for bilinear reconstruction and exact equality for alpha multiplication.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/backgroundRemoval/reconstructMask.ts packages/engine/src/backgroundRemoval/__tests__/reconstructMask.test.ts packages/engine/src/backgroundRemoval/worker.ts packages/engine/src/backgroundRemoval/providers/directOnnxProvider.ts crates/strata-bgremove/src/inference.rs crates/strata-bgremove/src/lib.rs
git commit -m "feat(engine): reconstruct source-resolution subject mattes"
```

## Task 5: Subject isolation service and stale-result rejection

**Files:**

- Create: `packages/editor/src/backgroundRemoval/SubjectIsolationService.ts`
- Create: `packages/editor/src/backgroundRemoval/SubjectIsolationService.test.ts`
- Modify: `packages/editor/src/context/useBackgroundRemoval.ts`
- Modify: `packages/editor/src/context/types.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover image replacement, crop/fill revision, document switch with colliding node IDs, node deletion, repeated activation, cancellation/retry, and selection changes. Each test starts one request, mutates exactly one revision, resolves inference, and asserts no document commit plus a specific stale status.

- [ ] **Step 2: Verify RED**

Run the new service test. Expected: current selection-only guard accepts at least replacement, crop, and colliding-document results.

- [ ] **Step 3: Implement immutable request tokens**

The service captures `{requestId, documentId, documentRevision, nodeId, sourceFingerprint, sourcePixelRevision, placementRevision}`. Commit compares every field against current editor state. The hook owns service lifecycle and aborts it on unmount; it no longer decodes, rasterizes, dispatches, or writes masks itself.

- [ ] **Step 4: Verify GREEN and hook ordering**

Run service tests, context tests, typecheck, and the jcodemunch triage because `context.tsx`/context shape is affected. Expected: no hook-order changes and no health threshold breach.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/backgroundRemoval/SubjectIsolationService.ts packages/editor/src/backgroundRemoval/SubjectIsolationService.test.ts packages/editor/src/context/useBackgroundRemoval.ts packages/editor/src/context/types.ts
git commit -m "feat(editor): centralize subject isolation lifecycle"
```

## Task 6: Transform-aware manual refinement

**Files:**

- Modify: `packages/editor/src/tools/RefineMaskTool.ts`
- Modify: `packages/editor/src/tools/TrimapEditTool.ts`
- Test: `packages/editor/src/tools/__tests__/RefineMaskTool.test.ts`
- Test: `packages/editor/src/tools/__tests__/TrimapEditTool.test.ts`
- Modify: `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`
- Create: `tests/e2e/effects/bgRemoval-refine.spec.ts`

- [ ] **Step 1: Write failing pointer tests**

Dispatch real/coalesced pointer samples for rotated, scaled, flipped, cropped, nested images at 25%, 100%, and 800% zoom. Assert source-mask pixels, pressure-adjusted opacity, continuous interpolation, cancel restoration, and one undo entry per stroke.

- [ ] **Step 2: Verify RED**

Run tool tests. Expected: current world-coordinate indexing paints the wrong pixels outside identity transforms and ignores pressure/coalesced events.

- [ ] **Step 3: Implement source-space brush sampling**

Use `imageMaskCoordinates.ts`, interpolate in source pixels, scale radius from a screen-space brush diameter, multiply dab opacity by normalized pressure for pen input, and consume coalesced events. Commit copy-on-write assets at pointer-up; cancel restores the previous asset reference.

- [ ] **Step 4: Add visible preview modes**

Expose checkerboard, overlay, black, white, mask-only, and edge modes through existing editor overlay state. Do not add imports to `CanvasArea.tsx` or `Shell.tsx`; inject the overlay renderer through the existing tool/render adapter.

- [ ] **Step 5: Run Playwright real-pointer regression**

Run the focused canvas refinement spec. Expected: mouse, synthetic pen pressure, touch pointer, zoom, rotation, and undo assertions pass.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/tools/RefineMaskTool.ts packages/editor/src/tools/TrimapEditTool.ts packages/editor/src/tools/__tests__/RefineMaskTool.test.ts packages/editor/src/tools/__tests__/TrimapEditTool.test.ts packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx tests/e2e/effects/bgRemoval-refine.spec.ts
git commit -m "feat(editor): add transform-aware mask refinement"
```

## Task 7: Access-path unification and accessible states

**Files:**

- Create: `packages/editor/src/backgroundRemoval/commands.ts`
- Create: `packages/editor/src/backgroundRemoval/commands.test.ts`
- Modify: `packages/editor/src/components/SelectionQuickBar/quickBarActions.ts`
- Modify: `packages/editor/src/Menubar.tsx`
- Modify: `packages/editor/src/components/BatchBgRemoveDialog.tsx`
- Modify: `packages/editor/src/components/Export/ExportDialog.tsx`
- Modify: `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`
- Test: `tests/e2e/effects/bgRemoval-access.spec.ts`

- [ ] **Step 1: Write failing command-equivalence tests**

For Inspector, quick bar, menu/batch, and export, assert the route calls the same command ID, capability check, consent gate, request service, and result commit. Assert AI never silently becomes Quick and unavailable routes expose a reason.

- [ ] **Step 2: Verify RED**

Expected: current routes call different functions and apply different gating/fallback behavior.

- [ ] **Step 3: Implement the shared command adapter**

Define distinct commands for generate, edit, show original, disable, delete, rasterize, replace background, and isolated export. Route all surfaces through the adapter and retain the Inspector as the detailed settings owner.

- [ ] **Step 4: Verify keyboard, screen reader, touch, and reduced motion**

Run RTL/axe tests and Playwright route tests. Expected: one processing status, labelled cancel/retry, no focus trap, no duplicate accessible names, and no animation when reduced motion is requested.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/backgroundRemoval/commands.ts packages/editor/src/backgroundRemoval/commands.test.ts packages/editor/src/components/SelectionQuickBar/quickBarActions.ts packages/editor/src/Menubar.tsx packages/editor/src/components/BatchBgRemoveDialog.tsx packages/editor/src/components/Export/ExportDialog.tsx packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx tests/e2e/effects/bgRemoval-access.spec.ts
git commit -m "refactor(editor): unify subject isolation commands"
```

## Task 8: Replacement, crop, copy, duplication, and persistence

**Files:**

- Modify: `packages/editor/src/components/Inspector/sections/ImageFillControls.tsx`
- Modify: `packages/editor/src/imageCrop.ts`
- Modify: `packages/scene/src/clone.ts`
- Modify: `packages/editor/src/clipboard.ts`
- Modify: `packages/editor/src/context.tsx`
- Test: `packages/editor/src/clipboard.test.ts`
- Test: `packages/editor/src/context.import.test.tsx`
- Test: `packages/scene/src/__tests__/clone.test.ts`
- Test: `tests/e2e/effects/bgRemoval-persistence.spec.ts`

- [ ] **Step 1: Write failing state-transition tests**

Assert replacement marks the mask stale and disabled, crop preserves source-pixel alignment, duplication shares an immutable asset until edit, cross-document paste carries only referenced assets, save/reopen preserves settings, and undo/redo restores exact asset references.

- [ ] **Step 2: Verify RED**

Expected: replacement keeps an active stale mask; cross-document clipboard has no raster asset closure.

- [ ] **Step 3: Implement canonical operations**

Use `deepCloneSubtree` for duplicate/remap behavior, include raster assets in document closures, and make replacement/crop operations update source or placement revisions atomically with the node.

- [ ] **Step 4: Verify E2E persistence**

Apply, refine, save, reopen, duplicate, crop, replace, undo, and redo in Chromium. Pixel-inspect canvas after each operation.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/components/Inspector/sections/ImageFillControls.tsx packages/editor/src/imageCrop.ts packages/scene/src/clone.ts packages/editor/src packages/scene/src tests/e2e/effects/bgRemoval-persistence.spec.ts
git commit -m "fix(scene): preserve raster masks across document operations"
```

Before committing, replace the broad `git add packages/editor/src packages/scene/src` with the exact changed file list from `git diff --name-only`; do not stage unrelated working-tree changes.

## Task 9: Rendering, thumbnails, and export parity

**Files:**

- Modify: `packages/editor/src/render/sceneToEngine.ts`
- Modify: `packages/editor/src/components/LayersPanel/useThumbnail.ts`
- Modify: `packages/editor/src/components/LayersPanel/thumbnailCache.ts`
- Modify: `packages/codegen/src/svg.ts`
- Modify: `crates/strata-print/src/lib.rs`
- Modify: `packages/editor/src/packageExport.ts`
- Test: renderer/codegen/print/package tests
- Test: `tests/e2e/effects/bgRemoval-export.spec.ts`

- [ ] **Step 1: Write failing parity tests**

Use one aligned source/mask fixture under fit, crop, rotation, effects, opacity, blend mode, nested group, and frame clip. Assert Canvas2D pixels, thumbnail pixels/cache invalidation, SVG `<mask>` geometry, PDF transparency/flattened pixels, and package asset checksum/deduplication.

- [ ] **Step 2: Verify RED**

Expected: thumbnail, SVG, PDF, and package assertions fail on the current implementation.

- [ ] **Step 3: Implement consumers of the native raster-mask contract**

Map source-space masks through `imagePlacement.ts`. PNG/WebP retain alpha; JPEG requires an explicit background. SVG emits an image mask in matching user space. PDF uses a soft mask when supported or deliberately rasterizes the masked subtree at export DPI. Package export writes one asset per checksum and rewrites document references.

- [ ] **Step 4: Verify pixel parity**

Run TypeScript, Rust, and Playwright export tests. Inspect edge pixels and dimensions, not only file existence.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/render/sceneToEngine.ts packages/editor/src/components/LayersPanel/useThumbnail.ts packages/editor/src/components/LayersPanel/thumbnailCache.ts packages/codegen/src/svg.ts crates/strata-print/src/lib.rs packages/editor/src/packageExport.ts tests/e2e/effects/bgRemoval-export.spec.ts
git commit -m "feat(export): preserve native raster masks everywhere"
```

## Task 10: Runtime provider selection and model governance

**Files:**

- Modify: `packages/engine/src/backgroundRemoval/worker.ts`
- Modify: `packages/engine/src/backgroundRemoval/modelManifest.ts`
- Modify: `apps/desktop/public/models/manifest.json`
- Create: `apps/desktop/public/models/THIRD_PARTY_NOTICES.md`
- Modify: `crates/strata-bgremove/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Test: provider capability and manifest tests

- [ ] **Step 1: Write failing provider self-test cases**

Mock WebGPU supported/unsupported operators, device loss, absent cross-origin isolation, WASM single/multithread, and native-provider failure. Assert ordered fallback and explicit runtime telemetry.

- [ ] **Step 2: Verify RED**

Expected: current WebGL-first worker and feature-disabled desktop path do not satisfy the matrix.

- [ ] **Step 3: Implement capability-tested providers**

Import the WebGPU ORT build in the app-owned worker, run a bundled known-output self-test, fall back to WASM SIMD, and dispose tensors/buffers. Enable native CPU inference in a dedicated release feature/job with CPU fallback; platform accelerators remain optional. Remove cloud from automatic dispatch and require explicit invocation.

- [ ] **Step 4: Pin model provenance**

Record source URL, upstream checkpoint/commit, license, SHA-256, conversion script/tool versions, opset, quantization calibration corpus, file size, input/output contract, and acceptance metrics. Do not ship BiRefNet weights until legal review confirms packaged-weight rights.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/backgroundRemoval/worker.ts packages/engine/src/backgroundRemoval/modelManifest.ts apps/desktop/public/models/manifest.json apps/desktop/public/models/THIRD_PARTY_NOTICES.md crates/strata-bgremove/Cargo.toml apps/desktop/src-tauri/Cargo.toml
git commit -m "feat(runtime): add verified offline inference providers"
```

## Task 11: Licensed quality corpus, visual metrics, and performance ledger

**Files:**

- Create: `tests/fixtures/background-removal/manifest.json`
- Create: `packages/engine/src/backgroundRemoval/qualityMetrics.ts`
- Create: `packages/engine/src/backgroundRemoval/__tests__/qualityFixtures.test.ts`
- Create: `packages/engine/src/backgroundRemoval/backgroundRemoval.bench.test.ts`
- Create: `docs/perf/background-removal-ledger.md`
- Create: `docs/quality/background-removal-fixtures.md`

- [ ] **Step 1: Add provenance-first fixtures**

Use only repository-authored synthetic fixtures, public-domain fixtures with recorded source/license, or explicitly licensed fixtures. Manifest fields are `id`, `source`, `license`, `sha256`, `subjectTypes`, `edgeCases`, `sourceImage`, and `groundTruthMask`.

- [ ] **Step 2: Write metric tests before accepting model changes**

Implement foreground retention, background leakage, boundary SAD, gradient error, connectivity error, and separate edge-crop snapshots. Each fixture has per-metric thresholds; no single aggregate score can pass a model.

- [ ] **Step 3: Benchmark candidates and runtimes**

Measure U2-Net Light baseline and checksum-pinned BiRefNet Lite candidates on WebGPU, WASM, and native CPU where available. Record cold model load, warm inference, source reconstruction, peak RSS/heap/GPU allocation, cancellation latency, UI long tasks, and mask dimensions.

- [ ] **Step 4: Select or reject the candidate using evidence**

The default changes only if all mandatory fixture thresholds pass and runtime limits remain within the documented desktop/browser budgets. Record genuine limitations for glass, smoke, reflections, translucent fabric, and motion blur.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/background-removal packages/engine/src/backgroundRemoval/qualityMetrics.ts packages/engine/src/backgroundRemoval/__tests__/qualityFixtures.test.ts packages/engine/src/backgroundRemoval/backgroundRemoval.bench.test.ts docs/perf/background-removal-ledger.md docs/quality/background-removal-fixtures.md
git commit -m "test(bgremove): add licensed quality and performance corpus"
```

## Task 12: Full cascade review and release verification

**Files:**

- Modify: `docs/audits/background-removal-production-audit-2026-07-15.md`
- Modify: `BACKGROUND_REMOVAL_MEMORY.md`
- Modify: relevant architecture/ADR documents

- [ ] **Step 1: Run mandatory regression protocol**

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:emoji
pnpm audit:tokens
```

Expected: every command exits zero with current package/test counts recorded.

- [ ] **Step 2: Run native checks**

```bash
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
cargo build --workspace
```

Expected: zero warnings/errors and all workspace tests passing.

- [ ] **Step 3: Run architecture health triage**

Re-index jcodemunch and compare every AGENTS.md threshold. Expected: no new cycles/layer violations, average complexity below 7.0, dead code below 3%, unstable modules below 250, test reachability above 95%, and hotspot #1 below 5500. Verify `CanvasArea.tsx` and `Shell.tsx` import counts did not increase.

- [ ] **Step 4: Run browser and desktop workflows**

```bash
npx playwright test tests/e2e/effects/bgRemoval*.spec.ts --project=chromium --reporter=list
npx playwright test tests/e2e/effects/bgRemoval*.spec.ts --project=firefox --reporter=list
npx playwright test tests/e2e/effects/bgRemoval*.spec.ts --project=webkit --reporter=list
```

Run Tauri/WebDriver on CachyOS Wayland and record Windows/macOS CI results. Expected: all supported workflows pass; platform-specific skips include an evidence-backed reason.

- [ ] **Step 5: Perform visual and accessibility review**

Inspect source, raw mask, refined mask, checkerboard preview, overlay, black/white views, boundary crops, layer thumbnail, PNG/WebP/SVG/PDF exports, and reopened document. Run axe, keyboard, mouse, pen, touch, screen-reader labeling, high contrast, 200% text, high DPI, and reduced-motion checks.

- [ ] **Step 6: Update audit and docs with measured evidence**

Replace prototype claims with exact supported behavior, model/runtime licenses, measurements, test counts, platform matrix, and genuine limitations. Do not mark a boundary supported without a passing fixture and export assertion.

- [ ] **Step 7: Commit and push**

```bash
git add docs/audits/background-removal-production-audit-2026-07-15.md BACKGROUND_REMOVAL_MEMORY.md docs/architecture docs/adr docs/perf docs/quality
git commit -m "docs: finalize production subject isolation workflow"
git push
git log --oneline -3
```

Expected: push succeeds and the final log contains the verified documentation milestone plus the preceding implementation milestone.
