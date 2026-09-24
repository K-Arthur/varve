import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEMANTIC } from './color';

// Drift guard: tokens.css is generated from color.ts. This test proves the
// committed CSS matches the audited TS source so the two cannot silently drift.
const fixtureDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(fixtureDir, 'tokens.css'), 'utf8');

function parseOklchDecls(selector: string): Record<string, string> {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\\s*\\{([^{}]*)\\}`,
  );
  const body = tokensCss.match(re)?.[1] ?? '';
  const decls: Record<string, string> = {};
  // Match oklch(L C H) with optional / alpha
  for (const m of body.matchAll(/--color-([\w-]+):\s*(oklch\([^;]+\));/g)) {
    const key = m[1];
    const val = m[2];
    if (key && val) decls[key] = val;
  }
  return decls;
}

/** Parse an oklch() string back to components for comparison (tolerance ±0.001). */
function parseOklchVal(s: string): { L: number; C: number; H: number } {
  const m = s.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`Cannot parse oklch value: ${s}`);
  return { L: parseFloat(m[1]!), C: parseFloat(m[2]!), H: parseFloat(m[3]!) };
}

describe('tokens.css drift guard (OKLCH)', () => {
  it(':root matches the audited light palette (within tolerance)', () => {
    const cssLight = parseOklchDecls(':root');
    for (const [token, oklch] of Object.entries(SEMANTIC.light)) {
      const cssVal = cssLight[token];
      expect(cssVal, `--color-${token} missing`).toBeDefined();
      const parsed = parseOklchVal(cssVal!);
      expect(Math.abs(parsed.L - oklch.L)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(parsed.C - oklch.C)).toBeLessThanOrEqual(0.001);
      // Hue tolerance: allow ±0.5 for rounding
      expect(Math.abs(parsed.H - oklch.H)).toBeLessThanOrEqual(0.5);
    }
  });

  it('[data-theme="dark"] matches the audited dark palette', () => {
    const cssDark = parseOklchDecls('[data-theme="dark"]');
    for (const [token, oklch] of Object.entries(SEMANTIC.dark)) {
      const cssVal = cssDark[token];
      expect(cssVal, `--color-${token} missing in dark`).toBeDefined();
      const parsed = parseOklchVal(cssVal!);
      expect(Math.abs(parsed.L - oklch.L)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(parsed.C - oklch.C)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(parsed.H - oklch.H)).toBeLessThanOrEqual(0.5);
    }
  });

  it('[data-theme="high-contrast"] matches the audited HC palette', () => {
    const cssHc = parseOklchDecls('[data-theme="high-contrast"]');
    for (const [token, oklch] of Object.entries(SEMANTIC['high-contrast'])) {
      const cssVal = cssHc[token];
      expect(cssVal, `--color-${token} missing in HC`).toBeDefined();
      const parsed = parseOklchVal(cssVal!);
      expect(Math.abs(parsed.L - oklch.L)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(parsed.C - oklch.C)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(parsed.H - oklch.H)).toBeLessThanOrEqual(0.5);
    }
  });
});

/**
 * The drift guard above reads the *first* `--color-x: oklch(...)` declaration
 * per token, so a later redeclaration inside the same block is invisible to it.
 * That blind spot is how 11 of 15 surface tokens came to be painted by
 * generator-local literals while the audit validated the color.ts values.
 * These tests assert the declaration is unique within its block and that the
 * elevation aliases point *at* the semantic roles, never the reverse.
 */
describe('tokens.css has no shadowed or inverted declarations', () => {
  const blocks = (() => {
    const found: { selector: string; body: string }[] = [];
    for (const m of tokensCss.matchAll(/(^|\n)([^{}]+)\{([^{}]*)\}/g)) {
      found.push({ selector: (m[2] ?? '').trim().split('\n').pop()!.trim(), body: m[3] ?? '' });
    }
    return found;
  })();

  it('declares no custom property twice inside one theme block', () => {
    for (const { selector, body } of blocks) {
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const line of body.split('\n')) {
        const decl = line.match(/^\s*(--[a-zA-Z0-9_-]+)\s*:/);
        if (!decl) continue;
        if (seen.has(decl[1]!)) duplicates.push(decl[1]!);
        seen.add(decl[1]!);
      }
      expect(duplicates, `${selector} redeclares ${duplicates.join(', ')}`).toEqual([]);
    }
  });

  it('keeps elevation surfaces as aliases of the audited surface roles', () => {
    const expected: Record<string, string> = {
      '--elevation-surface-sunken': '--color-surface-sunken',
      '--elevation-surface-default': '--color-surface-app',
      '--elevation-surface-raised': '--color-surface-raised',
      '--elevation-surface-overlay': '--color-surface-overlay',
    };
    for (const { selector, body } of blocks) {
      for (const [alias, target] of Object.entries(expected)) {
        const declared = body.match(new RegExp(`${alias}\\s*:\\s*([^;]+);`))?.[1]?.trim();
        if (declared === undefined) continue;
        // forced-colors blocks may legitimately resolve to system colors.
        if (declared === 'Canvas') continue;
        expect(declared, `${selector} ${alias}`).toBe(`var(${target})`);
      }
    }
  });

  it('never lets an elevation alias overwrite a --color- declaration', () => {
    for (const { selector, body } of blocks) {
      for (const line of body.split('\n')) {
        const decl = line.match(/^\s*(--color-surface-[a-z]+)\s*:\s*var\(--elevation-/);
        expect(decl, `${selector} inverts the alias direction: ${line.trim()}`).toBeNull();
      }
    }
  });
});

describe('interaction semantic roles', () => {
  const roles = [
    'interactive-hover-surface',
    'interactive-pressed-surface',
    'interactive-selected-surface',
    'interactive-selected-surface-hover',
    'interactive-selected-border',
    'interactive-current-indicator',
    'interactive-checked-surface',
    'interactive-drop-target-surface',
    'interactive-drop-target-border',
    'interactive-drop-denied-surface',
    'interactive-drop-denied-border',
    'highlight-search-match',
    'highlight-search-current',
    'highlight-text-selection',
    'highlight-text-selection-foreground',
  ] as const;

  it('defines every interaction role in every supported theme', () => {
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      for (const role of roles) {
        expect(SEMANTIC[theme][role], `${role} missing in ${theme}`).toBeDefined();
      }
    }
  });

  it('keeps temporary and persistent roles distinct', () => {
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      expect(SEMANTIC[theme]['interactive-hover-surface']).not.toEqual(
        SEMANTIC[theme]['interactive-selected-surface'],
      );
      expect(SEMANTIC[theme]['highlight-search-match']).not.toEqual(
        SEMANTIC[theme]['highlight-search-current'],
      );
    }
  });
});
