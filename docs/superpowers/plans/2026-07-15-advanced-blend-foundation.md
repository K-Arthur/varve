# Advanced Blend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one standards-correct blend/alpha implementation and make Canvas software compositing and raster painting consume it.

**Architecture:** `@strata/engine` remains the owner of artistic blend math. `blendModes.ts` exposes the authoritative straight-RGBA compositor and typed capability lookup; `compositeCanvas.ts` delegates software pixel blending to it; `@strata/scene` consumes that public engine API for raster brush dabs instead of maintaining a third formula set. The public API distinguishes unsupported modes from Normal and keeps Plus Lighter as an explicit composite operation.

**Tech Stack:** TypeScript strict mode, Vitest, Canvas2D ImageData, W3C Compositing and Blending Level 1.

---

## File Structure

- `packages/engine/src/blendModes.ts`: canonical separable/non-separable blend functions and W3C alpha composition.
- `packages/engine/src/blendModeCatalog.ts`: mode metadata, domain support, CSS/PDF mappings, and strict lookup.
- `packages/engine/src/blendConformance.ts`: immutable numeric vectors shared by unit and future backend tests.
- `packages/engine/src/blendModes.test.ts`: exact formula, partial-alpha, transparent-edge, and unsupported-mode tests.
- `packages/engine/src/compositeCanvas.ts`: Canvas surface utilities plus delegation to canonical blending.
- `packages/engine/src/compositeCanvas.test.ts`: delegation and byte-level ImageData tests.
- `packages/engine/src/index.ts`: public exports for scene and renderer consumers.
- `packages/scene/src/rasterLayer.ts`: raster dab compositing through the canonical engine function.
- `packages/scene/src/__tests__/rasterLayer.test.ts`: source-over, Dodge/Burn, camelCase, and translucent-edge tests.
- `docs/architecture/blend-compositing.md`: implemented formula and compatibility contract.

### Task 1: Strict blend catalog

**Files:**
- Create: `packages/engine/src/blendModeCatalog.ts`
- Create: `packages/engine/src/blendModeCatalog.test.ts`
- Modify: `packages/engine/src/index.ts`

- [ ] **Step 1: Write the failing catalog tests**

```ts
import { describe, expect, it } from 'vitest';
import { blendModeDefinition, blendModesForDomain } from './blendModeCatalog';

describe('blendModeDefinition', () => {
  it('maps Color Dodge to interoperable CSS and PDF names', () => {
    expect(blendModeDefinition('colorDodge')).toMatchObject({
      id: 'colorDodge',
      css: 'color-dodge',
      pdf: 'ColorDodge',
      kind: 'blend',
    });
  });

  it('does not silently normalize an unknown mode', () => {
    expect(blendModeDefinition('mystery-mode')).toBeNull();
  });

  it('keeps Pass Through group-only', () => {
    expect(blendModesForDomain('group').map((mode) => mode.id)).toContain('passThrough');
    expect(blendModesForDomain('fill').map((mode) => mode.id)).not.toContain('passThrough');
  });

  it('keeps Plus Darker out of editable domains', () => {
    expect(blendModesForDomain('object').map((mode) => mode.id)).not.toContain('plusDarker');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run packages/engine/src/blendModeCatalog.test.ts`

Expected: FAIL because `blendModeCatalog.ts` does not exist.

- [ ] **Step 3: Implement the typed catalog**

