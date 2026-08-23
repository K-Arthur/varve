#!/usr/bin/env node

/**
 * Varve secret scanner — dependency-free, fast, staged + tracked-tree aware.
 *
 * Why this exists alongside gitleaks: gitleaks is the deep-history tool (run
 * `gitleaks detect --log-opts="--all"` for a full forensic pass) and is
 * recommended for the pre-commit path when installed (see
 * .github/hooks/pre-commit). This scanner is the always-present, fast inner
 * loop: it inspects only what git actually tracks (or only staged additions
 * with --staged), needs zero installation, and fails a commit or CI run in
 * well under a second.
 *
 * Usage:
 *   node scripts/secret-scan.mjs            # scan all git-tracked files
 *   node scripts/secret-scan.mjs --staged   # scan only staged additions
 *   node scripts/secret-scan.mjs --ci       # alias for the tracked-tree scan
 *   node scripts/secret-scan.mjs --dir <path> [--dir <path>...]
 *                                          # scan build artifacts (dist)
 *   node scripts/secret-scan.mjs --canary <value>
 *                                          # fail if <value> appears anywhere
 *
 * Exit codes: 0 = clean, 1 = findings.
 *
 * Artifact scanning (--dir): the tracked-tree scan skips gitignored output
 * (dist/, target/...). Build artifacts get their own scan pass because a
 * secret can only enter a shipped artifact by being embedded at build time —
 * the source scan cannot see that. The artifact scan applies the same rules
 * to every non-binary file under the given directories. A missing directory
 * is tolerated (exit 0) so local runs are safe before the first build.
 *
 * Canary (--canary): the trust-boundary canary. CI sets
 * VARVE_PRIVATE_TEST_CANARY on build steps (a value with no credential
 * meaning) and this option fails the scan if that value ever appears in the
 * scanned output — proving the build system embeds only what it is told to.
 * See docs/security/trust-boundaries.md §Canary tests.
 *
 * Allowlist policy:
 *   - Path-based only, and only for files whose contents are *documented
 *     synthetic fixtures*. Never add a path because a real credential lives
 *     there — rotate and remove it instead.
 *   - packages/crash/src/redactFixtures.ts — deliberate fake credentials used
 *     by the crash-report privacy tests (fake values only, e.g. sk-1234...).
 *   - packages/crash/src/redact.test.ts — asserts on the canonical AWS
 *     documentation example access key.
 *   - packages/editor/src/archive/encryption.test.ts — 'test-password-123'
 *     archive password fixture.
 *   - packages/engine/src/backgroundRemoval/__tests__/cloudConfig.test.ts and
 *     cloudProvider.test.ts — 'sk-test-key-12345' fake provider keys.
 *   - docs/audits/menubar-audit-2026-07-23.md — contains keyboard-shortcut
 *     documentation strings that trigger generic key patterns.
 *
 * Templated values (${{ secrets.X }}, ${VAR}, $VAR) are never flagged: a
 * reference to a secret is not a secret value.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.icns',
  '.pdf',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.onnx',
  '.wasm',
  '.node',
  '.so',
  '.dll',
  '.dylib',
  '.zip',
  '.gz',
  '.tar',
  '.tgz',
  '.deb',
  '.rpm',
  '.appimage',
  '.dmg',
  '.exe',
  '.msi',
  '.p12',
  '.pfx',
  '.p8',
  '.key',
  '.crl',
  '.db',
  '.sqlite',
  '.bin',
  '.pack',
  '.idx',
  '.pyc',
  '.snap',
  '.cdx',
  '.lockb',
]);

const SKIP_PATH = [
  /^node_modules\//,
  /^dist\//,
  /^dist-pages\//,
  /^dist-root\//,
  /^target\//,
  /^test-results\//,
  /^playwright-report\//,
  /^reports\//,
  /^\.worktrees\//,
  /^apps\/desktop\/src-tauri\/target\//,
  /^apps\/website\/dist\//,
  /^\.git\/lfs\//,
  /^\.astro\//,
  /^models-source\//,
];

const ALLOWLISTED_PATHS = new Set([
  'packages/crash/src/redactFixtures.ts',
  'packages/crash/src/redact.test.ts',
  'packages/editor/src/archive/encryption.test.ts',
  'packages/engine/src/backgroundRemoval/__tests__/cloudConfig.test.ts',
  'packages/engine/src/backgroundRemoval/__tests__/cloudProvider.test.ts',
  'docs/audits/menubar-audit-2026-07-23.md',
]);

/**
 * High-signal, low-false-positive credential patterns. Each entry names the
 * rule so findings stay actionable. Word boundaries are used deliberately so
 * e.g. "keyshortcuts" never matches a KEY rule.
 */
