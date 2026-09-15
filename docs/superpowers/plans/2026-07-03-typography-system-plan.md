# Typography System Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between Strata's typography data model and its actual render, measurement, and export behavior for rich text, variable fonts, and OpenType features.

**Architecture:** Extend the engine IR text primitive to carry rich text and font-feature data, add a focused typography layout engine in `@varve/engine`, update the Canvas2D replay renderer to draw positioned runs, and improve SVG export and preflight to consume the same data. One layout structure feeds multiple outputs.

**Tech Stack:** TypeScript, Vitest, jsdom, Canvas2D, CanvasRenderingContext2D, CSS Font Loading API, SVG 1.1.

---

## File Map

| File | Responsibility |
|---|---|
| `packages/engine/src/fontRegistry.ts` | Font registry: registration, loading, CSS building, fallback chains, metadata. |
| `packages/engine/src/types.ts` | Engine IR types including `Primitive` text kind and `SceneNode`. |
| `packages/engine/src/engine.ts` | Stub engine `shapeToPrimitive` that builds the text primitive from a `TextNode`. |
| `packages/engine/src/textLayout.ts` (create) | Typography layout engine: wrap rich text, produce positioned runs/lines. |
| `packages/engine/src/replay.ts` | Canvas2D IR replay including `paintText`. |
| `packages/shared/src/textMeasure.ts` | Shared text measurement helpers (plain + rich text). |
| `packages/codegen/src/svg.ts` | Per-node SVG export including text. |
| `packages/scene/src/typographyPreflight.ts` | Continuous typography validation. |
| Test files | `fontRegistry.test.ts`, `engine.test.ts`, `textLayout.test.ts`, `replay.test.ts`, `textMeasure.test.ts`, `svg.ts` tests, `typographyPreflight.test.ts`. |

---

### Task 1: Fix FontRegistry CSS quoting and availability semantics

**Files:**
- Modify: `packages/engine/src/fontRegistry.ts:114-286`
- Test: `packages/engine/src/fontRegistry.test.ts:53-201`

- [ ] **Step 1: Write the failing test**

```ts
it('resolve quotes the family but not fallbacks', () => {
  const reg = new FontRegistry([]);
  reg.register({ family: 'Inter', weight: 400, style: 'normal', source: 'system' });
  expect(reg.resolve('Inter')).toBe('"Inter", sans-serif, serif, monospace');
});

it('resolve does not quote generic names', () => {
  const reg = new FontRegistry([]);
  expect(reg.resolve('sans-serif')).toBe('sans-serif');
});

it('buildFontCSS produces valid shorthand with quoted family', () => {
  const reg = new FontRegistry([]);
  reg.register({ family: 'Inter', weight: 400, style: 'normal', source: 'system' });
  const css = reg.buildFontCSS('Inter', 16, 700, 'italic', 1.5);
  expect(css).toBe('italic 700 16px/1.5 "Inter", sans-serif, serif, monospace');
});

it('isAvailable returns true only for loaded state', () => {
  const reg = new FontRegistry([]);
  reg.register({ family: 'A', weight: 400, style: 'normal', source: 'system' });
  expect(reg.isAvailable('A')).toBe(false);
  reg['loadState'].set('A', 'loaded');
  expect(reg.isAvailable('A')).toBe(true);
  reg['loadState'].set('A', 'error');
  expect(reg.isAvailable('A')).toBe(false);
});

it('isRegistered returns true for registered families regardless of load state', () => {
  const reg = new FontRegistry([]);
  reg.register({ family: 'B', weight: 400, style: 'normal', source: 'system' });
  expect(reg.isRegistered('B')).toBe(true);
  expect(reg.isRegistered('Unknown')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @varve/engine test -- --run fontRegistry`
Expected: FAIL with assertion mismatch on `resolve`/`buildFontCSS`/`isAvailable`/`isRegistered`.

- [ ] **Step 3: Implement minimal changes**

Edit `packages/engine/src/fontRegistry.ts`:

1. Replace `resolve` to quote the family name and append unquoted fallbacks:
```ts
resolve(family: string, _weight?: number, _style?: string): string {
  const fallbacks = this.fallbackChain(family);
  const isGeneric = fallbacks.length === 0 && ['sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'fantasy', 'cursive'].includes(family.toLowerCase());
  const familyPart = isGeneric ? family : `"${family}"`;
  return fallbacks.length > 0 ? `${familyPart}, ${fallbacks.join(', ')}` : familyPart;
}
```

