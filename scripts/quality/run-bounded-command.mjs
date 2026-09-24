#!/usr/bin/env node

import { spawn } from 'node:child_process';

const [timeoutText, cwd, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutText);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !cwd || !command) {
  console.error('Usage: run-bounded-command.mjs <timeout-ms> <cwd> <command> [...args]');
  process.exitCode = 2;
} else {
  runBounded(command, args, cwd, timeoutMs);
}

function runBounded(command, args, cwd, timeoutMs) {
  const isWindows = process.platform === 'win32';
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    shell: false,
    stdio: 'inherit',
    detached: !isWindows,
  });
  let timedOut = false;
  let receivedSignal = null;
  let forcedKillTimer = null;
  let settled = false;

  const signalTree = (signal) => {
    if (child.pid === undefined) return;
    if (isWindows) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.on('error', () => child.kill(signal));
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH')
        console.error(`Could not signal command process group: ${error.message}`);
      child.kill(signal);
    }
  };

  const settle = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadlineTimer);
    if (forcedKillTimer !== null) clearTimeout(forcedKillTimer);
    process.exitCode = code;
  };

  const terminate = (signal) => {
    signalTree(signal);
    if (!isWindows && forcedKillTimer === null) {
      forcedKillTimer = setTimeout(() => signalTree('SIGKILL'), 5_000);
    }
  };

  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    terminate('SIGTERM');
  }, timeoutMs);

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      receivedSignal = signal;
      terminate(signal);
    });
  }

  child.once('error', (error) => {
    console.error(`Could not start ${command}: ${error.message}`);
    settle(1);
  });
  child.once('close', (code) => {
    if (receivedSignal) settle(receivedSignal === 'SIGINT' ? 130 : 143);
    else if (timedOut) settle(124);
    else settle(code ?? 1);
  });
}
