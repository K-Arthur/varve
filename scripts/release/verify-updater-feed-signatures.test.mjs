#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, webcrypto as crypto, randomBytes } from 'node:crypto';
/**
 * Unit tests for verify-updater-feed-signatures.mjs.
 *
 * Generates an Ed25519 keypair, constructs minisign-format signatures
 * (both "ED" prehashed and "Ed" raw), writes them into a feed fixture,
 * and runs the verifier.  Tests both the happy path and failure modes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tmpDir = mkdtempSync('/tmp/updater-feed-test-');
const fixtureDir = join(tmpDir, 'fixture');
const releaseDir = join(fixtureDir, 'dist', 'release');
mkdirSync(releaseDir, { recursive: true });

function encodeB64(buf) {
  return Buffer.from(buf).toString('base64');
}

// Generate Ed25519 keypair
const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]);
const rawPk = Buffer.from(await crypto.subtle.exportKey('raw', publicKey));
// Construct minisign public key string
const keyIdBytes = randomBytes(8);
const algoBytes = Buffer.from('Ed');
const pubKeyBox = Buffer.concat([algoBytes, keyIdBytes, rawPk]);
const pubKeyStr = `untrusted comment: minisign public key: ${keyIdBytes.toString('hex')}\n${encodeB64(pubKeyBox)}\n`;

// Write pubkey file for the verifier to read (monkey-patched into tauri.conf.json)
const pubKeyFile = join(fixtureDir, 'pubkey.minisign');
writeFileSync(pubKeyFile, pubKeyStr);

// tauri.conf.json fixture (pubkey is base64 of the full pubkey file text)
const confPubKey = encodeB64(Buffer.from(pubKeyStr));
writeFileSync(
  join(fixtureDir, 'tauri.conf.json'),
  JSON.stringify({
    plugins: {
      updater: { pubkey: confPubKey, endpoints: ['https://varve.studio/updates/stable.json'] },
    },
  }),
);

// ── Helper: sign data in minisign format ───────────────────────────────────

async function minisignSign(data, sk, keyId, comment, prehash) {
  const effective = prehash ? createHash('blake2b512').update(data).digest() : data;
  const sigBytes = Buffer.from(await crypto.subtle.sign('Ed25519', sk, effective));
  const sigBox = Buffer.concat([Buffer.from(prehash ? 'ED' : 'Ed'), keyId, sigBytes]);
  const commentLine = `trusted comment: ${comment}`;
  // minisign signs sig || comment_text (without the "trusted comment: " prefix)
  const globalMsg = Buffer.concat([sigBytes, Buffer.from(comment, 'utf8')]);
  const globalSig = Buffer.from(await crypto.subtle.sign('Ed25519', sk, globalMsg));
  return {
    untrustedComment: 'untrusted comment: test signature',
    sigBoxB64: encodeB64(sigBox),
    commentLine,
    globalSigB64: encodeB64(globalSig),
  };
}

function toFeedSignature(signResult) {
  return Buffer.from(
    `${signResult.untrustedComment}\n${signResult.sigBoxB64}\n${signResult.commentLine}\n${signResult.globalSigB64}\n`,
  ).toString('base64');
}

// ── Test 1: ED (prehashed) — passes ────────────────────────────────────────

{
  const artifact = randomBytes(4096);
  const filename = 'Varve-test-linux-x86_64.AppImage';
  writeFileSync(join(releaseDir, filename), artifact);

  const sig = await minisignSign(
    artifact,
    privateKey,
    keyIdBytes,
    `timestamp:1700000000\tfile:${filename}`,
    true,
  );

  const feed = {
    version: '0.0.0',
    platforms: {
      'linux-x86_64': {
        url: `https://github.com/K-Arthur/varve/releases/download/v0.0.0/${filename}`,
        signature: toFeedSignature(sig),
      },
    },
  };
  writeFileSync(join(releaseDir, 'varve-update-stable.json'), JSON.stringify(feed));

  // Override tauri.conf.json in the repo root (the script reads it from there)
  const confPath = join(fixtureDir, 'tauri.conf.json');
  const feedPath = join(releaseDir, 'varve-update-stable.json');

  try {
    const out = execFileSync(
      'node',
      [
        join(process.cwd(), 'scripts/release/verify-updater-feed-signatures.mjs'),
        '--feed',
        feedPath,
        '--release-dir',
        releaseDir,
        '--tauri-conf',
        confPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 },
    );
    console.log(`TEST 1 PASS: ED prehashed signature verified\n${out}`);
  } catch (e) {
    console.error(`TEST 1 FAIL: ED prehashed verification failed\n${e.stdout}\n${e.stderr}`);
    process.exitCode = 1;
  }
}

// ── Test 2: Ed (raw, non-prehashed) — passes ───────────────────────────────

{
  const artifact = randomBytes(4096);
  const filename = 'Varve-test-windows-x86_64.exe';
  writeFileSync(join(releaseDir, filename), artifact);

  const sig = await minisignSign(
    artifact,
    privateKey,
    keyIdBytes,
    `timestamp:1700000000\tfile:${filename}`,
    false,
  );

  const feed = {
    version: '0.0.0',
    platforms: {
      'windows-x86_64': {
        url: `https://github.com/K-Arthur/varve/releases/download/v0.0.0/${filename}`,
        signature: toFeedSignature(sig),
      },
    },
  };
  writeFileSync(join(releaseDir, 'varve-update-stable.json'), JSON.stringify(feed));

  const confPath = join(fixtureDir, 'tauri.conf.json');
  const feedPath = join(releaseDir, 'varve-update-stable.json');

  try {
    const out = execFileSync(
      'node',
      [
        join(process.cwd(), 'scripts/release/verify-updater-feed-signatures.mjs'),
        '--feed',
        feedPath,
        '--release-dir',
        releaseDir,
        '--tauri-conf',
        confPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 },
    );
    console.log(`TEST 2 PASS: Ed raw signature verified\n${out}`);
  } catch (e) {
    console.error(`TEST 2 FAIL: Ed raw verification failed\n${e.stdout}\n${e.stderr}`);
    process.exitCode = 1;
  }
}

// ── Test 3: Tampered artifact — fails ───────────────────────────────────────

{
  const artifact = randomBytes(4096);
  const filename = 'Varve-test-tampered.exe';
  writeFileSync(join(releaseDir, filename), artifact);

  const sig = await minisignSign(
    artifact,
    privateKey,
    keyIdBytes,
    `timestamp:1700000000\tfile:${filename}`,
    true,
  );

  // Tamper with the artifact after signing
  const tampered = randomBytes(4096);
  writeFileSync(join(releaseDir, filename), tampered);

  const feed = {
    version: '0.0.0',
    platforms: {
      'windows-x86_64': {
        url: `https://github.com/K-Arthur/varve/releases/download/v0.0.0/${filename}`,
        signature: toFeedSignature(sig),
      },
    },
  };
  writeFileSync(join(releaseDir, 'varve-update-stable.json'), JSON.stringify(feed));

  const confPath = join(fixtureDir, 'tauri.conf.json');
  const feedPath = join(releaseDir, 'varve-update-stable.json');

  try {
    execFileSync(
      'node',
      [
        join(process.cwd(), 'scripts/release/verify-updater-feed-signatures.mjs'),
        '--feed',
        feedPath,
        '--release-dir',
        releaseDir,
        '--tauri-conf',
        confPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 },
    );
    console.error('TEST 3 FAIL: tampered artifact should have been rejected');
    process.exitCode = 1;
  } catch (e) {
    if (
      e.status === 1 &&
      (e.stderr.includes('inner Ed25519 signature invalid') ||
        e.message.includes('inner Ed25519 signature invalid'))
    ) {
      console.log(`TEST 3 PASS: tampered artifact correctly rejected\n${e.stderr}`);
    } else {
      console.error(`TEST 3 FAIL: unexpected error\n${e.stderr || e.message}`);
      process.exitCode = 1;
    }
  }
}

// ── Test 4: Non-HTTPS URL — fails ──────────────────────────────────────────

{
  const feed = {
    version: '0.0.0',
    platforms: {
      'linux-x86_64': {
        url: 'http://example.com/file.AppImage',
        signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IHRlc3Q=\nAAAA\ntrusted comment: test\nAAAA\n',
      },
    },
  };
  writeFileSync(join(releaseDir, 'varve-update-stable.json'), JSON.stringify(feed));

  const confPath = join(fixtureDir, 'tauri.conf.json');
  const feedPath = join(releaseDir, 'varve-update-stable.json');

  try {
    execFileSync(
      'node',
      [
        join(process.cwd(), 'scripts/release/verify-updater-feed-signatures.mjs'),
        '--feed',
        feedPath,
        '--release-dir',
        releaseDir,
        '--tauri-conf',
        confPath,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 },
    );
    console.error('TEST 4 FAIL: non-HTTPS URL should have been rejected');
    process.exitCode = 1;
  } catch (e) {
    if (e.status === 1 && (e.stderr.includes('not HTTPS') || e.message.includes('not HTTPS'))) {
      console.log(`TEST 4 PASS: non-HTTPS URL correctly rejected\n${e.stderr}`);
    } else {
      console.error(`TEST 4 FAIL: unexpected error\n${e.stderr || e.message}`);
      process.exitCode = 1;
    }
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────
rmSync(tmpDir, { recursive: true, force: true });
console.log('\nAll tests completed.');
if (process.exitCode) process.exit(1);
