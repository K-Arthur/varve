#!/usr/bin/env node
/** Guard the shared D3D12 type identity across wgpu-hal and gpu-allocator. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function packagesFromLock(contents) {
  return contents
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map((block) => {
      const field = (name) => block.match(new RegExp(`^${name} = "([^"]+)"$`, 'm'))?.[1];
      const dependencies = block.match(/^dependencies = \[\n([\s\S]*?)^\]/m)?.[1] ?? '';
      return {
        name: field('name'),
        version: field('version'),
        source: field('source'),
        dependencies: [...dependencies.matchAll(/^\s*"([^"]+)",?\s*$/gm)].map((match) => match[1]),
      };
    });
}

function uniquePackage(packages, name) {
  const matches = packages.filter((pkg) => pkg.name === name);
  if (matches.length !== 1) throw new Error(`Expected one ${name} package in the native lock`);
  return matches[0];
}

function dependency(packages, from, name) {
  const edges = from.dependencies.filter((edge) => edge === name || edge.startsWith(`${name} `));
  if (edges.length !== 1) throw new Error(`Expected one ${name} dependency for ${from.name}`);
  const [_, version, source] = edges[0].split(' ');
  const matches = packages.filter(
    (pkg) =>
      pkg.name === name &&
      (!version || pkg.version === version) &&
      (!source || pkg.source === source.replace(/^\(|\)$/g, '')),
  );
  if (matches.length !== 1)
    throw new Error(`Unresolved or ambiguous ${name} dependency for ${from.name}`);
  return matches[0];
}

export function verifyWindowsGpuGraph(contents) {
  const packages = packagesFromLock(contents);
  const hal = uniquePackage(packages, 'wgpu-hal');
  const allocator = dependency(packages, hal, 'gpu-allocator');
  const halWindows = dependency(packages, hal, 'windows');
  const allocatorWindows = dependency(packages, allocator, 'windows');
  if (halWindows !== allocatorWindows) {
    throw new Error(
      `D3D12 type mismatch: wgpu-hal uses windows ${halWindows.version}, gpu-allocator uses ${allocatorWindows.version}`,
    );
  }
  return { hal: hal.version, allocator: allocator.version, windows: halWindows.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    for (const lock of process.argv.slice(2).length
      ? process.argv.slice(2)
      : ['Cargo.lock', 'apps/desktop/src-tauri/Cargo.lock']) {
      const identity = verifyWindowsGpuGraph(readFileSync(lock, 'utf8'));
      console.log(`${lock}: D3D12 bindings agree on windows ${identity.windows}.`);
    }
  } catch (error) {
    console.error(`Native Windows graph failed: ${error.message}`);
    process.exitCode = 1;
  }
}