```ts
import type { BlendMode } from './types';

export type BlendDomain = 'object' | 'group' | 'fill' | 'stroke' | 'effect';
export type BlendCategory =
  | 'normal'
  | 'darken'
  | 'lighten'
  | 'contrast'
  | 'comparative'
  | 'component';

export interface BlendModeDefinition {
  id: BlendMode;
  label: string;
  category: BlendCategory;
  kind: 'blend' | 'group-policy' | 'composite' | 'legacy';
  css: string | null;
  pdf: string | null;
  editableIn: readonly BlendDomain[];
}

const ALL: readonly BlendDomain[] = ['object', 'group', 'fill', 'stroke', 'effect'];
const PAINT: readonly BlendDomain[] = ['object', 'fill', 'stroke', 'effect'];

export const BLEND_MODE_DEFINITIONS: readonly BlendModeDefinition[] = [
  { id: 'passThrough', label: 'Pass Through', category: 'normal', kind: 'group-policy', css: null, pdf: null, editableIn: ['group'] },
  { id: 'normal', label: 'Normal', category: 'normal', kind: 'blend', css: 'source-over', pdf: 'Normal', editableIn: ALL },
  { id: 'darken', label: 'Darken', category: 'darken', kind: 'blend', css: 'darken', pdf: 'Darken', editableIn: ALL },
  { id: 'multiply', label: 'Multiply', category: 'darken', kind: 'blend', css: 'multiply', pdf: 'Multiply', editableIn: ALL },
  { id: 'colorBurn', label: 'Color Burn', category: 'darken', kind: 'blend', css: 'color-burn', pdf: 'ColorBurn', editableIn: ALL },
  { id: 'lighten', label: 'Lighten', category: 'lighten', kind: 'blend', css: 'lighten', pdf: 'Lighten', editableIn: ALL },
  { id: 'screen', label: 'Screen', category: 'lighten', kind: 'blend', css: 'screen', pdf: 'Screen', editableIn: ALL },
  { id: 'colorDodge', label: 'Color Dodge', category: 'lighten', kind: 'blend', css: 'color-dodge', pdf: 'ColorDodge', editableIn: ALL },
  { id: 'overlay', label: 'Overlay', category: 'contrast', kind: 'blend', css: 'overlay', pdf: 'Overlay', editableIn: ALL },
  { id: 'softLight', label: 'Soft Light', category: 'contrast', kind: 'blend', css: 'soft-light', pdf: 'SoftLight', editableIn: ALL },
  { id: 'hardLight', label: 'Hard Light', category: 'contrast', kind: 'blend', css: 'hard-light', pdf: 'HardLight', editableIn: ALL },
  { id: 'difference', label: 'Difference', category: 'comparative', kind: 'blend', css: 'difference', pdf: 'Difference', editableIn: ALL },
  { id: 'exclusion', label: 'Exclusion', category: 'comparative', kind: 'blend', css: 'exclusion', pdf: 'Exclusion', editableIn: ALL },
  { id: 'hue', label: 'Hue', category: 'component', kind: 'blend', css: 'hue', pdf: 'Hue', editableIn: ALL },
  { id: 'saturation', label: 'Saturation', category: 'component', kind: 'blend', css: 'saturation', pdf: 'Saturation', editableIn: ALL },
  { id: 'color', label: 'Color', category: 'component', kind: 'blend', css: 'color', pdf: 'Color', editableIn: ALL },
  { id: 'luminosity', label: 'Luminosity', category: 'component', kind: 'blend', css: 'luminosity', pdf: 'Luminosity', editableIn: ALL },
  { id: 'plusLighter', label: 'Plus Lighter', category: 'lighten', kind: 'composite', css: 'lighter', pdf: null, editableIn: PAINT },
  { id: 'plusDarker', label: 'Plus Darker', category: 'darken', kind: 'legacy', css: null, pdf: null, editableIn: [] },
] as const;

const BY_ID = new Map<string, BlendModeDefinition>(
  BLEND_MODE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function blendModeDefinition(id: string): BlendModeDefinition | null {
  return BY_ID.get(id) ?? null;
}

export function blendModesForDomain(domain: BlendDomain): readonly BlendModeDefinition[] {
  return BLEND_MODE_DEFINITIONS.filter((definition) => definition.editableIn.includes(domain));
}
```

Export the catalog types and functions from `packages/engine/src/index.ts` without changing existing unrelated exports.

- [ ] **Step 4: Run the catalog tests and typecheck**

Run: `pnpm exec vitest run packages/engine/src/blendModeCatalog.test.ts && pnpm --filter @strata/engine typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the catalog**

```bash
git add packages/engine/src/blendModeCatalog.ts packages/engine/src/blendModeCatalog.test.ts packages/engine/src/index.ts
git commit -m "feat(blend): add strict blend capability catalog"
```

### Task 2: W3C alpha conformance

**Files:**
- Create: `packages/engine/src/blendConformance.ts`
- Modify: `packages/engine/src/blendModes.test.ts`
- Modify: `packages/engine/src/blendModes.ts`

- [ ] **Step 1: Add failing partial-alpha vectors**

```ts
import { BLEND_CONFORMANCE_CASES } from './blendConformance';

