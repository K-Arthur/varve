#!/usr/bin/env node
/**
 * Signing policy: the single source of truth for Varve's code-signing rules.
 *
 * Four different security systems are deliberately kept separate:
 *
 *   A. Windows Authenticode (Artifact Signing / certificates)
 *   B. Apple Developer ID + notarization + stapling
 *   C. Linux artifact trust (checksums, SBOM, GitHub attestations, optional GPG)
 *   D. Tauri updater signing (minisign keys — NOT used by Varve, see
 *      docs/release/update-strategy.md; keys are separate when it lands)
 *
 * A `.sig` for the updater is not Authenticode. A checksum is not notarization.
 * A GitHub attestation is not a trusted Windows publisher. This module never
 * conflates them.
 *
 * Policy (encoded here, enforced by scripts/release/verify-release-trust.mjs):
 *
 *   - channel == stable: Windows artifacts MUST carry a valid Authenticode
 *     signature when a Windows build is requested; macOS artifacts MUST be
 *     Developer ID signed, notarized AND stapled. Missing credentials fail in
 *     the signing preflight BEFORE the build starts.
 *   - channel == prerelease: unsigned artifacts are allowed ONLY when
 *     RELEASE_EXPECT_SIGNED is not 'true'. With RELEASE_EXPECT_SIGNED=true the
 *     same requirements as stable apply.
 *   - `signed: true` in release metadata is derived ONLY from post-build
 *     cryptographic verification reports, never from the existence of a
 *     secret.
 *   - A release never falls back from "signed" to "unsigned" automatically.
 *
 * Nothing in this file reads real secret values — callers pass PRESENCE
 * booleans only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CHANNEL_STABLE = 'stable';
export const MODE_SIGNED = 'signed';
export const MODE_UNSIGNED = 'unsigned';
export const MODE_FAIL_CLOSED = 'fail-closed';

/**
 * Secrets whose presence is required before a SIGNED Windows build may start.
 * AZURE_SIGNING_ACCOUNT / _PROFILE / _ENDPOINT are non-secret configuration
 * (stored as repository variables), listed here because a signed build is
 * impossible without them.
 */
export const WINDOWS_SIGNING_SECRETS = [
  'AZURE_SIGNING_CLIENT_ID',
  'AZURE_SIGNING_CLIENT_SECRET',
  'AZURE_SIGNING_TENANT_ID',
  'AZURE_SIGNING_ACCOUNT',
  'AZURE_SIGNING_PROFILE',
  'AZURE_SIGNING_ENDPOINT',
];

/** Secrets required to sign (and notarize) a macOS build. */
export const MACOS_SIGNING_SECRETS = [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_SIGNING_IDENTITY',
];

/**
 * Notarization auth is either the App Store Connect API key trio (preferred:
 * scoped, revocable, no account password) or the Apple ID + app-specific
 * password pair. Either set must be complete.
 */
export const MACOS_NOTARIZATION_API_KEY = [
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_P8_BASE64',
];
export const MACOS_NOTARIZATION_APPLE_ID = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'];

export function missingSecrets(presence, required) {
  return required.filter((name) => presence[name] !== true);
}

export function notarizationAuthPresent(presence) {
  const apiKeyMissing = missingSecrets(presence, MACOS_NOTARIZATION_API_KEY);
  const appleIdMissing = missingSecrets(presence, MACOS_NOTARIZATION_APPLE_ID);
  if (apiKeyMissing.length === 0) return { ok: true, method: 'api-key' };
  if (appleIdMissing.length === 0) return { ok: true, method: 'apple-id' };
  return {
    ok: false,
    method: null,
    missingApiKey: apiKeyMissing,
    missingAppleId: appleIdMissing,
  };
}

export function platformSecretsPresent(platform, presence) {
  if (platform === 'windows') {
    return {
      complete: missingSecrets(presence, WINDOWS_SIGNING_SECRETS).length === 0,
      missing: missingSecrets(presence, WINDOWS_SIGNING_SECRETS),
    };
  }
  if (platform === 'macos') {
    const cert = missingSecrets(presence, MACOS_SIGNING_SECRETS);
    const notarization = notarizationAuthPresent(presence);
    const missing = [...cert, ...(notarization.ok ? [] : notarization.missingApiKey)];
    return { complete: cert.length === 0 && notarization.ok, missing };
  }
  return { complete: true, missing: [] };
}

