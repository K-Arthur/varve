import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * pnpm fails the install with ERR_PNPM_UNUSED_PATCH when patchedDependencies
 * pins a version the lockfile no longer resolves (Dependabot's jsdom bump
 * from 30.0.1 to 30.1.x). Keep the workspace keys and lockfile in lockstep.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
const lockfile = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');

describe('patchedDependencies lockfile pairing', () => {
  it('every patched package version is present in the lockfile', () => {
    const keys = [...workspace.matchAll(/^ {2}((?:@[^:\s]+\/)?[^:\s]+@[\d.]+): patches\//gm)].map(
      (match) => match[1],
    );
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(lockfile, `${key} must be the resolved patched version`).toMatch(
        new RegExp(`${escaped}\\(patch_hash=[0-9a-f]{64}\\)`),
      );
    }
  });
});
