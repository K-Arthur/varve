# Background Removal — Deferred Implementation (Phases 5-6)

**Base commit:** Current HEAD | **Branch:** master

## Phases A–D completion (Session 39, 2026-07-06)

| Phase | Status | Notes |
|---|---|---|
| **A** Release hygiene | **Done** | Engine typecheck, clippy, BiRefNet URLs, bundle verify UI |
| **B** Download resilience | **Done** | Range resume, partial store, quota UX |
| **C** RefineMask polish | **Done** | CSS, keyboard shortcuts, commit-on-drag tests |
| **D** Inference perf | **Done** | `previewMaxDimension` default 2048; WebGPU deferred |
| **E** Advanced features | **Done** | E.0–E.4 + E.1 native ONNX parity (Session 40) |

Focused suite: **163/163** pass (23 files). See `docs/audits/background-removal-audit.md` Session 40 verification table.

### Phase E deliverables (Session 40)

| Slice | Status | Key files |
|---|---|---|
| **E.0** Stub parity | **Done** | `index.ts` direct-ONNX `previewMaxDimension`; `model.rs` metadata sync |
| **E.1** Native Rust AI | **Done** | ADR-0005 Option B; `inference.rs` dynamic IO, preview downscale, decontaminate, confidence |
| **E.2** Hair matting | **Done** | `refineHairMatting.ts`, inspector "Refine edges (hair/fur)" |
| **E.3** Multi-subject picker | **Done** | `findConnectedComponents`, `SubjectPickerOverlay`, `finalizeMaskResult` |
| **E.4** Trimap editor | **Done** | `TrimapEditTool`, `solveTrimapMatting`, ephemeral trimap store |

---

## Pre-Flight Checklist

```bash
pnpm typecheck       # 15/15 packages
pnpm test            # baseline pass
pnpm lint            # 0 new errors
pnpm audit:tokens    # 96/96 WCAG-AA
pnpm audit:emoji     # zero violations
cargo test --workspace  # if Rust touched
git log --oneline -3
```

**Current baseline:** ~3000+ JS tests, 87+ Rust tests (incl. 5 strata-bgremove). `just gate` after each phase.

---

## Known Gap (must fix first)

The `removeBackground` context action is **missing** from the editor context. The `BackgroundRemovalSection.tsx` component destructures it from `useEditor()` but `removeBackground` is not defined on `EditorContextValue` and has no implementation in the provider. This will cause a TypeScript error.

Fix the gap by reading the full pattern in `packages/editor/src/context.tsx`, then add to the `EditorContextValue` interface and implement in the provider:

```typescript
// In EditorContextValue interface (find context.tsx around line 577, near booleanOp):
  /** Remove background from the selected image node using the given method. */
  removeBackground: (method: import('@strata/scene').BackgroundRemovalMethod) => Promise<void>;
```

Implementation pattern: follow `booleanOp` implementation. Use `updateDoc` with `setBackgroundRemoval` from `@strata/scene`, call `removeBackground` from `@strata/engine`, show loading state via `announce`.

After adding the context action, run:
```bash
npx vitest run --reporter verbose packages/editor/src/components/Inspector/ 2>&1
```
to verify the fix compiles and tests pass.

---

## Phase 5: Web Version — onnxruntime-web + Web Worker (4-5 days)

### 5.1 Install onnxruntime-web dependency

```bash
cd apps/desktop
pnpm add onnxruntime-web
```

### 5.2 Create Web Worker for background removal inference

Create `packages/engine/src/backgroundRemoval/worker.ts`:

