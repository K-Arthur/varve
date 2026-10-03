import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { test } from '@playwright/test';

/**
 * Ordinary tests own only their isolated Playwright output. A deliberate review
 * capture may set VARVE_E2E_CAPTURE_ROOT (for example docs/screenshots), or the
 * owning spec's existing capture-directory override. Promotion remains explicit.
 */
export function evidencePath(relativePath: string, captureDirectory?: string): string {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Evidence path must be relative and stay within its output: ${relativePath}`);
  }
  const path = captureDirectory
    ? join(captureDirectory, relativePath.split(/[\\/]/).at(-1) ?? relativePath)
    : process.env.VARVE_E2E_CAPTURE_ROOT
      ? join(process.env.VARVE_E2E_CAPTURE_ROOT, relativePath)
      : test.info().outputPath(relativePath);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
