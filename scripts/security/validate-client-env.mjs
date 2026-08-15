#!/usr/bin/env node

/**
 * Varve client-build environment guard — fail closed on secret ingress.
 *
 * The website and desktop frontend are public clients: anything compiled into
 * them is recoverable by an end user. This guard makes the build itself
 * refuse to run when a private-credential-class environment variable is
 * present, and validates the values of the deliberately client-safe allowlist.
 *
 * It runs inside the app build scripts (apps/website + apps/desktop
 * package.json), so every CI path (ci.yml, website-deploy.yml, release.yml)
 * and every local build is covered automatically.
 *
 * Design rules (see docs/security/trust-boundaries.md §Client-safe config):
 *
 * 1. THE DENY-LIST IS THE SOURCE OF TRUTH. Naming conventions (PUBLIC_,
 *    VITE_, ASTRO_PUBLIC_) are documentation aids only — a variable is safe
 *    only if it is allowlisted, and forbidden if its name is denied,
 *    regardless of its prefix.
 * 2. Forbidden classes fail the build hard: signing credentials, updater
 *    private keys, backend/service secrets, DNS credentials, and the
 *    PRIVATE_/SIGNING_/DNS_ naming families.
 * 3. One documented exception: the canary VARVE_PRIVATE_TEST_CANARY is
 *    deliberately set by CI on build steps so the post-build artifact scan
 *    can prove the build system never embeds arbitrary environment values.
 *    It carries no credential meaning (see §Canary tests in
 *    docs/security/trust-boundaries.md).
 * 4. Second documented exception: release.yml's Tauri build steps legitimately
 *    hold signing credentials in the process environment (that is their job).
 *    The guard yields there ONLY when VARVE_SIGNING_STEP_ALLOWED=1 is set —
 *    a variable that may appear only in release.yml (enforced by
 *    scripts/security/workflow-policy.mjs), and whose output dist is always
 *    re-scanned by the artifact scan afterwards.
 * 5. Allowlist values are validated when present (URLs, base paths, channel
 *    identifiers); absent values are fine — every client variable has a
 *    safe default in code.
 *
 * Usage:
 *   node scripts/security/validate-client-env.mjs --app website
 *   node scripts/security/validate-client-env.mjs --app desktop
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_PREFIXES = [
  { family: 'signing', prefix: 'APPLE_' },
  { family: 'signing', prefix: 'WINDOWS_SIGNING_' },
  { family: 'signing', prefix: 'AZURE_SIGNING_' },
  { family: 'signing', prefix: 'TAURI_SIGNING_' },
  { family: 'backend', prefix: 'DATABASE_' },
  { family: 'backend', prefix: 'REDIS_' },
  { family: 'backend', prefix: 'STRIPE_' },
  { family: 'backend', prefix: 'OPENAI_' },
  { family: 'backend', prefix: 'ANTHROPIC_' },
  { family: 'backend', prefix: 'SMTP_' },
  { family: 'backend', prefix: 'WEBHOOK_' },
  { family: 'backend', prefix: 'JWT_' },
  { family: 'backend', prefix: 'SENDGRID_' },
  { family: 'backend', prefix: 'OBJECT_STORAGE_' },
  { family: 'backend', prefix: 'GOOGLE_APPLICATION_CREDENTIALS' },
  { family: 'dns', prefix: 'PORKBUN_' },
  { family: 'private', prefix: 'PRIVATE_' },
  { family: 'private', prefix: 'SIGNING_' },
  { family: 'private', prefix: 'DNS_' },
];

const FORBIDDEN_EXACT = new Set([
  // The canonical "never in a client build" list — see
  // docs/security/trust-boundaries.md §Credential matrix.
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DATABASE_PASSWORD',
  'DATABASE_URL',
  'DATABASE_USER',
  'REDIS_PASSWORD',
  'REDIS_URL',
  'PORKBUN_API_KEY',
  'PORKBUN_API_SECRET',
  'PORKBUN_SECRET_API_KEY',
  'GITHUB_PAT',
  'GH_PERSONAL_ACCESS_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TENANT_ID',
  'APPLE_SIGNING_PASSWORD',
  'APPLE_CERTIFICATE_PASSWORD',
  'WINDOWS_SIGNING_PRIVATE_KEY',
  'TAURI_UPDATER_PRIVATE_KEY',
  'TAURI_UPDATER_PRIVATE_KEY_PASSWORD',
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'SMTP_PASSWORD',
  'WEBHOOK_SECRET',
  'JWT_SIGNING_SECRET',
  'JWT_PRIVATE_KEY',
  'EMAIL_PROVIDER_API_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
  'SENDGRID_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);

const TAURI_UPDATER_PLUGIN_CONFIG = 'TAURI_UPDATER_PLUGIN_CONFIG';

function isPublicTauriUpdaterConfig(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return !/(private[_-]?key|password|secret|token|credential)/i.test(JSON.stringify(parsed));
  } catch {
    return false;
  }
}

// The CI canary (see docs/security/trust-boundaries.md §Canary tests).
// Deliberately NOT forbidden: it must be settable on build steps so the
// artifact scan can assert the build never embeds arbitrary env values.
export const PRIVATE_TEST_CANARY = 'VARVE_PRIVATE_TEST_CANARY';

// Documented exception: release.yml's Tauri build steps hold signing
// credentials in the process environment on purpose. The guard yields for the
// signing family only when this exact variable is set; workflow-policy.mjs
// forbids it everywhere except release.yml.
export const SIGNING_STEP_ALLOWED = 'VARVE_SIGNING_STEP_ALLOWED';

const ALLOWED = {
  website: {
    SITE_URL: {
      test: (v) => /^https?:\/\/[^\s/]+\/?(?:\?.*)?$/.test(v),
      hint: 'an absolute http(s) URL, e.g. https://varve.studio',
    },
    SITE_BASE: {
      test: (v) => /^\/[^\s]*$/.test(v),
      hint: "a path starting with '/', e.g. '/' or '/varve'",
    },
    ANALYTICS_DOMAIN: {
      test: (v) => v === '' || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(v),
      hint: "an empty value or a bare hostname (e.g. 'plausible.io')",
    },
  },
  desktop: {
    VITE_BASE_URL: {
      test: (v) => /^\/[^\s]*$/.test(v),
      hint: "a path starting with '/', e.g. '/'",
    },
    VARVE_APP_VERSION: {
      test: (v) => v === '' || /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v),
      hint: 'a semver string (e.g. 0.1.1) or empty',
    },
    VARVE_BUILD_CHANNEL: {
      test: (v) => v === '' || /^[a-z0-9-]+$/.test(v),
      hint: "an identifier like 'dev' or 'stable', or empty",
    },
    VARVE_RELEASE_ID: {
      test: (v) => v === '' || /^[A-Za-z0-9_.-]+$/.test(v),
      hint: 'a release identifier (e.g. v0.1.1) or empty',
    },
    VARVE_GIT_COMMIT: {
      test: (v) => v === '' || /^[0-9a-f]{40}$/i.test(v),
      hint: 'a full 40-character git commit SHA or empty',
    },
    TAURI_DEBUG: {
      test: (v) => v === '' || v === 'true' || v === 'false',
      hint: "'true', 'false' or empty",
    },
    [TAURI_UPDATER_PLUGIN_CONFIG]: {
      test: isPublicTauriUpdaterConfig,
      hint: 'JSON updater metadata without private key or credential fields',
    },
  },
};

// Infrastructure variables present in every CI environment; tolerated (never
// consumed by client code) so the guard stays practical in CI.
const TOLERATED_PREFIXES = [
  'CI',
  'GITHUB_',
  'RUNNER_',
  'ACTIONS_',
  'INPUT_',
  'LFS_',
  'NODE_',
  'PNPM_',
  'COREPACK_',
  'NPM_',
  'DEBIAN_',
  'JAVA_',
  'HOME',
  'PATH',
  'LANG',
  'LC_',
  'TERM',
  'USER',
  'SHELL',
  'HOSTNAME',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'TZ',
  'VITE_',
  'PUBLIC_',
  'ASTRO_',
  'TAURI_',
  'VARVE_',
];

export function classifyApp(arg) {
  if (arg === 'website' || arg === 'desktop') return arg;
  return null;
}

// Dotenv-style file parsing: Vite and Astro load `.env*` files from the app
// root, which never enter process.env and would otherwise bypass the guard.
// Only simple KEY=VALUE lines are parsed; shell interpolation and multiline
// values are intentionally unsupported (they are not used in this repo).
export function parseEnvFile(text) {
  const env = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    env[key] = value;
  }
  return env;
}

/**
 * Audit the on-disk .env files of an app (`.env`, `.env.local`,
 * `.env.production`, `.env.development`) together with the process
 * environment. The guard must not depend on .gitignore alone — these files
 * are untracked but Vite/Astro read them at build time. Returns the
 * accumulated error list (process-env errors are passed in by the caller).
 */
