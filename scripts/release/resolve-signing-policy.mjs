#!/usr/bin/env node
/**
 * Resolve the signing policy for the current release run and print it as JSON.
 *
 * Reads ONLY presence booleans from the environment (P_<SECRET> = 'true'/'false'),
 * plus CHANNEL, EXPECT_SIGNED and PLATFORMS (space-separated platforms that
 * this run will actually build; default: linux windows macos). Real secret
 * values never reach this script.
 *
 * Exit codes:
 *   0 — policy resolved (all built platforms either 'signed' or 'unsigned')
 *   1 — a platform that REQUIRES signing is missing credentials (fail-closed).
 *       Callers must stop BEFORE the platform build starts.
 *
 * Usage (called from release.yml signing-preflight):
 *   CHANNEL=stable EXPECT_SIGNED=false PLATFORMS="linux windows macos" \
 *   P_APPLE_CERTIFICATE=true P_AZURE_SIGNING_CLIENT_ID=true ... \
 *   node scripts/release/resolve-signing-policy.mjs
 *
 * Prints: {"windows":"signed","macos":"signed","linux":"unsigned"}
 */
import { platformSecretsPresent, resolveSigningPolicy } from './signing-policy.mjs';

const channel = process.env.CHANNEL ?? 'prerelease';
const expectSigned = process.env.EXPECT_SIGNED === 'true';
const platforms = (process.env.PLATFORMS ?? 'linux windows macos').split(/\s+/).filter(Boolean);

const presence = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('P_')) presence[key.slice(2)] = value === 'true';
}

const policy = resolveSigningPolicy({
  channel,
  expectSigned,
  secretPresence: { windows: presence, macos: presence },
  platforms,
});

let failed = false;
for (const platform of ['windows', 'macos']) {
  if (!platforms.includes(platform)) continue;
  if (policy[platform] === 'fail-closed') {
    failed = true;
    const { missing } = platformSecretsPresent(platform, presence);
    process.stderr.write(
      `::error::${platform}: signing REQUIRED (channel=${channel}, expectSigned=${expectSigned}) ` +
        `but credentials are missing: ${missing.join(', ') || '(none recognized)'}\n`,
    );
  }
}

process.stdout.write(`${JSON.stringify(policy)}\n`);
process.exit(failed ? 1 : 0);