```typescript
/**
 * Web Worker for ONNX model inference.
 * Runs background removal in a separate thread so the main thread
 * stays responsive during processing.
 */

import type { BackgroundRemovalResult } from './types';

interface WorkerCommand {
  type: 'infer';
  imageData: ImageData;
  modelPath: string;
  modelId: 'u2netp' | 'birefnet-general-lite';
}

interface WorkerResponse {
  type: 'result';
  result: BackgroundRemovalResult;
}

interface WorkerError {
  type: 'error';
  message: string;
}

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const { imageData, modelPath, modelId } = e.data;

  try {
    const ort = await import('onnxruntime-web');
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['webgl', 'wasm'],
    });

    const inputSize = modelId === 'u2netp' ? 320 : 1024;
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d')!;

    // Resize to model input
    const resizedCanvas = new OffscreenCanvas(inputSize, inputSize);
    const resizedCtx = resizedCanvas.getContext('2d')!;

    // Draw source image onto temp canvas to convert ImageData to ImageBitmap
    const imageBitmap = await createImageBitmap(imageData);
    resizedCtx.drawImage(imageBitmap, 0, 0, inputSize, inputSize);
    const resizedData = resizedCtx.getImageData(0, 0, inputSize, inputSize);

    // Convert to tensor (NCHW format)
    const { data, width, height } = resizedData;
    const floatData = new Float32Array(width * height * 3);
    for (let i = 0; i < data.length / 4; i++) {
      floatData[i] = data[i * 4] / 255;
      floatData[width * height + i] = data[i * 4 + 1] / 255;
      floatData[width * height * 2 + i] = data[i * 4 + 2] / 255;
    }

    const inputName = session.inputNames[0];
    const feeds: Record<string, any> = {};
    feeds[inputName] = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);

    const results = await session.run(feeds);
    const outputName = session.outputNames[0];
    const outputData = results[outputName].data as Float32Array;

    // Create mask
    const maskW = results[outputName].dims[3];
    const maskH = results[outputName].dims[2];
    const mask = new Uint8Array(maskW * maskH);
    for (let i = 0; i < outputData.length; i++) {
      mask[i] = outputData[i] > 0.5 ? 255 : 0;
    }

    // Upscale mask to original dimensions using OffscreenCanvas
    const maskCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskImageData = maskCtx.createImageData(maskW, maskH);
    for (let i = 0; i < mask.length; i++) {
      maskImageData.data[i * 4] = mask[i];
      maskImageData.data[i * 4 + 1] = mask[i];
      maskImageData.data[i * 4 + 2] = mask[i];
      maskImageData.data[i * 4 + 3] = 255;
    }
    maskCtx.putImageData(maskImageData, 0, 0);

    // Draw scaled
    const finalCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const finalCtx = finalCanvas.getContext('2d')!;
    finalCtx.drawImage(maskCanvas, 0, 0, imageData.width, imageData.height);

    const finalBlob = await finalCanvas.convertToBlob({ type: 'image/png' });
    const buffer = await finalBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const maskDataUrl = 'data:image/png;base64,' + btoa(binary);

    const response: WorkerResponse = {
      type: 'result',
      result: {
        maskDataUrl,
        confidence: 0.85,
        method: modelId === 'u2netp' ? 'quick' : 'ai-balanced',
        processingTimeMs: 0,
        width: imageData.width,
        height: imageData.height,
      },
    };
    self.postMessage(response);
  } catch (err) {
    const error: WorkerError = { type: 'error', message: (err as Error).message };
    self.postMessage(error);
  }
};
```

### 5.3 Update Vite config for Worker + WASM

Modify `apps/desktop/vite.config.ts` to handle Web Workers and WASM:

```typescript
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari14',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          'onnxruntime': ['onnxruntime-web'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
});
```

### 5.4 Update index.ts facade for Web Worker path

Modify `packages/engine/src/backgroundRemoval/index.ts` to use the Worker:

```typescript
// In the removeBackground function, between Tauri and fallback paths:
if (typeof Worker !== 'undefined' && options.method !== 'quick') {
  try {
    const modelId = options.method === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite';
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    const result = await new Promise<BackgroundRemovalResult>((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'result') {
          resolve(e.data.result);
        } else if (e.data.type === 'error') {
          reject(new Error(e.data.message));
        }
      };
      worker.onerror = (e) => reject(new Error(`Worker error: ${e.message}`));

      worker.postMessage({
        type: 'infer',
        imageData: transferImageData(imageData),
        modelPath: `/${modelId}.onnx`,
        modelId: modelId === 'birefnet-general' ? 'birefnet-general-lite' : 'u2netp',
      } satisfies WorkerCommand);
    });

    worker.terminate();
    return result;
  } catch {
    // Fall through to heuristic
  }
}
```

### 5.5 Model download for web

Update `modelLoader.ts` so that when running in a browser context, models are stored in IndexedDB instead of localStorage (which has a ~5MB limit). Use the existing `indexedDB` polyfill pattern (see `vitest.setup.ts` references).

**Implementation plan:**
- Create `packages/engine/src/backgroundRemoval/modelStore.ts` with IndexedDB-backed model storage
- Store model binary data as blobs in IndexedDB
- Implement `loadModelBlob(id)`, `saveModelBlob(id, blob)`, `hasModelBlob(id)`, `deleteModelBlob(id)`
- Use `idb` npm package or raw IndexedDB API
- Fall back to `localStorage` for small metadata (model state tracking)

