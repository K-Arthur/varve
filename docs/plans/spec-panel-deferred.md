# Spec Panel — Deferred Implementation Plan

Use this in a future session to complete the remaining phases.

## Completed foundation (this session)

| Area | Status | What was built |
|---|---|---|
| Shared infrastructure | Done | `units.ts`, `debounce.ts`, `Tabs.tsx` (APG), `CopyButton.tsx` with aria-live |
| Inspect mode | Done | `'inspect'` ToolId, shortcut `I`, toolbar button, Menubar entry, CanvasArea guard |
| Measurement math | Done | `worldBBox`, `edgeDistance`, `centerToCenter` in `measurement.ts` |
| MeasureOverlay | Done | Screen-space SVG overlay, hover-to-measure dimension lines, selected-node AABB + W×H |
| MeasurementReadout | Done | Panel-side W/H/X/Y (page + parent), unit-aware display with CopyButton |
| UnitSelector | Done | px/pt/rem/% segmented control, localStorage persistence |
| SpecReadouts | Done | Layout, typography, color/fill (swatch + HEX + contrast ratio), content fieldsets |
| Token matching | Done | Reverse-lookup from VariableStore for property→token name |
| Code generation | Done | 6 targets (SVG, CSS, Tailwind, CSS Modules, Flutter, SwiftUI) with per-node public API |
| CodeGenView | Done | APG Tabs for target switching, line-numbered `<pre>`, CopyButton |
| Asset export | Done | Offscreen canvas raster (PNG/JPG/WebP) at 1x/2x/3x/custom, SVG copy/download |
| Annotations | Done | Read + author per-node text notes, relative timestamps |
| Tests | 316 passing (was 273) | +43 new tests across 7 SpecPanel files + codegen |

---

## Phase D1 — Playwright E2E + axe-core for Spec Panel

### Setup (first time — may already be done from Layers Panel E2E)

```bash
cd /home/karthur/CodingProjects/Strata
npx playwright install --with-deps chromium firefox webkit
```

### Test file: `tests/e2e/spec/measurement.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Spec Panel Measurement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:1420');
  });

  test('enter inspect mode via shortcut I', async ({ page }) => {
    await page.keyboard.press('i');
    // Assert inspect mode active (cursor or tool indicator)
    const canvas = page.getByRole('img', { name: /canvas/i });
    await expect(canvas).toBeVisible();
  });

  test('measurement overlay shows when node selected in inspect mode', async ({ page }) => {
    await page.keyboard.press('i');
    // Click on canvas to select a node
    // Assert dimension overlay visible
  });

  test('copy button copies value and announces', async ({ page }) => {
    await page.keyboard.press('i');
    // Navigate to spec panel readout
    // Click copy button
    // Assert clipboard content
    // Assert aria-live announcement
  });
});
```

### Axe-core test: `tests/e2e/spec/axe.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('spec panel has no axe violations', async ({ page }) => {
  await page.goto('http://localhost:1420');
  await page.keyboard.press('i');
  const results = await new AxeBuilder({ page }).include('.spec-panel').analyze();
  expect(results.violations).toEqual([]);
});
```

---

## Phase D2 — Syntax highlighting for code output

The current `CodeGenView` uses plain `<pre><code>` without syntax highlighting.

### Tree-shaken Prism (lightweight)

```bash
pnpm add prismjs --filter @varve/editor
pnpm add -D @types/prismjs --filter @varve/editor
```

Create `packages/editor/src/components/SpecPanel/syntax.ts`:

```ts
import Prism from 'prismjs';
import 'prismjs/components/prism-css.min.js';
import 'prismjs/components/prism-jsx.min.js';
import 'prismjs/components/prism-dart.min.js';
import 'prismjs/components/prism-swift.min.js';
import 'prismjs/components/prism-markup.min.js';

const LANG_MAP: Record<string, string> = {
  css: 'css',
  tailwind: 'jsx',
  modules: 'css',
  svg: 'markup',
  flutter: 'dart',
  swiftui: 'swift',
};

export function highlight(code: string, target: string): string {
  const lang = LANG_MAP[target] ?? 'css';
  return Prism.highlight(code, Prism.languages[lang]!, lang);
}
```

Replace `<pre>` content in `CodeGenView.tsx` with `dangerouslySetInnerHTML` using `highlight()` output. Add Prism CSS theme tokens via `SpecPanel.css`.

---

## Phase D3 — Diff-on-change for code generation

Track previous code output per `NodeId` + `CodeTarget` key. Show diff summary when output changes.

### Implementation outline

```tsx
// CodeGenView.tsx
const prevCode = useRef<Map<string, string>>(new Map());

