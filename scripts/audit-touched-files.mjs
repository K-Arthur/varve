/**
 * audit-touched-files.mjs — Changed-files debt rule enforcer.
 *
 * Reads git diff --name-only HEAD to find touched files, then runs
 * `pnpm biome lint --max-diagnostics=50` on each. If any touched file
 * has lint warnings (even pre-existing), prints the diff and exits
 * non-zero.
 *
 * Usage:
 *   node scripts/audit-touched-files.mjs
 *
 * Hook into just gate as a pre-push check:
 *   gate: format-check lint typecheck test audit-touched
 */

import { execSync } from 'node:child_process';

const changed = execSync('git diff --name-only HEAD', { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

if (changed.length === 0) {
  process.exit(0);
}

let exitCode = 0;
const relevantExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.mjs']);

for (const file of changed) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (!relevantExts.has(ext)) continue;

  try {
    const out = execSync(`pnpm biome lint --max-diagnostics=50 "${file}" 2>&1 || true`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (out.includes('Found') && !out.includes('Found 0 warnings')) {
      console.error(`\n\u26A0  ${file} has lint warnings (pre-existing or new):`);
      const warningLines = out.split('\n').filter((l) => l.includes('lint/'));
      for (const w of warningLines.slice(0, 10)) {
        console.error(`  ${w.trim()}`);
      }
      exitCode = 1;
    }
  } catch {
    // biome exits non-zero on warnings; ignore parse errors for non-code files
  }
}

if (exitCode) {
  console.error('\n\u274C Some touched files have lint warnings. Fix them before committing.');
} else {
  console.log('\u2705 All touched files are clean.');
}
process.exit(exitCode);
