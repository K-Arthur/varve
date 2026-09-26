import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository-wide native <select> guard.
 *
 * AGENTS.md: "No native <select> elements — use @varve/ui's custom Select
 * component." The one sanctioned primitive that wraps a native element is
 * NativeSelect itself (accessible label/field wiring for call sites that
 * deliberately need native behaviour); raw <select> markup in application
 * surfaces is what this guard rejects.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_DIRS = ['packages', 'apps'];

/** Files that legitimately own native select markup. */
const PRIMITIVE_FILES = new Set(['packages/ui/src/components/NativeSelect.tsx']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-pages', 'dist-try', '.worktrees']);
const SKIP_FILE = /\.(test|spec|stories)\.[jt]sx?$/;
const SOURCE_FILE = /\.(tsx|ts|astro)$/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectSourceFiles(full, out);
    else if (SOURCE_FILE.test(entry) && !SKIP_FILE.test(entry)) out.push(full);
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

describe('native select guard', () => {
  it('finds the source tree', () => {
    expect(sourceFiles.length).toBeGreaterThan(500);
  });

  it('routes select controls through @varve/ui instead of raw native markup', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8');
      if (!/<select[\s>]/.test(src)) continue;
      for (const [index, line] of src.split('\n').entries()) {
        if (/<select[\s>]/.test(line)) offenders.push(`${relative(file)}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
