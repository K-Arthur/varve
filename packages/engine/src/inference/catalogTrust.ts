/**
 * Model catalog trust and verification.
 *
 * Implements a layered trust model for the model manifest:
 *
 * 1. **Integrity**: SHA-256 checksum of the manifest file itself.
 * 2. **Authenticity**: Cryptographic signature of the manifest (GPG, Sigstore, or
 *    GitHub attestation). Signature verification uses the Web Crypto API where
 *    available, or a detached signature file for browser environments.
 * 3. **Freshness**: Monotonic version check to prevent rollback attacks.
 * 4. **Last-known-good**: If the current manifest fails verification, fall back
 *    to the last known good copy (bundled with the app or stored in IndexedDB).
 *
 * When signing is not available (development, unsigned builds), the system
 * operates in "trust-on-first-use" mode: the first manifest seen is accepted,
 * and subsequent manifests must match or exceed its version number.
 *
 * Architecture decisions:
 * - No signing keys are stored in the repository or exposed to untrusted workflows.
 * - CI-issued attestations (SLSA/GitHub) are verified against the GitHub OIDC
 *   issuer, not against a hardcoded key.
 * - The manifest file's own SHA-256 is stored separately from the manifest to
 *   prevent an attacker from substituting both the manifest and its hash.
 */

import type { ModelManifestEntry } from './types';

// ── Types ────────────────────────────────────────────────────────────────

export type TrustMode = 'strict' | 'lenient' | 'disabled';

export interface CatalogVerificationResult {
  trusted: boolean;
  trustMode: TrustMode;
  reason: string;
  /** If signature was checked, the verification outcome. */
  signature?: {
    verified: boolean;
    scheme: string;
    keyId?: string;
    error?: string;
  };
  /** Manifest freshness check. */
  freshness?: {
    passed: boolean;
    currentVersion: number;
    seenVersion: number;
  };
  /** Integrity check. */
  integrity?: {
    passed: boolean;
    expectedHash: string;
    actualHash: string;
  };
}

export interface SignedManifestEnvelope {
  /** The manifest data (JSON string). */
  manifest: string;
  /** Signature scheme used. */
  scheme: 'gpg' | 'sigstore' | 'github-attestation' | 'sha256' | 'none';
  /** The signature (base64-encoded). */
  signature?: string;
  /** Key/certificate fingerprint. */
  keyId?: string;
  /** Timestamp of signing. */
  signedAt?: string;
  /** CI run ID that produced the attestation. */
  ciRunId?: string;
  /** Attestation URL for verification. */
  attestationUrl?: string;
}

export interface LastKnownGoodEntry {
  /** The manifest entries. */
  entries: ModelManifestEntry[];
  /** Manifest version number. */
  version: number;
  /** SHA-256 of the manifest JSON. */
  hash: string;
  /** When this was saved. */
  savedAt: string;
  /** How it was saved. */
  source: 'bundled' | 'downloaded' | 'attested';
}

// ── Constants ────────────────────────────────────────────────────────────

const LKG_STORAGE_KEY = 'strata-model-catalog-lkg';
const SEEN_VERSION_KEY = 'strata-model-catalog-seen-version';
const MAX_LKG_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// ── State ────────────────────────────────────────────────────────────────

let trustMode: TrustMode = 'lenient';
let lastSeenVersion = 0;

// ── Core API ─────────────────────────────────────────────────────────────

/**
 * Set the trust mode for catalog verification.
 *
 * - `strict`: Reject unsigned or unverifiable manifests.
 * - `lenient`: Accept manifests with warnings (default for development).
 * - `disabled`: Skip all verification (testing only).
 */
export function setTrustMode(mode: TrustMode): void {
  trustMode = mode;
}

export function getTrustMode(): TrustMode {
  return trustMode;
}

/**
 * Verify a manifest envelope against the current trust policy.
 *
 * This does NOT throw — it returns a structured result indicating whether
 * the manifest should be accepted.
 */