const diffSummary = useMemo(() => {
  const key = `${node.id}:${activeTab}`;
  const prev = prevCode.current.get(key);
  prevCode.current.set(key, code);
  if (prev && prev !== code) {
    const prevLines = prev.split('\n');
    const currLines = code.split('\n');
    const added = currLines.length - prevLines.length;
    const removed = prevLines.length - currLines.length;
    return { added: Math.max(0, added), removed: Math.max(0, removed) };
  }
  return null;
}, [code, node.id, activeTab]);

// Render:
{diffSummary && (
  <div className="spec-codegen__diff" aria-live="polite">
    {diffSummary.added > 0 && <span className="spec-codegen__diff--added">+{diffSummary.added}</span>}
    {diffSummary.removed > 0 && <span className="spec-codegen__diff--removed">-{diffSummary.removed}</span>}
  </div>
)}
```

---

## Phase D4 — Tauri file-save plugin wiring

The current `AssetExportControls` uses DOM Blob download (`<a>` click). For desktop builds, wire `tauri-plugin-dialog` + `tauri-plugin-fs`.

### Steps

1. Add to `apps/desktop/src-tauri/Cargo.toml`:
```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

2. Register in `apps/desktop/src-tauri/src/lib.rs`:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
```

3. Add permissions in `apps/desktop/src-tauri/capabilities/default.json`:
```json
"permissions": ["core:default", "dialog:default", "fs:default"]
```

4. Create `saveBlob` on `@varve/platform` `Platform` interface and implement in `tauri.ts` using the dialog plugin + `plugin:fs|write_file`.

---

## Phase D5 — Enhanced token-aware codegen

The current token matching does a reverse-lookup from VariableStore (value match). For production, nodes should carry explicit `variableBindings`.

### Future schema change

```ts
// packages/scene/src/types.ts — add to NodeBase
variableBindings?: Partial<Record<string, NodeId>>;
// e.g. { fill: 'var-001', fontSize: 'var-002' }
```

Then codegen emits:
- CSS: `background: var(--color-accent)` instead of `background: #39d0c6`
- Tailwind: `bg-[--color-accent]` or theme token reference
- Flutter: `Theme.of(context).colorScheme.primary`

---

## Phase D6 — Cross-platform verification

- [ ] WebKitGTK (Wayland + X11) — verify MeasureOverlay SVG renders correctly
- [ ] macOS Safari — verify `navigator.clipboard` permissions
- [ ] Firefox — verify OffscreenCanvas fallback
- [ ] Tauri desktop — verify asset export + (future) file dialog

---

## Phase D7 — PDF export via strata-print

The existing `strata-print` crate has `export_pdf()` but is not wired to any Tauri command.

### Implementation

1. Add `strata-print` dependency to `apps/desktop/src-tauri/Cargo.toml`
2. Create Tauri command `export_node_pdf(nodes: Vec<IpcSceneNode>, opts) -> Vec<u8>`
3. In `AssetExportControls`, when running in Tauri, invoke the command and save via file dialog
4. In browser, show "PDF export requires desktop build" tooltip

---

## Phase D8 — Flutter/SwiftUI full auto-layout

Current Flutter/SwiftUI emitters output flat `Container`/`Positioned` widgets. Enhance to emit:
- Flex layouts as `Row`/`Column` with `gap`
- Text nodes as `Text()` / `Text("...")` with proper `fontSize`
- Stack children for nested frames

---

## Files created this session

All new SpecPanel files:

```
packages/editor/src/components/SpecPanel/
  SpecPanel.tsx              — container shell
  SpecPanel.css              — all spec panel styles
  AnnotationsDisplay.tsx     — read + author notes
  AssetExportControls.tsx    — format/scale picker + download
  CodeGenView.tsx            — 6-code-target tabs with copy
  export.ts                  — raster + SVG blob export engine
  measurement.ts             — worldBBox, edgeDistance, centerToCenter
  measurement.test.ts        — 8 tests
  MeasurementReadout.tsx     — panel-side dimension readout
  MeasureOverlay.tsx         — canvas SVG overlay
  SpecReadouts.tsx           — layout/typo/color/content fieldsets
  SpecReadouts.test.tsx      — 3 tests
  UnitSelector.tsx           — px/pt/rem/% segmented control

packages/shared/src/
  units.ts + units.test.ts   — unit conversion (18 tests)
  debounce.ts + debounce.test.ts — debounce/throttle (5 tests)

packages/ui/src/components/
  Tabs.tsx + Tabs.test.tsx    — APG Tabs (8 tests)
  CopyButton.tsx + CopyButton.test.tsx — clipboard copy (2 tests)

packages/codegen/src/
  shared.ts                  — extracted shared helpers
  svg.ts                     — per-node SVG export
  css.ts                     — CSS class target
  tailwind.ts                — React+Tailwind target
  css-modules.ts             — CSS Modules target
  flutter.ts                 — Flutter target
  swiftui.ts                 — SwiftUI target
  codegen.test.ts            — 8 new target tests
```
