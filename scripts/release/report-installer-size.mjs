#!/usr/bin/env node
/**
 * Report and gate release installer sizes against a baseline.
 *
 * Motivation (2026-08-18 installer-size investigation): the v0.1.2 Windows
 * NSIS installer was 263.7 MB (x64) / 236.7 MB (ARM64). Decomposition of the
 * released artifact showed the embedded WebView2 Evergreen standalone
 * installer (Tauri `offlineInstaller` mode) alone contributed 202.8 MB /
 * 187.3 MB. This script makes installer composition and growth observable on
 * every release:
 *
 *   - decomposes NSIS installers via 7-Zip when available (best-effort);
 *   - compares total size against an expected baseline;
 *   - warns past `warnRatio` of expected, blocks past `blockRatio`;
 *   - records a machine-readable report next to the artifact;
 *   - honours an explicit override for intentional growth (e.g. adding a
 *     bundled model or switching WebView2 install mode) so the gate never
 *     blocks a deliberate change — the override reason is recorded in the
 *     report, so unexplained growth stays visible in the audit trail.
 *
 * Baselines live in `installer-size-baseline.json`; entries are updated in
 * the same commit that intentionally changes installer size (this is the
 * override-at-source process). The v0.1.2 baselines below reflect the two
 * accepted 2026-08-18 optimisations:
 *   - WebView2 `offlineInstaller` -> `downloadBootstrapper` (-~200 MB x64 /
 *     -~185 MB ARM64, +~2 MB bootstrapper);
 *   - onnxruntime-web staging trimmed to the 4 required runtime companions
 *     (-~9.8 MB of brotli-compressed payload inside varve-desktop.exe).
 *
 * Usage:
 *   node scripts/release/report-installer-size.mjs \
 *     --installer dist/release/Varve-0.1.3-windows-x86_64.exe \
 *     [--installer <more...>] \
 *     [--baseline scripts/release/installer-size-baseline.json] \
 *     [--out-report dist/release/installer-size-report.json] \
 *     [--override-reason "reason"]
 *
 * Exit codes: 0 = ok or warning (report written), 1 = hard threshold
 * exceeded without an override, 2 = usage error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WARN_RATIO = 1.2;
const BLOCK_RATIO = 1.35;

const DEFAULT_BASELINE = {
  schemaVersion: 1,
  note: 'Expected NSIS installer sizes after the 2026-08-18 changes (WebView2 downloadBootstrapper + ort-wasm trim). Derived from the released v0.1.2 bytes: 263,742,332 (x64) / 236,738,619 (arm64) minus the embedded WebView2 standalone installer (202.8 MB / 187.3 MB raw; LZMA-incompressible, so its installer contribution ~ its raw size), minus ~9.8 MB brotli payload trimmed from varve-desktop.exe, plus ~2 MB bootstrapper. Update this file in the same commit as any intentional installer-size change.',
  warnRatio: WARN_RATIO,
  blockRatio: BLOCK_RATIO,
  installers: {
    'nsis-x86_64': { expectedBytes: 56_000_000 },
    'nsis-aarch64': { expectedBytes: 44_000_000 },
  },
};

const WEBVIEW_PATTERN = /MicrosoftEdgeWebView2RuntimeInstaller/i;
const UNINSTALL_PATTERN = /uninstall\.exe$/i;
const PLUGINS_PATTERN = /\$PLUGINSDIR/i;

function parseArgs(argv) {
  const args = { installers: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (key === '--installer') {
      args.installers.push(argv[i + 1]);
    } else {
      args[key.slice(2)] = argv[i + 1];
    }
  }
  if (args.installers.length === 0) {
    throw new Error('At least one --installer <path> is required');
  }
  return args;
}

function archFromFilename(filename) {
  const lowered = filename.toLowerCase();
  if (lowered.includes('x86_64') || lowered.includes('x64')) return 'x86_64';
  if (lowered.includes('aarch64') || lowered.includes('arm64')) return 'aarch64';
  return 'unknown';
}

function formatFromFilename(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'exe') return 'nsis';
  if (ext === 'msi') return 'msi';
  return ext ?? 'unknown';
}

function findSevenZip() {
  const candidates = ['7z', '7zz', '7za'];
  for (const name of candidates) {
    try {
      execFileSync(name, ['i'], { stdio: 'pipe', timeout: 15_000 });
      return name;
    } catch {
      // try next
    }
  }
  // GitHub-hosted Windows runners preinstall 7-Zip outside PATH.
  const windowsPath = 'C:\\Program Files\\7-Zip\\7z.exe';
  if (existsSync(windowsPath)) return windowsPath;
  return null;
}

function listNsisEntries(sevenZip, installerPath) {
  // `-slt` emits one structured block per entry with `Path =` and `Size =`
  // lines, which is robust to locale and solid-archive quirks.
  const out = execFileSync(sevenZip, ['l', '-slt', installerPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  const entries = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('Path = ')) {
      current = { name: line.slice('Path = '.length).trim(), sizeBytes: 0 };
      entries.push(current);
    } else if (line.startsWith('Size = ') && current) {
      current.sizeBytes = Number(line.slice('Size = '.length).trim()) || 0;
    }
  }
  return entries;
}

function classifyEntry(name) {
  if (WEBVIEW_PATTERN.test(name)) return 'webviewInstaller';
  if (UNINSTALL_PATTERN.test(name)) return 'uninstaller';
  if (PLUGINS_PATTERN.test(name)) return 'nsisPlugins';
  if (name.includes('onnxruntime-libs')) return 'onnxRuntime';
  if (name.toLowerCase().endsWith('.exe')) return 'appBinary';
  return 'other';
}

function categoryBytes(entries) {
  const totals = {};
  for (const entry of entries) {
    const cat = classifyEntry(entry.name);
    totals[cat] = (totals[cat] ?? 0) + entry.sizeBytes;
  }
  return totals;
}

function webviewModeFromEntries(entries) {
  const hasInstaller = entries.some((e) => WEBVIEW_PATTERN.test(e.name));
  return hasInstaller ? 'offlineInstaller' : 'bootstrapper';
}

function loadBaseline(path) {
  if (!path) return DEFAULT_BASELINE;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return {
    ...DEFAULT_BASELINE,
    ...raw,
    installers: { ...DEFAULT_BASELINE.installers, ...raw.installers },
  };
}

function analyzeInstaller({ installerPath, baseline, overrideReason, sevenZip }) {
  const filename = basename(installerPath);
  const format = formatFromFilename(filename);
  const arch = archFromFilename(filename);
  const sizeBytes = statSync(installerPath).size;

  const report = {
    filename,
    format,
    arch,
    sizeBytes,
    size: humanSize(sizeBytes),
    decomposed: false,
    entries: [],
    categories: null,
    webviewMode: null,
    expectedBytes: null,
    warnBytes: null,
    blockBytes: null,
    status: 'ok',
    overrideReason: overrideReason ?? null,
  };

  const baselineEntry = baseline.installers[`${format}-${arch}`];
  if (baselineEntry) {
    report.expectedBytes = baselineEntry.expectedBytes;
    report.warnBytes = Math.round(baselineEntry.expectedBytes * baseline.warnRatio);
    report.blockBytes = Math.round(baselineEntry.expectedBytes * baseline.blockRatio);
  }

  if (sevenZip && format === 'nsis') {
    try {
      const entries = listNsisEntries(sevenZip, installerPath);
      report.decomposed = true;
      report.entries = entries.map((e) => ({ ...e, category: classifyEntry(e.name) }));
      report.categories = categoryBytes(entries);
      report.webviewMode = webviewModeFromEntries(entries);
      report.uncompressedBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
    } catch (err) {
      report.decomposeError = String(err.message ?? err);
    }
  } else if (format === 'nsis') {
    report.decomposeError = '7-Zip unavailable — size-only report';
  }

  if (report.blockBytes !== null) {
    if (sizeBytes > report.blockBytes) {
      report.status = overrideReason ? 'block-overridden' : 'block';
    } else if (sizeBytes > report.warnBytes) {
      report.status = 'warn';
    }
  }
  return report;
}

function humanSize(bytes) {
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function renderSummary(reports, _baseline) {
  const lines = [];
  for (const r of reports) {
    lines.push(`\n== ${r.filename} (${r.size})`);
    if (r.decomposed) {
      const cats = r.categories ?? {};
      for (const [cat, bytes] of Object.entries(cats).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${cat.padEnd(16)} ${humanSize(bytes).padStart(9)}`);
      }
      if (r.webviewMode) lines.push(`  webview mode    ${r.webviewMode}`);
    } else if (r.decomposeError) {
      lines.push(`  (decomposition skipped: ${r.decomposeError})`);
    }
    if (r.expectedBytes !== null) {
      const delta = r.sizeBytes - r.expectedBytes;
      const pct = (r.sizeBytes / r.expectedBytes - 1) * 100;
      lines.push(
        `  baseline ${humanSize(r.expectedBytes)}  delta ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% (${delta >= 0 ? '+' : ''}${humanSize(delta)})`,
      );
      lines.push(
        `  warn at ${humanSize(r.warnBytes)}  block at ${humanSize(r.blockBytes)}  status ${r.status}`,
      );
    }
  }
  return lines.join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Usage error: ${err.message}\n`);
    process.exit(2);
  }

  const baseline = loadBaseline(args.baseline);
  const sevenZip = findSevenZip();
  const overrideReason = args['override-reason']?.trim() || null;

  const reports = args.installers.map((path) =>
    analyzeInstaller({ installerPath: path, baseline, overrideReason, sevenZip }),
  );

  process.stdout.write(`Installer size report (7z: ${sevenZip ?? 'unavailable'}):\n`);
  process.stdout.write(renderSummary(reports, baseline));
  process.stdout.write('\n');

  const outReport =
    args['out-report'] ?? join(dirname(args.installers[0]), 'installer-size-report.json');
  mkdirSync(dirname(outReport), { recursive: true });
  writeFileSync(
    outReport,
    `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), installers: reports }, null, 2)}\n`,
  );
  process.stdout.write(`\nReport written to ${outReport}\n`);

  const blocks = reports.filter((r) => r.status === 'block');
  if (blocks.length > 0) {
    for (const r of blocks) {
      process.stderr.write(
        `SIZE GATE BLOCK: ${r.filename} is ${r.size} — ${r.blockBytes / 1_000_000} MB hard ceiling. ` +
          `Re-run with --override-reason "<why>" to accept this growth intentionally.\n`,
      );
    }
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}

export {
  analyzeInstaller,
  archFromFilename,
  classifyEntry,
  DEFAULT_BASELINE,
  webviewModeFromEntries,
};
