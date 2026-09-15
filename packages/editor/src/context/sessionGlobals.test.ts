import type { ImportFileReport, ImportReport } from '@varve/import';
import { describe, expect, it } from 'vitest';
import { importReportHasIssues } from './sessionGlobals';

function file(overrides: Partial<ImportFileReport> = {}): ImportFileReport {
  return {
    name: 'art.svg',
    source: 'file-picker',
    format: 'svg',
    status: 'success',
    byteCount: 1,
    durationMs: 1,
    nodeCount: 1,
    artifacts: [],
    warnings: [],
    unsupportedFeatures: [],
    ...overrides,
  };
}

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    files: [file()],
    startedAt: 0,
    completedAt: 1,
    durationMs: 1,
    totalFiles: 1,
    successCount: 1,
    partialCount: 0,
    failureCount: 0,
    unsupportedCount: 0,
    warnings: [],
    ...overrides,
  };
}

describe('importReportHasIssues', () => {
  it('is false for a clean single-file import', () => {
    expect(importReportHasIssues(report())).toBe(false);
  });

  it('is true for file-level warnings even when the aggregate is clean', () => {
    expect(
      importReportHasIssues(
        report({
          files: [
            file({
              status: 'partial',
              warnings: [
                { code: 'svg.unsupported-filter', message: 'Filter dropped', severity: 'warning' },
              ],
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is true for file-level unsupported features', () => {
    expect(
      importReportHasIssues(
        report({
          files: [
            file({
              unsupportedFeatures: [{ code: 'svg.filter', feature: 'filter', message: 'x' }],
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it('is true for a non-success file status', () => {
    expect(
      importReportHasIssues(
        report({ files: [file({ status: 'failed' })], failureCount: 1, successCount: 0 }),
      ),
    ).toBe(true);
  });

  it('is true for aggregate warnings', () => {
    expect(
      importReportHasIssues(
        report({ warnings: [{ code: 'parser.warning', message: 'x', severity: 'warning' }] }),
      ),
    ).toBe(true);
  });
});
