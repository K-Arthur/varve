#!/usr/bin/env node
/**
 * Validates apps/desktop/public/models/manifest.json against the v3 schema.
 *
 * This lived as an inline `node -e` heredoc in both model-validation.yml and
 * quantize.yml. The two copies drifted, so a manifest could pass one gate and
 * fail the other. One script, two callers.
 *
 * Usage:
 *   node scripts/models/validate-manifest.mjs [--manifest <path>] [--check-files]
 *
 *   --check-files  Additionally require every `bundled: true` model to exist on
 *                  disk and match its pinned SHA-256.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_MANIFEST = 'apps/desktop/public/models/manifest.json';
const REQUIRED_ENTRY_FIELDS = ['id', 'filename', 'localPath', 'bundled', 'remoteUrl'];
const OUTPUT_ACTIVATIONS = ['sigmoid', 'softmax', 'none', 'linear'];
const PROVENANCE_STATUSES = ['unverified', 'signed', 'verified', 'revoked', 'expired'];

/** Quantization provenance. See `checkInt8Provenance` for why this exists. */
const QUANTIZATION_ORIGINS = ['in-repo', 'upstream'];

const args = process.argv.slice(2);
const manifestPath = args.includes('--manifest')
  ? args[args.indexOf('--manifest') + 1]
  : DEFAULT_MANIFEST;
const checkFiles = args.includes('--check-files');

const errors = [];
const fail = (...msg) => errors.push(msg.join(' '));

/**
 * Every INT8 blob must be traceable to something that was hashed — but the two
 * ways of getting an INT8 model have different evidence:
 *
 *   in-repo   We quantized it from an FP32 model in this same manifest.
 *             The chain is `sourceModelId` -> that entry's pinned `sha256`,
 *             and `sourceSha256` must equal it. This is what
 *             scripts/quantize/quantize_model.py produces.
 *
 *   upstream  A third party published the INT8 weights and we download them.
 *             There is no in-repo FP32 source, so `sourceModelId` can never be
 *             filled in. The evidence is instead that every downloadable blob
 *             is SHA-256 pinned over HTTPS.
 *
 * The previous rule required `sourceModelId`+`sourceSha256` for *any* int8
 * entry, which conflated "is INT8" with "was quantized by us" and made the four
 * upstream models permanently unrepresentable.
 *
 * `quantizationOrigin` is explicit rather than inferred from field presence, so
 * a typo'd `sourceModelId` fails loudly instead of silently downgrading to the
 * weaker upstream check.
 */
function checkInt8Provenance(entry, byId) {
  if (entry.precision !== 'int8') return;

  const origin = entry.quantizationOrigin;
  if (!QUANTIZATION_ORIGINS.includes(origin)) {
    fail(
      'ERROR:',
      entry.id,
      `is int8 but has no valid quantizationOrigin (want one of ${QUANTIZATION_ORIGINS.join(', ')}); got:`,
      JSON.stringify(origin),
    );
    return;
  }

  if (origin === 'in-repo') {
    if (!entry.sourceModelId || !entry.sourceSha256) {
      fail('ERROR:', entry.id, 'in-repo int8 entry missing sourceModelId or sourceSha256');
      return;
    }
    const source = byId.get(entry.sourceModelId);
    if (!source) {
      fail(
        'ERROR:',
        entry.id,
        'sourceModelId does not resolve to a manifest entry:',
        entry.sourceModelId,
      );
    } else if (source.sha256 && source.sha256 !== entry.sourceSha256) {
      fail(
        'ERROR:',
        entry.id,
        'sourceSha256 does not match the pinned hash of',
        entry.sourceModelId,
      );
    }
    return;
  }

  // origin === 'upstream': every downloadable blob must be pinned over HTTPS.
  const blobs = entry.components?.length
    ? entry.components.map((c) => ({ label: `component ${c.id}`, ...c }))
    : [{ label: 'entry', remoteUrl: entry.remoteUrl, sha256: entry.sha256 }];

  for (const blob of blobs) {
    if (!blob.sha256) {
      fail('ERROR:', entry.id, blob.label, 'upstream int8 blob has no pinned sha256');
    }
    if (!blob.remoteUrl) {
      fail('ERROR:', entry.id, blob.label, 'upstream int8 blob has no remoteUrl');
    } else if (!blob.remoteUrl.startsWith('https://')) {
      fail('ERROR:', entry.id, blob.label, 'upstream int8 blob is not served over HTTPS');
    }
  }
}