describe('W3C partial-alpha conformance', () => {
  for (const fixture of BLEND_CONFORMANCE_CASES) {
    it(fixture.name, () => {
      const actual = blend(fixture.backdrop, fixture.source, fixture.mode, fixture.opacity);
      actual.forEach((channel, index) => {
        expect(channel).toBeCloseTo(fixture.expected[index]!, 8);
      });
    });
  }

  it('rejects unknown modes instead of silently applying Normal', () => {
    expect(() => blend([1, 0, 0, 1], [0, 0, 1, 1], 'mystery', 1)).toThrow(
      'Unsupported blend mode: mystery',
    );
  });
});
```

Create `BLEND_CONFORMANCE_CASES` with at least these exact vectors:

```ts
export const BLEND_CONFORMANCE_CASES = [
  {
    name: 'multiply over a half-transparent backdrop retains uncovered source color',
    backdrop: [1, 0, 0, 0.5],
    source: [0, 0, 1, 0.5],
    mode: 'multiply',
    opacity: 1,
    expected: [1 / 3, 0, 1 / 3, 0.75],
  },
  {
    name: 'screen over transparent backdrop equals source',
    backdrop: [0.8, 0.2, 0.1, 0],
    source: [0.2, 0.4, 0.6, 0.25],
    mode: 'screen',
    opacity: 1,
    expected: [0.2, 0.4, 0.6, 0.25],
  },
] as const;
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run packages/engine/src/blendModes.test.ts`

Expected: multiply partial-alpha vector fails with blue `0` instead of `1/3`; unknown mode does not throw.

- [ ] **Step 3: Implement the W3C equation and strict dispatch**

Replace the silent default in `getBlendFn` with a thrown unsupported-mode error. Keep the transparent-backdrop early return. Replace the output channels with:

```ts
const sourceUncovered = sa * (1 - ba);
const overlap = sa * ba;
const backdropUncovered = (1 - sa) * ba;

return [
  clamp((sourceUncovered * srIn + overlap * mr + backdropUncovered * br) / ao),
  clamp((sourceUncovered * sgIn + overlap * mg + backdropUncovered * bg) / ao),
  clamp((sourceUncovered * sbIn + overlap * mb + backdropUncovered * bb) / ao),
  clamp(ao),
];
```

Implement Plus Lighter as a separate premultiplied composite branch before blend-function dispatch:

```ts
if (mode === 'plusLighter') {
  const ao = Math.min(1, sa + ba);
  if (ao === 0) return [0, 0, 0, 0];
  return [
    clamp((sa * srIn + ba * br) / ao),
    clamp((sa * sgIn + ba * bg) / ao),
    clamp((sa * sbIn + ba * bb) / ao),
    ao,
  ];
}
```

Do not dispatch Plus Darker through a source-over blend function.

- [ ] **Step 4: Run focused and package tests**

Run: `pnpm exec vitest run packages/engine/src/blendModes.test.ts packages/engine/src/nonSeparable.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit W3C composition**

```bash
git add packages/engine/src/blendModes.ts packages/engine/src/blendModes.test.ts packages/engine/src/blendConformance.ts
git commit -m "fix(blend): implement W3C partial-alpha composition"
```

### Task 3: Remove the duplicate CompositeCanvas formula engine

**Files:**
- Modify: `packages/engine/src/compositeCanvas.ts`
- Modify: `packages/engine/src/compositeCanvas.test.ts`

- [ ] **Step 1: Add a failing byte-level delegation test**

```ts
it('preserves source blue over a half-transparent red backdrop in Multiply', () => {
  const backdrop = new ImageData(new Uint8ClampedArray([255, 0, 0, 128]), 1, 1);
  const source = new ImageData(new Uint8ClampedArray([0, 0, 255, 128]), 1, 1);
  const result = blendPixels(backdrop, source, 'multiply', 1);

  expect([...result.data]).toEqual([85, 0, 85, 192]);
});

it('throws for an unsupported software mode', () => {
  const pixel = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1);
  expect(() => blendPixels(pixel, pixel, 'mystery', 1)).toThrow('Unsupported blend mode');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run packages/engine/src/compositeCanvas.test.ts`

