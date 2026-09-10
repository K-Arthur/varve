# Session 03 — Inspector E2E + Spec Panel Final Phases

**Parallel agents:** 2 (inspector-e2e | spec-panel)
**Estimated:** 6–8h

---

## Agent A — Inspector E2E + axe-core (Track D)

**See `docs/plans/inspector-final.md` lines 251-327 for full spec.**

### D1 — Playwright inspector test suite

`tests/e2e/inspector/helpers.ts` — NEW:
```typescript
import { type Page } from '@playwright/test';

export async function navigateToEditor(page: Page) {
  await page.goto('http://localhost:1420');
  // Click "New File" or preset
  await page.getByRole('button', { name: /new file/i }).click();
  // Wait for editor to load
  await page.waitForSelector('[aria-label="Design canvas"]');
}

export async function createRectShape(page: Page) {
  // Press R to select Rectangle tool
  await page.keyboard.press('r');
  // Click + drag on canvas
  const canvas = page.getByRole('img', { name: /canvas/i });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas not found');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.up();
}

export async function getInspectorValue(page: Page, label: string): Promise<string | null> {
  const el = page.getByLabelText(label);
  const val = await el.getAttribute('aria-valuetext');
  if (val && val !== 'Mixed values') return val;
  return await el.inputValue();
}

export async function setInspectorValue(page: Page, label: string, value: string) {
  const el = page.getByLabelText(label);
  await el.click();
  await el.fill(value);
  await el.press('Enter');
}
```

`tests/e2e/inspector/edit.spec.ts`:
- "select shape → change X → canvas reflects new position"
- "change W → shape width changes"
- "change H → shape height changes"
- "change fill color → shape renders new color"
- "change opacity → shape renders at new opacity"
- "rotation changes → shape rotates"
- "flip H → shape flips horizontally"

`tests/e2e/inspector/multi.spec.ts`:
- "select 2 shapes → change opacity → both update"
- "Mixed indicator for differing X values"
- "align left edges → both snap to same left"
- "distribute horizontal → equal spacing"

`tests/e2e/inspector/sections.spec.ts`:
- "stroke add/remove/weight"
- "effect add/remove/blur"
- "corner radius changes"
- "layout mode change (none→flex→grid)"

`tests/e2e/inspector/color.spec.ts`:
- "ColorPicker opens on swatch click"
- "hue slider changes fill color"
- "HEX input updates RGB fields"
- "swatch click sets fill"

### D2 — axe-core scan

`tests/e2e/inspector/axe.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Inspector axe-core', () => {
  test('no violations in empty state', async ({ page }) => {
    await page.goto('http://localhost:1420');
    await page.waitForSelector('[aria-label="Inspector"]');
    const results = await new AxeBuilder({ page })
      .include('[aria-label="Inspector"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('no violations with shape selected', async ({ page }) => {
    await page.goto('http://localhost:1420');
    // Create a shape
    await page.keyboard.press('r');
    const canvas = page.getByRole('img', { name: /canvas/i });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');
    await page.mouse.click(box.x + 150, box.y + 150);
    await page.waitForTimeout(500);
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 150, box.y + 150);
    // Scan
    const results = await new AxeBuilder({ page })
      .include('[aria-label="Inspector"]')
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
```

### D3 — Fix axe-core violations

Common fixes needed:
- All `<button>` elements need `type="button"`
- All form controls need proper labels via `htmlFor`/`id` or `aria-label`
- Color contrast on indicators
- ARIA roles on tab lists (should already be `role="tablist"`)
- Disclosure section `aria-expanded`/`aria-controls`

Run axe-core scan first, then fix each violation. Commit fixes separately.

### Verification
```bash
cd packages/editor && npx playwright test --config=../../playwright.config.ts tests/e2e/inspector/ 2>&1
```

---

## Agent B — Spec Panel Final Phases (D5-D7)

### D5 — Token-aware codegen

**Goal:** When a node has variable bindings (from the token binding system), the generated code (CSS, Tailwind, SVG) should emit the token name instead of the hardcoded value.

`packages/codegen/src/tokens.ts` — already exists with `resolveTokenName()`.

**Modify `packages/codegen/src/css.ts`:**
- Import `VariableStore`, `resolveTokenName` from `./tokens`
- Add `variableStore?: VariableStore` to `CssExportOptions`
- In `formatColor` and size emission: call `resolveTokenName(node.bindings, property, variableStore)` first
- If a token is bound, emit `var(--token-name)` instead of the raw value

**Modify `packages/codegen/src/tailwind.ts`:**
- Same pattern: when token bound, emit e.g. `bg-[--color-primary]` instead of `bg-[#39d0c6]`
- The existing `bgClass` already has token support — extend to `left`/`top`/`w`/`h` classes

**Modify `packages/codegen/src/index.ts`:**
- Pass variableStore through to sub-emitters
- In `exportDocumentToReact`, use token names when available