const RULES = [
  {
    id: 'github-pat',
    re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: 'github-fine-grained-pat',
    re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  },
  {
    id: 'npm-token',
    re: /\bnpm_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: 'aws-access-key',
    re: /\b(AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'aws-secret',
    re: /\baws[_A-Z]*secret[_A-Z]*['"]?\s*[:=]\s*['"][A-Za-z0-9/+=]{40}['"]/gi,
  },
  {
    id: 'private-key-block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: 'ssh-public-key-material',
    re: /\bssh-(?:rsa|dss|ed25519|ecdsa) AAAA[0-9A-Za-z+/]{20,}/g,
  },
  {
    id: 'slack-webhook',
    re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,10}\/B[A-Z0-9]{8,12}\/[A-Za-z0-9]{20,}/g,
  },
  {
    id: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    id: 'stripe-live-key',
    re: /\b(?:sk|rk|pk)_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: 'openai-key',
    re: /\bsk-(?:proj-)?[A-Za-z0-9]{24,}\b/g,
  },
  {
    id: 'sendgrid-key',
    re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
  },
  {
    id: 'telegram-bot-token',
    re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/g,
  },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: 'basic-auth-url',
    // Disallow JSON punctuation from the password segment so minified
    // JSON-LD (`"@context":"https://schema.org"... "email":"support@..."`)
    // does not look like `https://host:password@`.
    re: /\bhttps?:\/\/[^\s/:@]+:[^\s/@"',}\]{]{6,}@/g,
  },
  {
    id: 'netrc',
    re: /\bmachine\s+\S+\s+login\s+\S+\s+password\s+\S+/g,
  },
  {
    id: 'env-style-secret-key',
    // All-caps environment-style assignment whose key ENDS in a credential
    // word: VARVE_API_TOKEN=..., AWS_SECRET_ACCESS_KEY=..., CLIENT_SECRET=x.
    // The suffix match avoids flagging merely-"signed" names like
    // RELEASE_EXPECT_SIGNED. Values may be quoted or bare.
    re: /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|CLIENT_SECRET|ACCESS_KEY|PRIVATE_KEY|SIGNING_KEY)\b\s*=\s*(?:['"][^'"\s$]{16,}['"]|[^'"\s$]{16,}(?:\s|$))/g,
  },
  {
    id: 'quoted-key-value',
    // Assignment-style quoted values for credential-ish key words. The
    // (?<![a-z0-9_-]) guard prevents matching inside compound words like
    // "textbox-password" (MDI icon aliases) while still catching
    // `password = '...'` / `apiKey: '...'` assignments.
    re: /(?<![a-z0-9_-])(?:api[_-]?key|apikey|secret|passwd|password|client[_-]?secret|access[_-]?token|auth[_-]?token|bearer[_-]?token|signing[_-]?key|private[_-]?key)['"]?\s*[:=]\s*['"][^'"\s$]{16,}['"]/gi,
  },
  {
    id: 'pem-base64-blob',
    // Base64-encoded certificate/key material. A contiguous base64 run
    // starting with MII (X.509 DER prefix) of certificate size: real
    // certificates, PKCS12 bundles and .p8 keys are 500-32000 chars of
    // base64. Larger runs are binary data inlined by bundlers (e.g. the
    // wawoff2 WASM decoder ships ~866 KB of base64) and are not secrets —
    // scanning the tracked tree or an artifact must not fail on those.
    re: /MII[A-Za-z0-9+/]{60,}={0,2}/g,
    valid: (m) => m[0].length >= 500 && m[0].length <= 32000,
  },
  {
    id: 'minisign-signing-key',
    re: /\bRWQ[A-Za-z0-9+/]{60,}\b/g,
  },
];

function isBinaryPath(path) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return BINARY_EXT.has(ext);
}

function shouldSkip(path) {
  if (isBinaryPath(path)) return true;
  if (ALLOWLISTED_PATHS.has(path)) return true;
  for (const re of SKIP_PATH) {
    if (re.test(path)) return true;
  }
  return false;
}

function redact(match) {
  if (match.length <= 12) return '<redacted>';
  return `${match.slice(0, 4)}<redacted>${match.slice(-4)}`;
}

function scanText(text, path, findings) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/\$\{\{\s*secrets\./.test(line)) continue;
    if (/\$\{?[A-Z][A-Z0-9_]*\}?/.test(line)) continue;
    for (const rule of RULES) {
      if (rule.id === 'basic-auth-url' && line.includes('application/ld+json')) continue;
      rule.re.lastIndex = 0;
      const match = rule.re.exec(line);
      if (match) {
        if (rule.valid && !rule.valid(match)) continue;
        findings.push({
          path,
          line: i + 1,
          rule: rule.id,
          match: redact(match[0]),
        });
        break;
      }
    }
  }
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function stagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
    encoding: 'utf8',
  });
  return out.split('\0').filter(Boolean);
}

