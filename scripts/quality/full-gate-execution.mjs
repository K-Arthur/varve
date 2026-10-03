/** Execution ownership is explicit; a release never starts a serial farm by accident. */
import { broadBrowserArgv } from './execution-plan.mjs';
import { FULL_BROWSER_SHARDS } from './validation-policy.mjs';

export const LOCAL_BROWSER_SHARDS = FULL_BROWSER_SHARDS;

export function fullGateExecution(args) {
  const local = args.includes('--local');
  const remote = args.includes('--remote');
  if (local && remote) throw new Error('Choose one full-gate owner: --local or --remote.');
  if (local && args.includes('--status'))
    throw new Error('--status inspects remote certification; it cannot execute a local full gate.');
  return { mode: local ? 'local' : 'remote', resume: args.includes('--resume') };
}

/** All shards are required; a failure stops the gate and leaves green shards resumable. */
export function localBrowserLanes() {
  return Array.from({ length: LOCAL_BROWSER_SHARDS }, (_, index) => ({
    label: `Chromium E2E ${index + 1}/${LOCAL_BROWSER_SHARDS}`,
    argv: [
      ...broadBrowserArgv('e2e:all', { strict: true }),
      '--project=chromium',
      `--shard=${index + 1}/${LOCAL_BROWSER_SHARDS}`,
    ],
  }));
}
