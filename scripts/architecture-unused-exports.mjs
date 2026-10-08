import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runValidationCommand } from './quality/heavy-lease.mjs';

const require = createRequire(import.meta.url);
const IGNORED_PATH =
  /(?:^|[/\\])(?:node_modules|__tests__)(?:[/\\]|$)|\.(?:test|spec)\.|\.d\.ts(?:$|:)/;

/** ts-prune reports candidates within one project, including public barrels.
 * These records are advisory; they do not prove an export is unused by consumers. */
export function parseUnusedExports(output) {
  const records = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^(.+?\.(?:ts|tsx)):(\d+|undefined)(?::\s+|\s+-\s+)(\S.*)$/);
    if (!match) throw new Error(`Unrecognized ts-prune output: ${line.slice(0, 300)}`);
    if (!IGNORED_PATH.test(match[1])) records.push({ file: match[1], symbol: match[3] });
  }
  return records;
}

export function unusedExportArgv(project) {
  return [
    process.execPath,
    require.resolve('ts-prune/lib/index.js'),
    '--project',
    project,
    '--ignore',
    '(node_modules|__tests__|\\.test\\.|\\.d\\.ts|\\.spec\\.)',
  ];
}

/** File descriptors preserve complete CLI output even when it calls process.exit.
 * The shared supervisor owns timeout/cancellation/descendant cleanup. No npx,
 * shell interpolation, hidden stderr or non-zero-to-empty-success conversion. */
export async function runUnusedExportCommand(argv, { cwd, timeoutMs = 60_000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'varve-unused-exports-'));
  const stdoutPath = join(directory, 'stdout');
  const stderrPath = join(directory, 'stderr');
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  try {
    const result = await runValidationCommand(argv, {
      cwd,
      timeoutMs,
      stdio: ['ignore', stdout, stderr],
    });
    const diagnostic = readFileSync(stderrPath, 'utf8').trim();
    if (result.status !== 0 || result.signal || result.remaining.length || result.cleanupUnknown) {
      throw new Error(
        `ts-prune failed: exit ${result.status}, signal ${result.signal ?? 'none'}; ${diagnostic || 'no stderr output'}`,
      );
    }
    if (diagnostic) throw new Error(`Unexpected ts-prune stderr: ${diagnostic}`);
    return parseUnusedExports(readFileSync(stdoutPath, 'utf8'));
  } finally {
    closeSync(stdout);
    closeSync(stderr);
    rmSync(directory, { recursive: true, force: true });
  }
}
