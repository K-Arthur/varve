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
  const result = await runValidationCommand([command, ...args], { cwd, timeoutMs });
  process.exitCode = result.status;
}
