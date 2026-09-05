import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  resolve(process.cwd(), 'packages/editor/src/auxiliary/AuxiliaryShell.css'),
  'utf8',
);

describe('auxiliary-window theme discipline', () => {
  it('uses semantic tokens instead of literal interface colours', () => {
    expect(stylesheet).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
  });

  it('does not restore obsolete detached-window token aliases', () => {
    expect(stylesheet).not.toMatch(
      /var\(--color-(?:surface(?:-elevated)?|text|border|accent)(?:\s*[,)]|\))/,
    );
  });
});