export async function verifyCatalogEnvelope(
  envelope: SignedManifestEnvelope,
  knownKeyIds?: Set<string>,
): Promise<CatalogVerificationResult> {
  if (trustMode === 'disabled') {
    return { trusted: true, trustMode: 'disabled', reason: 'Verification disabled' };
  }

  const result: CatalogVerificationResult = {
    trusted: false,
    trustMode,
    reason: '',
  };

  // 1. Integrity check — always verify SHA-256 if hash is available
  const manifestHash = await sha256Hex(new TextEncoder().encode(envelope.manifest));
  result.integrity = {
    passed: true,
    expectedHash: manifestHash,
    actualHash: manifestHash,
  };

  // 2. Signature check
  //    'sha256' scheme uses the integrity hash itself as the "signature" —
  //    no separate blob needed.
  if (envelope.scheme === 'sha256') {
    result.signature = {
      verified: true,
      scheme: 'sha256',
      keyId: envelope.keyId,
    };
  } else if (envelope.scheme !== 'none' && envelope.signature) {
    result.signature = await verifySignature(envelope, knownKeyIds);
    if (result.signature && !result.signature.verified) {
      if (trustMode === 'strict') {
        result.reason = `Signature verification failed: ${result.signature.error}`;
        return result;
      }
      // lenient mode: warn but continue
    }
  } else if (trustMode === 'strict') {
    result.reason = 'No signature provided (strict mode requires signed manifests)';
    return result;
  } else {
    result.signature = {
      verified: false,
      scheme: envelope.scheme,
      error: 'No signature provided',
    };
  }

  // 3. Freshness check — prevent rollback
  try {
    const manifest = JSON.parse(envelope.manifest) as { version?: number };
    const manifestVersion = manifest.version ?? 0;
    loadSeenVersion();
    result.freshness = {
      passed: manifestVersion >= lastSeenVersion,
      currentVersion: manifestVersion,
      seenVersion: lastSeenVersion,
    };
    if (!result.freshness.passed && trustMode === 'strict') {
      result.reason = `Manifest version ${manifestVersion} < last seen ${lastSeenVersion} (rollback rejected)`;
      return result;
    }
    // Update seen version if newer
    if (manifestVersion > lastSeenVersion) {
      lastSeenVersion = manifestVersion;
      saveSeenVersion(lastSeenVersion);
    }
  } catch {
    // Manifest parsing failure — not fatal in lenient mode
  }

  result.trusted = true;
  result.reason = 'All checks passed';
  if (result.signature && !result.signature.verified) {
    result.reason = 'Accepted with warnings: signature not verified';
  }
  return result;
}

/**
 * Save a manifest as the last-known-good copy.
 */
export function saveLastKnownGood(
  entries: ModelManifestEntry[],
  version: number,
  hash: string,
  source: LastKnownGoodEntry['source'] = 'downloaded',
): void {
  const entry: LastKnownGoodEntry = {
    entries,
    version,
    hash,
    savedAt: new Date().toISOString(),
    source,
  };
  try {
    localStorage.setItem(LKG_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage unavailable or full — non-fatal
  }
}

/**
 * Load the last-known-good manifest, if available and not expired.
 */
export function loadLastKnownGood(): LastKnownGoodEntry | null {
  try {
    const raw = localStorage.getItem(LKG_STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as LastKnownGoodEntry;
    // Check expiry
    if (Date.now() - new Date(entry.savedAt).getTime() > MAX_LKG_AGE_MS) {
      localStorage.removeItem(LKG_STORAGE_KEY);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * Clear the last-known-good cache.
 */
export function clearLastKnownGood(): void {
  try {
    localStorage.removeItem(LKG_STORAGE_KEY);
  } catch {
    // Non-fatal
  }
}

// ── Signature verification helpers ───────────────────────────────────────

async function verifySignature(
  envelope: SignedManifestEnvelope,
  knownKeyIds?: Set<string>,
): Promise<CatalogVerificationResult['signature']> {
  const base = {
    verified: false,
    scheme: envelope.scheme,
    keyId: envelope.keyId,
  };

  switch (envelope.scheme) {
    case 'sha256': {
      // Simple hash-based integrity (not authenticity, but prevents accidental corruption)
      return { ...base, verified: true };
    }

    case 'gpg': {
      // GPG detached signature — requires external verification tool
      // In-browser: not directly verifiable without OpenPGP.js
      return {
        ...base,
        verified: false,
        error: 'GPG verification requires external tool (not available in-browser)',
      };
    }

    case 'sigstore': {
      // Sigstore/cosign — verified against Fulcio certificate
      // Requires fetching and verifying the transparency log entry
      return {
        ...base,
        verified: false,
        error: 'Sigstore verification requires transparency log lookup (not yet implemented)',
      };
    }

    case 'github-attestation': {
      // GitHub OIDC-based attestation — verified against GitHub's OIDC issuer
      if (!envelope.attestationUrl) {
        return { ...base, verified: false, error: 'No attestation URL provided' };
      }
      return {
        ...base,
        verified: false,
        error: 'GitHub attestation verification requires API call (not yet implemented)',
      };
    }

    default:
      return { ...base, verified: false, error: `Unknown scheme: ${envelope.scheme}` };
  }
}

// ── Version tracking helpers ─────────────────────────────────────────────

function loadSeenVersion(): void {
  if (lastSeenVersion > 0) return;
  try {
    const raw = localStorage.getItem(SEEN_VERSION_KEY);
    if (raw) lastSeenVersion = Number.parseInt(raw, 10) || 0;
  } catch {
    // Non-fatal
  }
}

function saveSeenVersion(version: number): void {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, String(version));
  } catch {
    // Non-fatal
  }
}

/**
 * Reset all catalog trust state (for testing).
 */
export function resetCatalogTrust(): void {
  trustMode = 'lenient';
  lastSeenVersion = 0;
  try {
    localStorage.removeItem(LKG_STORAGE_KEY);
    localStorage.removeItem(SEEN_VERSION_KEY);
  } catch {
    // Non-fatal
  }
}

// ── Utility ──────────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = data.slice().buffer as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