function checkTensorContract(entry) {
  const tc = entry.tensorContract;
  if (!tc) return;
  if (!tc.inputs || tc.inputs.length === 0)
    fail('ERROR:', entry.id, 'tensorContract has no inputs');
  if (!tc.outputs || tc.outputs.length === 0)
    fail('ERROR:', entry.id, 'tensorContract has no outputs');
  if (!OUTPUT_ACTIVATIONS.includes(tc.outputActivation))
    fail('ERROR:', entry.id, 'invalid outputActivation:', tc.outputActivation);
  if (!tc.version || tc.version < 1)
    fail('ERROR:', entry.id, 'tensorContract version must be >= 1');
}

function checkValidationBlock(entry) {
  const v = entry.validation;
  if (!v) return;
  if (typeof v.contractVerified !== 'boolean')
    fail('ERROR:', entry.id, 'validation.contractVerified must be boolean');
  if (typeof v.integrityVerified !== 'boolean')
    fail('ERROR:', entry.id, 'validation.integrityVerified must be boolean');
  if (!PROVENANCE_STATUSES.includes(v.provenanceStatus))
    fail('ERROR:', entry.id, 'invalid provenanceStatus:', v.provenanceStatus);
}

/**
 * `localPath` is web-rooted (`/models/u2netp.onnx`) because it is what the
 * renderer fetches, so it resolves against the Vite public dir — not against
 * the directory holding the manifest. The inline version of this check joined
 * it onto `.../public/models` and produced `.../public/models/models/...`;
 * that bug stayed latent because the schema step always failed first.
 */
function checkBundledFile(entry, webRoot) {
  if (!entry.bundled) return;
  const filePath = join(webRoot, entry.localPath.replace(/^\//, ''));
  if (!existsSync(filePath)) {
    fail('ERROR: bundled model not found:', filePath);
    return;
  }
  if (!entry.sha256) return;
  const hash = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  if (hash !== entry.sha256) {
    fail(
      'ERROR: hash mismatch for',
      entry.id,
      '\n  expected:',
      entry.sha256,
      '\n  actual:  ',
      hash,
    );
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

if (manifest.version !== 3) {
  console.error('ERROR: manifest version must be 3, got', manifest.version);
  process.exit(1);
}
for (const field of ['version', 'models']) {
  if (manifest[field] === undefined) {
    console.error('ERROR: manifest missing top-level field:', field);
    process.exit(1);
  }
}

const byId = new Map(manifest.models.map((e) => [e.id, e]));
// manifest.json lives at <webRoot>/models/manifest.json
const webRoot = dirname(dirname(manifestPath));

for (const entry of manifest.models) {
  for (const field of REQUIRED_ENTRY_FIELDS) {
    if (entry[field] === undefined) {
      fail('ERROR: entry', entry.id, 'missing required field:', field);
    }
  }
  checkInt8Provenance(entry, byId);
  checkTensorContract(entry);
  checkValidationBlock(entry);
  if (checkFiles) checkBundledFile(entry, webRoot);
}

if (errors.length > 0) {
  for (const e of errors) console.error(e);
  console.error(`\n${errors.length} manifest error(s)`);
  process.exit(1);
}

console.log(
  `Manifest v3 OK: ${manifest.models.length} entries` +
    (checkFiles ? ', all bundled models present and hash-matched' : ''),
);
