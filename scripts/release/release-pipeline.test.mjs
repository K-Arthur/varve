#!/usr/bin/env node
/**
 * Unit tests for the release pipeline scripts.
 *
 * Run: node scripts/release/release-pipeline.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools).
 *
 * Fixture-based: all artifacts are synthetic, but the verification rules are
 * the same code paths the release pipeline and the website deploy run.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load } from 'js-yaml';
import ts from 'typescript';
import { STRICT_BROWSER_FLAGS } from '../quality/browser-execution-policy.mjs';
import { localBrowserLanes } from '../quality/full-gate-execution.mjs';
import {
  computePolicyHash,
  FULL_BROWSER_SHARDS,
  POLICY_FILES,
} from '../quality/validation-policy.mjs';
import '../website/demo-dist-validation.test.mjs';
import './production/contracts.test.mjs';
import { candidateNextAction } from './release.mjs';
import { parseChecksums, selectRelease, verifyReleaseIntegrity } from './verify-release-data.mjs';
import { incrementVersion } from './version.mjs';
import {
  buildWebsiteReleaseData,
  formatCopy,
  releaseUpdaterAvailability,
} from './website-release-data.mjs';
import { buildUpdaterConfig } from './write-updater-config.mjs';

// Platform code-signing and Tauri updater signing are independent. When the
// updater key exists, even an unsigned platform build must receive it or the
// generated updater config makes `tauri build` fail after packaging the app.
const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const websiteWorkflow = readFileSync('.github/workflows/website-deploy.yml', 'utf8');
const visualWorkflow = readFileSync('.github/workflows/visual-baselines.yml', 'utf8');
const candidateWorkflow = readFileSync('.github/workflows/release-candidate.yml', 'utf8');
const integrationWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const verifierSource = readFileSync('scripts/quality/verify.mjs', 'utf8');
const strictBrowserFlags = STRICT_BROWSER_FLAGS;
assert.ok(POLICY_FILES.includes('scripts/release/production/contracts.test.mjs'));

// Execute the actual early native dependency probe: wrong architectures and
// runtime versions must fail before producing an acceptance receipt.
{
  const release = load(releaseWorkflow);
  const contracts = release.jobs['native-contracts'];
  assert.ok(release.jobs.bundle.needs.includes('native-contracts'));
  assert.equal(contracts.strategy['fail-fast'], false);
  assert.equal(contracts.strategy.matrix.include.length, 5);
  for (const workflow of [
    releaseWorkflow,
    candidateWorkflow,
    websiteWorkflow,
    integrationWorkflow,
    readFileSync('.github/workflows/build.yml', 'utf8'),
  ]) {
    const config = load(workflow);
    for (const job of Object.values(config.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/setup-node@')) {
          assert.equal(
            step.with['node-version'] === `\${{ env.NODE_VERSION }}`
              ? config.env.NODE_VERSION
              : step.with['node-version'],
            '26.10.0',
          );
        }
      }
    }
  }
  const step = contracts.steps.find(
    (step) => step.name === 'Record and verify actual native runtime',
  );
  const probe = step.run.split("<<'NODE'\n")[1].split('\nNODE')[0];
  const temporary = mkdtempSync(join(tmpdir(), 'varve-native-contract-'));
  const output = join(temporary, 'native-runtime.json');
  const env = {
    ...process.env,
    NODE_VERSION: process.versions.node,
    EXPECTED_NODE_ARCH: process.arch,
    PRODUCT_SHA: 'a'.repeat(40),
    WORKFLOW_SHA: 'b'.repeat(40),
    NATIVE_RUNTIME_OUTPUT: output,
  };
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      env,
      timeout: 60000,
      stdio: 'pipe',
    });
    const receipt = JSON.parse(readFileSync(output));
    assert.equal(receipt.arch, process.arch);
    assert.equal(receipt.node, process.versions.node);
    assert.equal(receipt.productSha, env.PRODUCT_SHA);
    assert.match(receipt.canvas, /^\d+\.\d+\.\d+$/);
    rmSync(output);
    for (const invalid of [
      { EXPECTED_NODE_ARCH: 'wrong-architecture' },
      { NODE_VERSION: '0.0.0' },
    ]) {
      assert.throws(
        () =>
          execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
            env: { ...env, ...invalid },
            timeout: 60000,
            stdio: 'pipe',
          }),
        /Command failed/,
      );
      assert.equal(existsSync(output), false, 'Rejected runtime cannot leave a passing receipt');
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// Exercise CMake's real cache precedence: CC/CXX cannot override the native
// dependency's explicit cl.exe defaults. The toolchain must do so before project().
{
  const steps = load(releaseWorkflow).jobs.bundle.steps;
  const cache = steps.find((step) => step.uses?.startsWith('Swatinem/rust-cache@'));
  assert.deepEqual(cache.with.workspaces.trim().split('\n'), [
    '. -> target',
    'apps/desktop/src-tauri -> target',
  ]);
  assert.equal(cache.with['cache-on-failure'], true);
  assert.match(
    cache.with.key,
    /hashFiles\('release-build-tooling\/scripts\/release\/toolchains\/\*\*'\)/,
  );
  assert.equal(cache.with['cache-workspace-crates'], undefined);
  assert.equal(cache.with['add-rust-environment-hash-key'], undefined);
  for (const input of [
    'CARGO',
    'CC',
    'CFLAGS',
    'CXX',
    'CMAKE',
    'RUST',
    'WindowsSDKVersion',
    'VCToolsInstallDir',
    'VARVE_WINDOWS_ARM64_CLANG',
  ])
    assert.ok(cache.with['env-vars'].split(' ').includes(input));
  const checkout = steps.find(
    (step) => step.name === 'Checkout workflow-pinned ARM64 compiler tooling',
  );
  const probe = steps.find((step) => step.name === 'Verify native Windows ARM64 Clang toolchain');
  assert.equal(checkout.with.ref, `\${{ github.workflow_sha }}`);
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(checkout.if, probe.if);
  assert.match(probe.if, /matrix\.name == 'windows-aarch64'/);
  assert.match(probe.if, /REUSE_PLATFORM != 'true'/);
  assert.equal(probe.shell, 'pwsh');
  assert.ok(steps.indexOf(probe) < steps.findIndex((step) => step.name === 'Build frontend'));
  const rust = steps.find((step) => step.name === 'Verify native Rust linker from build shell');
  assert.equal(rust.if, probe.if);
  assert.equal(rust.shell, 'bash', 'probe the actual Tauri build shell, including its POSIX PATH');
  assert.equal(rust.env.ARM64_COMPILER_PROBE, `\${{ steps.arm64-compiler.outputs.probe_dir }}`);
  assert.match(rust.run, /cargo run --offline --locked --release/);
  assert.ok(steps.indexOf(probe) < steps.indexOf(rust));
  assert.ok(steps.indexOf(rust) < steps.findIndex((step) => step.name === 'Build frontend'));
  const setup = readFileSync('scripts/release/toolchains/verify-windows-aarch64.ps1', 'utf8');
  assert.match(setup, /CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER = \$linker/);
  assert.doesNotMatch(setup, /\$env:PATH\.Split\([^\n]*GITHUB_PATH/);
  assert.match(setup, /rust\/build\.rs/);
  assert.match(setup, /@\('mt\.exe', 'rc\.exe'\)/);
  assert.match(setup, /Get-Command \$_ -CommandType Application -ErrorAction Stop/);
  assert.match(setup, /StartsWith\(\$env:WindowsSdkDir/);
  assert.match(setup, /@\(\$sdkBins\) \| Out-File \$env:GITHUB_PATH/);
  assert.match(setup, /crate-type = \["cdylib", "rlib"\]/);
  assert.match(setup, /apps\/desktop\/src-tauri\/windows-app-manifest\.xml/);
  assert.match(setup, /cargo:rustc-link-arg=\/MANIFEST:EMBED/);
  assert.match(setup, /cargo:rustc-link-arg=\/MANIFESTINPUT=/);
  const fixture = mkdtempSync(join(tmpdir(), 'varve-arm64-toolchain-'));
  try {
    const toolchain = join(fixture, 'windows-aarch64.cmake');
    copyFileSync('scripts/release/toolchains/windows-aarch64.cmake', toolchain);
    const check = join(fixture, 'check.cmake');
    writeFileSync(
      check,
      `
include("${toolchain.replaceAll('\\', '/')}")
file(TO_CMAKE_PATH "$ENV{VARVE_WINDOWS_ARM64_CLANG}" expected)
foreach(kind C CXX ASM)
  if(NOT CMAKE_\${kind}_COMPILER STREQUAL expected)
    message(FATAL_ERROR "Upstream MSVC compiler was not replaced for \${kind}")
  endif()
endforeach()
if(NOT CMAKE_LINKER STREQUAL expected)
  message(FATAL_ERROR "Wrong native linker")
endif()
if(NOT CMAKE_C_COMPILER_TARGET STREQUAL "aarch64-pc-windows-msvc" OR NOT CMAKE_CXX_COMPILER_TARGET STREQUAL "aarch64-pc-windows-msvc")
  message(FATAL_ERROR "Wrong native target")
endif()
if(NOT CMAKE_CXX_FLAGS STREQUAL "/bigobj /EHsc" OR GGML_NATIVE OR NOT GGML_CPU_ARM_ARCH STREQUAL "armv8-a")
  message(FATAL_ERROR "Wrong release flags or portable ARM baseline")
endif()
`,
    );
    const args = [
      '-DCMAKE_C_COMPILER=cl.exe',
      '-DCMAKE_CXX_COMPILER=cl.exe',
      '-DCMAKE_ASM_COMPILER=cl.exe',
      "-DCMAKE_CXX_FLAGS='/bigobj'",
      '-DGGML_NATIVE=ON',
      '-P',
      check,
    ];
    const env = {
      ...process.env,
      VARVE_WINDOWS_ARM64_CLANG: process.execPath,
      CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER: process.execPath,
    };
    execFileSync('cmake', args, { cwd: fixture, env, encoding: 'utf8' });
    assert.throws(
      () =>
        execFileSync('cmake', args, {
          cwd: fixture,
          env: { ...env, VARVE_WINDOWS_ARM64_CLANG: join(fixture, 'missing-clang.exe') },
          stdio: 'pipe',
        }),
      /Verified Windows ARM64 Clang executable is missing/,
    );
    assert.throws(
      () =>
        execFileSync('cmake', args, {
          cwd: fixture,
          env: {
            ...env,
            CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER: join(fixture, 'missing-link.exe'),
          },
          stdio: 'pipe',
        }),
      /Verified Windows ARM64 Microsoft linker is missing/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

// A failed bundle cannot mask qualification on the other successful targets.
// Artifact selection and final convergence remain strict; this collects failures.
{
  const jobs = load(releaseWorkflow).jobs;
  for (const id of ['package-smoke', 'platform-smoke']) {
    assert.match(jobs[id].if, /always\(\) && !cancelled\(\)/);
    assert.match(jobs[id].if, /needs\.preflight\.result == 'success'/);
    assert.match(jobs[id].if, /github\.event\.inputs\.publish != 'yes'/);
    assert.ok(jobs[id].needs.includes('bundle'));
    assert.ok(jobs[id].steps.some((step) => step.name?.startsWith('Select successful')));
    assert.ok(jobs.verify.needs.includes(id));
    assert.ok(jobs[id].steps.every((step) => !step['continue-on-error']));
  }
  assert.ok(jobs.verify.needs.includes('bundle'));
  assert.doesNotMatch(jobs.verify.if ?? '', /always\(\)/);
}

// Recovery qualification must execute the trusted workflow's complete adapter
// closure, while its installed bytes and fixture stay at the certified tag.
{
  const jobs = load(releaseWorkflow).jobs;
  for (const id of ['package-smoke', 'platform-smoke']) {
    const steps = jobs[id].steps;
    const tooling = steps.find(
      (step) => step.name === 'Checkout workflow-pinned native qualification tooling',
    );
    assert.equal(steps[0].with.ref, `\${{ needs.preflight.outputs.tag }}`);
    assert.equal(tooling.with.ref, `\${{ github.workflow_sha }}`);
    assert.equal(tooling.with['persist-credentials'], false);
    const fixture = mkdtempSync(join(tmpdir(), 'varve-native-tooling-'));
    try {
      for (const path of tooling.with['sparse-checkout'].trim().split('\n')) {
        const relative = path.replace(/^\//, '');
        const target = join(fixture, relative);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(relative, target, { recursive: true });
      }
      for (const test of [
        'dialog-forwarding',
        'published-upgrade',
        'retained-document',
        'native-quit',
        'native-export-controls',
        'native-pdf',
        'macos-ax-controls',
        'workflow',
        ...(id === 'package-smoke' ? ['appimage-extraction'] : []),
      ]) {
        execFileSync(
          process.execPath,
          [join(fixture, `scripts/release/production/${test}.test.mjs`)],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              VARVE_NATIVE_WORKFLOW_FIXTURE: join(fixture, '.github/workflows/release.yml'),
            },
          },
        );
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
}

// A published tag is immutable, but a workflow dispatch can recover broken
// release orchestration. Keep the repaired verifier tied to the workflow SHA
// and every product/policy identity tied to the approved tag.
{
  const expression = (value) => `\${{ ${value} }}`;
  const jobs = load(releaseWorkflow).jobs;
  const steps = jobs.preflight.steps;
  assert.equal(steps[0].with.ref, expression('inputs.tag || github.ref'));
  assert.equal(steps[0].with['fetch-depth'], 0);
  assert.equal(steps[0].with['sparse-checkout-cone-mode'], false);
  const materialize = steps.find((step) => step.name === 'Materialize tagged policy inputs');
  assert.match(
    materialize.run,
    /import \{ POLICY_FILES \} from "\.\/scripts\/quality\/validation-policy\.mjs"/,
  );
  // `add` inherits non-cone mode; Git 2.55 rejects the `set`-only --no-cone flag.
  assert.match(materialize.run, /git sparse-checkout add --stdin/);
  assert.doesNotMatch(materialize.run, /git sparse-checkout add[^\n]*--no-cone/);
  for (const source of [candidateWorkflow, integrationWorkflow]) {
    const planner = load(source).jobs.changes;
    const checkout = planner.steps.find((step) => step.uses?.startsWith('actions/checkout'));
    assert.equal(checkout.with['fetch-depth'], 0, 'planning retains all source ancestry');
    assert.equal(checkout.with.filter, 'blob:none', 'avoid fetching unrelated historical blobs');
    assert.equal(checkout.with['sparse-checkout'], undefined, 'planner retains its full worktree');
    assert.equal(planner['timeout-minutes'], 15);
  }
  const tooling = steps.find((step) => step.name === 'Check out workflow certification tooling');
  assert.equal(tooling.with.ref, expression('github.workflow_sha'));
  assert.equal(tooling.with.path, 'release-tooling');
  assert.equal(tooling.with['persist-credentials'], false);
  const verify = steps.find((step) => step.id === 'certification');
  assert.ok(steps.indexOf(tooling) < steps.indexOf(verify));
  assert.match(verify.run, /git rev-parse "\$\{RELEASE_TAG\}\^\{commit\}"/);
  assert.match(verify.run, /import\('\.\/scripts\/quality\/validation-policy\.mjs'\)/);
  assert.match(verify.run, /node release-tooling\/scripts\/release\/verify-certification\.mjs/);
  assert.match(verify.run, /--sha "\$\{TAG_SHA\}".*--policy-hash "\$\{POLICY_HASH\}"/);
  assert.equal(jobs.gate.steps[0].with.ref, expression('github.workflow_sha'));
  for (const path of [
    'certification.mjs',
    'verify-certification.mjs',
    '../quality/validation-policy.mjs',
  ]) {
    const relative = path.startsWith('../')
      ? `scripts/${path.slice(3)}`
      : `scripts/release/${path}`;
    assert.ok(jobs.gate.steps[0].with['sparse-checkout'].includes(`/${relative}`));
  }
  assert.ok(tooling.with['sparse-checkout'].includes('/scripts/release/select-run-artifacts.mjs'));
  assert.match(jobs.gate.steps[1].run, /--sha "\$\{\{ needs\.preflight\.outputs\.tag_sha \}\}"/);
  assert.match(
    jobs.gate.steps[1].run,
    /--policy-hash "\$\{\{ needs\.preflight\.outputs\.policy_hash \}\}"/,
  );
  assert.equal(
    jobs.bundle.steps.find((step) => step.uses?.startsWith('actions/checkout')).with.ref,
    expression('needs.preflight.outputs.tag'),
  );
  assert.equal(
    jobs.bundle.steps.find((step) => step.uses?.startsWith('actions/checkout')).with[
      'sparse-checkout'
    ],
    undefined,
    'package builds retain the complete certified product source',
  );
  const signing = jobs['signing-preflight'].steps[0].with;
  assert.equal(signing.ref, expression('needs.preflight.outputs.tag'));
  assert.equal(signing['persist-credentials'], false);
  const fixture = mkdtempSync(join(tmpdir(), 'varve-release-policy-'));
  try {
    for (const path of steps[0].with['sparse-checkout'].trim().split('\n')) {
      const relative = path.replace(/^\//, '');
      const target = join(fixture, relative);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(relative, target, {
        recursive: true,
        // Local ignored Python environments can contain inaccessible or
        // transient files. The workflow fixture should model tracked inputs.
        filter: (source) => !/[/\\](?:\.venv|__pycache__|node_modules)(?:[/\\]|$)/.test(source),
      });
    }
    for (const path of POLICY_FILES) {
      if (!existsSync(path)) continue;
      const target = join(fixture, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, target);
    }
    const git = (argv, options = {}) =>
      execFileSync('git', argv, { cwd: fixture, encoding: 'utf8', ...options });
    git(['init', '--quiet']);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Pipeline fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--quiet',
      '-m',
      'Synthetic release policy inputs',
    ]);
    git(['sparse-checkout', 'set', '--no-cone', '--stdin'], {
      input: steps[0].with['sparse-checkout'],
    });
    assert.notEqual(computePolicyHash({ root: fixture }), computePolicyHash());
    // Execute the actual workflow shell, then compare against a complete tree.
    execFileSync('bash', ['-c', materialize.run], { cwd: fixture, encoding: 'utf8' });
    assert.equal(git(['config', '--get', 'core.sparseCheckoutCone']).trim(), 'false');
    assert.equal(computePolicyHash({ root: fixture }), computePolicyHash());
    const currentVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
    execFileSync(
      process.execPath,
      ['scripts/release/version.mjs', 'verify', `v${currentVersion}`],
      {
        cwd: fixture,
        encoding: 'utf8',
      },
    );
    execFileSync(
      process.execPath,
      ['scripts/release/release-notes.mjs', '--check', currentVersion],
      {
        cwd: fixture,
        encoding: 'utf8',
      },
    );
    rmSync(
      join(
        fixture,
        POLICY_FILES.find((path) => existsSync(path)),
      ),
      { force: true },
    );
    assert.notEqual(computePolicyHash({ root: fixture }), computePolicyHash());
    rmSync(fixture, { recursive: true, force: true });
    for (const path of signing['sparse-checkout'].trim().split('\n')) {
      const relative = path.replace(/^\//, '');
      const target = join(fixture, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(relative, target);
    }
    const result = execFileSync(process.execPath, ['scripts/release/resolve-signing-policy.mjs'], {
      cwd: fixture,
      encoding: 'utf8',
      env: { CHANNEL: 'stable', EXPECT_SIGNED: 'false', PLATFORMS: 'linux windows macos' },
    });
    const policy = JSON.parse(result);
    assert.equal(policy.windows, 'unsigned');
    assert.equal(policy.macos, 'unsigned');
    rmSync(fixture, { recursive: true, force: true });
    for (const path of tooling.with['sparse-checkout'].trim().split('\n')) {
      const relative = path.replace(/^\//, '');
      const target = join(fixture, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(relative, target);
    }
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "await import('./scripts/release/verify-certification.mjs')"],
      { cwd: fixture, encoding: 'utf8' },
    );
    const releaseData = load(websiteWorkflow).jobs['release-data'].steps[0].with;
    assert.equal(releaseData.ref, expression('github.sha'));
    assert.equal(releaseData['persist-credentials'], false);
    rmSync(fixture, { recursive: true, force: true });
    for (const path of releaseData['sparse-checkout'].trim().split('\n')) {
      const relative = path.replace(/^\//, '');
      const target = join(fixture, relative);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(relative, target);
    }
    execFileSync(process.execPath, ['scripts/release/website-release-data-check.mjs'], {
      cwd: fixture,
      encoding: 'utf8',
    });
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "await import('./scripts/release/verify-website-publication.mjs')",
      ],
      { cwd: fixture, encoding: 'utf8' },
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}
function workflowJob(source, id) {
  const start = source.indexOf(`\n  ${id}:`);
  assert.ok(start >= 0, `missing job ${id}`);
  const next = source.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:/);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
// History scans need a full-depth checkout. The job deadline includes that
// network operation, so three minutes can expire before the scan starts.
for (const [name, source] of [
  ['integration', integrationWorkflow],
  ['release candidate', candidateWorkflow],
]) {
  const job = load(source).jobs['attribution-check'];
  assert.ok(job, `${name} workflow must retain its history policy guard`);
  assert.ok(
    job['timeout-minutes'] >= 10,
    `${name} history guard must allow full-history checkout before scanning`,
  );
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout?.with?.['fetch-depth'], 0, `${name} guard must inspect complete history`);
}
for (const id of ['e2e', 'e2e-visual']) {
  const job = workflowJob(candidateWorkflow, id);
  assert.match(job, /needs: \[changes, pipeline-validate, wasm\]/);
  assert.doesNotMatch(job, /needs:.*rust/, 'independent browsers must not wait on native targets');
}
{
  const visual = load(candidateWorkflow).jobs['e2e-visual'];
  assert.equal(visual.env.VARVE_VISUAL_GPU, '1');
  assert.equal(visual.env.VARVE_VISUAL_HARNESS_ONLY, '1');
  assert.match(
    visual.steps.find((step) => step.name === 'Discover complete candidate visual inventory').run,
    /--project chromium-visual-gpu/,
  );
  assert.equal(
    visual.steps
      .find((step) => step.name === 'Visual E2E (candidate)')
      .run.split('--project=chromium-visual-gpu').length - 1,
    2,
    'both candidate triage and final visual commands execute the GPU project',
  );
}
{
  const website = load(websiteWorkflow);
  assert.match(
    website.concurrency.group,
    /workflow_run.*workflow_dispatch.*noop.*deploy/,
    'a no-op workflow_run cannot replace the queued published-release deployment',
  );
  assert.doesNotMatch(
    websiteWorkflow,
    /'scripts\/release\/\*\*'/,
    'release-tool-only commits must not start the full website suite and source deployment',
  );
}
// The installed payload must still exist when its signature is observed.
// Installer-container verification remains a separate fail-closed gate.
{
  const platformSmoke = workflowJob(releaseWorkflow, 'platform-smoke');
  const windowsStart = platformSmoke.indexOf('      - name: Windows — silent install,');
  const windowsEnd = platformSmoke.indexOf('      - name: macOS — mount DMG', windowsStart);
  assert.ok(windowsStart >= 0 && windowsEnd > windowsStart, 'Windows package smoke must exist');
  const windowsSmoke = platformSmoke.slice(windowsStart, windowsEnd);
  const install = windowsSmoke.indexOf('Start-Process -FilePath $exe.FullName');
  const payload = windowsSmoke.indexOf(
    'Get-AuthenticodeSignature -LiteralPath $installed.FullName',
  );
  const uninstall = windowsSmoke.indexOf('Start-Process -FilePath $uninstallKey.UninstallString');
  assert.ok(
    install >= 0 && install < payload && payload < uninstall,
    'observe the installed payload signature after installation and before uninstall',
  );
  assert.doesNotMatch(
    windowsSmoke,
    /signature check skipped/,
    'a missing payload must not silently skip observation',
  );
}

assert.match(workflowJob(candidateWorkflow, 'desktop-e2e'), /needs:.*rust/);
assert.match(workflowJob(candidateWorkflow, 'certification'), /needs:.*rust/);
const candidateBrowserCommands = candidateWorkflow
  .split('\n')
  .filter(
    (line) => /\bpnpm (?:exec playwright test|e2e:visual)/.test(line) && !line.includes('--list'),
  );
assert.equal(
  candidateBrowserCommands.length,
  7,
  'triage/final plus the single production-demo owner run',
);
for (const command of candidateBrowserCommands) {
  assert.match(command, /node scripts\/quality\/heavy-lease\.mjs/);
  for (const flag of strictBrowserFlags) assert.ok(command.includes(flag), command);
}
const directIntegrationBrowserCommands = integrationWorkflow
  .split('\n')
  .filter((line) => /run: .*\bpnpm exec playwright test/.test(line));
assert.equal(directIntegrationBrowserCommands.length, 3);
for (const command of directIntegrationBrowserCommands) {
  assert.match(command, /node scripts\/quality\/heavy-lease\.mjs/);
  for (const flag of strictBrowserFlags) assert.ok(command.includes(flag), command);
}
const websiteBrowserSteps = websiteWorkflow
  .split(/\n {6}- name:/)
  .filter((step) => /pnpm exec playwright test/.test(step));
assert.equal(websiteBrowserSteps.length, 3, 'source modes, full built inventory, full built demo');
for (const step of websiteBrowserSteps) {
  assert.match(step, /node scripts\/quality\/heavy-lease\.mjs/);
  for (const flag of strictBrowserFlags) assert.ok(step.includes(flag), step);
  assert.doesNotMatch(step, /--(?:grep|shard|last-failed|only-changed|test-list)(?:=|\s)/);
}
const websiteBuild = workflowJob(websiteWorkflow, 'build');
const websiteStage = websiteBuild.indexOf('node scripts/website/stage-demo.mjs');
const websitePrepare = websiteBuild.indexOf(
  'node scripts/website/demo-dist-validation.mjs prepare',
);
const websiteDemo = websiteBuild.indexOf('name: Validate built production demo');
const websiteReport = websiteBuild.indexOf(
  'node scripts/website/demo-dist-validation.mjs verify-report',
);
const websiteUnchanged = websiteBuild.indexOf(
  'node scripts/website/demo-dist-validation.mjs assert-unchanged',
);
const websiteUpload = websiteBuild.indexOf('uses: actions/upload-pages-artifact@');
assert.ok(
  websiteStage >= 0 &&
    websitePrepare > websiteStage &&
    websiteDemo > websitePrepare &&
    websiteReport > websiteDemo &&
    websiteUnchanged > websiteReport &&
    websiteUpload > websiteUnchanged,
  'built artifact and complete browser evidence must precede upload',
);
assert.match(
  websiteBuild,
  /VARVE_DEMO_EXPECTED_SHA: \$\{\{ needs\.release-data\.outputs\.published_sha \|\| github\.sha \}\}/,
);
assert.doesNotMatch(websiteWorkflow, /path: \|\n {12}test-results\/\n/);
assert.match(verifierSource, /\.\.\.localBrowserLanes\(\)/);
const localBrowserGate = localBrowserLanes();
assert.equal(localBrowserGate.length, FULL_BROWSER_SHARDS + 1);
assert.deepEqual(
  localBrowserGate
    .slice(0, FULL_BROWSER_SHARDS)
    .map(({ argv }) => argv.find((arg) => arg.startsWith('--shard='))),
  Array.from(
    { length: FULL_BROWSER_SHARDS },
    (_, index) => `--shard=${index + 1}/${FULL_BROWSER_SHARDS}`,
  ),
);
for (const { argv } of localBrowserGate.slice(0, FULL_BROWSER_SHARDS)) {
  assert.deepEqual(argv.slice(0, 4), ['pnpm', 'exec', 'playwright', 'test']);
  for (const flag of [...strictBrowserFlags, '--project=chromium']) assert.ok(argv.includes(flag));
  assert.doesNotMatch(argv.join(' '), /--(?:grep|last-failed|only-changed|test-list)(?:=|\s|$)/);
}
assert.deepEqual(localBrowserGate.at(-1), {
  label: 'Production demo E2E',
  argv: [process.execPath, 'scripts/quality/run-demo-dist-e2e.mjs'],
});
assert.match(verifierSource, /'e2e:visual', \.\.\.playwrightRunOptions\(\{ strict: true \}\)/);
assert.match(
  JSON.parse(readFileSync('package.json', 'utf8')).scripts['e2e:visual'],
  /--project=chromium-visual-3x/,
  'full final visual gate keeps all three DPR tiers',
);

// Local version readiness must report the next actual release gate. A dirty
// or unpublished candidate cannot be mistaken for a published release.
const localCandidate = {
  dirty: false,
  changelogSection: true,
  upstream: 'origin/master',
  ahead: 0,
  behind: 0,
};
assert.match(candidateNextAction({ ...localCandidate, dirty: true }), /commit/);
assert.match(candidateNextAction({ ...localCandidate, ahead: 38 }), /Push reviewed master/);
assert.match(candidateNextAction({ ...localCandidate, behind: 1 }), /reconcile incoming/);
assert.match(candidateNextAction(localCandidate), /exact-SHA integration certification/);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

assert.match(releaseWorkflow, /varve-release-published/);
assert.match(websiteWorkflow, /repository_dispatch:/);
assert.match(visualWorkflow, /reviewed:/);
assert.match(visualWorkflow, /update_snapshots:/);
assert.match(visualWorkflow, /VARVE_REVIEWED/);
assert.match(visualWorkflow, /VARVE_UPDATE_SNAPSHOTS/);
assert.match(visualWorkflow, /Explicit reviewed update mode/);
assert.match(visualWorkflow, /--update-snapshots/);
assert.match(
  visualWorkflow,
  /if: always\(\)/,
  'visual review artifacts must survive a comparison failure',
);
assert.match(websiteWorkflow, /needs\.release-data\.outputs\.published == 'true'/);
assert.match(
  websiteWorkflow,
  /verify-website-publication\.mjs[\s\S]*--tag "\$RELEASE_TAG" --sha "\$RELEASE_SHA"/,
  'publication dispatch and recovery must verify the tag against their exact commit SHA',
);
assert.match(
  websiteWorkflow,
  /fetch-website-release\.mjs --tag "\$\{RELEASE_TAG\}"/,
  'release-data deployment must fetch the published tag, not an unrelated latest release',
);
assert.match(
  websiteWorkflow,
  /github\.event_name == 'workflow_run' && github\.event\.workflow_run\.conclusion == 'success'/,
);
assert.match(
  websiteWorkflow,
  /github\.event\.workflow_run\.event != 'workflow_dispatch'/,
  'workflow_run fallback must not duplicate the explicit publication dispatch',
);
const signedUpdaterBuild = releaseWorkflow.match(
  /- name: Tauri build \(unsigned platforms with signed updater\)([\s\S]*?)(?=\n {6}- name:)/,
)?.[1];
assert.ok(
  signedUpdaterBuild,
  'release workflow must have a signed-updater unsigned-platform build',
);
assert.match(signedUpdaterBuild, /updater_mode == 'signed'/);
assert.match(
  signedUpdaterBuild,
  /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/,
);
assert.match(signedUpdaterBuild, /VARVE_SIGNING_STEP_ALLOWED: '1'/);
const manualUpdaterBuild = releaseWorkflow.match(
  /- name: Tauri build \(unsigned platforms, manual updates\)([\s\S]*?)(?=\n {6}- name:)/,
)?.[1];
assert.ok(manualUpdaterBuild, 'release workflow must retain a manual-update build path');
assert.match(manualUpdaterBuild, /updater_mode != 'signed'/);
assert.doesNotMatch(manualUpdaterBuild, /TAURI_SIGNING_PRIVATE_KEY:/);

// Installer-size reports are generated after collect-artifacts, then copied
// into the final directory for release diagnostics. They are not installer
// manifest entries, but they must remain checksum-covered final-release files.
{
  const staged = join(tmpdir(), `varve-merge-staged-${process.pid}`);
  const out = join(tmpdir(), `varve-merge-out-${process.pid}`);
  rmSync(staged, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(staged, 'windows'), { recursive: true });
  mkdirSync(out, { recursive: true });
  const installer = 'Varve-0.1.0-windows-x86_64.exe';
  writeFileSync(join(out, installer), Buffer.from('installer bytes'));
  writeFileSync(join(out, `${installer}.provenance.json`), '{"schema":1,"commitSha":"a"}\n');
  writeFileSync(join(out, 'installer-size-report-windows-x86_64.json'), '{"status":"pass"}\n');
  writeFileSync(
    join(staged, 'windows', 'release-manifest.json'),
    JSON.stringify({
      version: '0.1.0',
      artifacts: [{ filename: installer, os: 'windows', arch: 'x86_64', format: 'nsis' }],
    }),
  );
  execFileSync(
    process.execPath,
    ['scripts/release/merge-manifests.mjs', '--staged', staged, '--out', out],
    { encoding: 'utf8' },
  );
  execFileSync(process.execPath, ['scripts/release/generate-final-checksums.mjs', '--dir', out], {
    encoding: 'utf8',
  });
  const merged = JSON.parse(readFileSync(join(out, 'release-manifest.json'), 'utf8'));
  assert.equal(merged.artifacts.length, 1, 'diagnostic report is not an installer artifact');
  assert.ok(readFileSync(join(out, 'release-manifest.json'), 'utf8').includes(installer));
  assert.match(
    readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8'),
    /installer-size-report-windows-x86_64\.json$/m,
  );
  rmSync(staged, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
}

// ── updater build-mode configuration ────────────────────────────────────────
assert.deepEqual(buildUpdaterConfig('stable', 'signed'), {
  plugins: { updater: { endpoints: ['https://varve.studio/updates/stable.json'] } },
});
assert.deepEqual(buildUpdaterConfig('beta', 'manual-only'), {
  bundle: { createUpdaterArtifacts: false },
  plugins: {
    updater: { endpoints: ['https://varve.studio/updates/beta.json'], active: false, pubkey: '' },
  },
});
assert.throws(() => buildUpdaterConfig('preview', 'signed'), /invalid update channel/);
assert.throws(() => buildUpdaterConfig('stable', 'unsigned'), /invalid updater mode/);

const runValidator = (files) => {
  try {
    execFileSync(process.execPath, ['scripts/release/validate-sbom.mjs', ...files], {
      stdio: 'ignore',
    });
    return 0;
  } catch {
    return 1;
  }
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const FILE_A = Buffer.from('varve-installer-bytes-a');
const FILE_B = Buffer.from('varve-installer-bytes-b');
const HASH_A = sha256(FILE_A);
const HASH_B = sha256(FILE_B);

const FIXTURE_MANIFEST = {
  schemaVersion: 1,
  version: '0.1.0',
  generatedAt: '2026-08-06T10:00:00.000Z',
  signed: false,
  notarized: false,
  artifacts: [
    {
      filename: 'Varve-0.1.0-linux-x86_64.AppImage',
      os: 'linux',
      arch: 'x86_64',
      format: 'appimage',
      sizeBytes: FILE_A.length,
      sha256: HASH_A,
    },
    {
      filename: 'Varve-0.1.0-windows-x86_64.exe',
      os: 'windows',
      arch: 'x86_64',
      format: 'nsis',
      sizeBytes: FILE_B.length,
      sha256: HASH_B,
    },
  ],
};

const FIXTURE_ASSETS = [
  'Varve-0.1.0-linux-x86_64.AppImage',
  'Varve-0.1.0-windows-x86_64.exe',
  'Varve-0.1.0-sbom-linux-x86_64.cdx.json',
  'Varve-0.1.0-sbom-windows-x86_64.cdx.json',
  'release-manifest.json',
  'SHA256SUMS.txt',
];

const FIXTURE_CHECKSUMS = `${[
  `${HASH_A}  Varve-0.1.0-linux-x86_64.AppImage`,
  `${HASH_B}  Varve-0.1.0-windows-x86_64.exe`,
  `${sha256(Buffer.from('sbom-linux'))}  Varve-0.1.0-sbom-linux-x86_64.cdx.json`,
  `${sha256(Buffer.from('sbom-windows'))}  Varve-0.1.0-sbom-windows-x86_64.cdx.json`,
  `${sha256(Buffer.from('manifest'))}  release-manifest.json`,
].join('\n')}\n`;

function verifyFixture(overrides = {}) {
  return verifyReleaseIntegrity({
    tag: 'v0.1.0',
    manifest: FIXTURE_MANIFEST,
    checksumsText: FIXTURE_CHECKSUMS,
    assetNames: FIXTURE_ASSETS,
    ...overrides,
  });
}

// ── parseChecksums ───────────────────────────────────────────────────────────
{
  const parsed = parseChecksums(FIXTURE_CHECKSUMS);
  assert.equal(parsed.size, 5, 'parses all entries');
  assert.equal(parsed.get('Varve-0.1.0-linux-x86_64.AppImage'), HASH_A);
}

// Rejections: wrong format
const BAD_LINES = [
  ['deadbeef  file.txt', 'wrong hash length'],
  [`${HASH_A.toUpperCase()}  file.txt`, 'uppercase hash'],
  ['file-without-hash.txt', 'no two-space separator'],
  [`${HASH_A}  ../escape.txt`, 'path traversal'],
  [`${HASH_A}  /abs.txt`, 'absolute path'],
  [`${HASH_A}  a\nb.txt`, 'newline in filename'],
  ['', 'empty file'],
];
for (const [text, label] of BAD_LINES) {
  assert.throws(() => parseChecksums(text), undefined, `must reject ${label}`);
}

// Duplicate filenames
assert.throws(
  () => parseChecksums(`${HASH_A}  same.txt\n${HASH_B}  same.txt\n`),
  undefined,
  'must reject duplicate filenames',
);

// A one-byte mutation must fail verification
{
  const corrupted = FIXTURE_CHECKSUMS.replace(
    HASH_A,
    sha256(Buffer.concat([FILE_A, Buffer.from([1])])),
  );
  assert.throws(
    () => verifyFixture({ checksumsText: corrupted }),
    /Hash mismatch/,
    'mutated checksum byte must fail verification',
  );
}

// ── verifyReleaseIntegrity ───────────────────────────────────────────────────
{
  const result = verifyFixture();
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.sbomAssets.length, 2);
}

// Tag/version disagreement
assert.throws(
  () => verifyFixture({ tag: 'v0.2.0' }),
  /does not match tag/,
  'tag/version disagreement must be rejected',
);

// Missing asset in the checksum file
{
  const missing = FIXTURE_CHECKSUMS.replace(`${HASH_A}  Varve-0.1.0-linux-x86_64.AppImage\n`, '');
  assert.throws(
    () => verifyFixture({ checksumsText: missing }),
    /Hash mismatch.*\(absent\)/,
    'manifest asset absent from checksums must be rejected',
  );
}

// Phantom checksum entry (lists a file that is not a release asset)
assert.throws(
  () =>
    verifyFixture({
      checksumsText: `${FIXTURE_CHECKSUMS}${sha256(Buffer.from('x'))}  ghost.txt\n`,
    }),
  /not a release asset/,
  'phantom checksum entries must be rejected',
);

// Duplicate manifest filenames
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [FIXTURE_MANIFEST.artifacts[0], FIXTURE_MANIFEST.artifacts[0]],
      },
    }),
  /duplicate filenames/,
  'duplicate manifest names must be rejected',
);

// Unknown artifact format
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], format: 'apk' }],
      },
    }),
  /Unsupported artifact format "apk"/,
  'unknown format must be rejected',
);

// Unknown platform
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], os: 'plan9' }],
      },
    }),
  /Unsupported platform "plan9"/,
  'unknown platform must be rejected',
);

// Architecture aliases are accepted only when the canonical filename agrees.
assert.throws(
  () =>
    verifyFixture({
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], arch: 'arm64' }],
      },
    }),
  /does not agree with canonical architecture aarch64/,
  'architecture/filename disagreement must be rejected',
);

// Unmanifested installer on the release
assert.throws(
  () => verifyFixture({ assetNames: [...FIXTURE_ASSETS, 'Varve-0.1.0-macos-aarch64.dmg'] }),
  /installer assets not listed/,
  'unmanifested installer must be rejected',
);

// Missing SBOM for an advertised platform
{
  const sbomWindowsLine = `${sha256(Buffer.from('sbom-windows'))}  Varve-0.1.0-sbom-windows-x86_64.cdx.json`;
  assert.throws(
    () =>
      verifyFixture({
        assetNames: FIXTURE_ASSETS.filter((n) => !n.includes('sbom-windows')),
        checksumsText: FIXTURE_CHECKSUMS.replace(`${sbomWindowsLine}\n`, ''),
      }),
    /no windows-specific or combined SBOM/,
    'missing platform SBOM must be rejected',
  );
}

// SBOM not covered by checksums
{
  const extraSbom = `${sha256(Buffer.from('sbom-linux'))}  Varve-0.1.0-sbom-linux-x86_64.cdx.json`;
  const checksumsWithoutSbom = FIXTURE_CHECKSUMS.replace(`${extraSbom}\n`, '');
  assert.throws(
    () => verifyFixture({ checksumsText: checksumsWithoutSbom }),
    /SBOM asset.*not covered by SHA256SUMS/,
    'unhashed SBOM must be rejected',
  );
}

// Malformed manifest
assert.throws(
  () => verifyFixture({ manifest: { ...FIXTURE_MANIFEST, version: 'garbage' } }),
  /does not match tag/,
  'non-semver manifest version must be rejected',
);

// Zero-byte / placeholder installer
{
  const tiny = Buffer.from('tiny');
  assert.throws(
    () =>
      verifyFixture({
        manifest: {
          ...FIXTURE_MANIFEST,
          artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], sizeBytes: 0, sha256: sha256(tiny) }],
        },
        checksumsText: `${FIXTURE_CHECKSUMS.replace(`${HASH_A}  Varve-0.1.0-linux-x86_64.AppImage\n`, '')}`,
      }),
    /no positive sizeBytes/,
    'zero-byte installer must be rejected',
  );
}

// ── buildWebsiteReleaseData ──────────────────────────────────────────────────
{
  const data = buildWebsiteReleaseData({
    repo: 'K-Arthur/varve',
    tag: 'v0.1.0',
    manifest: FIXTURE_MANIFEST,
    checksumsText: FIXTURE_CHECKSUMS,
    sbomFilenames: [
      'Varve-0.1.0-sbom-linux-x86_64.cdx.json',
      'Varve-0.1.0-sbom-windows-x86_64.cdx.json',
    ],
    integrity: 'verified',
  });

  assert.equal(data.hasRelease, true);
  assert.equal(data.version, '0.1.0');
  assert.equal(data.releaseDate, '2026-08-06');
  assert.equal(data.prerelease, false);
  assert.equal(data.signed, false);
  assert.equal(data.integrity, 'verified');
  assert.equal(
    data.checksumsUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/SHA256SUMS.txt',
  );

  assert.deepEqual(Object.keys(data.platforms).sort(), ['linux', 'windows']);
  const linux = data.platforms.linux[0];
  assert.equal(
    linux.url,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/Varve-0.1.0-linux-x86_64.AppImage',
  );
  assert.equal(
    linux.sbomUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/Varve-0.1.0-sbom-linux-x86_64.cdx.json',
  );
  assert.equal(linux.title, 'AppImage');
  assert.match(linux.install, /chmod \+x/);

  const windows = data.platforms.windows[0];
  assert.equal(windows.caveat.length > 0, true, 'unsigned Windows builds need a caveat');
}

// A retained old feed does not confer availability on a newly selected release.
{
  const directory = join(tmpdir(), `varve-retained-updater-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  const stablePath = join(directory, 'stable.json');
  const oldFeed = {
    version: '0.2.1',
    platforms: {
      'linux-x86_64': {
        url: 'https://example.test/0.2.1.AppImage',
        signature: 'fixture-signature',
      },
    },
  };
  writeFileSync(stablePath, JSON.stringify(oldFeed));
  const oldRelease = {
    tag_name: 'v0.2.1',
    draft: false,
    prerelease: false,
    assets: [{ name: 'varve-update-stable.json' }],
  };
  const newRelease = { tag_name: 'v0.5.0', draft: false, prerelease: false, assets: [] };
  const selected = selectRelease([oldRelease, newRelease]);
  assert.equal(selected.tag_name, 'v0.5.0');
  const retained = JSON.parse(readFileSync(stablePath, 'utf8'));
  assert.equal(
    releaseUpdaterAvailability(selected, { stable: retained }),
    false,
    'a present old stable.json must not advertise an updater for the new no-feed release',
  );
  assert.equal(
    releaseUpdaterAvailability(selected, {}),
    false,
    'no freshly verified feed must stay unavailable despite the retained file',
  );
  const manifest = JSON.parse(JSON.stringify(FIXTURE_MANIFEST).replaceAll('0.1.0', '0.5.0'));
  const data = buildWebsiteReleaseData({
    repo: 'K-Arthur/varve',
    tag: selected.tag_name,
    manifest: { ...manifest, updater: releaseUpdaterAvailability(selected, { stable: retained }) },
    checksumsText: FIXTURE_CHECKSUMS.replaceAll('0.1.0', '0.5.0'),
    sbomFilenames: [],
  });
  assert.equal(data.version, '0.5.0');
  assert.equal(
    data.updater,
    false,
    'the website download data must not inherit the older feed claim',
  );
  assert.deepEqual(
    JSON.parse(readFileSync(stablePath, 'utf8')),
    oldFeed,
    'availability checks do not delete the previous valid feed',
  );
  const withFeed = { ...newRelease, assets: [{ name: 'varve-update-stable.json' }] };
  assert.equal(
    releaseUpdaterAvailability(withFeed, { stable: { ...oldFeed, version: '0.5.0' } }),
    true,
    'the exact selected stable release with a freshly verified matching feed is available',
  );
  assert.equal(
    releaseUpdaterAvailability(withFeed, { stable: retained }),
    false,
    'asset presence alone cannot substitute stale local feed data',
  );
  const betaRelease = {
    tag_name: 'v0.5.0-beta.1',
    draft: false,
    prerelease: true,
    assets: [{ name: 'varve-update-beta.json' }],
  };
  assert.equal(
    releaseUpdaterAvailability(betaRelease, { beta: { ...oldFeed, version: '0.5.0-beta.1' } }),
    true,
  );
  assert.equal(
    releaseUpdaterAvailability(betaRelease, { stable: { ...oldFeed, version: '0.5.0-beta.1' } }),
    false,
    'stable and beta feeds cannot cross channels',
  );
  assert.equal(
    releaseUpdaterAvailability(
      { ...withFeed, draft: true },
      { stable: { ...oldFeed, version: '0.5.0' } },
    ),
    false,
  );
  rmSync(directory, { recursive: true, force: true });
}

// Combined SBOM fallback when no platform-specific SBOM exists
{
  const data = buildWebsiteReleaseData({
    repo: 'K-Arthur/varve',
    tag: 'v0.1.0',
    manifest: FIXTURE_MANIFEST,
    checksumsText: FIXTURE_CHECKSUMS,
    sbomFilenames: ['varve-0.1.0-sbom.cdx.json'],
    integrity: 'verified',
  });
  assert.equal(
    data.platforms.linux[0].sbomUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/varve-0.1.0-sbom.cdx.json',
  );
  assert.equal(
    data.sbomUrl,
    'https://github.com/K-Arthur/varve/releases/download/v0.1.0/varve-0.1.0-sbom.cdx.json',
  );
}

// Unknown format must never reach the page
assert.throws(
  () =>
    buildWebsiteReleaseData({
      repo: 'K-Arthur/varve',
      tag: 'v0.1.0',
      manifest: {
        ...FIXTURE_MANIFEST,
        artifacts: [{ ...FIXTURE_MANIFEST.artifacts[0], format: 'tar.gz' }],
      },
      checksumsText: FIXTURE_CHECKSUMS,
      sbomFilenames: [],
    }),
  /unknown format/,
  'unknown formats must be refused by the page builder',
);

// ── formatCopy ───────────────────────────────────────────────────────────────
{
  const copy = formatCopy('Varve');
  for (const format of ['appimage', 'deb', 'rpm', 'nsis', 'msi', 'dmg']) {
    assert.ok(copy[format]?.title, `formatCopy must describe ${format}`);
    assert.ok(copy[format]?.install, `formatCopy must give install instructions for ${format}`);
  }
  // No formatCopy copy may tell users to disable OS security. The word
  // "disable" is only acceptable inside a "do not disable" warning.
  for (const entry of Object.values(copy)) {
    const text = JSON.stringify(entry);
    assert.ok(!/spctl --master-disable/.test(text), 'no master-disable instructions');
    assert.ok(
      !/(?:[^o]|\b)disable (gatekeeper|smartscreen|antivirus|windows security)/i.test(text) ||
        /(do not|don'?t|never)\s+disable/i.test(text),
      'no install copy may advise disabling OS security',
    );
  }
}

// ── SBOM validation (validate-sbom.mjs rules, in-process) ────────────────────
{
  const valid = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ vendor: 'K-Arthur', name: 'varve/generate-sbom.mjs', version: '1.0.0' }],
      component: {
        type: 'application',
        'bom-ref': 'pkg:generic/varve@0.1.0',
        name: 'Varve',
        version: '0.1.0',
      },
    },
    components: [
      {
        type: 'library',
        'bom-ref': 'pkg:cargo/tauri@2.0.0',
        name: 'tauri',
        version: '2.0.0',
        purl: 'pkg:cargo/tauri@2.0.0',
      },
    ],
  };
  const tmp = join(tmpdir(), 'varve-sbom-fixture-valid.json');
  writeFileSync(tmp, JSON.stringify(valid));
  assert.equal(runValidator([tmp]), 0, 'valid SBOM passes');

  // Strata identity must fail
  const strata = JSON.parse(JSON.stringify(valid));
  strata.metadata.component.name = 'Strata';
  strata.metadata.component['bom-ref'] = 'pkg:generic/strata@0.1.0';
  strata.metadata.tools[0].vendor = 'Strata';
  writeFileSync(join(tmpdir(), 'varve-sbom-fixture-strata.json'), JSON.stringify(strata));
  assert.notEqual(
    runValidator([join(tmpdir(), 'varve-sbom-fixture-strata.json')]),
    0,
    'Strata identity fails',
  );

  // strata: property names must fail
  const prop = JSON.parse(JSON.stringify(valid));
  prop.components[0].properties = [{ name: 'strata:provenanceStatus', value: 'unknown' }];
  writeFileSync(join(tmpdir(), 'varve-sbom-fixture-prop.json'), JSON.stringify(prop));
  assert.notEqual(
    runValidator([join(tmpdir(), 'varve-sbom-fixture-prop.json')]),
    0,
    'strata: properties fail',
  );

  // duplicate bom-refs must fail
  const dup = JSON.parse(JSON.stringify(valid));
  dup.components.push({ ...dup.components[0] });
  writeFileSync(join(tmpdir(), 'varve-sbom-fixture-dup.json'), JSON.stringify(dup));
  assert.notEqual(
    runValidator([join(tmpdir(), 'varve-sbom-fixture-dup.json')]),
    0,
    'duplicate bom-refs fail',
  );

  // malformed purl must fail
  const purl = JSON.parse(JSON.stringify(valid));
  purl.components[0].purl = 'not-a-purl';
  writeFileSync(join(tmpdir(), 'varve-sbom-fixture-purl.json'), JSON.stringify(purl));
  assert.notEqual(
    runValidator([join(tmpdir(), 'varve-sbom-fixture-purl.json')]),
    0,
    'malformed purl fails',
  );

  // non-JSON must fail
  writeFileSync(join(tmpdir(), 'varve-sbom-fixture-bad.json'), '{not json');
  assert.notEqual(
    runValidator([join(tmpdir(), 'varve-sbom-fixture-bad.json')]),
    0,
    'non-JSON fails',
  );
}

// ── version.mjs agreement ─────────────────────────────────────────────────────
{
  const runVersion = (argv, env = {}) =>
    execFileSync(process.execPath, ['scripts/release/version.mjs', ...argv], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ...env },
    }).trim();
  const current = runVersion(['get']);
  assert.match(current, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'current version is semver');
  // The tag the release pipeline will actually verify against must agree.
  // Self-derived from the current version so a version bump cannot break the
  // gate with a stale hardcoded expectation.
  assert.match(
    runVersion(['verify', `v${current}`]),
    new RegExp(`All version manifests agree on ${escapeRegExp(current)}\\.`),
    'verify current version passes',
  );
  assert.throws(() => runVersion(['verify', 'v9.9.9']), undefined, 'verify wrong tag fails');
  // Build metadata is illegal in deb/MSI versions — must be rejected up front.
  assert.throws(
    () => runVersion(['set', '1.0.0+build.7']),
    undefined,
    'set rejects build metadata (+...)',
  );

  // incrementVersion pure logic — no files touched.
  assert.equal(incrementVersion('0.1.0', 'patch'), '0.1.1', 'bump patch');
  assert.equal(incrementVersion('0.1.0', 'minor'), '0.2.0', 'bump minor');
  assert.equal(incrementVersion('0.1.0', 'major'), '1.0.0', 'bump major');
  assert.equal(incrementVersion('0.1.0-alpha.3', 'patch'), '0.1.1', 'bump drops prerelease');
  assert.throws(
    () => incrementVersion('0.1.0', 'nonsense'),
    /Unknown bump part/,
    'bump rejects unknown part',
  );

  // snapshot: deterministic, read-only, never a bare release version.
  const snap1 = runVersion(['snapshot']);
  const snap2 = runVersion(['snapshot']);
  assert.equal(snap1, snap2, 'snapshot is deterministic for the same HEAD');
  assert.match(
    snap1,
    new RegExp(`^${escapeRegExp(current)}-dev\\.(?:[0-9a-f]{7,}|local)$`),
    'snapshot format',
  );
  assert.equal(runVersion(['get']), current, 'snapshot never writes manifests');

  // set/bump write-path integration against a fixture tree (VARVE_VERSION_ROOT):
  // the exact in-place JSON + TOML-section rewrites must round-trip.
  const versionTargets = [
    'package.json',
    'apps/desktop/package.json',
    'apps/desktop/src-tauri/tauri.conf.json',
    'Cargo.toml',
    'apps/desktop/src-tauri/Cargo.toml',
    'README.md',
    'apps/desktop/src-tauri/linux/dev.varve.desktop.metainfo.xml',
    'packaging/aur/varve-desktop-bin/PKGBUILD',
    'packaging/aur/varve-desktop-bin/.SRCINFO',
  ];
  {
    const tmp = join(tmpdir(), `varve-version-${process.pid}`);
    rmSync(tmp, { recursive: true, force: true });
    for (const rel of versionTargets) {
      const abs = join(tmp, rel);
      mkdirSync(dirname(abs), { recursive: true });
      copyFileSync(rel, abs);
    }
    const env = { VARVE_VERSION_ROOT: tmp };
    runVersion(['set', '1.2.3'], env);
    assert.match(
      runVersion(['verify'], env),
      /All version manifests agree on 1\.2\.3\./,
      'fixture verify after set',
    );
    runVersion(['set', '1.2.3'], env);
    assert.match(
      runVersion(['verify'], env),
      /All version manifests agree on 1\.2\.3\./,
      'setting an already-synchronized README version is a no-op',
    );
    runVersion(['bump', 'minor'], env);
    assert.equal(runVersion(['get'], env), '1.3.0', 'fixture bump minor -> 1.3.0');
    runVersion(['bump', 'patch'], env);
    assert.equal(runVersion(['get'], env), '1.3.1', 'fixture bump patch -> 1.3.1');
    runVersion(['set', '2.0.0-beta.1'], env);
    assert.match(
      runVersion(['verify', 'v2.0.0-beta.1'], env),
      /agree on 2\.0\.0-beta\.1\./,
      'fixture prerelease set + verify',
    );
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── channel policy (selectRelease) ───────────────────────────────────────────
{
  const rel = (tag, draft = false) => ({ tag_name: tag, draft });

  // No releases at all → no-release state
  assert.equal(selectRelease([]), null, 'no releases → null');
  assert.equal(selectRelease([rel('v0.1.0', true)]), null, 'only drafts → null');

  // Drafts are never eligible even when they are the newest
  const withDraft = selectRelease([rel('v0.9.9', true), rel('v0.1.0')]);
  assert.equal(withDraft.tag_name, 'v0.1.0', 'draft v0.9.9 must not shadow published v0.1.0');

  // Published auxiliary releases must not shadow the newest product release.
  const withModelBundle = selectRelease([rel('varve-models-v1'), rel('v0.1.1')]);
  assert.equal(
    withModelBundle.tag_name,
    'v0.1.1',
    'non-semver model bundle must not be selected as a product release',
  );

  // Stable preferred over prerelease
  const stableWins = selectRelease([rel('v0.2.0-alpha.1'), rel('v0.1.0'), rel('v0.1.1')]);
  assert.equal(stableWins.tag_name, 'v0.1.1', 'highest stable wins over prerelease');

  // Prerelease fallback when no stable exists
  const prereleaseOnly = selectRelease([rel('v0.1.0-beta.1'), rel('v0.1.0-alpha.5')]);
  assert.equal(prereleaseOnly.tag_name, 'v0.1.0-beta.1', 'highest prerelease when no stable');

  // Pinned tag: published passes, draft fails
  assert.equal(selectRelease([rel('v0.1.0')], 'v0.1.0').tag_name, 'v0.1.0');
  assert.equal(selectRelease([rel('v0.1.0', true)], 'v0.1.0'), null, 'pinned draft must fail');
}

process.stdout.write('release-pipeline.test.mjs: all assertions passed\n');

// CLI retry=0 can be overridden by spec-local configuration. Parse real code,
// not comments, and reject nonzero or dynamic overrides in release-selected specs.
function retryOverrides(source) {
  const file = ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true);
  const violations = [];
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(file).replace(/^['"]|['"]$/g, '') === 'retries'
    ) {
      if (!ts.isNumericLiteral(node.initializer) || node.initializer.text !== '0') {
        const location = file.getLineAndCharacterOfPosition(node.getStart(file));
        violations.push(location.line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}
assert.equal(retryOverrides('test.describe.configure({ retries: 1 });').length, 1);
assert.equal(
  retryOverrides('test.describe.configure({ retries: process.env.CI ? 1 : 0 });').length,
  1,
);
assert.equal(retryOverrides('test.use({ "retries": 2 });').length, 1);
assert.deepEqual(retryOverrides('// retries: 3\ntest.describe.configure({ retries: 0 });'), []);
function gateSpecs(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? gateSpecs(path)
      : /\.(spec|test)\.[cm]?[jt]sx?$/.test(entry.name)
        ? [path]
        : [];
  });
}
for (const path of [...gateSpecs('tests/e2e'), ...gateSpecs('apps/website/tests/e2e')]) {
  assert.deepEqual(
    retryOverrides(readFileSync(path, 'utf8')),
    [],
    `${path}: positive/dynamic spec retry override bypasses the strict global gate`,
  );
}
console.log('release-selected specs have no positive retry overrides');
