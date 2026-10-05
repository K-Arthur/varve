/** Execution order and browser coverage for the already-selected affected lanes. */

const AFFECTED_TIERS = [0, 1, 2, 3, 4];

function isBrowserLane(lane) {
  return lane.startsWith('e2e:') || lane === 'website-e2e' || lane.startsWith('website-e2e:file:');
}

function isCheapCheck(lane) {
  return (
    lane.startsWith('format:') ||
    lane.startsWith('lint:') ||
    lane.startsWith('audit:') ||
    lane.startsWith('typecheck:') ||
    lane === 'cargo-fmt'
  );
}

function isAppTestPath(path) {
  const normalized = path.replaceAll('\\', '/');
  return normalized.startsWith('tests/e2e/') && !normalized.split('/').includes('..');
}

function coveredByAppSuite(lane, e2eDomains) {
  if (!lane.startsWith('e2e:') || lane === 'e2e:all') return false;
  if (lane.startsWith('e2e:file:')) return isAppTestPath(lane.slice('e2e:file:'.length));
  // The unfiltered app suite includes every configured project, including the
  // visual projects. Website tests use a separate config and remain separate.
  if (lane === 'e2e:visual') return true;
  const domain = lane.slice('e2e:'.length);
  const paths = e2eDomains[domain] ?? [`tests/e2e/${domain}`];
  return paths.length > 0 && paths.every(isAppTestPath);
}

export function buildExecutionPlan(plan, { tiers = AFFECTED_TIERS, e2eDomains = {} } = {}) {
  const selected = [...new Set(tiers.flatMap((tier) => plan.tiers[tier] ?? []))];
  const covered = selected.includes('e2e:all')
    ? selected
        .filter((lane) => coveredByAppSuite(lane, e2eDomains))
        .map((lane) => ({ lane, coveredBy: 'e2e:all' }))
    : [];
  if (selected.includes('website-e2e')) {
    for (const lane of selected)
      if (lane.startsWith('website-e2e:file:')) covered.push({ lane, coveredBy: 'website-e2e' });
  }
  const coveredLanes = new Set(covered.map(({ lane }) => lane));
  const remaining = selected.filter((lane) => !coveredLanes.has(lane));
  // Stable partitions preserve relative tier order within each phase. Moving
  // a browser lane never adds/removes compiler, unit, native, or benchmark work.
  const cheap = remaining.filter(isCheapCheck);
  const checks = remaining.filter((lane) => !isCheapCheck(lane) && !isBrowserLane(lane));
  const websiteE2eFiles = [];
  const browser = [];
  let websiteBatchIndex = -1;
  for (const lane of remaining.filter(isBrowserLane)) {
    if (lane.startsWith('website-e2e:file:')) {
      websiteE2eFiles.push(lane.slice('website-e2e:file:'.length));
      if (websiteBatchIndex === -1) websiteBatchIndex = browser.length;
    } else {
      browser.push(lane);
    }
  }
  if (websiteE2eFiles.length) browser.splice(websiteBatchIndex, 0, 'website-e2e:files');
  return { selected, covered, lanes: [...cheap, ...checks, ...browser], websiteE2eFiles };
}

export function formatExecutionPlan(execution) {
  return [
    `Execution plan: ${execution.selected.length} selected lane(s), ${execution.lanes.length} command(s); audits/compilers before browser lanes.`,
    ...execution.covered.map(
      ({ lane, coveredBy }) =>
        `  [COVERAGE] ${coveredBy} includes ${lane}; no separate run. Coverage succeeds only when ${coveredBy} passes.`,
    ),
    `  Order: ${execution.lanes
      .map((lane) =>
        lane === 'website-e2e:files'
          ? `${lane} (${execution.websiteE2eFiles.length} specs; one build and browser run)`
          : lane,
      )
      .join(' -> ')}`,
  ].join('\n');
}

/** Apply the same discovery bounds to exact, domain, and broad browser runs. */
export function playwrightRunOptions({
  workers,
  maxFailures,
  triage = false,
  strict = false,
} = {}) {
  const args = [];
  if (workers) args.push('--workers', workers);
  else if (triage || strict) args.push('--workers=1');
  // Local triage stops early so a red investigation stays short. Hosted
  // integration/candidate cells must report the *complete* failure set: a
  // five-failure cutoff once hid 69 selected cases in a single shard and
  // forced extra full re-runs to discover them. The job timeout bounds a red
  // hosted cell instead.
  const failureBound = maxFailures ?? (triage ? '5' : undefined);
  if (failureBound) args.push('--max-failures', failureBound);
  // Gate attempts must expose the first failure instead of paying for
  // configured diagnostic retries. Retain its trace without needing a retry.
  if (triage || strict)
    args.push(
      '--retries=0',
      '--update-snapshots=none',
      '--fail-on-flaky-tests',
      '--trace=retain-on-failure',
    );
  return args;
}

export function broadBrowserArgv(lane, options) {
  const commands = {
    'e2e:all': ['pnpm', 'exec', 'playwright', 'test'],
    'e2e:visual': [
      'pnpm',
      'exec',
      'playwright',
      'test',
      '--project=chromium-visual-1x',
      '--project=chromium-visual-2x',
    ],
    // pnpm forwards these arguments to the script's final Playwright command;
    // both existing website builds and frozen snapshot policy remain intact.
    'website-e2e': ['pnpm', 'test:website:e2e'],
  };
  const argv = commands[lane];
  if (!argv) throw new Error(`No broad browser command for '${lane}'`);
  return [...argv, ...playwrightRunOptions(options)];
}

/** Batch exact website specs so their shared build/port setup runs once. */
export function websiteE2eFilesArgv(files, options) {
  const inScope = (path) => {
    const normalized = path.replaceAll('\\', '/');
    return (
      normalized.startsWith('apps/website/tests/e2e/') &&
      normalized.endsWith('.spec.ts') &&
      !normalized.split('/').includes('..')
    );
  };
  if (!files.length || files.some((path) => !inScope(path))) {
    throw new Error('website E2E batch requires one or more in-scope spec paths');
  }
  const broad = broadBrowserArgv('website-e2e', options);
  return [...broad.slice(0, 2), ...files, ...broad.slice(2)];
}
