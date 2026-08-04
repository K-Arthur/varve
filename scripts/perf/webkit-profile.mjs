#!/usr/bin/env node
/**
 * Linux WebKitGTK native profiling — capability detection, release-session
 * launch/attach, and bounded sampling.
 *
 * Chromium DevTools conclusions do not transfer to WebKitGTK: it has its own
 * multi-process architecture, compositor and canvas acceleration, and the
 * render worker is disabled there entirely (no reliable OffscreenCanvas), so
 * all replay cost lands on the web process's main thread.
 *
 * This runner never assumes a profiler is installed, never requires root, and
 * reports precisely which capability is missing instead of producing an empty
 * profile. Release builds do not depend on any of it.
 *
 * Usage:
 *   node scripts/perf/webkit-profile.mjs --check          # capabilities only
 *   node scripts/perf/webkit-profile.mjs --check --json
 *   node scripts/perf/webkit-profile.mjs --record --duration=15 --label=drag
 *   node scripts/perf/webkit-profile.mjs --record --attach   # attach to a running session
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);

const JSON_ONLY = args.get('json') === 'true';
const DURATION_S = Number(args.get('duration') ?? 15);
const LABEL = args.get('label') ?? 'session';
const OUT = args.get('out') ?? `perf-${LABEL}.data`;

function run(cmd, cmdArgs, fallback = null) {
  try {
    return execFileSync(cmd, cmdArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return fallback;
  }
}

function which(tool) {
  return run('sh', ['-c', `command -v ${tool} 2>/dev/null`], null);
}

function readSysctl(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

// ── Capability detection ────────────────────────────────────────────────────

/**
 * `perf_event_paranoid` governs what an unprivileged user may sample:
 *   3 — nothing;  2 — user-space only;  1 — +kernel;  0/-1 — +raw tracepoints.
 * Call stacks that cross into the kernel need <= 1, so a value of 2 still
 * yields useful user-space flamegraphs and must not be reported as a failure.
 */
export function interpretParanoid(value) {
  // Guard null/empty explicitly: Number(null) and Number('') are both 0, which
  // would otherwise be reported as the most permissive level when the file is
  // simply absent or unreadable.
  if (value === null || value === undefined || String(value).trim() === '') {
    return { usable: false, detail: 'unreadable' };
  }
  const level = Number(value);
  if (!Number.isFinite(level)) return { usable: false, detail: 'unreadable' };
  if (level >= 3) return { usable: false, detail: 'sampling disabled for unprivileged users' };
  if (level === 2) return { usable: true, detail: 'user-space sampling only (no kernel stacks)' };
  if (level === 1) return { usable: true, detail: 'user-space and kernel stacks' };
  return { usable: true, detail: 'full access including raw tracepoints' };
}

/**
 * Yama `ptrace_scope` governs whether a non-parent process may attach:
 *   0 — any process of the same uid;  1 — descendants only;
 *   2 — admin only;  3 — attaching disabled entirely.
 *
 * This is the setting that most often defeats the gdb/eu-stack fallback:
 * at the common default of 1, a profiler can only sample a target it
 * launched itself, not a session already on screen.
 */
export function interpretPtraceScope(value) {
  const level = Number(value);
  if (!Number.isFinite(level)) return { attachRunning: true, detail: 'no Yama restriction' };
  if (level === 0) return { attachRunning: true, detail: 'any same-uid process may be attached' };
  if (level === 1) {
    return {
      attachRunning: false,
      detail:
        'descendants only — a running session cannot be attached, only one launched by the profiler',
    };
  }
  if (level === 2) return { attachRunning: false, detail: 'admin only' };
  return { attachRunning: false, detail: 'ptrace attaching is disabled' };
}