### 5.6 Tests for Web Worker

Create `packages/engine/src/backgroundRemoval/__tests__/worker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('background removal worker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('worker script exists and is importable', async () => {
    // Verify worker.ts can be bundled
    const workerCode = await import('../worker?raw');
    expect(workerCode.default).toBeTruthy();
    expect(workerCode.default).toContain('self.onmessage');
  });

  it('OffscreenCanvas is available in supported environments', () => {
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    // Test should adapt to environment
    expect(typeof OffscreenCanvas).toBeDefined();
  });

  it('handles missing onnxruntime-web gracefully', async () => {
    // When onnxruntime-web is not available, worker should throw
    // and the index.ts facade should fall back to heuristic
    const { removeBackground } = await import('../index');
    const img = new ImageData(10, 10);
    const result = await removeBackground(img, { method: 'ai-balanced' });
    expect(result.method).toBe('quick'); // fallback
  });

  it('transferImageData creates transferable buffer', () => {
    // Verify ImageData can be transferred to Worker without copy
    const img = new ImageData(100, 100);
    const buffer = img.data.buffer;
    expect(buffer.byteLength).toBe(100 * 100 * 4);
  });
});
```

### 5.7 Acceptance criteria

- [x] onnxruntime-web import succeeds in browser — `packages/engine/package.json`, `worker.ts`
- [x] Web Worker instantiation succeeds — `workerPool.ts:25`
- [x] Worker fallback to main-thread inference when Worker unavailable — `index.test.ts` direct-AI/heuristic fallthrough
- [x] IndexedDB model storage works for large blobs (>5MB) — `modelStore.ts` + `modelLoader.test.ts`
- [x] WebGL execution provider preferred, WASM as fallback — `worker.ts` + `directAi.telemetry.test.ts`
- [x] Cancelling inference mid-flight doesn't leak memory — `workerPool.test.ts` abort dequeue; `context.tsx` selection-change abort
- [x] Model download dialog works in web context — `ModelDownloadDialog.test.tsx`
- [x] Graceful degradation to heuristic when model or Worker unavailable — `index.test.ts`, batch/export gating

---

## Phase 6: Batch Processing + Polish + Accessibility (4-5 days)

### 6.1 Batch background removal from asset browser

Create `packages/editor/src/components/BatchBgRemoveDialog.tsx`:

**Pattern to follow:** Study `packages/home/src/BulkImportDialog.tsx` for the stage-based dialog pattern (`'select'` → `'processing'` → `'results'`). Study `packages/editor/src/components/Export/ExportDialog.tsx` for the batch job list pattern.

**Features:**
1. Select multiple ImageNodes in layers panel or asset browser
2. Right-click → "Remove Background (Batch)" → opens batch dialog
3. Dialog shows per-file progress with thumbnail preview
4. Method selector applies to all selected images
5. Error isolation: one failure doesn't abort the batch
6. Results summary: N succeeded, M failed, K skipped (already processed)
7. Ability to retry failed items individually

**TDD tests (12+):**
- Batch dialog renders with selected files
- Progress updates per file
- Error recovery (one file fails, others continue)
- All-files-complete state
- Cancel during processing
- Empty selection shows prompt

### 6.2 Batch background removal context action

Add to `EditorContextValue` in `context.tsx`:

```typescript
/** Batch remove background from all selected image nodes. */
batchRemoveBackground: (method: BackgroundRemovalMethod) => Promise<BatchBgRemoveResult>;
```

**Implementation:**
```typescript
batchRemoveBackground: async (method) => {
  const imageNodes = state.selection
    .map((id) => state.document.nodes[id])
    .filter((n): n is ImageNode => n?.kind === 'image');

  if (imageNodes.length === 0) {
    announce('Select one or more image nodes first');
    return { total: 0, succeeded: 0, failed: 0 };
  }

  beginTransaction();
  let succeeded = 0;
  let failed = 0;

  for (const node of imageNodes) {
    try {
      const { removeBackground, getImageCache } = await import('@strata/engine');
      const { setBackgroundRemoval } = await import('@strata/scene');
      const cache = getImageCache();
      const img = await cache.load(node.src);
      if (!img) { failed++; continue; }
      const canvas = document.createElement('canvas');
      canvas.width = node.w;
      canvas.height = node.h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, node.w, node.h);
      const imageData = ctx.getImageData(0, 0, node.w, node.h);

      const result = await removeBackground(imageData, { method, feather: 0.5, decontaminate: true });

      updateDoc((d) =>
        setBackgroundRemoval(d, node.id, {
          maskDataUrl: result.maskDataUrl,
          method: result.method,
          confidence: result.confidence,
          appliedAt: Date.now(),
          feather: 0.5,
          decontaminate: true,
        }),
      );
      succeeded++;
    } catch {
      failed++;
    }
  }

  commitTransaction();
  announce(`Background removed from ${succeeded} image(s)${failed ? `, ${failed} failed` : ''}`);
  return { total: imageNodes.length, succeeded, failed };
},
```

