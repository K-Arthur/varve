import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUTTON_SIZES, BUTTON_VARIANTS } from '../../packages/ui/src/components/Button';

/**
 * Repository-wide Button-system guard.
 *
 * The Button/IconButton primitives own every modifier class they emit. Call
 * sites must go through those components instead of hand-writing `varve-btn`
 * markup, and no call site may invent a modifier the stylesheet does not
 * define — `varve-btn--primary` and `varve-btn--danger` shipped that way for
 * months, rendering destructive actions with neutral chrome.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_DIRS = ['packages', 'apps'];
const STATE_MODIFIERS = new Set(['loading', 'confirming']);
const KNOWN_MODIFIERS = new Set<string>([...BUTTON_VARIANTS, ...BUTTON_SIZES, ...STATE_MODIFIERS]);

/** Files that legitimately own the raw class vocabulary. */
const PRIMITIVE_FILES = new Set([
  'packages/ui/src/components/Button.tsx',
  'packages/ui/src/components/IconButton.tsx',
  'packages/ui/src/components/ToggleButton.tsx',
  'packages/ui/src/components/ButtonGroup.tsx',
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-pages', 'dist-try', '.worktrees']);
const SKIP_FILE = /\.(test|spec|stories)\.[jt]sx?$/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !SKIP_FILE.test(entry)) out.push(full);
  }
  return out;
}

function relative(path: string): string {
  return path
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/');
}

const sourceFiles = PACKAGE_DIRS.flatMap((dir) => collectSourceFiles(join(ROOT, dir))).filter(
  (file) => !PRIMITIVE_FILES.has(relative(file)),
);

describe('button system guard', () => {
  it('finds the source tree', () => {
    expect(sourceFiles.length).toBeGreaterThan(500);
  });

  it('never references a varve-btn modifier outside the declared vocabulary', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/varve-btn--([a-z0-9-]+)/g)) {
        if (!KNOWN_MODIFIERS.has(match[1])) {
          offenders.push(`${relative(file)}: varve-btn--${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes varve-btn markup through Button/IconButton instead of raw elements', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8');
      for (const [index, line] of src.split('\n').entries()) {
        if (/className=\{?`?[^`]*\bvarve-btn\b/.test(line)) {
          offenders.push(`${relative(file)}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