/**
 * Resolve the signing mode for one platform.
 *
 * @param {object} options
 * @param {string} options.platform 'windows' | 'macos' | 'linux'
 * @param {string} options.channel 'stable' | prerelease channel id
 * @param {boolean} options.expectSigned RELEASE_EXPECT_SIGNED == 'true'
 * @param {boolean} options.secretsComplete presence check result
 * @returns {string} MODE_SIGNED | MODE_UNSIGNED | MODE_FAIL_CLOSED
 */
export function resolveSigningMode({ platform, channel, expectSigned, secretsComplete }) {
  if (platform === 'linux') return MODE_UNSIGNED; // checksums + attestations, never a cert
  const signingRequired = channel === CHANNEL_STABLE || expectSigned === true;
  if (!signingRequired) return MODE_UNSIGNED;
  return secretsComplete ? MODE_SIGNED : MODE_FAIL_CLOSED;
}

/**
 * Resolve the policy for all platforms at once.
 * @returns {Record<string, string>} platform -> mode
 */
export function resolveSigningPolicy({
  channel,
  expectSigned,
  secretPresence,
  platforms = ['linux', 'windows', 'macos'],
}) {
  const policy = {};
  for (const platform of platforms) {
    const presence = secretPresence[platform] ?? {};
    const { complete } = platformSecretsPresent(platform, presence);
    policy[platform] = resolveSigningMode({
      platform,
      channel,
      expectSigned,
      secretsComplete: complete,
    });
  }
  return policy;
}

/**
 * Normalize a platform verification report into the manifest's signing block.
 *
 * The report must have been produced by scripts/release/verify-windows-signature.ps1
 * or scripts/release/verify-macos-signature.sh against the actual artifact
 * bytes — it is never synthesized from secret presence.
 *
 * @returns {object} the per-platform signing state, or null if the report is
 *   structurally unusable
 */
export function signingStateFromReport({ platform, report }) {
  if (!report || typeof report !== 'object' || report.platform !== platform) return null;
  if (platform === 'windows') {
    return {
      mode: report.signed ? MODE_SIGNED : MODE_UNSIGNED,
      signed: report.signed === true,
      verification: report.verification ?? (report.signed ? 'unknown' : 'not-signed'),
      publisher: report.publisher ?? null,
      timestamped: report.timestamped === true,
      digestAlgorithm: report.digestAlgorithm ?? null,
      innerExecutableSigned: report.innerExecutableSigned === true,
      files: Array.isArray(report.files) ? report.files.map((f) => f.filename) : [],
      verifiedAt: report.checkedAt ?? null,
    };
  }
  if (platform === 'macos') {
    return {
      mode: report.signed ? MODE_SIGNED : MODE_UNSIGNED,
      signed: report.signed === true,
      notarized: report.notarized === true,
      stapled: report.stapled === true,
      hardenedRuntime: report.hardenedRuntime === true,
      teamId: report.teamId ?? null,
      publisher: report.publisher ?? null,
      verifiedAt: report.checkedAt ?? null,
    };
  }
  return null;
}

/**
 * Enforce the release trust policy against the merged manifest and the
 * per-platform verification reports. This is the fail-closed gate: a stable
 * release whose artifacts do not verify MUST NOT pass, and an artifact must
 * never be labelled signed unless its report says so.
 *
 * @param {object} options
 * @param {string} options.channel 'stable' | prerelease channel id
 * @param {boolean} options.expectSigned
 * @param {object} options.manifest merged release-manifest.json
 * @param {Record<string, object|null>} options.reports platform -> report (or null)
 * @param {string|null} [options.expectedPublisher] optional substring that the
 *   verified Windows publisher must contain (e.g. a legal name or CN)
 * @returns {{ problems: string[], notes: string[] }}
 */
