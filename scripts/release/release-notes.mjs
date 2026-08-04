#!/usr/bin/env node
/**
 * Build release notes from the approved changelog plus the generated manifest.
 *
 * Two rules drive the shape of this file:
 *
 *  1. The prose comes from CHANGELOG.md, which a human wrote and reviewed.
 *     Auto-generating notes from commit messages produces a list of internal
 *     refactors that means nothing to a user downloading a design tool.
 *
 *  2. The download table and checksums come from the manifest, which was
 *     derived from the actual bytes. Nothing about artifact names, sizes or
 *     hashes is hand-typed, so the notes cannot drift from the release.
 *
 * Usage:
 *   node scripts/release/release-notes.mjs \
 *     --version 0.1.0 --manifest dist/release/release-manifest.json --out RELEASE_NOTES.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

/**
 * Extract the `## [version]` section from CHANGELOG.md, excluding the heading.
 *
 * Stops at the next `##` heading *or* a horizontal rule, and strips HTML
 * comments. Without this, the trailing `<!-- template -->` block at the bottom
 * of the changelog gets swept into the notes of whichever version happens to be
 * last — which is how maintainer scaffolding ends up on a public release page.
 */
function changelogSection(version) {
  const text = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf-8');
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no '## [${version}]' section.`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## ') || /^-{3,}\s*$/.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');

  const cleaned = body.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!cleaned) {
    throw new Error(
      `CHANGELOG.md section '## [${version}]' is empty. Release notes need real content — ` +
        'describe what changed for someone deciding whether to install this update.',
    );
  }
  return cleaned;
}

const OS_LABEL = {
  linux: 'Linux',
  windows: 'Windows',
  macos: 'macOS',
};

const INSTALL_HINT = {
  appimage: 'chmod +x, then run. Needs FUSE2.',
  deb: 'sudo apt install ./<file>',
  rpm: 'sudo dnf install ./<file>',
  nsis: 'Per-user install, no admin needed.',
  msi: 'System-wide install.',
  dmg: 'Open, drag to Applications.',
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, args.manifest), 'utf-8'));
  const outPath = resolve(repoRoot, args.out ?? 'RELEASE_NOTES.md');

  if (manifest.version !== version) {
    throw new Error(`Manifest version '${manifest.version}' != requested '${version}'`);
  }

  const platforms = [...new Set(manifest.artifacts.map((a) => a.os))];
  const out = [];

  out.push(`## Strata ${version}`);
  out.push('');
  out.push(changelogSection(version));
  out.push('');

  // ── Trust disclosure, first thing after the changes ──────────────────────
  // Placed before the downloads deliberately: a user deciding whether to run an
  // unsigned binary should read this before they click, not after.
  if (!manifest.signed) {
    out.push('### Before you install');
    out.push('');
    out.push(
      'These builds are **not code-signed**. That is a statement about this project’s ' +
        'budget, not about the files — but your operating system cannot tell the ' +
        'difference, and neither can you without checking. Verify the SHA-256 checksum ' +
        'below against your download before running it.',
    );
    out.push('');
    if (platforms.includes('windows')) {
      out.push(
        '- **Windows** shows "Windows protected your PC". Choose **More info → Run anyway**.',
      );
    }
    if (platforms.includes('macos')) {
      out.push(
        '- **macOS** refuses to open the app. Use **System Settings → Privacy & Security → ' +
          'Open Anyway**. Do not disable Gatekeeper system-wide.',
      );
    }
    if (platforms.includes('linux')) {
      out.push('- **Linux** has no equivalent prompt; verify the checksum instead.');
    }
    out.push('');
  }

  // ── Downloads ────────────────────────────────────────────────────────────
  out.push('### Downloads');
  out.push('');
  out.push('| Platform | Package | Size | Install |');
  out.push('|---|---|---|---|');
  for (const a of manifest.artifacts) {
    const os = OS_LABEL[a.os] ?? a.os;
    out.push(
      `| ${os} ${a.arch} | \`${a.filename}\` | ${a.size} | ${INSTALL_HINT[a.format] ?? '—'} |`,
    );
  }
  out.push('');

  // ── Checksums ────────────────────────────────────────────────────────────
  out.push('### Verify your download');
  out.push('');
  out.push('```');
  for (const a of manifest.artifacts) out.push(`${a.sha256}  ${a.filename}`);
  out.push('```');
  out.push('');
  out.push(
    'Or download `SHA256SUMS.txt` and run `sha256sum -c SHA256SUMS.txt` ' +
      '(`shasum -a 256 -c` on macOS, `Get-FileHash` on Windows).',
  );
  out.push('');

  // ── Standing warnings ────────────────────────────────────────────────────
  out.push('### Known limitations');
  out.push('');
  out.push(
    '- **This is early software. Keep backups of anything you care about.** ' +
      'The `.strata` document format may still change in ways that break older files.',
  );
  out.push('- Updates are manual — there is no in-app updater yet.');
  if (!platforms.includes('macos')) {
    out.push('- No macOS build in this release.');
  }
  if (!platforms.includes('windows')) {
    out.push('- No Windows build in this release.');
  }
  out.push('');
  out.push(
    'A CycloneDX software bill of materials is attached as ' +
      `\`strata-${version}-sbom.cdx.json\`.`,
  );

  writeFileSync(outPath, `${out.join('\n')}\n`);
  process.stdout.write(`Release notes written to ${outPath}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