/**
 * Recursively list every non-binary file under a build-output directory
 * (gitignored, so it never appears in the tracked/staged scans).
 */
function filesUnder(dir) {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
      } else if (!isBinaryPath(entry.name) && entry.name !== '.DS_Store') {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

function scanPaths(paths, findings) {
  for (const path of paths) {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.size > MAX_TEXT_BYTES) continue;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    scanText(text, path, findings);
  }
}

function main() {
  const args = process.argv.slice(2);
  const staged = args.includes('--staged');
  const dirs = [];
  let canary = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dir') {
      dirs.push(args[i + 1]);
      i += 1;
    } else if (args[i].startsWith('--dir=')) {
      dirs.push(args[i].slice('--dir='.length));
    } else if (args[i] === '--canary') {
      canary = args[i + 1];
      i += 1;
    } else if (args[i].startsWith('--canary=')) {
      canary = args[i].slice('--canary='.length);
    }
  }

  const findings = [];
  let artifactFileCount = 0;

  if (dirs.length > 0) {
    for (const dir of dirs) {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
        console.warn(`  [secret-scan] note: artifact dir not found, skipping: ${dir}`);
        continue;
      }
      const files = filesUnder(dir);
      artifactFileCount += files.length;
      scanPaths(files, findings);
    }
  } else {
    const files = staged ? stagedFiles() : trackedFiles().filter((f) => !shouldSkip(f));
    scanPaths(files, findings);
  }

  if (canary && canary.length > 0) {
    // The trust-boundary canary must never appear in built output: CI sets it
    // on build steps, then asserts absence here.
    const canaryFindings = [];
    const scanCanaryIn = (files) => {
      for (const path of files) {
        let stat;
        try {
          stat = statSync(path);
        } catch {
          continue;
        }
        if (stat.size > MAX_TEXT_BYTES) continue;
        let text;
        try {
          text = readFileSync(path, 'utf8');
        } catch {
          continue;
        }
        if (text.includes(canary)) {
          canaryFindings.push({ path, line: 1, rule: 'canary', match: redact(canary) });
        }
      }
    };
    if (dirs.length > 0) {
      for (const dir of dirs) {
        if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
        scanCanaryIn(filesUnder(dir));
      }
    } else {
      scanCanaryIn(staged ? stagedFiles() : trackedFiles().filter((f) => !shouldSkip(f)));
    }
    findings.push(...canaryFindings);
  }

  if (findings.length > 0) {
    console.error('Secret scan failed — credentials or forbidden values in scanned content:');
    for (const f of findings) {
      console.error(`  ${f.path}:${f.line} [${f.rule}] ${f.match}`);
    }
    if (dirs.length === 0) {
      console.error(
        'If this is a documented synthetic fixture, add the exact path to ALLOWLISTED_PATHS in scripts/secret-scan.mjs — never add a real credential to an allowlist.',
      );
    } else {
      console.error(
        'Artifact scan found credential-shaped content in built output. A secret can only reach ' +
          'an artifact by being embedded at build time — inspect the build wiring, not the scanner.',
      );
    }
    process.exit(1);
  }
  if (dirs.length > 0) {
    console.log(
      `Secret scan clean (${artifactFileCount} artifact file(s) across ${dirs.length} dir(s)${canary ? ', canary verified absent' : ''}).`,
    );
  } else {
    const what = staged ? 'staged additions' : 'tracked files';
    console.log(`Secret scan clean (${what}).`);
  }
}

main();
