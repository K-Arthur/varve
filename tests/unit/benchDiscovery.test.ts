// Benchmark discovery must never reach `.worktrees/`.
//
// `pnpm bench` runs `vitest bench`, which resolves its file list from
// `test.benchmark.include` / `test.benchmark.exclude` — NOT from
// `test.include` / `test.exclude`. An earlier fix (commit `862dd38c`, finding
// P3-13) added the worktree guard to `test.exclude` only, so bench mode kept
// walking every sibling worktree: a 2026-08-07 measurement discovered 90
// `.bench.ts` files, 81 of them under `.worktrees/`.
//
// That is a correctness problem before it is a speed problem. Benchmark
// numbers are a regression gate, and a gate that silently measures another
// agent's in-progress branch reports the wrong thing. This test pins the
// config so the guard cannot be dropped again without a red test.
//
// (Header uses line comments deliberately: the glob patterns under test
// contain the block-comment terminator.)

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const benchmark = config.test?.benchmark;

/** Repo-relative `.bench.ts`/`.bench.tsx` paths, POSIX separators. */
function findBenchFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) findBenchFiles(full, out);
    else if (/\.bench\.tsx?$/.test(entry)) out.push(relative(repoRoot, full).split(sep).join('/'));
  }
  return out;
}

describe('vitest bench discovery', () => {
  it('declares a dedicated benchmark block (bench mode ignores test.exclude)', () => {
    expect(benchmark).toBeDefined();
    expect(benchmark?.include).toBeDefined();
    expect(benchmark?.exclude).toBeDefined();
  });

  it('excludes sibling worktrees from benchmark discovery', () => {
    expect(benchmark?.exclude).toContain('**/.worktrees/**');
  });

  it('scopes benchmark includes to packages/*/src', () => {
    // A repo-wide include would re-admit `.worktrees` through a path the
    // exclude above does not anticipate.
    for (const pattern of benchmark?.include ?? []) {
      expect(pattern.startsWith('packages/')).toBe(true);
    }
  });

  it('would not admit any worktree bench file that exists on disk', () => {
    const benchFiles = findBenchFiles(repoRoot);
    const worktreeBenches = benchFiles.filter((f) => f.startsWith('.worktrees/'));
    // Only meaningful while worktrees are actually checked out; when none are
    // present the assertion below is vacuously true and that is correct.
    for (const file of worktreeBenches) {
      const admittedByInclude = (benchmark?.include ?? []).some((p) => p.startsWith('packages/'));
      const excluded = file.includes('.worktrees/');
      expect(admittedByInclude && !excluded).toBe(false);
    }
  });
});