Expected: partial-alpha byte vector fails and unknown mode does not throw.

- [ ] **Step 3: Delegate to the canonical implementation**

At the top of `compositeCanvas.ts`, import:

```ts
import { blendPixels as blendPixelsCanonical } from './blendModes';
import { blendModeDefinition } from './blendModeCatalog';
```

Replace the duplicate `blendPixels` body with:

```ts
export function blendPixels(
  backdrop: ImageData,
  source: ImageData,
  blendMode: string,
  opacity: number,
): ImageData {
  return blendPixelsCanonical(backdrop, source, blendMode, opacity);
}
```

Replace `mapBlendMode`'s switch with strict catalog lookup:

```ts
export function mapBlendMode(mode: string): string {
  const definition = blendModeDefinition(mode);
  if (!definition?.css) throw new Error(`Blend mode is not available in Canvas2D: ${mode}`);
  return definition.css;
}
```

Call sites that intentionally implement Pass Through must avoid calling
`mapBlendMode('passThrough')` and choose source-over at their group-policy layer.

- [ ] **Step 4: Run focused engine tests**

Run: `pnpm exec vitest run packages/engine/src/compositeCanvas.test.ts packages/engine/src/blendModes.test.ts packages/engine/src/replay.test.ts packages/engine/src/filterCompositor.test.ts`

Expected: PASS after updating explicit Pass Through call sites, with no silent fallback assertions remaining.

- [ ] **Step 5: Commit consolidation**

```bash
git add packages/engine/src/compositeCanvas.ts packages/engine/src/compositeCanvas.test.ts packages/engine/src/replay.ts packages/engine/src/filterCompositor.ts
git commit -m "refactor(blend): centralize software pixel composition"
```

### Task 4: Route raster brush dabs through canonical blending

**Files:**
- Modify: `packages/engine/src/index.ts`
- Modify: `packages/scene/src/rasterLayer.ts`
- Modify: `packages/scene/src/__tests__/rasterLayer.test.ts`

- [ ] **Step 1: Add failing raster-dab conformance tests**

```ts
import type { BrushDab, RasterLayerNode } from '../types';
import { TILE_SIZE, compositeDabOnNode, createEmptyTile, makeRasterLayerNode } from '../rasterLayer';

const CENTER = 16;

function makeSinglePixelRaster(rgba: readonly [number, number, number, number]): RasterLayerNode {
  const node = makeRasterLayerNode('raster', { width: TILE_SIZE, height: TILE_SIZE });
  const tile = createEmptyTile();
  const offset = (CENTER * TILE_SIZE + CENTER) * 4;
  tile.pixels.set(rgba, offset);
  return { ...node, tiles: new Map([['0:0', tile]]) };
}

function centerDab(
  options: { blendMode: string; opacity: number },
): BrushDab {
  return {
    x: CENTER + 0.5,
    y: CENTER + 0.5,
    radius: 0.5,
    hardness: 1,
    opacity: options.opacity,
    flow: 1,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    blendMode: options.blendMode,
  };
}

function readCenterPixel(node: RasterLayerNode): [number, number, number, number] {
  const pixels = node.tiles.get('0:0')!.pixels;
  const offset = (CENTER * TILE_SIZE + CENTER) * 4;
  return [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, pixels[offset + 3]!];
}

it('source-over paint replaces opaque destination color', () => {
  const node = makeSinglePixelRaster([255, 0, 0, 255]);
  const result = compositeDabOnNode(
    node,
    centerDab({ blendMode: 'normal', opacity: 1 }),
    [0, 0, 255, 255],
  );
  expect(readCenterPixel(result)).toEqual([0, 0, 255, 255]);
});

it('uses camelCase Color Dodge with the W3C equation', () => {
  const node = makeSinglePixelRaster([128, 128, 128, 255]);
  const result = compositeDabOnNode(
    node,
    centerDab({ blendMode: 'colorDodge', opacity: 1 }),
    [128, 128, 128, 255],
  );
  expect(readCenterPixel(result)[0]).toBeGreaterThanOrEqual(254);
});

it('retains source color over a partially transparent Multiply backdrop', () => {
  const node = makeSinglePixelRaster([255, 0, 0, 128]);
  const result = compositeDabOnNode(
    node,
    centerDab({ blendMode: 'multiply', opacity: 0.5 }),
    [0, 0, 255, 255],
  );
  expect(readCenterPixel(result)).toEqual([85, 0, 85, 192]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm exec vitest run packages/scene/src/__tests__/rasterLayer.test.ts`

