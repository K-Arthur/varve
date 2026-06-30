import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEMANTIC } from './color';
import { toHex } from './contrast';

// Drift guard: tokens.css is generated from color.ts. This test proves the
// committed CSS matches the audited TS source so the two cannot silently drift.
const fixtureDir = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(fixtureDir, 'tokens.css'), 'utf8');

function parseColorDecls(selector: string): Record<string, string> {
  // Matches top-level (non-nested) rules only — sufficient for :root and the
  // [data-theme] blocks; the @media duplicates are intentionally skipped.
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}\\s*\\{([^{}]*)\\}`,
  );
  const body = tokensCss.match(re)?.[1] ?? '';
  const decls: Record<string, string> = {};
  for (const m of body.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    const key = m[1];
    const val = m[2];
    if (key && val) decls[key] = val.toLowerCase();
  }
  return decls;
}

describe('tokens.css drift guard', () => {
  it(':root matches the audited light palette', () => {
    const cssLight = parseColorDecls(':root');
    for (const [token, rgb] of Object.entries(SEMANTIC.light)) {
      expect(cssLight[token], `--color-${token}`).toBe(toHex(rgb));
    }
  });

  it('[data-theme="dark"] matches the audited dark palette', () => {
    const cssDark = parseColorDecls('[data-theme="dark"]');
    for (const [token, rgb] of Object.entries(SEMANTIC.dark)) {
      expect(cssDark[token], `--color-${token}`).toBe(toHex(rgb));
    }
  });

  it('[data-theme="high-contrast"] matches the audited HC palette', () => {
    const cssHc = parseColorDecls('[data-theme="high-contrast"]');
    for (const [token, rgb] of Object.entries(SEMANTIC['high-contrast'])) {
      expect(cssHc[token], `--color-${token}`).toBe(toHex(rgb));
    }
  });
});
