import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Repository-wide slider-system guard.
 *
 * `@varve/ui` owns exactly one native-range skin (`.varve-native-range` in
 * `components.css`). Before this guard, the same track/thumb/focus rules were
 * redeclared five times (`.insp-range`, `.insp-slider__input`,
 * `.adj-editor__slider`, `.colorize-section__slider-row input`,
 * `.colorize-section__compare-slider`) and ten more surfaces rendered the
 * platform default. The first test below makes a sixth copy impossible; the
 * second makes the skin opt-in impossible to forget.
 *
 * Deliberate exceptions, both documented in `docs/architecture/slider-system.md`:
 * - `radius-system.css` may set only `border-radius` on range pseudo-elements.
 * - `ColorSlider` is a gradient-track control, not a scale, and does not use
 *   a native range at all (so it never appears in these scans).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_DIRS = ['packages', 'apps'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-pages',
  'dist-try',
  '.worktrees',
  '.tmp',
  '.capture-tmp',
]);

/** The only file allowed to own range pseudo-element skin declarations. */
const SKIN_OWNER = 'packages/ui/src/components/components.css';
/** May declare radius ownership only (verified below). */
const RADIUS_OWNER = 'packages/ui/src/components/radius-system.css';

const RANGE_PSEUDO =
  /::(?:-webkit-slider-thumb|-moz-range-thumb|-webkit-slider-runnable-track|-moz-range-track)/;
/** JSX `type="range"` / `type={'range'}`; excludes `matches('input[type="range"]')`. */
const JSX_RANGE = /(?<![\w[-])type=\{?["']range["']\}?/;

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else out.push(full);
  }
  return out;
}

function relative(path: string): string {
  return path
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/');
}

const allFiles = PACKAGE_DIRS.flatMap((dir) => collect(join(ROOT, dir)));
const cssFiles = allFiles.filter((file) => file.endsWith('.css'));
const sourceFiles = allFiles.filter(
  (file) => /\.tsx$/.test(file) && !/\.(test|spec|stories)\.tsx$/.test(file),
);

describe('slider system guard', () => {
  it('finds the source tree', () => {
    expect(cssFiles.length).toBeGreaterThan(50);
    expect(sourceFiles.length).toBeGreaterThan(500);
  });

  it('owns every native-range skin declaration in one stylesheet', () => {
    const offenders: string[] = [];
    for (const file of cssFiles) {
      const rel = relative(file);
      if (rel === SKIN_OWNER) continue;
      const src = readFileSync(file, 'utf8');
      for (const [index, line] of src.split('\n').entries()) {
        if (!RANGE_PSEUDO.test(line)) continue;
        if (rel === RADIUS_OWNER) {
          // Selector lists span several lines; only a line that opens a block
          // can declare anything, and it may only declare border-radius.
          if (!line.includes('{')) continue;
          const declaration = line.slice(line.indexOf('{') + 1).trim();
          if (declaration !== '' && !declaration.startsWith('border-radius')) {
            offenders.push(`${rel}:${index + 1} radius owner declares: ${declaration}`);
          }
          continue;
        }
        offenders.push(`${rel}:${index + 1} ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders every range input with the canonical skin', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8');
      if (!JSX_RANGE.test(src)) continue;
      if (!src.includes('varve-native-range')) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it('never asks a RangeValueControl consumer for a one-off skin class', () => {
    const retired = /(?:^|\s)(?:insp-range|insp-slider__input|adj-editor__slider)(?:\s|$)/;
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, 'utf8');
      for (const [index, line] of src.split('\n').entries()) {
        const match = line.match(/rangeClassName=(?:"([^"]*)"|\{`([^`]*)`\})/);
        const value = match?.[1] ?? match?.[2];
        if (value && retired.test(value)) offenders.push(`${relative(file)}:${index + 1} ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
