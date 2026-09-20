import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository-wide radio-group geometry guard.
 *
 * `SegmentedControl` is an inset radiogroup: the track owns the outer radius
 * and every segment is a separate visible layer inset by the track padding, so
 * its radius derives from the outer value. A later corner-radius pass flattened
 * the members to `--radius-none` while the track stayed rounded, which shipped
 * a square selected chip inside a rounded shell (reported 2026-09-20), and the
 * pill variant ended up with a square track around a pill thumb.
 *
 * These tests keep radius ownership in `radius-system.css`, make the derived
 * inset formula mandatory, and forbid the inspector's removed fixed-column
 * grid that clipped option labels ("Linear R…") on narrow rails.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI = join(ROOT, 'packages', 'ui', 'src', 'components');
const RADIUS_OWNER = join(UI, 'radius-system.css');
const COMPONENT_OWNER = join(UI, 'components.css');
const INSPECTOR = join(
  ROOT,
  'packages',
  'editor',
  'src',
  'components',
  'Inspector',
  'inspector.css',
);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Extract selector/declaration blocks whose selector mentions `selector`. */
function blocksDeclaring(css: string, selector: string, property: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: string[] = [];
  const blocks = stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const block of blocks) {
    const selectors = block[1] ?? '';
    const declarations = block[2] ?? '';
    if (!selectors.includes(selector)) continue;
    for (const declaration of declarations.split(';')) {
      if (declaration.trim().startsWith(`${property}:`)) {
        found.push(`${selectors.trim().replace(/\s+/g, ' ')} { ${declaration.trim()} }`);
      }
    }
  }
  return found;
}

describe('radio-group geometry guard', () => {
  it('keeps segmented radius ownership in radius-system.css', () => {
    const componentRadius = blocksDeclaring(
      read(COMPONENT_OWNER),
      '.varve-segmented',
      'border-radius',
    );
    expect(componentRadius).toEqual([]);
  });

  it('derives the inset member radius instead of flattening it', () => {
    const radiusCss = read(RADIUS_OWNER);
    expect(radiusCss).not.toMatch(/\.varve-segmented__btn\s*\{[^}]*--radius-none/);

    const memberRadius = blocksDeclaring(radiusCss, '.varve-segmented__btn', 'border-radius');
    expect(memberRadius).toHaveLength(2);
    const base = memberRadius.find((block) => !block.includes('--pill'));
    expect(base).toContain('max(0px, calc(var(--radius-control) - var(--space-05)))');
  });

  it('keeps both pill levels fully round', () => {
    const radiusCss = read(RADIUS_OWNER);
    const pillBlock = radiusCss.match(/\.varve-segmented--pill[^{}]*\{[^}]*\}/g) ?? [];
    const declarations = pillBlock.join('\n');
    expect(declarations).toContain('.varve-segmented--pill');
    expect(declarations).toContain('.varve-segmented--pill .varve-segmented__btn');
    expect(declarations).toContain('border-radius: var(--radius-pill)');
  });

  it('allows inspector segments to wrap at content width instead of clipping', () => {
    const inspectorCss = read(INSPECTOR);
    expect(inspectorCss).toContain('repeat(auto-fit, minmax(min(6rem, 100%), 1fr))');
    const fixedGrids = inspectorCss.match(
      /\.insp-field__control > \.varve-segmented \{[^}]*repeat\(\s*\d/gs,
    );
    expect(fixedGrids).toBeNull();
  });

  it('lets a squeezed segment ellipsize its label rather than hard-clip it', () => {
    const inspectorCss = read(INSPECTOR);
    const labelRule = inspectorCss.match(
      /\.editor-inspector\s+\.varve-segmented__btn\s*>\s*\.varve-segmented__label\s*\{[^}]*\}/,
    );
    expect(labelRule).not.toBeNull();
    expect(labelRule?.[0]).toContain('text-overflow: ellipsis');
    expect(labelRule?.[0]).toContain('min-inline-size: 0');
  });

  it('keeps icon-only field groups compact instead of stacking one per row', () => {
    const inspectorCss = read(INSPECTOR);
    const iconRule = inspectorCss.match(
      /\.varve-segmented:has\([^)]*varve-visually-hidden[^)]*\)\s*\{[^}]*\}/s,
    );
    expect(iconRule).not.toBeNull();
    expect(iconRule?.[0]).toContain('minmax(min(2.5rem, 100%), 1fr)');
  });
});