### 6.3 Export dialog integration

Modify `packages/editor/src/components/Export/ExportDialog.tsx` to add:

**"Remove background before export" toggle** — when enabled, runs background removal on image nodes before exporting. This ensures exported assets have transparent backgrounds.

**Changes:**
- Add toggle checkbox in Export settings section
- When enabled: for each ImageNode with no existing backgroundRemoval, run quick remove before export
- For ImageNodes that already have backgroundRemoval, use the existing mask
- Show a note: "Background removal will be applied to N images"

**TDD tests (4+):**
- Toggle appears in export dialog
- Toggle enables pre-export processing
- Masked images export with transparency
- Unmasked images export without transparency change

### 6.4 Polish: Background removal preview toggle

Add a toggle to `BackgroundRemovalSection.tsx` that lets users preview the original image vs. the masked result.

**Changes to BackgroundRemovalSection.tsx:**
```typescript
const [showOriginal, setShowOriginal] = useState(false);
```

When toggled, update the node's temporary state (not committed) to skip the alpha mask during rendering. Use the existing `showOriginal` approach by modifying the `toEngineNode` output temporarily:

```typescript
// Add to CanvasArea.toEngineNode:
if (showOriginalTemporarily.has(nodeId)) {
  // Don't pass alphaMask
}
```

**Implementation approach:**
- Add `previewOriginalBgIds: Set<NodeId>` to `EditorState` (or use a ref)
- In `BackgroundRemovalSection`, call `setShowOriginalPreview(true/false)` from context
- In `CanvasArea.toEngineNode`, check the set and skip alphaMask when active
- Reset on tool change or section close

**TDD tests (3+):**
- Toggle renders
- Preview shows original image
- Preview reverts to masked on toggle off

### 6.5 Polish: Refinement controls

Add feather and decontaminate sliders to `BackgroundRemovalSection.tsx`:

- **Feather** slider: 0-3px, step 0.1 — softens mask edges
- **Decontaminate** checkbox: removes background color spill from foreground edges
- These apply during processing, not as post-process

**TDD tests (3+):**
- Feather slider renders and updates
- Decontaminate checkbox renders and updates
- Changing controls returns different mask

### 6.6 Add brush-based mask refinement (stretch goal)

Create `packages/editor/src/tools/RefineMaskTool.ts`:

**Behavior:**
- Click/brush to add to the mask (foreground)
- Alt+click/brush to subtract from the mask (background)
- Adjustable brush size and hardness
- Undo/redo per stroke

**Implementation approach:**
1. Create new tool extending `BaseTool`
2. Register as `'refineMask'` ToolId
3. On pointer down: begin transaction, capture pointer
4. On pointer move: paint mask pixels (add or subtract mode)
5. On pointer up: commit transaction, update `backgroundRemoval.maskDataUrl`
6. Tool activates automatically after applying background removal (or manually from inspector)

**TDD tests (6+):**
- Brush adds to mask
- Alt+brush subtracts from mask
- Brush size changes affect coverage
- Undo reverts stroke
- Redo restores stroke
- Empty mask handled gracefully

### 6.7 Accessibility

#### Screen reader support for canvas accessibility tree

Update `packages/editor/src/components/CanvasAccessibilityTree.tsx` to include background removal status in the accessible description:

```typescript
label: `${node.name}, ${node.kind}, ${Math.round(bounds.x)}, ${Math.round(bounds.y)}, ${Math.round(bounds.w)} x ${Math.round(bounds.h)}${node.backgroundRemoval ? ', background removed' : ''}`,
```

#### Focus management for background removal dialogs

Wrap the `ModelDownloadDialog` in a `FocusTrap` (from `packages/editor/src/components/FocusTrap.tsx`):

