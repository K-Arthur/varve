#!/usr/bin/env node

/** Write exact-SHA sidecars used by the resumable release artifact path. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const POLICY_HASH = /^[0-9a-f]{64}$/;
const SAFE_FILENAME = /^[^/\\\0]+$/;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function writeArtifactProvenance({ dir, version, commitSha, policyHash, platform } = {}) {
  if (!dir || !version || !SHA.test(commitSha ?? '') || !POLICY_HASH.test(policyHash ?? '')) {
    throw new Error(
      'dir, version, a 40-character commitSha, and a 64-character policyHash are required',
    );
  }
  if (!platform || !/^(?:linux|windows|macos)-(?:x86_64|aarch64)$/.test(platform)) {
    throw new Error(`unsupported release platform '${platform}'`);
  }
  if (!existsSync(dir)) throw new Error(`release directory not found: ${dir}`);
  const manifest = JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8'));
  if (manifest.version !== version)
    throw new Error(`release manifest version ${manifest.version} does not match ${version}`);
  const artifacts = (manifest.artifacts ?? []).filter(
    (artifact) => `${artifact.os}-${artifact.arch}` === platform,
  );
  if (artifacts.length === 0) throw new Error(`no collected artifact for ${platform}`);

  const outputs = [];
  for (const artifact of artifacts) {
    if (
      !SAFE_FILENAME.test(artifact.filename ?? '') ||
      artifact.filename === '.' ||
      artifact.filename === '..'
    ) {
      throw new Error(`unsafe collected artifact filename '${artifact.filename}'`);
    }
    const artifactPath = resolve(dir, artifact.filename);
    if (!existsSync(artifactPath))
      throw new Error(`missing collected artifact ${artifact.filename}`);
    const metadata = {
      schema: 1,
      version,
      commitSha,
      policyHash,
      platform,
      artifact: basename(artifact.filename),
      sha256: sha256(artifactPath),
    };
    const sidecar = `${artifactPath}.provenance.json`;
    writeFileSync(sidecar, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    outputs.push(sidecar);
  }
  return outputs;
}

function value(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const dir = resolve(value(args, '--dir') ?? 'dist/release');
  const outputs = writeArtifactProvenance({
    dir,
    version: value(args, '--version'),
    commitSha: value(args, '--sha'),
    policyHash: value(args, '--policy-hash'),
    platform: value(args, '--platform'),
  });
  console.log(
    `Wrote ${outputs.length} exact-SHA provenance sidecar(s) for ${value(args, '--platform')}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`artifact provenance failed: ${error.message}`);
    process.exitCode = 1;
  }
}