export function verifyReleaseTrust({
  channel,
  expectSigned,
  manifest,
  reports,
  expectedPublisher = null,
}) {
  const problems = [];
  const notes = [];
  const platforms = [...new Set((manifest.artifacts ?? []).map((a) => a.os))];
  const signingRequired = channel === CHANNEL_STABLE || expectSigned === true;

  notes.push(`Channel: ${channel}. ${signingRequired ? 'Signing REQUIRED.' : 'Signing optional.'}`);

  for (const platform of platforms) {
    if (platform === 'linux') {
      notes.push(
        'Linux: trust via SHA-256 checksums + SBOM + GitHub attestation (no platform code-signing certificate).',
      );
      continue;
    }
    const report = reports[platform] ?? null;
    const state = report ? signingStateFromReport({ platform, report }) : null;

    if (signingRequired) {
      if (!state?.signed) {
        problems.push(
          `${platform}: signing required (channel=${channel}, expectSigned=${expectSigned}) but the ` +
            `verification report ${report ? 'says unsigned' : 'is missing'}. Refusing to release.`,
        );
        continue;
      }
      if (platform === 'windows') {
        if (state.verification !== 'valid') {
          problems.push(
            `windows: report says signed but verification='${state.verification}'. Refusing.`,
          );
        }
        if (!state.timestamped) {
          notes.push(
            'windows: signature present but not timestamped — signatures may expire with the certificate.',
          );
        }
        if (expectedPublisher && state.publisher && !state.publisher.includes(expectedPublisher)) {
          problems.push(
            `windows: verified publisher '${state.publisher}' does not contain expected '${expectedPublisher}'. Refusing.`,
          );
        }
        if (!state.innerExecutableSigned) {
          notes.push(
            'windows: NSIS installer is signed; the executable embedded in the installer is NOT ' +
              '(Tauri NSIS limitation). Installed-app verification reports this honestly.',
          );
        }
      }
      if (platform === 'macos') {
        if (!state.notarized) {
          problems.push(
            'macos: Developer ID signature exists but notarization did not verify. Refusing.',
          );
        }
        if (!state.stapled) {
          problems.push('macos: notarization ticket is not stapled to the artifact. Refusing.');
        }
        if (!state.hardenedRuntime) {
          problems.push('macos: hardened runtime flag missing from the signature. Refusing.');
        }
        if (!state.teamId) {
          problems.push('macos: Team ID could not be read from the signature. Refusing.');
        }
      }
      notes.push(
        `${platform}: signed and verified (${new Date(state.verifiedAt ?? Date.now()).toISOString()}).`,
      );
    } else if (state?.signed) {
      // Signing was not required, but the build did sign: the label must still
      // match the evidence.
      if (state.verification !== 'valid' && platform === 'windows') {
        problems.push(
          `windows: manifest would label signed but verification='${state.verification}'. Refusing.`,
        );
      }
      if (platform === 'macos' && (!state.notarized || !state.stapled)) {
        problems.push(
          'macos: artifact claims signed but notarized/stapled did not verify. ' +
            'A signed-but-not-notarized app is worse than an honestly unsigned one.',
        );
      }
    }
  }

  const claimedSigned = manifest.signed === true;
  const evidenceSigned = platforms.some((p) => {
    const r = reports[p];
    return r ? r.signed === true : false;
  });
  if (claimedSigned && !evidenceSigned) {
    problems.push(
      'Manifest claims signed=true but no platform verification report confirms a signature. ' +
        'Signedness must come from cryptographic verification, never from intent.',
    );
  }
  if (evidenceSigned && !claimedSigned) {
    // Evidence exists but the manifest has not been updated — a merge-order bug.
    problems.push(
      'Verification reports confirm signatures but manifest.signed is not true. ' +
        'Run merge-manifests with --reports-dir before publishing.',
    );
  }
  if (manifest.notarized === true && reports.macos?.notarized !== true) {
    problems.push(
      'Manifest claims notarized=true but the macOS report does not confirm notarization. ' +
        'Notarization claims must come from spctl/stapler verification.',
    );
  }

  return { problems, notes };
}

/**
 * Locate signing-report-*.json files under a directory tree.
 * @returns {Array<{platform: string, path: string}>}
 */
export function findSigningReports(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^signing-report-([a-z]+)\.json$/.test(entry.name)) {
        out.push({ platform: entry.name.match(/^signing-report-([a-z]+)\.json$/)[1], path: full });
      }
    }
  };
  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) walk(dir);
  return out;
}

export function readSigningReports(dir) {
  const reports = {};
  for (const found of findSigningReports(dir)) {
    try {
      reports[found.platform] = JSON.parse(readFileSync(found.path, 'utf-8'));
    } catch (err) {
      reports[found.platform] = {
        platform: found.platform,
        signed: false,
        error: `unreadable report ${found.path}: ${err.message}`,
      };
    }
  }
  return reports;
}
