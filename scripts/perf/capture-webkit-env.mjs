#!/usr/bin/env node
/**
 * WebKitGTK environment capture + native profiling runbook.
 *
 * Treats Linux WebKitGTK as a first-class profiling target rather than
 * assuming Chromium DevTools conclusions apply. Captures the environment
 * metadata required to make a trace report meaningful (distro, kernel, DE,
 * session type, WebKitGTK/GTK/Mesa versions, GPU, Tauri/Rust versions,
 * hardware-acceleration flags, display refresh, device-pixel ratio, memory)
 * and prints which native profiling tools are actually available on this
 * machine, with concrete commands for each.
 *
 * Usage: node scripts/perf/capture-webkit-env.mjs [--json]
 *   --json   print only the machine-readable environment report
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
const jsonOnly = args.has('--json');

function run(cmd, fallback = null) {
  try {
    return execFileSync(cmd[0], cmd.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return fallback;
  }
}

function pkg(meta) {
  return run(['pacman', '-Q', meta], null);
}

const env = {
  capturedAt: new Date().toISOString(),
  hostname: run(['hostname'], 'unknown'),
  os: {
    distro: run(
      ['bash', '-c', 'cat /etc/os-release | grep -E "^(NAME|PRETTY_NAME)=" | tr "\\n" ";"'],
      'unknown',
    ),
    kernel: run(['uname', '-r'], 'unknown'),
    arch: run(['uname', '-m'], 'unknown'),
    desktop: process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION ?? 'unknown',
    sessionType: process.env.XDG_SESSION_TYPE ?? 'unknown',
    waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
  },
  toolchain: {
    webkitGtk: run(
      ['pkg-config', '--modversion', 'webkit2gtk-4.1'],
      run(['pkg-config', '--modversion', 'webkit2gtk-4.0'], 'unknown'),
    ),
    gtk: run(['pkg-config', '--modversion', 'gtk+-3.0'], 'unknown'),
    mesa: pkg('mesa'),
    mesaVulkan: pkg('vulkan-mesa-layer'),
    tauri: pkg('tauri-cli'),
    rust: run(['rustc', '--version'], 'unknown'),
    cargo: run(['cargo', '--version'], 'unknown'),
    node: run(['node', '--version'], 'unknown'),
  },
  gpu: {
    glxinfo:
      run(['glxinfo', '-B'], null)?.split('\n').slice(0, 8).join(' | ') ?? 'glxinfo not installed',
    lspciVga: run(['bash', '-c', 'lspci | grep -iE "vga|3d|display"'], 'lspci not installed'),
  },
  display: {
    refresh: run(['bash', '-c', 'xrandr 2>/dev/null | grep -E "\\*" | head -1'], null),
    dprHint: run(
      [
        'bash',
        '-c',
        'gsettings get org.gnome.desktop.interface text-scaling-factor 2>/dev/null || true',
      ],
      null,
    ),
  },
  memory: {
    total: run(['bash', '-c', 'grep MemTotal /proc/meminfo'], 'unknown'),
    available: run(['bash', '-c', 'grep MemAvailable /proc/meminfo'], 'unknown'),
  },
  cpu: {
    governor: run(
      [
        'bash',
        '-c',
        'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown',
      ],
      'unknown',
    ),
    hwConcurrency: run(['bash', '-c', 'nproc'], 'unknown'),
  },
  acceleration: {
    webglInspection: run(
      ['bash', '-c', 'echo "see runtime diagnostics: window.__varvePerf / PerformanceSettingsTab"'],
      'n/a',
    ),
  },
  profilers: {
    gdb: existsSync('/usr/bin/gdb'),
    perf: existsSync('/usr/bin/perf'),
    strace: existsSync('/usr/bin/strace'),
    valgrind: existsSync('/usr/bin/valgrind'),
    bpftrace: existsSync('/usr/bin/bpftrace'),
    heaptrack: existsSync('/usr/bin/heaptrack'),
  },
};

const report = { environment: env };

if (!jsonOnly) {
  console.log('=== Strata WebKitGTK environment report ===');
  console.log(JSON.stringify(env, null, 2));
  console.log();
  console.log('=== Native profiling runbook (tools detected on this machine) ===');
  const tips = [];
  if (env.profilers.gdb) {
    tips.push(
      'gdb: attach to the web process to capture JS/WASM stack on a hang:\n' +
        '  gdb -p $(pgrep -f WebKitWebProcess | head -1) -ex "thread apply all bt" -batch',
    );
  } else {
    tips.push('gdb: not installed (pacman -S gdb).');
  }
  if (env.profilers.perf) {
    tips.push(
      'perf: sample all web processes during a slow interaction:\n' +
        '  perf record -F 199 -g -p $(pgrep -f "WebKit|strata" | tr "\\n" ",") sleep 15 && perf report',
    );
  } else {
    tips.push(
      'perf: not installed — `sudo pacman -S perf` on CachyOS/Arch; kernel.perf_event_paranoid may need',
    );
  }
  tips.push(
    'WebKit inspector (server-side): relaunch with\n' +
      '  WEBKIT_INSPECTOR_SERVER=127.0.0.1:9222 VARVE_PERF_URL=... then attach Safari/WebKit inspector.',
  );
  tips.push(
    'Structured Rust spans: run the Tauri app with RUST_LOG=trace and correlate monotonic timestamps;',
  );
  tips.push(
    'capability fallbacks: see window.__varvePerf / PerformanceSettingsTab for hasOffscreenCanvas,',
  );
  tips.push(
    'render worker is disabled on WebKitGTK by profileForTier (enableWorker requires OffscreenCanvas);',
  );
  tips.push(
    'verify OffscreenCanvas with: typeof OffscreenCanvas !== "undefined" in the devtools console.',
  );
  for (const t of tips) console.log(`  - ${t}`);
  console.log();
  console.log('Include this report with any WebKitGTK trace submission.');
} else {
  console.log(JSON.stringify(report));
}
