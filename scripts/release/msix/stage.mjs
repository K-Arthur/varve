#!/usr/bin/env node
/**
 * Stage a Tauri Windows release directory into an MSIX layout.
 *
 * Copies only the installed payload (exe, sibling DLLs, ONNX libs, license
 * files, generative helper) plus Store assets from the master icon pipeline.
 * Does not wrap the published NSIS .exe and does not touch GitHub Release
 * assets.
 */
import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertStoreManifestContract,
  loadIdentityFile,
  loadManifestTemplate,
  renderManifest,
  resolveStoreIdentity,
  STORE_ASSET_FILES,
} from './identity.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PAYLOAD_FILES = [
  'varve-desktop.exe',
  'WebView2Loader.dll',
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES',
];

export function listStagedPayload(releaseDir) {
  const names = new Set();
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower === 'varve-desktop.exe' || lower.endsWith('.dll')) names.add(entry.name);
      if (PAYLOAD_FILES.includes(entry.name)) names.add(entry.name);
      if (entry.name.startsWith('varve-generative-helper')) names.add(entry.name);
    }
  }
  return [...names].sort();
}

export function stageMsixLayout({
  releaseDir,
  outputDir,
  version,
  architecture,
  signMode = 'unsigned',
  env = process.env,
  iconDir = join(repoRoot, 'apps/desktop/src-tauri/icons'),
  template = loadManifestTemplate(),
  identityFile = loadIdentityFile(),
}) {
  const identity = resolveStoreIdentity({ signMode, env, file: identityFile });
  mkdirSync(join(outputDir, 'Assets'), { recursive: true });

  const payload = listStagedPayload(releaseDir);
  if (!payload.includes('varve-desktop.exe')) {
    throw new Error(`varve-desktop.exe missing from ${releaseDir}`);
  }
  for (const name of payload) {
    cpSync(join(releaseDir, name), join(outputDir, name));
  }

  const onnx = join(releaseDir, 'onnxruntime-libs');
  try {
    if (statSync(onnx).isDirectory())
      cpSync(onnx, join(outputDir, 'onnxruntime-libs'), { recursive: true });
  } catch {
    // Optional when a tagged source predates bundled ONNX, or the prune step
    // removed a foreign-arch tree. The pack still needs the exe.
  }

  const licenses = join(releaseDir, 'THIRD_PARTY_LICENSES');
  try {
    if (statSync(licenses).isDirectory()) {
      cpSync(licenses, join(outputDir, 'THIRD_PARTY_LICENSES'), { recursive: true });
    }
  } catch {
    // License trees are copied when Tauri staged them next to the exe.
  }

  for (const file of STORE_ASSET_FILES) {
    cpSync(join(iconDir, file), join(outputDir, 'Assets', file));
  }

  const xml = renderManifest(template, identity, { version, architecture });
  assertStoreManifestContract(xml);
  writeFileSync(join(outputDir, 'AppxManifest.xml'), xml);
  writeFileSync(
    join(outputDir, 'msix-identity.json'),
    `${JSON.stringify(
      {
        ...identity,
        version,
        architecture,
        payload,
      },
      null,
      2,
    )}\n`,
  );
  return { identity, payload, manifestPath: join(outputDir, 'AppxManifest.xml') };
}

function readOption(args, name) {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const result = stageMsixLayout({
    releaseDir: readOption(args, '--release-dir'),
    outputDir: readOption(args, '--output-dir'),
    version: readOption(args, '--version'),
    architecture: readOption(args, '--architecture'),
    signMode: args.includes('--sign-mode') ? readOption(args, '--sign-mode') : 'unsigned',
  });
  process.stdout.write(`${JSON.stringify(result.identity)}\n`);
}
