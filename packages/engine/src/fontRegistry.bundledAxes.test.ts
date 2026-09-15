/**
 * Keeps the registry's bundled-font axis table honest.
 *
 * `BUNDLED_VARIABLE_AXES` is hand-written data describing binaries that live
 * in node_modules, so nothing stops it drifting when a font is upgraded or an
 * import in `apps/desktop/src/main.tsx` is pointed at a different axis subset.
 * These cases re-read the `fvar` tables of the exact files the app loads and
 * fail when the registry claims an axis the font does not vary, omits one it
 * does, or gets a bound wrong.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseFontData } from './font/fontParser';
import { FontRegistry } from './fontRegistry';

const require = createRequire(import.meta.url);
const DESKTOP = new URL('../../../apps/desktop', import.meta.url).pathname;

/**
 * The woff2 each family resolves to, matching the CSS entry points imported
 * by apps/desktop/src/main.tsx. Fraunces is the `opsz` build, not `full`.
 */
const LOADED_FILES: Record<string, [pkg: string, file: string]> = {
  'Geist Variable': ['geist', 'geist-latin-wght-normal.woff2'],
  'IBM Plex Sans Variable': ['ibm-plex-sans', 'ibm-plex-sans-latin-wght-normal.woff2'],
  'Fraunces Variable': ['fraunces', 'fraunces-latin-opsz-normal.woff2'],
};

function read(pkg: string, file: string): Buffer | null {
  try {
    const meta = require.resolve(`@fontsource-variable/${pkg}/metadata.json`, { paths: [DESKTOP] });
    return readFileSync(meta.replace(/metadata\.json$/, `files/${file}`));
  } catch {
    return null;
  }
}

describe('bundled variable font axes', () => {
  const registry = new FontRegistry();

  it.each(Object.keys(LOADED_FILES))('%s is reported as a variable family', (family) => {
    // Regression: all three shipped with no axis data, so isVariable() was
    // false and the inspector's axis panel never rendered for any of them.
    expect(registry.isVariable(family)).toBe(true);
    expect(registry.getAxisDefinitions(family)?.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(LOADED_FILES))(
    '%s axis table matches the fvar of the file the app loads',
    async (family, [pkg, file]) => {
      const woff2 = read(pkg, file);
      if (!woff2) return; // dependency not installed in this checkout
      const { decompress } = await import('wawoff2');
      const ttf = await decompress(woff2);
      const meta = await parseFontData(
        ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer,
      );

      const declared = registry.getAxisDefinitions(family) ?? [];
      expect(declared.map((a) => a.tag).sort()).toEqual(meta.axes.map((a) => a.tag).sort());
      for (const axis of meta.axes) {
        expect(declared.find((d) => d.tag === axis.tag)).toMatchObject({
          min: axis.min,
          default: axis.default,
          max: axis.max,
        });
      }
    },
  );

  it('prefers the family bound over the generic per-tag fallback', () => {
    // The generic table says wght spans 1-1000; IBM Plex Sans stops at 700.
    expect(registry.getAxisInfo('wght')?.max).toBe(1000);
    expect(registry.getAxisInfo('wght', 'IBM Plex Sans Variable')?.max).toBe(700);
    expect(registry.getAxisInfo('wght', 'Geist Variable')?.max).toBe(900);
  });

  it('falls back to the generic table for an axis the family does not declare', () => {
    expect(registry.getAxisInfo('slnt', 'Geist Variable')?.tag).toBe('slnt');
    expect(registry.getAxisDefinitions('Geist Variable')?.some((a) => a.tag === 'slnt')).toBe(
      false,
    );
  });

  it('leaves non-variable families alone', () => {
    expect(registry.isVariable('Georgia')).toBe(false);
    expect(registry.getAxisDefinitions('Georgia')).toBeUndefined();
  });
});