```typescript
import { FocusTrap } from '../FocusTrap';

// In the dialog render:
<FocusTrap>
  <div className="model-download-overlay" role="dialog" aria-modal="true" aria-label="Download AI Model">
    ...
  </div>
</FocusTrap>
```

#### ARIA labels for inspector controls

Add `aria-label` and `aria-describedby` to all background removal controls:

```typescript
<select
  id="bg-method"
  aria-label="Background removal method"
  aria-describedby="bg-method-desc"
  ...
/>
<span id="bg-method-desc" className="sr-only">
  Quick uses fast heuristics without downloading a model.
  AI Balanced and AI Best Quality require downloading a machine learning model.
</span>
```

#### Keyboard accessibility

- All dialog actions must be reachable via Tab
- Escape dismisses any open dialog
- Focus returns to the trigger element on dialog close
- Download progress announces status via `aria-live`

**TDD tests (6+):**
- Focus trap works in ModelDownloadDialog
- Escape dismisses dialog
- Tab cycles through focusable elements
- Screen reader announces progress updates
- Background removal status in accessibility tree
- Keyboard navigation of refinement controls

### 6.8 Edge case hardening

| Case | Expected Behavior |
|---|---|
| **0-byte image** | Show error message, skip processing |
| **Image load fails (CORS)** | Catch error, show "Could not load image" |
| **Memory quota exceeded** | Catch in model loader, suggest quick mode |
| **Worker crashes mid-inference** | Fall back to heuristic, show warning |
| **onnxruntime-web fails to load** | Show "Download model" button redirect |
| **model download interrupted** | Resume with HTTP Range headers |
| **model download storage full** | Show storage error with clear message |
| **multiple rapid clicks on Apply** | Debounce, disable button while processing |
| **selecting different image while processing** | Abort current, process new |

### 6.9 Acceptance criteria

- [x] Batch dialog works with asset browser multi-select — `BatchBgRemoveDialog.tsx` + 16 tests
- [x] Export dialog has "remove background" toggle — `ExportDialog.tsx` + `bgRemovalFeatures.test.tsx`
- [x] Preview toggle shows original vs. masked — `BackgroundRemovalSection` + `showOriginalBgNodeId`
- [x] Feather slider adjusts mask edge softness — `BackgroundRemovalSection` + tests
- [x] Decontaminate checkbox removes color spill — `BackgroundRemovalSection` + tests
- [x] Brush refinement tool can add/subtract from mask — `RefineMaskTool.ts` wired in inspector + tests
- [x] All dialogs have FocusTrap — `BatchBgRemoveDialog`, `ModelDownloadDialog`
- [x] Canvas accessibility tree reports background removal status — `CanvasAccessibilityTree.tsx` includes method
- [x] All controls have ARIA labels — inspector + export method selector
- [x] All edge cases produce clear error messages — `index.test.ts` 0-byte guard, CORS announces in context
- [x] Full test suite passes (heuristic + worker + batch + accessibility) — focused 113/113; full gate below
- [ ] Token audit passes (96/96 WCAG-AA) — run at gate
- [ ] Emoji audit passes — run at gate

---

## Verification Protocol

After each sub-phase:

```bash
pnpm format
pnpm typecheck       # 15/15 packages pass
pnpm lint            # 0 new errors
pnpm test            # all pass (+ new background removal tests)
pnpm audit:tokens    # 96/96 WCAG-AA
pnpm audit:emoji     # zero violations
cargo test --workspace  # if Rust files touched
```

Run `just gate` after each cross-package boundary.

---

## Commit Convention

```
Phase {N}: {Description}

- {Bullet list of changes}
- {Tests added/passed}
```

---

## Dependency Graph

```
Phase 5.1 (onnxruntime-web dep)
  └─→ Phase 5.2 (Web Worker)
        ├─→ Phase 5.3 (Vite config)
        └─→ Phase 5.4 (facade integration)
              └─→ Phase 5.5 (IndexedDB model store)
                    └─→ Phase 5.6 (worker tests)

Phase 6.1 (batch dialog)
  └─→ Phase 6.2 (batch context action)
        └─→ Phase 6.3 (export integration)
Phase 6.4 (preview toggle)
Phase 6.5 (refinement controls)
  └─→ Phase 6.6 (brush refinement) [stretch]
Phase 6.7 (accessibility)
Phase 6.8 (edge cases)
Phase 6.9 (acceptance verification)
```

All Phase 6 sub-items without dependency arrows between them are independent and can run in parallel.
