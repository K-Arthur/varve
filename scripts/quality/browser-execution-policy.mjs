/** Shared contract for certified browser commands and their execution receipts. */
export const CERTIFIED_BROWSER_POLICY = Object.freeze({
  workers: 1,
  retries: 0,
  updateSnapshots: 'none',
  failOnFlakyTests: true,
  trace: 'retain-on-failure',
});

export const STRICT_BROWSER_FLAGS = Object.freeze([
  `--workers=${CERTIFIED_BROWSER_POLICY.workers}`,
  `--retries=${CERTIFIED_BROWSER_POLICY.retries}`,
  `--update-snapshots=${CERTIFIED_BROWSER_POLICY.updateSnapshots}`,
  '--fail-on-flaky-tests',
  `--trace=${CERTIFIED_BROWSER_POLICY.trace}`,
]);

/** Require literal, unambiguous flags before spending time on a browser lane. */
export function certifiedBrowserCommandErrors(command) {
  const tokens = command.split(/\s+/);
  return STRICT_BROWSER_FLAGS.filter((flag) => {
    const name = flag.split('=')[0];
    const occurrences = tokens.filter((token) => token === name || token.startsWith(`${name}=`));
    return occurrences.length !== 1 || occurrences[0] !== flag;
  }).map((flag) => `certified browser command requires exactly one ${flag}`);
}