export function detectCapabilities() {
  const paranoidRaw = readSysctl('/proc/sys/kernel/perf_event_paranoid');
  const paranoid = interpretParanoid(paranoidRaw);
  const kptr = readSysctl('/proc/sys/kernel/kptr_restrict');
  const ptraceRaw = readSysctl('/proc/sys/kernel/yama/ptrace_scope');
  const ptrace = interpretPtraceScope(ptraceRaw);

  const profilers = {
    perf: which('perf'),
    sysprof: which('sysprof') ?? which('sysprof-cli'),
    hotspot: which('hotspot'),
    gdb: which('gdb'),
    eu_stack: which('eu-stack'),
    valgrind: which('valgrind'),
  };

  const release = `${ROOT}target/release/varve-desktop`;
  const debugBinary = `${ROOT}target/debug/varve-desktop`;

  return {
    capturedAt: new Date().toISOString(),
    profilers,
    anyProfilerInstalled: Object.values(profilers).some(Boolean),
    permissions: {
      perfEventParanoid: paranoidRaw,
      perfSamplingUsable: paranoid.usable,
      perfSamplingDetail: paranoid.detail,
      kptrRestrict: kptr,
      ptraceScope: ptraceRaw,
      canAttachRunningProcess: ptrace.attachRunning,
      ptraceDetail: ptrace.detail,
      // Root is deliberately not required; the runner reports what an
      // unprivileged user can actually do.
      runningAsRoot: process.getuid?.() === 0,
    },
    symbols: {
      // Frame pointers are what make cheap stack unwinding work; Rust release
      // builds omit them unless force-frame-pointers is set.
      releaseBinaryPresent: existsSync(release),
      debugBinaryPresent: existsSync(debugBinary),
      forceFramePointersHint: 'RUSTFLAGS="-C force-frame-pointers=yes" for usable release stacks',
      debugInfoInRelease: existsSync(release)
        ? (run('sh', ['-c', `file ${release}`], '') ?? '').includes('not stripped')
        : false,
    },
    environment: {
      session: process.env.XDG_SESSION_TYPE ?? 'unknown',
      desktop: process.env.XDG_CURRENT_DESKTOP ?? 'unknown',
      wayland: Boolean(process.env.WAYLAND_DISPLAY),
      webkitVersion: run('sh', ['-c', "pacman -Q webkit2gtk-4.1 2>/dev/null || echo ''"], ''),
      gtkVersion: run('sh', ['-c', "pacman -Q gtk3 2>/dev/null || echo ''"], ''),
      mesaVersion: run('sh', ['-c', "pacman -Q mesa 2>/dev/null || echo ''"], ''),
      kernel: run('uname', ['-r'], 'unknown'),
    },
  };
}

/** Discover the Tauri host and its WebKit subprocesses. */
export function discoverProcesses() {
  const find = (pattern) => {
    const out = run('pgrep', ['-f', pattern], '');
    return (out ?? '')
      .split('\n')
      .filter(Boolean)
      .map((pid) => ({
        pid: Number(pid),
        cmd: run('sh', ['-c', `tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null`], '')?.trim() ?? '',
        threads: Number(run('sh', ['-c', `ls /proc/${pid}/task 2>/dev/null | wc -l`], '0')),
      }));
  };
  return {
    // Costs land in the web process, not the Tauri host — profiling only the
    // host is the classic way to produce an empty-looking WebKitGTK profile.
    host: find('target/(release|debug)/varve-desktop'),
    webProcess: find('WebKitWebProcess'),
    networkProcess: find('WebKitNetworkProcess'),
    gpuProcess: find('WebKitGPUProcess'),
  };
}

/** Build the perf command without running it, so it is unit-testable. */
export function buildPerfCommand({ pids, durationSeconds, output, frequency = 199 }) {
  if (!pids.length) throw new Error('no target pids');
  return [
    'perf',
    [
      'record',
      '-F',
      String(frequency),
      '-g',
      '--call-graph',
      'dwarf',
      '-p',
      pids.join(','),
      '-o',
      output,
      '--',
      'sleep',
      String(durationSeconds),
    ],
  ];
}

// ── Commands ────────────────────────────────────────────────────────────────
// Guarded so the exported helpers above can be unit-tested without a profiler
// installed and without the CLI running (and exiting) on import.

