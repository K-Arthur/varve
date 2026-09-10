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
import { documentExtension, productSlug } from './product.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

/**
 * Read CHANGELOG.md with every HTML comment removed.
 *
 * Comments are stripped from the *whole file before anything is located*, not
 * from a section after it is extracted. The changelog carries a commented-out
 * `## [0.1.0] - 2026-MM-DD` template for maintainers to copy. Searching the raw
 * text finds that heading, and because the opening `<!--` sits above the match
 * it never appears in the extracted body — so a later comment-strip has nothing
 * to remove and the empty-section guard sees `### Added ... -->` as real
 * content. Tagging v0.1.0 would then publish the blank template, trailing `-->`
 * and all, as the release notes.
 *
 * Blanking comments out (rather than deleting them) keeps line numbers intact
 * so any future line-based reporting still points at the right place.
 */
function changelogWithoutComments() {
  const text = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf-8');
  return text.replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ''));
}

/**
 * Extract the `## [version]` section from CHANGELOG.md, excluding the heading.
 *
 * Stops at the next `##` heading *or* a horizontal rule. Templates and other
 * commented-out scaffolding are invisible here — see `changelogWithoutComments`.
 */
function changelogSection(version) {
  const lines = changelogWithoutComments().split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) {
    throw new Error(
      `CHANGELOG.md has no '## [${version}]' section. ` +
        'A commented-out template does not count — write a real one.',
    );
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## ') || /^-{3,}\s*$/.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');

  // Bare `### Added`-style headings with nothing under them are scaffolding,
  // not notes; a section containing only those is as empty as a blank one.
  const cleaned = body.trim();
  const hasProse = cleaned.split('\n').some((l) => l.trim() !== '' && !/^#{2,6}\s/.test(l.trim()));
  if (!cleaned || !hasProse) {
    throw new Error(
      `CHANGELOG.md section '## [${version}]' has no content. Release notes need real prose — ` +
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

  // `--check <version>` validates the changelog alone, with no manifest and no
  // output. The release workflow used `grep -q "## [$VERSION]"` for this, which
  // happily matched the commented-out template and let a tag through with blank
  // release notes. Sharing this code means the gate and the generator can never
  // disagree about what counts as a usable section.
  if (args.check) {
    changelogSection(args.check);
    console.log(`CHANGELOG.md has a usable '## [${args.check}]' section.`);
    return;
  }

  const manifest = JSON.parse(readFileSync(resolve(repoRoot, args.manifest), 'utf-8'));
  const outPath = resolve(repoRoot, args.out ?? 'RELEASE_NOTES.md');

  if (manifest.version !== version) {
    throw new Error(`Manifest version '${manifest.version}' != requested '${version}'`);
  }

  const platforms = [...new Set(manifest.artifacts.map((a) => a.os))];
  const out = [];

  out.push(`## ${productSlug()} ${version}`);
  out.push('');
  out.push(changelogSection(version));
  out.push('');

  // ── Trust disclosure, first thing after the changes ──────────────────────
  // Placed before the downloads deliberately: a user deciding whether to run a
  // binary should read this before they click, not after. The content derives
  // from the manifest's signing block, which was populated from post-build
  // cryptographic verification — never from intent.
  const signing = manifest.signing ?? {};
  if (manifest.signed) {
    out.push('### Release verification');
    out.push('');
    if (signing.windows?.signed) {
      out.push(
        `- **Windows** — Authenticode signature verified: ${signing.windows.publisher ?? '(publisher)'}. ` +
          'SmartScreen may still warn until the publisher builds reputation.',
      );
    }
    if (signing.macos?.signed) {
      out.push('- **macOS** — Developer ID signed, notarized by Apple, ticket stapled.');
    }
    out.push(
      '- **Linux** — SHA-256 checksums, SBOM and GitHub build provenance are attached to this release.',
    );
    if (signing.windows && !signing.windows.innerExecutableSigned) {
      out.push(
        '- **Windows note** — the installer is signed; the executable it installs is not ' +
          '(NSIS payloads are not signed). Windows does not require it to run.',
      );
    }
    out.push('');
  } else {
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
      `The \`.${documentExtension()}\` document format may still change in ways that ` +
      'break older files.',
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
      `\`${productSlug().toLowerCase()}-${version}-sbom.cdx.json\`.`,
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