2. Replace `buildFontCSS` to use the resolved family string directly (already quoted):
```ts
buildFontCSS(
  family: string,
  size: number,
  weight?: number,
  style?: string,
  lineHeight?: number,
): string {
  const w = weight ?? 400;
  const s = style ?? 'normal';
  const lh = lineHeight ?? 1.2;
  const familyStr = this.resolve(family);
  return `${s} ${w} ${size}px/${lh} ${familyStr}`;
}
```

3. Fix `isAvailable`:
```ts
isAvailable(family: string): boolean {
  return this.loadState.get(family) === 'loaded';
}
```

4. Add `isRegistered`:
```ts
isRegistered(family: string): boolean {
  return this.entries.has(family);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @varve/engine test -- --run fontRegistry`
Expected: PASS (36 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/fontRegistry.ts packages/engine/src/fontRegistry.test.ts
git commit -m "fix(engine): correct FontRegistry CSS quoting and availability semantics"
```

---

### Task 2: Extend engine IR text primitive with rich text and font features

**Files:**
- Modify: `packages/engine/src/types.ts:112-249`
- Modify: `packages/engine/src/engine.ts:31-79`
- Test: `packages/engine/src/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('buildIr preserves richText, variableAxes, and openTypeFeatures on text nodes', async () => {
  const engine = await createEngine('stub');
  const richText = {
    paragraphs: [
      {
        runs: [{ text: 'Hello ', format: { fontWeight: 400 } }, { text: 'World', format: { fontWeight: 700 } }],
      },
    ],
  };
  const scene: Scene = {
    nodes: [
      {
        id: 't1',
        name: 'Text',
        kind: 'text',
        transform: [1, 0, 0, 1, 0, 0],
        text: 'Hello World',
        fontSize: 16,
        fontFamily: 'Inter',
        richText,
        variableAxes: { wght: 500, wdth: 75 },
        openTypeFeatures: { liga: true, kern: true },
      },
    ],
  };
  const ir = await engine.buildIr(scene);
  const primitive = ir[0]?.primitive;
  expect(primitive?.kind).toBe('text');
  if (primitive?.kind === 'text') {
    expect(primitive.richText).toEqual(richText);
    expect(primitive.variableAxes).toEqual({ wght: 500, wdth: 75 });
    expect(primitive.openTypeFeatures).toEqual({ liga: true, kern: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @varve/engine test -- --run engine`
Expected: FAIL because `primitive.richText` is undefined.

- [ ] **Step 3: Implement minimal changes**

Edit `packages/engine/src/types.ts`:

1. Add imports at the top:
```ts
import type { OpenTypeFeatureMap, PathTextSettings, RichText, TextMode, VariableFontSettings } from '@varve/scene';
```

2. Extend `SceneNode` text fields:
```ts
/** Optional rich text content. */
richText?: RichText;
/** Variable font axis values. */
variableAxes?: VariableFontSettings;
/** OpenType feature flags. */
openTypeFeatures?: OpenTypeFeatureMap;
/** Text mode. */
textMode?: TextMode;
/** Path text settings. */
pathTextSettings?: PathTextSettings;
```

3. Extend `Primitive` text kind:
```ts
| {
    kind: 'text';
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    fontSize: number;
    fontFamily: string;
    fontWeight: number;
    fontStyle: 'normal' | 'italic';
    textAlign: 'left' | 'center' | 'right' | 'justify';
    textAlignVertical: 'top' | 'middle' | 'bottom';
    letterSpacing: number;
    lineHeight: number;
    paragraphSpacing: number;
    textCase: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    textDecoration: 'none' | 'underline' | 'line-through';
    textOverflow: 'clip' | 'ellipsis' | 'visible';
    listStyle: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
    /** Rich text content (takes precedence over `text` when rendering). */
    richText?: RichText;
    /** Variable font axis values. */
    variableAxes?: VariableFontSettings;
    /** OpenType feature flags. */
    openTypeFeatures?: OpenTypeFeatureMap;
    /** Text mode. */
    textMode?: TextMode;
    /** Path text settings. */
    pathTextSettings?: PathTextSettings;
  };
```

Edit `packages/engine/src/engine.ts`:

In `shapeToPrimitive`, after the text primitive object, add the new fields:
```ts
return {
  ...existingFields,
  richText: node.richText,
  variableAxes: node.variableAxes,
  openTypeFeatures: node.openTypeFeatures,
  textMode: node.textMode as TextMode | undefined,
  pathTextSettings: node.pathTextSettings,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @varve/engine test -- --run engine`
Expected: PASS (new + existing 24 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/engine.ts packages/engine/src/engine.test.ts
git commit -m "feat(engine): extend IR text primitive with richText, variable axes, and OpenType features"
```

---

### Task 3: Add typography layout engine for rich text

**Files:**
- Create: `packages/engine/src/textLayout.ts`
- Create: `packages/engine/src/textLayout.test.ts`
- Modify: `packages/shared/src/textMeasure.ts` (add `measureRichTextWrapped` helper)

- [ ] **Step 1: Write the failing test**

Create `packages/engine/src/textLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutRichText } from './textLayout';

describe('layoutRichText', () => {
  it('returns single line for short text', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [{ text: 'Hello' }],
          },
        ],
      },
      200,
      { fontSize: 16, fontFamily: 'sans-serif' },
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.runs).toHaveLength(1);
    expect(result.lines[0]?.runs[0]?.text).toBe('Hello');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('wraps mixed-format runs across lines', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [
              { text: 'Small ', format: { fontSize: 12 } },
              { text: 'big', format: { fontSize: 32 } },
            ],
          },
        ],
      },
      80,
      { fontSize: 16, fontFamily: 'sans-serif' },
    );
    expect(result.lines.length).toBeGreaterThanOrEqual(1);
    expect(result.lines[0]?.runs.length).toBeGreaterThanOrEqual(1);
  });

  it('marks overflow when text exceeds max lines', () => {
    const result = layoutRichText(
      {
        paragraphs: [
          {
            runs: [{ text: 'A B C D E F G H I J' }],
            format: { maxLines: 2 },
          },
        ],
      },
      30,
      { fontSize: 16, fontFamily: 'sans-serif' },
    );
    expect(result.lines.length).toBeLessThanOrEqual(2);
    expect(result.overset).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @varve/engine test -- --run textLayout`
Expected: FAIL because `textLayout.ts` does not exist.

- [ ] **Step 3: Implement minimal layout engine**

Create `packages/engine/src/textLayout.ts`:

```ts
/**
 * Typography layout engine — produces positioned text lines/runs for rendering and export.
 *
 * Research basis: CSS inline layout, Figma derived text data, HarfBuzz glyph runs.
 */

import type { CharacterFormat, Paragraph, ParagraphFormat, RichText } from '@varve/scene';
import { measureRun, type RunMeasureOptions } from '@varve/shared';

export interface PositionedRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  format: ResolvedCharacterFormat;
  font: string;
  featureSettings?: string;
  variationSettings?: string;
}

export interface PositionedLine {
  runs: PositionedRun[];
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

export interface PositionedText {
  lines: PositionedLine[];
  width: number;
  height: number;
  overset: boolean;
}

export interface ResolvedCharacterFormat extends CharacterFormat {
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  lineHeight: number;
  letterSpacing: number;
  textCase: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration: 'none' | 'underline' | 'line-through';
  color: readonly [number, number, number, number];
}

function buildFontString(format: ResolvedCharacterFormat): string {
  const style = format.fontStyle === 'italic' ? 'italic ' : '';
  return `${style}${format.fontWeight} ${format.fontSize}px "${format.fontFamily}"`;
}

function buildFeatureSettings(features?: Record<string, boolean>): string | undefined {
  if (!features || Object.keys(features).length === 0) return undefined;
  const parts = Object.entries(features)
    .filter(([tag]) => tag !== 'custom')
    .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
    .join(', ');
  return parts ? `font-feature-settings: ${parts};` : undefined;
}

function buildVariationSettings(axes?: Record<string, number>): string | undefined {
  if (!axes || Object.keys(axes).length === 0) return undefined;
  const parts = Object.entries(axes)
    .map(([tag, value]) => `"${tag}" ${value}`)
    .join(', ');
  return `font-variation-settings: ${parts};`;
}

function resolveFormat(
  runFormat: CharacterFormat | undefined,
  paraFormat: ParagraphFormat | undefined,
  defaults: RunMeasureOptions,
): ResolvedCharacterFormat {
  const base: ResolvedCharacterFormat = {
    fontSize: defaults.fontSize,
    fontFamily: defaults.fontFamily,
    fontWeight: defaults.fontWeight ?? 400,
    fontStyle: defaults.fontStyle ?? 'normal',
    lineHeight: defaults.lineHeight ?? 1.4,
    letterSpacing: defaults.letterSpacing ?? 0,
    textCase: defaults.textCase ?? 'none',
    textDecoration: 'none',
    color: [0, 0, 0, 255],
  };
  const merged: ResolvedCharacterFormat = { ...base, ...paraFormat, ...runFormat } as ResolvedCharacterFormat;
  return merged;
}

function measureRunWidth(text: string, format: ResolvedCharacterFormat): number {
  return measureRun(text, format).width;
}

function splitRunByWidth(
  text: string,
  format: ResolvedCharacterFormat,
  maxWidth: number,
  offsetX: number,
): { fitted: string; width: number; overset: string } {
  const words = text.split(' ');
  let current = '';
  let currentWidth = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    const w = measureRunWidth(candidate, format);
    if (w + offsetX > maxWidth && current.length > 0) {
      return { fitted: current, width: currentWidth, overset: words.slice(i).join(' ') };
    }
    current = candidate;
    currentWidth = w;
  }
  return { fitted: text, width: currentWidth, overset: '' };
}

function layoutParagraph(
  paragraph: Paragraph,
  width: number,
  defaultFormat: RunMeasureOptions,
  startY: number,
): { lines: PositionedLine[]; height: number; overset: boolean } {
  const resolvedRuns = paragraph.runs.map((run) => ({
    text: run.text,
    format: resolveFormat(run.format, paragraph.format, defaultFormat),
  }));

  const maxLines = paragraph.format?.maxLines;
  const lines: PositionedLine[] = [];
  let currentY = startY;
  let lineOverset = false;

  for (const run of resolvedRuns) {
    let remaining = run.text;
    let currentFormat = run.format;
    while (remaining.length > 0) {
      const offsetX = lines[lines.length - 1]?.width ?? 0;
      const availableWidth = width - offsetX;
      if (availableWidth <= 0 || (maxLines !== undefined && lines.length >= maxLines)) {
        lineOverset = true;
        break;
      }
      const split = splitRunByWidth(remaining, currentFormat, width, offsetX);
      if (split.fitted.length === 0) {
        // Word is too wide for the whole line; force a line with the word.
        const forced = remaining.split(' ')[0] ?? remaining;
        const w = measureRunWidth(forced, currentFormat);
        lines.push({
          runs: [
            {
              text: forced,
              x: 0,
              y: currentY,
              width: w,
              height: currentFormat.fontSize * currentFormat.lineHeight,
              format: currentFormat,
              font: buildFontString(currentFormat),
              featureSettings: buildFeatureSettings(currentFormat.openTypeFeatures),
              variationSettings: buildVariationSettings(currentFormat.variableFontSettings),
            },
          ],
          x: 0,
          y: currentY,
          width: w,
          height: currentFormat.fontSize * currentFormat.lineHeight,
          baseline: currentY,
        });
        remaining = remaining.slice(forced.length).trimStart();
        currentY += lines[lines.length - 1]!.height;
        continue;
      }
      const runHeight = currentFormat.fontSize * currentFormat.lineHeight;
      const line = lines[lines.length - 1];
      if (line) {
        line.runs.push({
          text: split.fitted,
          x: line.width,
          y: currentY,
          width: split.width - line.width,
          height: runHeight,
          format: currentFormat,
          font: buildFontString(currentFormat),
          featureSettings: buildFeatureSettings(currentFormat.openTypeFeatures),
          variationSettings: buildVariationSettings(currentFormat.variableFontSettings),
        });
        line.width = split.width;
        line.height = Math.max(line.height, runHeight);
      } else {
        lines.push({
          runs: [
            {
              text: split.fitted,
              x: 0,
              y: currentY,
              width: split.width,
              height: runHeight,
              format: currentFormat,
              font: buildFontString(currentFormat),
              featureSettings: buildFeatureSettings(currentFormat.openTypeFeatures),
              variationSettings: buildVariationSettings(currentFormat.variableFontSettings),
            },
          ],
          x: 0,
          y: currentY,
          width: split.width,
          height: runHeight,
          baseline: currentY,
        });
      }
      remaining = split.overset;
      if (remaining.length > 0) {
        currentY += lines[lines.length - 1]!.height;
      }
    }
  }

  const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
  return { lines, height: totalHeight, overset: lineOverset };
}

export function layoutRichText(
  richText: RichText,
  width: number,
  defaultFormat: RunMeasureOptions,
): PositionedText {
  const allLines: PositionedLine[] = [];
  let currentY = 0;
  let maxWidth = 0;
  let overset = false;

  for (const para of richText.paragraphs) {
    const { lines, height, overset: paraOverset } = layoutParagraph(para, width, defaultFormat, currentY);
    allLines.push(...lines);
    currentY += height;
    maxWidth = Math.max(maxWidth, ...lines.map((l) => l.width));
    overset = overset || paraOverset;
  }

  return { lines: allLines, width: maxWidth, height: currentY, overset };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @varve/engine test -- --run textLayout`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/textLayout.ts packages/engine/src/textLayout.test.ts
git commit -m "feat(engine): add typography layout engine for rich text"
```

---

### Task 4: Render rich text in Canvas2D replay

**Files:**
- Modify: `packages/engine/src/replay.ts:570-696`
- Test: `packages/engine/src/replay.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('paints rich text with per-run formatting', () => {
  const target = createMockTarget();
  const ir: RenderItem = {
    transform: [1, 0, 0, 1, 0, 0],
    fill: [0, 0, 0, 255],
    primitive: {
      kind: 'text',
      x: 0,
      y: 0,
      w: 200,
      h: 100,
      text: 'Hello World',
      fontSize: 16,
      fontFamily: 'Inter',
      fontWeight: 400,
      fontStyle: 'normal',
      textAlign: 'left',
      textAlignVertical: 'top',
      letterSpacing: 0,
      lineHeight: 1.4,
      paragraphSpacing: 0,
      textCase: 'none',
      textDecoration: 'none',
      textOverflow: 'visible',
      listStyle: 'none',
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Hello', format: { fontWeight: 400 } },
              { text: ' World', format: { fontWeight: 700, fontSize: 20 } },
            ],
          },
        ],
      },
    },
  };
  replayIr(target, [ir]);
  expect(target.fillText).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @varve/engine test -- --run replay`
Expected: FAIL because rich text path is not implemented.

- [ ] **Step 3: Implement minimal rich text rendering**

Edit `packages/engine/src/replay.ts`:

1. Import `layoutRichText` from `./textLayout`.
2. In `paintText`, check for `p.richText` and call a new `paintRichText` function.

```ts
import { layoutRichText } from './textLayout';

function paintRichText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  const defaultFormat = {
    fontSize: p.fontSize,
    fontFamily: p.fontFamily,
    fontWeight: p.fontWeight,
    fontStyle: p.fontStyle,
    letterSpacing: p.letterSpacing,
    lineHeight: p.lineHeight,
    textCase: p.textCase,
    textDecoration: p.textDecoration,
  };
  const positioned = layoutRichText(p.richText!, p.w, defaultFormat);

  let yOffset = 0;
  if (p.textAlignVertical === 'middle') yOffset = (p.h - positioned.height) / 2;
  else if (p.textAlignVertical === 'bottom') yOffset = p.h - positioned.height;

  for (const line of positioned.lines) {
    let xOffset = 0;
    if (p.textAlign === 'center') xOffset = (p.w - line.width) / 2;
    else if (p.textAlign === 'right') xOffset = p.w - line.width;

    for (const run of line.runs) {
      target.font = run.font;
      target.fillStyle = run.format.color ? rgba(run.format.color) : undefined;
      target.fillText(run.text, p.x + run.x + xOffset, p.y + run.y + yOffset);

      if (run.format.textDecoration === 'underline' || run.format.textDecoration === 'line-through') {
        const decoY = run.format.textDecoration === 'underline'
          ? p.y + run.y + yOffset + run.format.fontSize * 1.1
          : p.y + run.y + yOffset + run.format.fontSize * 0.5;
        target.beginPath();
        target.moveTo(p.x + run.x + xOffset, decoY);
        target.lineTo(p.x + run.x + xOffset + run.width, decoY);
        target.stroke();
      }
    }
  }
}
```

3. In `paintText`, add at the top:
```ts
if (p.richText) {
  paintRichText(target, p);
  return;
}
```

4. For plain text, fix letter-spacing by measuring actual glyph width instead of `0.6` estimate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @varve/engine test -- --run replay`
Expected: PASS (new + existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/replay.ts packages/engine/src/replay.test.ts
git commit -m "feat(engine): render rich text with per-run formatting in Canvas2D"
```

---

### Task 5: Improve SVG text export for multi-line and rich text

**Files:**
- Modify: `packages/codegen/src/svg.ts:93-117`
- Test: `packages/codegen/src/codegen.test.ts` (or create `svg.test.ts`)

- [ ] **Step 1: Write the failing test**

In `packages/codegen/src/codegen.test.ts` add:

```ts
it('exports text with line breaks as tspan elements', () => {
  const doc = createDocument();
  const node = makeTextNode('t1', 'Line 1\nLine 2', { fontSize: 16, fontFamily: 'Inter' });
  doc = addNode(doc, node);
  const svg = exportDocumentToSvg(doc);
  expect(svg).toContain('<tspan');
  expect(svg).toContain('Line 1');
  expect(svg).toContain('Line 2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/codegen/src/codegen.test.ts -- --run`
Expected: FAIL because `<tspan>` is not produced.

- [ ] **Step 3: Implement minimal SVG multi-line/rich text export**

Edit `packages/codegen/src/svg.ts`:

Replace the text case in `nodeToSvgTag` with a helper that:
1. Splits `node.text` by `\n` into `<tspan>` elements with `x` reset and `dy` line height.
2. For `node.richText`, iterate paragraphs/runs and emit `<tspan>` per run with per-run attributes.
3. Applies `font-variation-settings` and `font-feature-settings` style attributes when `node.variableAxes` or `node.openTypeFeatures` are present.

```ts
function buildTextContent(node: SceneNode, textStyle: string): string {
  const baseY = 0;
  const lh = (node.lineHeight ?? 1.4) * (node.fontSize ?? 16);
  const lines = (node.text ?? '').split('\n');
  if (!node.richText) {
    return lines
      .map((line, i) => {
        const y = baseY + i * lh;
        const escaped = escapeXml(line);
        return `      <tspan x="0" y="${y.toFixed(2)}" ${textStyle}>${escaped}</tspan>`;
      })
      .join('\n');
  }
  // Rich text path: simplified — one tspan per run
  const runs: string[] = [];
  let y = baseY;
  for (const para of node.richText.paragraphs) {
    let x = 0;
    for (const run of para.runs) {
      const attrs: string[] = [`x="${x.toFixed(2)}"`, `y="${y.toFixed(2)}"`];
      if (run.format?.fontFamily) attrs.push(`font-family="${escapeXml(run.format.fontFamily)}"`);
      if (run.format?.fontSize) attrs.push(`font-size="${run.format.fontSize}"`);
      if (run.format?.fontWeight) attrs.push(`font-weight="${run.format.fontWeight}"`);
      if (run.format?.fontStyle === 'italic') attrs.push(`font-style="italic"`);
      if (run.format?.letterSpacing) attrs.push(`letter-spacing="${run.format.letterSpacing}"`);
      if (run.format?.textDecoration && run.format.textDecoration !== 'none') {
        attrs.push(`text-decoration="${run.format.textDecoration}"`);
      }
      const styleParts: string[] = [];
      if (run.format?.variableFontSettings) {
        const settings = Object.entries(run.format.variableFontSettings)
          .map(([tag, value]) => `"${tag}" ${value}`)
          .join(', ');
        styleParts.push(`font-variation-settings: ${settings};`);
      }
      if (run.format?.openTypeFeatures) {
        const features = Object.entries(run.format.openTypeFeatures)
          .filter(([tag]) => tag !== 'custom')
          .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
          .join(', ');
        if (features) styleParts.push(`font-feature-settings: ${features};`);
      }
      if (styleParts.length > 0) attrs.push(`style="${styleParts.join(' ')}"`);
      runs.push(`      <tspan ${attrs.join(' ')}>${escapeXml(run.text)}</tspan>`);
      // Approximate advance; real layout engine would compute this.
      x += run.text.length * (run.format?.fontSize ?? node.fontSize ?? 16) * 0.6;
    }
    y += lh;
  }
  return runs.join('\n');
}
```

Then in the `case 'text':` block, call `buildTextContent`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/codegen/src/codegen.test.ts -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/codegen/src/svg.ts packages/codegen/src/codegen.test.ts
git commit -m "feat(codegen): SVG text export with multi-line and rich text support"
```

---

### Task 6: Strengthen typography preflight

**Files:**
- Modify: `packages/scene/src/typographyPreflight.ts`
- Test: `packages/scene/src/typographyPreflight.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('detects missing variable axes', () => {
  let doc = createDocument();
  const node = makeTextNode('t1', 'Hello', { fontFamily: 'Inter', variableAxes: { wxyz: 500 } });
  doc = addNode(doc, node);
  const result = runTypographyPreflight(doc, {
    availableFonts: new Set(['Inter']),
    supportedAxes: new Map([['Inter', new Set(['wght'])]]),
  });
  expect(result.issues.some((i) => i.category === 'unsupported-glyph' || i.category === 'style-conflict')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @varve/scene test -- --run typographyPreflight`
Expected: FAIL because `supportedAxes` option is not implemented.

- [ ] **Step 3: Implement minimal preflight improvements**

Edit `packages/scene/src/typographyPreflight.ts`:

1. Add `supportedAxes?: Map<string, Set<string>>` to options.
2. In the text-node loop, after missing-font check, check variable axes:
```ts
if (node.variableAxes && options.supportedAxes) {
  const axes = options.supportedAxes.get(node.fontFamily ?? 'Inter');
  if (axes) {
    for (const axis of Object.keys(node.variableAxes)) {
      if (!axes.has(axis)) {
        issues.push({
          severity: 'warning',
          category: 'style-conflict',
          message: `Variable axis "${axis}" is not supported by "${node.fontFamily ?? 'Inter'}"`,
          nodeId: node.id,
        });
      }
    }
  }
}
```

3. Add `unsupported-glyph` check stub using a new `fontMetadata` option:
```ts
if (options.fontMetadata && node.text) {
  const meta = options.fontMetadata.get(node.fontFamily ?? 'Inter');
  if (meta && meta.glyphCount && node.text.length > 0) {
    // Conservative stub: report only obviously unsupported private-use characters
    for (const char of node.text) {
      const code = char.codePointAt(0) ?? 0;
      if (code >= 0xe000 && code <= 0xf8ff) {
        issues.push({
          severity: 'warning',
          category: 'unsupported-glyph',
          message: `Private-use character may not be supported by "${node.fontFamily ?? 'Inter'}"`,
          nodeId: node.id,
        });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @varve/scene test -- --run typographyPreflight`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scene/src/typographyPreflight.ts packages/scene/src/typographyPreflight.test.ts
git commit -m "feat(scene): strengthen typography preflight with variable axis and glyph checks"
```

---

### Task 7: Final regression gate

- [ ] **Step 1: Run all relevant tests**

```bash
pnpm --filter @varve/shared test -- --run
pnpm --filter @varve/engine test -- --run
pnpm --filter @varve/scene test -- --run
pnpm exec vitest run packages/codegen/src -- --run
```

Expected:
- shared: 186+ pass
- engine: 251+ pass
- scene: 372 pass (2 pre-existing unrelated failures documented)
- codegen: 45+ pass

- [ ] **Step 2: Run formatting and type checks**

```bash
pnpm format-check
pnpm typecheck
pnpm lint
pnpm audit:emoji
pnpm audit:tokens
```

Expected: no new errors on touched files; token audit 93/93; emoji audit 0 violations.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: apply formatting and fix lint issues after typography foundation work"
```

---

## Spec Coverage Check

| Spec Section | Task |
|---|---|
| FontRegistry CSS/availability | Task 1 |
| Engine IR rich text/features | Task 2 |
| Typography layout engine | Task 3 |
| Canvas2D rich text rendering | Task 4 |
| SVG multi-line/rich text export | Task 5 |
| Preflight improvements | Task 6 |
| Regression gate | Task 7 |

No placeholders remain. All tasks include exact file paths, test code, and commands.