export function auditEnvWithFiles(app, errors) {
  const files = ['.env', '.env.local', '.env.production', '.env.development'];
  for (const file of files) {
    const path = join(process.cwd(), `apps/${app}`, file);
    if (!existsSync(path)) continue;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const fileEnv = parseEnvFile(text);
    const result = auditEnv(app, fileEnv);
    for (const e of result.errors) errors.push(`[${app}/${file}] ${e}`);
  }
  return errors;
}

function isTolerated(name) {
  const lower = name.toLowerCase();
  return TOLERATED_PREFIXES.some((p) => name === p || lower.startsWith(p.toLowerCase()));
}

function isForbiddenPrefix(name) {
  // Tauri injects this exact public updater metadata object into the
  // beforeBuildCommand environment so tauri-plugin-updater can read its
  // endpoints and public key. It is validated through the desktop allowlist;
  // private updater material remains denied by FORBIDDEN_EXACT.
  if (name === TAURI_UPDATER_PLUGIN_CONFIG) return null;
  return FORBIDDEN_PREFIXES.find((f) => name.startsWith(f.prefix)) ?? null;
}

/**
 * Audit a client build environment.
 * Returns { errors, warnings }. `signingStep` (default false) enables the
 * documented release.yml exception: the signing credential family is ignored
 * so the Tauri build step can legitimately hold signing secrets, which the
 * post-build artifact scan then verifies never reached the client output.
 */
