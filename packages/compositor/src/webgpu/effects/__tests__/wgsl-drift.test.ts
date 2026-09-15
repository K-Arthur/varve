// @vitest-environment node

/**
 * Drift guard for the live-effects WGSL kernels: the naga-validated mirrors
 * in `crates/varve-bridge/tests/wgsl_validation.rs` must match the
 * TypeScript kernel sources. Regenerate with:
 *   node packages/compositor/scripts/gen-wgsl-mirrors.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BLOOM_KERNEL } from '../kernels/bloom';
import { CAUSTICS_KERNEL } from '../kernels/caustics';
import { CRT_KERNEL } from '../kernels/crt';
import { LENS_FLARE_KERNEL } from '../kernels/lensFlare';
import { LIGHT_LEAK_KERNEL } from '../kernels/lightLeak';
import { LIGHT_SHAFTS_KERNEL } from '../kernels/lightShafts';
import { PALETTE_SNAP_KERNEL } from '../kernels/paletteSnap';
import { RGB_SPLIT_KERNEL } from '../kernels/rgbSplit';
import { VHS_KERNEL } from '../kernels/vhs';

const here = dirname(fileURLToPath(import.meta.url));
const rustPath = join(here, '../../../../../../crates/varve-bridge/tests/wgsl_validation.rs');

function extractRustWgsl(src: string, constName: string): string {
  const marker = `const ${constName}: &str = r#"`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${constName} in wgsl_validation.rs`);
  const bodyStart = start + marker.length;
  const end = src.indexOf('"#;', bodyStart);
  if (end < 0) throw new Error(`unclosed ${constName} in wgsl_validation.rs`);
  return src.slice(bodyStart, end);
}

function norm(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

const KERNELS: Array<{ id: string; wgsl: string }> = [
  { id: 'rgbSplit', wgsl: RGB_SPLIT_KERNEL.wgsl },
  { id: 'crt', wgsl: CRT_KERNEL.wgsl },
  { id: 'lightLeak', wgsl: LIGHT_LEAK_KERNEL.wgsl },
  { id: 'paletteSnap', wgsl: PALETTE_SNAP_KERNEL.wgsl },
  { id: 'vhs', wgsl: VHS_KERNEL.wgsl },
  { id: 'lightShafts', wgsl: LIGHT_SHAFTS_KERNEL.wgsl },
  { id: 'caustics', wgsl: CAUSTICS_KERNEL.wgsl },
  { id: 'lensFlare', wgsl: LENS_FLARE_KERNEL.wgsl },
  { id: 'bloom', wgsl: BLOOM_KERNEL.wgsl },
];

describe('effect kernel WGSL drift guard', () => {
  const rust = readFileSync(rustPath, 'utf8');

  for (const kernel of KERNELS) {
    const constName = `${kernel.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_WGSL`;
    it(`${kernel.id} matches the naga mirror (regenerate mirrors after edits)`, () => {
      const rustWgsl = extractRustWgsl(rust, constName);
      expect(norm(rustWgsl)).toBe(norm(kernel.wgsl));
    });
  }
});
