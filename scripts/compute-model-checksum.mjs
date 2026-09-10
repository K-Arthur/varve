#!/usr/bin/env node
/**
 * Fetch a remote ONNX model and print the manifest.json sha256 patch.
 * Usage: node scripts/compute-model-checksum.mjs <url> [modelId]
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const modelId = process.argv[3] ?? 'model';
if (!url) {
  console.error('Usage: node scripts/compute-model-checksum.mjs <url> [modelId]');
  process.exit(1);
}

const response = await fetch(url);
if (!response.ok) {
  console.error(`Fetch failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const buffer = Buffer.from(await response.arrayBuffer());
const sha256 = createHash('sha256').update(buffer).digest('hex');
const outPath = `apps/desktop/public/models/${modelId}.onnx`;
writeFileSync(outPath, buffer);

console.log(JSON.stringify({ modelId, sha256, bytes: buffer.length, outPath }, null, 2));