export function auditEnv(app, env, signingStep = false) {
  const errors = [];
  const warnings = [];
  const allowed = ALLOWED[app] ?? {};
  const forbiddenByFamily = new Map();

  for (const name of Object.keys(env)) {
    if (name === PRIVATE_TEST_CANARY) continue;
    const prefixHit = isForbiddenPrefix(name);
    const exactHit = FORBIDDEN_EXACT.has(name);
    if (prefixHit) {
      if (signingStep && prefixHit.family === 'signing') continue;
      if (!forbiddenByFamily.has(prefixHit.family)) {
        forbiddenByFamily.set(prefixHit.family, []);
      }
      forbiddenByFamily.get(prefixHit.family).push(name);
      continue;
    }
    if (exactHit) {
      if (signingStep && (name.startsWith('APPLE_') || name.startsWith('AZURE_'))) continue;
      errors.push(`${name} is a private credential and must never be present in a client build`);
      continue;
    }
    if (Object.hasOwn(allowed, name)) {
      const value = env[name];
      if (!allowed[name].test(value)) {
        errors.push(`${name}="${value}" is invalid — expected ${allowed[name].hint}`);
      }
      continue;
    }
    if (!isTolerated(name)) {
      warnings.push(`${name} is not in the client-safe allowlist and was not consumed`);
    }
  }

  for (const [family, names] of forbiddenByFamily) {
    errors.push(
      `forbidden credential-family variable(s) of class ${family} present in the ${app} build environment: ${names.join(', ')}`,
    );
  }

  return { errors, warnings };
}

function parseArgs(args) {
  let app = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--app') {
      app = classifyApp(args[i + 1]);
      i += 1;
    } else if (arg.startsWith('--app=')) {
      app = classifyApp(arg.slice('--app='.length));
    } else if (classifyApp(arg)) {
      app = classifyApp(arg);
    }
  }
  return app;
}

function main() {
  const app = parseArgs(process.argv.slice(2));
  if (!app) {
    console.error('Usage: node scripts/security/validate-client-env.mjs --app website|desktop');
    process.exit(2);
  }

  const signingStep = process.env[SIGNING_STEP_ALLOWED] === '1';
  const { errors, warnings } = auditEnv(app, process.env, signingStep);
  // Untracked .env files are read by Vite/Astro at build time and never
  // enter process.env — audit them explicitly so .gitignore is not the
  // only safeguard (see docs/security/trust-boundaries.md §Client-safe config).
  auditEnvWithFiles(app, errors);
  if (warnings.length > 0) {
    if (process.env.CI) {
      for (const w of warnings) console.warn(`  [env-guard] warning: ${w}`);
    } else {
      console.warn(
        `  [env-guard] note: ${warnings.length} environment variable(s) are not in the client-safe ` +
          'allowlist and were not consumed (details shown when CI=1)',
      );
    }
  }
  for (const e of errors) console.error(`  [env-guard] ${e}`);

  if (errors.length > 0) {
    console.error(
      `Client environment guard FAILED for ${app}. A private credential was present in the ` +
        'build environment, or a client-safe value was invalid. Fix the environment, not the guard.',
    );
    process.exit(1);
  }
  const allowedCount = Object.keys(ALLOWED[app]).length;
  console.log(
    `Client environment guard OK (${app}, ${allowedCount} client-safe variables allowlisted).`,
  );
}

if (process.argv[1]?.endsWith('validate-client-env.mjs')) {
  main();
}
