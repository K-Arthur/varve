/** Durable diagnostics after every case; an interrupted report is never a certificate. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { redactSensitive } from '../ci/failure-manifest.mjs';

function percentile(values, fraction) {
  if (!values.length) return null;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

export function progressSummary(report) {
  const cases = report.attempts ?? [];
  const completed = new Set(cases.map((entry) => entry.id));
  const durations = cases
    .filter((entry) => entry.status !== 'skipped')
    .map((entry) => entry.durationMs)
    .sort((a, b) => a - b);
  const failed = cases.filter(
    (entry) => entry.status !== entry.expectedStatus && entry.status !== 'skipped',
  );
  return {
    expected: report.expected.length,
    completed: completed.size,
    pending: report.expected.filter((entry) => !completed.has(entry.id)).length,
    attempts: cases.length,
    unexpectedAttempts: failed.length,
    skipped: cases.filter((entry) => entry.status === 'skipped').length,
    retries: cases.filter((entry) => entry.retry > 0).length,
    firstFailure: failed[0] ?? null,
    durationP50Ms: percentile(durations, 0.5),
    durationP95Ms: percentile(durations, 0.95),
    slowest: [...cases].sort((a, b) => b.durationMs - a.durationMs).slice(0, 20),
  };
}

function identity(test, root) {
  return {
    id: test.id,
    project: test.parent.project()?.name ?? '',
    file: relative(root, test.location.file).replaceAll('\\', '/'),
    line: test.location.line,
    title: test.titlePath().join(' > '),
    expectedStatus: test.expectedStatus,
  };
}

export default class BrowserProgressReporter {
  constructor({ outputFile, now = () => new Date(), argv = process.argv } = {}) {
    if (!outputFile) throw new Error('Browser progress reporter requires an outputFile.');
    this.outputFile = outputFile;
    this.now = now;
    this.writeFailed = false;
    // Playwright invokes reporters during discovery too. Listing has no test
    // attempts and must never be mistaken for an incomplete execution.
    this.discoveryOnly = argv.includes('--list');
  }

  onBegin(config, suite) {
    if (this.discoveryOnly) return;
    this.root = config.rootDir;
    const source = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
    this.report = {
      schema: 1,
      kind: 'browser-progress-diagnostic',
      note: 'Diagnostic only. Incomplete, interrupted or retry results cannot certify a release.',
      sourceSha: source.status === 0 ? source.stdout.trim() : null,
      startedAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
      status: 'running',
      shard: config.shard,
      workers: config.workers,
      expected: suite.allTests().map((test) => identity(test, this.root)),
      active: {},
      attempts: [],
      errors: [],
    };
    this.persist();
  }

  onTestBegin(test, result) {
    this.report.active[test.id] = {
      ...identity(test, this.root),
      retry: result.retry,
      startedAt: this.now().toISOString(),
    };
    this.persist();
  }

  onTestEnd(test, result) {
    delete this.report.active[test.id];
    this.report.attempts.push({
      ...identity(test, this.root),
      status: result.status,
      retry: result.retry,
      durationMs: result.duration,
      workerIndex: result.workerIndex,
      errors: (result.errors ?? []).map((error) =>
        redactSensitive(String(error.message ?? error.value ?? '')).slice(0, 8000),
      ),
      annotations: (test.annotations ?? []).map(({ type, description }) => ({
        type,
        description: redactSensitive(String(description ?? '')).slice(0, 1000),
      })),
      attachments: (result.attachments ?? [])
        .filter(({ path }) => path)
        .map(({ name, path, contentType }) => ({ name, path, contentType })),
    });
    this.persist();
  }

  onError(error) {
    if (!this.report) return;
    this.report.errors.push(
      redactSensitive(String(error.message ?? error.value ?? '')).slice(0, 8000),
    );
    this.persist();
  }

  onEnd(result) {
    if (this.discoveryOnly) return;
    if (!this.report) return { status: 'failed' };
    const summary = progressSummary(this.report);
    const incomplete =
      result.status === 'passed' && (summary.pending > 0 || this.report.errors.length > 0);
    this.report.status = incomplete || this.writeFailed ? 'failed' : result.status;
    this.report.finishedAt = this.now().toISOString();
    this.report.durationMs = result.duration;
    this.persist();
    if (this.writeFailed || incomplete) return { status: 'failed' };
  }

  persist() {
    try {
      this.report.updatedAt = this.now().toISOString();
      this.report.summary = progressSummary(this.report);
      mkdirSync(dirname(this.outputFile), { recursive: true });
      const temporary = `${this.outputFile}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(this.report, null, 2)}\n`);
      renameSync(temporary, this.outputFile);
    } catch (error) {
      this.writeFailed = true;
      console.error(
        `Browser progress evidence could not be written: ${redactSensitive(error.message)}`,
      );
    }
  }

  printsToStdio() {
    return false;
  }
}
