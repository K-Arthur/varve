#!/usr/bin/env node
import { createHash, webcrypto as crypto } from 'node:crypto';
/**
 * Verify every entry in the Tauri updater feed against the shipped public key
 * and the on-disk artifacts.  Implements the exact verification chain from:
 *
 *   tauri-plugin-updater 2.10.1  →  minisign-verify 0.2.5
 *
 * Algorithm:
 *   1. Decode the minisign pubkey embedded in tauri.conf.json.
 *   2. For each platform entry in the feed JSON:
 *      a. Base64-decode the signature field (the feed stores base64 of the
 *         .sig file content).
 *      b. Parse the minisign signature box: algo[0..2] ‖ key_id[2..10] ‖ sig[10..74].
 *      c. Check that key_id matches the embedded pubkey.
 *      d. If algo == "ED" (0x45,0x44) the data was BLAKE2b-512 pre-hashed;
 *         if "Ed" (0x45,0x64) the raw file bytes are the message.
 *      e. Ed25519-verify the inner signature.
 *      f. Ed25519-verify the trusted-comment global signature over
 *         sig[64] ‖ trusted_comment (without the 17-char prefix).
 *   3. Confirm the artifact file exists in the build output and is non-empty.
 *   4. Confirm the download URL uses HTTPS.
 *
 * Exit 1 on any failure; stdout lists every result.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

// ── Helpers ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function decodeBase64(str) {
  return Buffer.from(str.trim(), 'base64');
}

function die(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exitCode = 1;
}

// ── Minisign pubkey parsing (mirrors minisign-verify PublicKey::decode) ────

function parsePubKey(pubKeyConf) {
  // tauri.conf.json plugins.updater.pubkey is base64 of the full pubkey FILE
  // text (comment line + base64 body).  The updater does base64_to_string()
  // then PublicKey::decode() which handles this format.
  const fullText = decodeBase64(pubKeyConf).toString('utf8');
  const lines = fullText.split('\n').filter((l) => l.trim().length > 0);
  const bodyB64 = lines.length >= 2 ? lines[1] : lines[0];
  const raw = decodeBase64(bodyB64);
  if (raw.length !== 42) throw new Error(`pubkey length ${raw.length} != 42`);
  const algo = [raw[0], raw[1]];
  if (!(algo[0] === 0x45 && (algo[1] === 0x64 || algo[1] === 0x44))) {
    throw new Error(`unsupported pubkey algorithm ${String.fromCharCode(...algo)}`);
  }
  const keyId = raw.subarray(2, 10);
  const pk = raw.subarray(10, 42);
  return { keyId, pk };
}

// ── Minisign signature parsing (mirrors minisign-verify Signature::decode) ─

function parseSignature(sigFieldB64) {
  const text = decodeBase64(sigFieldB64).toString('utf8');
  const lines = text.split('\n');
  if (lines.length < 4) throw new Error(`signature has ${lines.length} lines, expected 4`);

  const bin1 = decodeBase64(lines[1]);
  if (bin1.length !== 74) throw new Error(`sig box length ${bin1.length} != 74`);

  const bin2 = decodeBase64(lines[3]);
  if (bin2.length !== 64) throw new Error(`global sig length ${bin2.length} != 64`);

  if (!lines[2].startsWith('trusted comment: ')) {
    throw new Error('missing "trusted comment: " prefix');
  }

  const algo0 = bin1[0],
    algo1 = bin1[1];
  const isPrehashed =
    algo0 === 0x45 && algo1 === 0x64 ? false : algo0 === 0x45 && algo1 === 0x44 ? true : null;
  if (isPrehashed === null) {
    throw new Error(`unsupported algorithm ${String.fromCharCode(algo0, algo1)}`);
  }

  return {
    untrustedComment: lines[0],
    keyId: bin1.subarray(2, 10),
    signature: bin1.subarray(10, 74),
    trustedComment: lines[2].slice(17), // strip "trusted comment: "
    globalSignature: bin2,
    isPrehashed,
  };
}

// ── Ed25519 verify via Node WebCrypto ──────────────────────────────────────

async function edVerify(pkRaw, sigRaw, data) {
  const key = await crypto.subtle.importKey('raw', pkRaw, { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, sigRaw, data);
}

// ── Full verification chain (mirrors tauri-plugin-updater verify_signature) ─

async function verifyEntry(entry, pubKey, releaseDir) {
  // HTTPS check
  if (!entry.url.startsWith('https://')) {
    throw new Error(`artifact URL is not HTTPS: ${entry.url}`);
  }

  // Signature box
  const sig = parseSignature(entry.signature);

  // Key ID match
  if (!pubKey.keyId.equals(sig.keyId)) {
    throw new Error(
      `key ID mismatch: feed=${sig.keyId.toString('hex')} pubkey=${pubKey.keyId.toString('hex')}`,
    );
  }

  // Effective message: prehashed → BLAKE2b-512; else raw
  const filename = entry.url.split('/').pop();
  const artifactPath = join(releaseDir, filename);
  if (!existsSync(artifactPath)) throw new Error(`artifact not found: ${filename}`);
  const artifactSize = statSync(artifactPath).size;
  if (artifactSize === 0) throw new Error(`artifact is empty: ${filename}`);

  const artifact = readFileSync(artifactPath);
  const effective = sig.isPrehashed ? createHash('blake2b512').update(artifact).digest() : artifact;

  // Inner signature
  const innerOk = await edVerify(pubKey.pk, sig.signature, effective);
  if (!innerOk) throw new Error('inner Ed25519 signature invalid');

  // Trusted-comment global signature: sig[64] ‖ trusted_comment
  const globalMsg = Buffer.concat([
    Buffer.from(sig.signature),
    Buffer.from(sig.trustedComment, 'utf8'),
  ]);
  const commentOk = await edVerify(pubKey.pk, sig.globalSignature, globalMsg);
  if (!commentOk) throw new Error('trusted-comment global signature invalid');

  return { filename, size: artifactSize, algo: sig.isPrehashed ? 'ED' : 'Ed' };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const confPath = args['tauri-conf']
    ? resolve(args['tauri-conf'])
    : resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json');
  const conf = readJSON(confPath);
  if (!conf) die(`cannot read tauri.conf.json: ${confPath}`);

  const pubKeyConf = conf.plugins?.updater?.pubkey;
  if (!pubKeyConf) die('no updater pubkey in tauri.conf.json');
  const pubKey = parsePubKey(pubKeyConf);

  // Feed path: --feed takes absolute/relative; else --dir determines directory.
  const feedPath = args.feed
    ? resolve(args.feed)
    : resolve(repoRoot, args.dir ?? 'dist', 'release', 'varve-update-stable.json');

  // Artifact directory: --release-dir overrides; else same base as feed.
  const releaseDir = args['release-dir']
    ? resolve(args['release-dir'])
    : resolve(repoRoot, args.dir ?? 'dist', 'release');

  const feed = readJSON(feedPath);
  if (!feed) die(`cannot read feed: ${feedPath}`);

  const platforms = Object.keys(feed.platforms);
  if (platforms.length === 0) die('feed has no platform entries');

  process.stdout.write(
    `Verifying ${platforms.length} feed entries against pubkey ${pubKey.keyId.toString('hex')}...\n`,
  );

  let failures = 0;
  for (const [target, entry] of Object.entries(feed.platforms)) {
    try {
      const result = await verifyEntry(entry, pubKey, releaseDir);
      process.stdout.write(
        `  PASS  ${target}: ${result.filename} (${(result.size / 1048576).toFixed(1)} MiB) algo=${result.algo} keyId=${pubKey.keyId.toString('hex')}\n`,
      );
    } catch (e) {
      failures += 1;
      process.stderr.write(`  FAIL  ${target}: ${e.message}\n`);
    }
  }

  if (failures) {
    die(`${failures} feed ${failures === 1 ? 'entry' : 'entries'} failed verification`);
  } else {
    process.stdout.write(`All ${platforms.length} feed entries verified successfully.\n`);
  }
}

main().catch((e) => {
  die(e.message);
});