const isMain =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (!isMain) {
  // Imported as a library: stop before any CLI side effect.
} else {
  const capabilities = detectCapabilities();

  if (args.get('check') === 'true' || args.size === 0) {
    if (JSON_ONLY) {
      console.log(JSON.stringify(capabilities, null, 2));
      process.exit(0);
    }
    console.log('WebKitGTK native profiling — capability report\n');
    console.log('Profilers:');
    for (const [name, path] of Object.entries(capabilities.profilers)) {
      console.log(`  ${path ? '✓' : '✗'} ${name.padEnd(10)} ${path ?? 'not installed'}`);
    }
    console.log('\nPermissions:');
    console.log(`  perf_event_paranoid = ${capabilities.permissions.perfEventParanoid}`);
    console.log(
      `  ${capabilities.permissions.perfSamplingUsable ? '✓' : '✗'} ${capabilities.permissions.perfSamplingDetail}`,
    );
    console.log(`  ptrace_scope = ${capabilities.permissions.ptraceScope}`);
    console.log(
      `  ${capabilities.permissions.canAttachRunningProcess ? '✓' : '✗'} ${capabilities.permissions.ptraceDetail}`,
    );
    console.log('\nBinaries:');
    console.log(`  ${capabilities.symbols.releaseBinaryPresent ? '✓' : '✗'} release binary`);
    console.log(
      `  ${capabilities.symbols.debugInfoInRelease ? '✓' : '✗'} debug info retained in release`,
    );
    console.log(`  hint: ${capabilities.symbols.forceFramePointersHint}`);

    const processes = discoverProcesses();
    console.log('\nRunning processes:');
    for (const [role, list] of Object.entries(processes)) {
      console.log(
        `  ${role.padEnd(16)} ${list.length ? list.map((p) => `${p.pid} (${p.threads} threads)`).join(', ') : 'none'}`,
      );
    }

    if (!capabilities.anyProfilerInstalled) {
      console.log(
        '\nNo native profiler installed. To enable sampling:\n' +
          '  Arch/CachyOS:  sudo pacman -S perf sysprof\n' +
          '  Debian/Ubuntu: sudo apt install linux-perf sysprof\n' +
          'Then re-run with --record. Nothing in the app depends on this being installed.',
      );
    }
    process.exit(0);
  }

  if (args.get('record') === 'true') {
    if (!capabilities.profilers.perf) {
      console.error(
        'webkit-profile: perf is not installed, so no native samples can be collected.\n' +
          'Install it (sudo pacman -S perf) or use --check to see what is available.',
      );
      process.exit(2);
    }
    if (!capabilities.permissions.perfSamplingUsable) {
      console.error(
        `webkit-profile: kernel restrictions block sampling ` +
          `(perf_event_paranoid = ${capabilities.permissions.perfEventParanoid}).\n` +
          'Lower it for this session with:\n' +
          '  sudo sysctl kernel.perf_event_paranoid=1\n' +
          'This runner will not attempt to escalate privileges itself.',
      );
      process.exit(3);
    }

    const processes = discoverProcesses();
    const pids = [...processes.host, ...processes.webProcess, ...processes.gpuProcess].map(
      (p) => p.pid,
    );
    if (!pids.length) {
      console.error(
        'webkit-profile: no running Varve session found.\n' +
          'Launch the release GUI first (the workload must run in a real window):\n' +
          '  ./target/release/varve-desktop\n' +
          'then warm it up and re-run with --record.',
      );
      process.exit(4);
    }
    if (!processes.webProcess.length) {
      console.warn(
        'webkit-profile: WARNING — no WebKitWebProcess found. Replay cost lives in\n' +
          'the web process; a host-only profile will look misleadingly idle.',
      );
    }

    const [cmd, cmdArgs] = buildPerfCommand({ pids, durationSeconds: DURATION_S, output: OUT });
    console.log(`Recording ${DURATION_S}s across pids ${pids.join(', ')} → ${OUT}`);
    console.log('Perform the workload now.');
    const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`webkit-profile: perf record failed with status ${result.status}`);
      process.exit(5);
    }

    const meta = `${OUT}.meta.json`;
    writeFileSync(
      meta,
      JSON.stringify(
        {
          label: LABEL,
          durationSeconds: DURATION_S,
          pids,
          processes,
          capabilities,
          commit: run('git', ['rev-parse', 'HEAD'], 'unknown'),
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`\nWrote ${OUT} and ${meta}`);
    console.log('Analyse with:');
    console.log(`  perf report -i ${OUT}                        # interactive`);
    console.log(`  perf report -i ${OUT} --sort=dso,symbol      # platform vs app cost`);
    console.log(`  hotspot ${OUT}                               # flamegraph viewer`);
    process.exit(0);
  }

  if (args.get('sample-stacks') === 'true') {
    // Fallback sampler for machines without perf. eu-stack walks the stacks of
    // every thread on demand; polling it is a crude but real statistical
    // profiler. It is strictly worse than perf (much lower rate, and each
    // sample briefly stops the target), so it is offered only as a fallback and
    // its limitations are recorded in the output.
    if (!capabilities.profilers.eu_stack) {
      console.error(
        'webkit-profile: eu-stack is not installed (package: elfutils).\n' +
          'Install it or use --record with perf instead.',
      );
      process.exit(2);
    }
    if (!capabilities.permissions.canAttachRunningProcess) {
      console.error(
        `webkit-profile: ptrace_scope = ${capabilities.permissions.ptraceScope} — ` +
          `${capabilities.permissions.ptraceDetail}.\n` +
          'Stack sampling of an already-running session is therefore blocked. Either:\n' +
          '  sudo sysctl kernel.yama.ptrace_scope=0     (session-wide, reverts on reboot)\n' +
          'or install perf, which samples without ptrace:\n' +
          '  sudo pacman -S perf\n' +
          'This runner will not escalate privileges itself.',
      );
      process.exit(3);
    }

    const processes = discoverProcesses();
    const target = processes.webProcess[0] ?? processes.host[0];
    if (!target) {
      console.error(
        'webkit-profile: no running Varve session found. Launch ./target/release/varve-desktop first.',
      );
      process.exit(4);
    }

    const intervalMs = Number(args.get('interval') ?? 10);
    const deadline = Date.now() + DURATION_S * 1000;
    const counts = new Map();
    let samples = 0;
    let failures = 0;
    console.log(
      `Sampling pid ${target.pid} every ${intervalMs}ms for ${DURATION_S}s. Perform the workload now.`,
    );
    while (Date.now() < deadline) {
      const out = run('eu-stack', ['-p', String(target.pid)], null);
      if (!out) {
        failures++;
      } else {
        samples++;
        for (const line of out.split('\n')) {
          const match = /#\d+\s+0x[0-9a-f]+\s+(.+)/.exec(line.trim());
          if (match?.[1]) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
        }
      }
    }

    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const report = {
      method: 'eu-stack polling (fallback; not a substitute for perf)',
      limitations: [
        'sample rate is far below perf and is not uniform',
        'each sample briefly stops the target, perturbing the workload',
        'inclusive frame counts only — no self time and no call-graph weighting',
      ],
      pid: target.pid,
      durationSeconds: DURATION_S,
      samples,
      failures,
      topFrames: top.map(([frame, count]) => ({
        frame,
        count,
        share: count / Math.max(1, samples),
      })),
      capabilities,
      recordedAt: new Date().toISOString(),
    };
    writeFileSync(`${OUT}.stacks.json`, JSON.stringify(report, null, 2));
    console.log(`\n${samples} samples (${failures} failures). Top frames:`);
    for (const { frame, count } of top.slice(0, 20))
      console.log(`  ${String(count).padStart(5)}  ${frame}`);
    console.log(`\nWrote ${OUT}.stacks.json`);
    process.exit(0);
  }

  console.error(
    'webkit-profile: pass --check, --record, or --sample-stacks. See the header for usage.',
  );
  process.exit(1);
}
