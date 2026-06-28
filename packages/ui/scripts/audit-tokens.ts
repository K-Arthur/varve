/**
 * Strata token audit (Strata plan §6 / §7 gate).
 *
 * Verifies every contrast pair in CONTRAST_PAIRS passes its WCAG 2.2 grade in
 * EVERY theme (light, dark, high-contrast). Exits non-zero on any failure,
 * printing the offending pair + measured ratio.
 *
 * Research basis: WCAG 2.2 success criterion 1.4.3 (text) and 1.4.11 (UI).
 * Run: `pnpm audit:tokens` (wired into the Cascade Review `gates` recipe).
 */
import { CONTRAST_PAIRS, SEMANTIC, THEMES } from '../src/tokens/color';
import { contrastRatio, minimumRatio, toHex } from '../src/tokens/contrast';

let failures = 0;
const rows: string[] = [];

for (const theme of THEMES) {
  const palette = SEMANTIC[theme];
  for (const pair of CONTRAST_PAIRS) {
    const fg = palette[pair.fg];
    const bg = palette[pair.bg];
    const ratio = contrastRatio(fg, bg);
    const required = minimumRatio(pair.grade);
    const ok = ratio >= required;
    if (!ok) failures += 1;
    rows.push(
      `  ${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(13)} ${pair.grade.padEnd(3)} ${ratio.toFixed(2).padStart(5)} >= ${required.toFixed(1)}  ${pair.name}`,
    );
    if (!ok) {
      rows.push(`        fg=${toHex(fg)}  bg=${toHex(bg)}`);
    }
  }
}

for (const r of rows) console.log(r);

if (failures > 0) {
  console.error(`\naudit:tokens — ${failures} pair(s) below WCAG 2.2 threshold.`);
  process.exit(1);
}
console.log(
  `\naudit:tokens — all ${CONTRAST_PAIRS.length * THEMES.length} pairs pass across ${THEMES.length} themes.`,
);
