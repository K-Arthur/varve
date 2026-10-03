#!/usr/bin/env node

import { runValidationCommand } from './heavy-lease.mjs';

const [timeoutText, cwd, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutText);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !cwd || !command) {
  console.error('Usage: run-bounded-command.mjs <timeout-ms> <cwd> <command> [...args]');
  process.exitCode = 2;
} else {
  // pnpm may detach descendants into their own process groups. Share the
  // identity-based cleanup used by the lease without acquiring another lease.
  const env = { ...process.env };
  let expectedParent;
  if (env.VARVE_VALIDATION_LAUNCHER) {
    try {
      expectedParent = JSON.parse(env.VARVE_VALIDATION_LAUNCHER);
      if (
        !Number.isSafeInteger(expectedParent?.pid) ||
        expectedParent.pid <= 0 ||
        typeof expectedParent.identity !== 'string' ||
        !expectedParent.identity
      )
        throw new Error('invalid launcher identity');
    } catch {
      console.error('validation: invalid original launcher identity; command not launched');
      process.exitCode = 2;
    }
    delete env.VARVE_VALIDATION_LAUNCHER;
  }
  const result =
    process.exitCode === 2
      ? { status: 2 }
      : await runValidationCommand([command, ...args], { cwd, timeoutMs, expectedParent, env });
  process.exitCode = result.status;
}