**Test additions to `packages/codegen/src/codegen.test.ts`:**
```typescript
it('emits CSS custom property when token is bound', () => {
  const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    { name: 'Box', bindings: { fill: { variableId: 'v1' } } });
  const store: VariableStore = {
    variables: { v1: { id: 'v1', name: 'color-primary', valuesByMode: {} as any, type: 'color' } },
    modes: [],
    activeMode: 'default',
  };
  const css = exportNodeToCss(node, doc, { variableStore: store });
  expect(css).toContain('var(--color-primary)');
});
```

### D6 — Cross-platform verification

`tests/e2e/spec/cross-platform.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Spec Panel cross-platform', () => {
  test('code generation works on all platforms', async ({ page }) => {
    await page.goto('http://localhost:1420');
    await page.keyboard.press('i'); // inspect mode
    await page.waitForSelector('[role="tab"][aria-selected="true"]');
    // Verify spec panel sections render
    await expect(page.getByText(/svg|css|tailwind/i).first()).toBeVisible();
  });

  test('copy button copies to clipboard', async ({ page }) => {
    await page.goto('http://localhost:1420');
    await page.keyboard.press('i');
    const copyBtn = page.getByRole('button', { name: /copy/i }).first();
    await copyBtn.click();
    // Verify via clipboard API mock
    await expect(copyBtn).toBeVisible();
  });
});
```

**Verification checklist** (manual, document in `docs/plans/spec-panel-deferred.md`):
- [ ] macOS: CodeGenView renders with correct font
- [ ] macOS: Copy button uses `navigator.clipboard`
- [ ] Windows: CodeGenView renders with correct font
- [ ] Windows: Save-as dialog opens via platform.saveBlob
- [ ] Linux: CodeGenView renders correctly
- [ ] Linux: Save-as dialog opens

### D7 — PDF export wiring

**Current state:** `export_node_pdf` Tauri command exists in `apps/desktop/src-tauri/src/lib.rs`. It calls `export_pdf()` from `strata-print`. Need to verify end-to-end:

1. Verify the Rust command signature matches what the frontend expects:
```rust
#[tauri::command]
fn export_node_pdf(nodes: Vec<IpcSceneNode>, opts: Option<ExportPdfOptions>) -> Result<Vec<u8>, String> {
    let scene_nodes: Vec<SceneNode> = nodes.into_iter().map(|n| n.into()).collect();
    strata_print::export_pdf(&scene_nodes, opts.unwrap_or_default())
        .map_err(|e| e.to_string())
}
```

2. In `packages/platform/src/tauri.ts`, verify `exportPdf` exists:
```typescript
exportPdf: async (nodes: any[], opts?: any) => {
  const bytes: number[] = await invoke('export_node_pdf', { nodes, opts });
  return new Uint8Array(bytes);
},
```

3. In `packages/editor/src/components/SpecPanel/AssetExportControls.tsx`, verify the "PDF" button calls this:
```typescript
// In the format selector, when 'pdf' is chosen:
case 'pdf':
  if (platform?.exportPdf) {
    const pdfBytes = await platform.exportPdf(/* serialized nodes */);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    platform.saveBlob(blob, `${node.name}.pdf`);
  }
  break;
```

4. Add a test in `tests/e2e/spec/pdf-export.spec.ts`:
```typescript
test('PDF export button is present and clickable', async ({ page }) => {
  await page.goto('http://localhost:1420');
  await page.keyboard.press('i');
  const pdfBtn = page.getByRole('button', { name: /pdf/i });
  await expect(pdfBtn).toBeVisible();
  // Click should trigger platform.saveBlob (test in memory platform)
  // In test environment (stub platform), verify saveBlob was called
});
```

5. **Rust test:** Verify `export_pdf` handles all shape types (including arrow, path):
```rust
#[test]
fn export_pdf_with_arrow_shape() {
    let node = SceneNode {
        id: NodeId(1),
        name: "arrow".into(),
        transform: Affine::translate((10.0, 10.0)),
        shape: Shape::Arrow { from: (0.0, 0.0), to: (50.0, 0.0), tolerance: 2.0, arrowhead_size: 8.0 },
        fill: [0, 0, 0, 255],
        children: vec![],
        component_id: None,
        slots: None,
        opacity: 1.0,
        blend_mode: "normal".into(),
        rotation: 0.0,
        strokes: vec![],
        effects: vec![],
    };
    let pdf = strata_print::export_pdf(&[node], Default::default()).expect("pdf");
    assert!(pdf.starts_with(b"%PDF"));
    assert!(pdf.len() > 50);
}
```

### Verification
```bash
pnpm typecheck
cargo test -p strata-print 2>&1
npx vitest run packages/codegen/src/codegen.test.ts 2>&1
npx vitest run packages/editor/src/components/SpecPanel/ 2>&1
```