Expected: Normal leaves opaque destination red, camelCase Dodge falls through,
and partial-alpha Multiply loses blue.

- [ ] **Step 3: Export and consume canonical `blend`**

Export `blend` from `packages/engine/src/index.ts`. In `rasterLayer.ts`, import it
with `Affine`:

```ts
import { blend, type Affine } from '@strata/engine';
```

Delete the local `blendPixel` function. Replace both Normal and advanced branches
inside `compositeBrushDabOnPixels` with one straight-RGBA call:

```ts
const result = blend(
  [
    pixels[idx]! / 255,
    pixels[idx + 1]! / 255,
    pixels[idx + 2]! / 255,
    destAlpha,
  ],
  [color[0]! / 255, color[1]! / 255, color[2]! / 255, effectiveAlpha],
  blendMode === 'source-over' ? 'normal' : blendMode,
  1,
);
pixels[idx] = Math.round(result[0] * 255);
pixels[idx + 1] = Math.round(result[1] * 255);
pixels[idx + 2] = Math.round(result[2] * 255);
pixels[idx + 3] = Math.round(result[3] * 255);
```

- [ ] **Step 4: Run scene and engine regression tests**

Run: `pnpm exec vitest run packages/scene/src/__tests__/rasterLayer.test.ts packages/engine/src/blendModes.test.ts packages/engine/src/compositeCanvas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit raster parity**

```bash
git add packages/engine/src/index.ts packages/scene/src/rasterLayer.ts packages/scene/src/__tests__/rasterLayer.test.ts
git commit -m "fix(paint): share canonical blend composition"
```

### Task 5: Foundation documentation and regression gate

**Files:**
- Create: `docs/architecture/blend-compositing.md`
- Modify: `docs/superpowers/specs/2026-07-15-advanced-blend-system-design.md`

- [ ] **Step 1: Document the implemented contract**

Document:

- the exact W3C equation from Task 2;
- encoded-sRGB compatibility blend space;
- straight blend inputs and premultiplied storage/output;
- standard mode list and Plus Lighter exception;
- Pass Through as group policy;
- strict unsupported-mode behavior;
- future conformance consumers for Canvas2D, WebGPU, WASM/native, SVG, and PDF.

Update the design specification's ownership statement to clarify that
`@strata/engine` owns and publicly exports the blend core, while
`@strata/scene` consumes it through its existing one-way dependency.

- [ ] **Step 2: Run the mandatory regression protocol**

Run in order:

```bash
pnpm format
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:emoji
pnpm audit:tokens
```

Expected: every command passes. If unrelated failures remain from the pre-existing
dirty branch, record exact test names and verify the blend-focused tests remain
green; do not hide or rewrite unrelated user work.

- [ ] **Step 3: Run architecture health triage**

Re-index with the repository's jcodemunch workflow, then run the health triage
and compare against `AGENTS.md` ceilings. No hub import is added in this phase.

Expected: no threshold regression.

- [ ] **Step 4: Commit and verify persistence**

```bash
git add docs/architecture/blend-compositing.md docs/superpowers/specs/2026-07-15-advanced-blend-system-design.md
git commit -m "docs: record blend compositing compatibility contract"
git log --oneline -3
```

- [ ] **Step 5: Push the verified milestone**

Run: `git push origin fix/canvas-selection-transform-image-toolbar`

Expected: remote branch contains every foundation commit. If remote export is
blocked by environment policy, report the exact local commit ids and do not use an
alternate transport.
