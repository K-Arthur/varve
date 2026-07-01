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
