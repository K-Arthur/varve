/**
 * Canonical release target and architecture registry.
 *
 * The same architecture appears as `arm64`, `aarch64`, `ARM64` and `arm64`
 * package metadata in different tools. Release code must normalize those
 * spellings at its boundaries and use the canonical values internally.
 *
 * This registry is intentionally plain ESM so it can be consumed by release
 * scripts, tests and build tooling without pulling application code into CI.
 */

export const ARCHITECTURES = Object.freeze({
  x86_64: Object.freeze({
    canonical: 'x86_64',
    node: 'x64',
    rust: 'x86_64',
    debian: 'amd64',
    rpm: 'x86_64',
    windows: 'x64',
    release: 'x86_64',
    label: 'Intel/AMD 64-bit',
  }),
  aarch64: Object.freeze({
    canonical: 'aarch64',
    node: 'arm64',
    rust: 'aarch64',
    debian: 'arm64',
    rpm: 'aarch64',
    windows: 'ARM64',
    release: 'aarch64',
    label: 'ARM64',
  }),
});

const TARGETS = [
  {
    id: 'linux-x86_64',
    os: 'linux',
    architecture: 'x86_64',
    rustTarget: 'x86_64-unknown-linux-gnu',
    packageFormats: ['appimage', 'deb', 'rpm'],
    runner: 'ubuntu-22.04',
    nativeRuntimeKey: 'linux-x86_64',
    displayName: 'Linux x86_64',
    releaseFilenameArch: 'x86_64',
    updateTarget: 'linux-x86_64',
    signingPolicy: 'linux',
    releaseReady: true,
    nativeRunnerRequired: true,
  },
  {
    id: 'linux-aarch64',
    os: 'linux',
    architecture: 'aarch64',
    rustTarget: 'aarch64-unknown-linux-gnu',
    packageFormats: ['appimage', 'deb', 'rpm'],
    runner: 'ubuntu-22.04-arm',
    nativeRuntimeKey: 'linux-aarch64',
    displayName: 'Linux ARM64',
    releaseFilenameArch: 'aarch64',
    updateTarget: 'linux-aarch64',
    signingPolicy: 'linux',
    releaseReady: false,
    nativeRunnerRequired: true,
  },
  {
    id: 'windows-x86_64',
    os: 'windows',
    architecture: 'x86_64',
    rustTarget: 'x86_64-pc-windows-msvc',
    packageFormats: ['nsis'],
    runner: 'windows-latest',
    nativeRuntimeKey: 'windows-x86_64',
    displayName: 'Windows x86_64',
    releaseFilenameArch: 'x86_64',
    updateTarget: 'windows-x86_64',
    signingPolicy: 'windows',
    releaseReady: true,
    nativeRunnerRequired: true,
  },
  {
    id: 'windows-aarch64',
    os: 'windows',
    architecture: 'aarch64',
    rustTarget: 'aarch64-pc-windows-msvc',
    packageFormats: ['nsis'],
    runner: 'windows-11-arm',
    nativeRuntimeKey: 'windows-aarch64',
    displayName: 'Windows ARM64',
    releaseFilenameArch: 'aarch64',
    updateTarget: 'windows-aarch64',
    signingPolicy: 'windows',
    releaseReady: false,
    nativeRunnerRequired: true,
  },
  {
    id: 'macos-aarch64',
    os: 'macos',
    architecture: 'aarch64',
    rustTarget: 'aarch64-apple-darwin',
    packageFormats: ['dmg'],
    runner: 'macos-latest',
    nativeRuntimeKey: 'macos-aarch64',
    displayName: 'macOS Apple Silicon',
    releaseFilenameArch: 'aarch64',
    updateTarget: 'macos-aarch64',
    signingPolicy: 'macos',
    releaseReady: true,
    nativeRunnerRequired: true,
  },
].map((target) =>
  Object.freeze({ ...target, packageFormats: Object.freeze([...target.packageFormats]) }),
);

export const RELEASE_TARGETS = Object.freeze(TARGETS);
export const RELEASE_TARGETS_BY_ID = Object.freeze(
  Object.fromEntries(RELEASE_TARGETS.map((target) => [target.id, target])),
);

const ARCHITECTURE_ALIASES = new Map([
  ['x86_64', 'x86_64'],
  ['x86-64', 'x86_64'],
  ['x64', 'x86_64'],
  ['amd64', 'x86_64'],
  ['aarch64', 'aarch64'],
  ['arm64', 'aarch64'],
  ['arm64-v8a', 'aarch64'],
  ['armv8', 'aarch64'],
]);

/** Normalize a Node, package, Rust, or release architecture spelling. */
export function normalizeArchitecture(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  const canonical = ARCHITECTURE_ALIASES.get(normalized);
  if (!canonical) {
    throw new Error(
      `Unsupported architecture '${value}'. ARM32/armhf and unknown architectures are out of scope.`,
    );
  }
  return canonical;
}

/** Return a canonical OS/architecture target id. */
export function targetIdFor(os, architecture) {
  const id = `${os}-${normalizeArchitecture(architecture)}`;
  if (!RELEASE_TARGETS_BY_ID[id]) throw new Error(`Unsupported release target '${id}'.`);
  return id;
}

/** Normalize a target id supplied by a CLI or workflow helper. */
export function normalizeTargetId(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^([a-z]+)-(.+)$/i);
  if (!match) throw new Error(`Invalid release target '${value}'.`);
  return targetIdFor(match[1].toLowerCase(), match[2]);
}

export function targetFor(os, architecture) {
  return RELEASE_TARGETS_BY_ID[targetIdFor(os, architecture)];
}

export function targetById(id) {
  return RELEASE_TARGETS_BY_ID[normalizeTargetId(id)];
}

/** Resolve the current Node process to the same key used by the Rust loader. */
export function currentTargetId(platform = process.platform, nodeArchitecture = process.arch) {
  const os = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux';
  const architecture =
    nodeArchitecture === 'arm64'
      ? 'aarch64'
      : nodeArchitecture === 'x64'
        ? 'x86_64'
        : nodeArchitecture;
  return targetIdFor(os, architecture);
}
