# Native GUI Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide reliable cross-platform Tauri runtime diagnostics and native GUI testing without shipping test automation in production artifacts.

**Architecture:** A single compatibility module powers the preflight command and tests. A test-only Tauri configuration enables the embedded WDIO server on all three desktop platforms; Playwright continues to test the browser renderer. CI invokes platform-native jobs and uploads diagnostic artifacts.

**Tech Stack:** Node.js ESM, Vitest, Tauri 2/Rust, WebdriverIO 9, Playwright, GitHub Actions, Xvfb, Weston.

---

### Task 1: Compatibility policy and preflight

**Files:**
- Create: `scripts/desktop/compatibility.mjs`
- Create: `scripts/desktop/preflight.mjs`
- Create: `scripts/desktop/compatibility.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing compatibility tests**

```js
test('reports an incompatible WDIO native-utils export', () => {
  const report = evaluateWdioCompatibility({
    serviceVersion: '1.2.0', nativeUtilsExports: [],
  });
  assert.equal(report.ok, false);
  assert.match(report.issues[0], /installMockSyncOverride/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/desktop/compatibility.test.mjs`

Expected: failure because the module does not exist.

- [ ] **Step 3: Implement policy and CLI**

```js
export function evaluateWdioCompatibility(input) {
  return input.nativeUtilsExports.includes('installMockSyncOverride')
    ? { ok: true, issues: [] }
    : { ok: false, issues: ['@wdio/native-utils must export installMockSyncOverride'] };
}
```

The CLI must check only relevant platform dependencies, print actionable
distribution-specific commands, and return non-zero for incompatibilities.

- [ ] **Step 4: Run focused tests and preflight**

Run: `node --test scripts/desktop/compatibility.test.mjs && pnpm desktop:preflight -- --json`

Expected: tests pass; the local report identifies the current native-utils
problem before dependency resolution is corrected.

- [ ] **Step 5: Commit**

```bash
git add scripts/desktop package.json
git commit -m "feat(desktop): add runtime compatibility preflight"
```

### Task 2: Reproducible WDIO compatibility and isolated test build

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/capabilities/wdio.json`
- Create: `apps/desktop/src-tauri/tauri.test.conf.json`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/wdio.ts`

- [ ] **Step 1: Write failing isolation tests**

```js
test('release config does not select the wdio capability', () => {
  assert.equal(readConfig('tauri.conf.json').app.security.capabilities?.includes('wdio'), false);
});
test('test config selects the wdio capability', () => {
  assert.ok(readConfig('tauri.test.conf.json').app.security.capabilities.includes('wdio'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/desktop/compatibility.test.mjs`

Expected: failure because no test configuration/capability exists.

- [ ] **Step 3: Implement exact pins and test-only loading**

Use exact WDIO versions and a pnpm override to resolve `@wdio/native-utils` to
2.5.0 for the known 1.2.0 service incompatibility. Register Rust plugins only
under the `wdio` feature, add their permissions only to `wdio.json`, and load
the frontend bridge only in Vite WDIO mode.

- [ ] **Step 4: Verify red-green and native runner initialization**

Run: `node --test scripts/desktop/compatibility.test.mjs && pnpm test:desktop:preflight && pnpm test:wdio -- --dry-run`

Expected: isolation assertions and WDIO service initialization pass without an
export error.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml apps/desktop/src
git commit -m "fix(desktop): isolate embedded webdriver test build"
```

### Task 3: Native window smoke coverage and runner commands

**Files:**
- Create: `tests/wdio/native-smoke.e2e.ts`
- Modify: `wdio.conf.ts`
- Modify: `tests/e2e/tauri/README.md`
- Modify: `scripts/tauri-e2e.sh`

- [ ] **Step 1: Write a failing native smoke assertion**

```ts
it('shows an interactive desktop window', async () => {
  await expect(await browser.getWindowSize()).toMatchObject({ width: expect.any(Number) });
  const canvas = await browser.$('[data-testid="editor-canvas"]');
  await canvas.waitForDisplayed();
  expect(await canvas.getSize()).toEqual(expect.objectContaining({ width: expect.any(Number) }));
});
```

- [ ] **Step 2: Run it and verify the failure is environmental or behavioral**

Run: `pnpm test:desktop:native -- --spec tests/wdio/native-smoke.e2e.ts`

Expected: current test build fails until its embedded provider is correctly
configured.

- [ ] **Step 3: Implement a resolved-path WDIO configuration and commands**

Capture backend/frontend logs and screenshots in `artifacts/desktop`. Remove
the false Playwright-native claim; document direct external WebDriver as a
diagnostic-only Linux/Windows route.

- [ ] **Step 4: Run native smoke on Wayland and Xvfb**

Run: `pnpm test:desktop:native` and
`xvfb-run --auto-servernum pnpm test:desktop:native`

Expected: both runs verify a window, canvas dimensions, and a click/keyboard
interaction. Save resulting artifacts.

- [ ] **Step 5: Commit**

```bash
git add wdio.conf.ts tests/wdio tests/e2e/tauri scripts/tauri-e2e.sh package.json
git commit -m "test(desktop): verify native window interaction"
```

### Task 4: CI, packaging, and operator documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/build.yml`
- Modify: `.github/workflows/publish.yml`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `docs/desktop-runtime.md`

- [ ] **Step 1: Write failing workflow/config policy tests**

```js
test('Windows distribution embeds offline WebView2', () => {
  assert.equal(readConfig('tauri.conf.json').bundle.windows.webviewInstallMode.type, 'offlineInstaller');
});
test('native CI has Linux X11, Linux Wayland, Windows, and macOS jobs', () => {
  for (const name of ['desktop-e2e-linux-x11', 'desktop-e2e-linux-wayland', 'desktop-e2e-windows', 'desktop-e2e-macos']) {
    assert.match(readText('.github/workflows/ci.yml'), new RegExp(`${name}:`));
  }
});
```

- [ ] **Step 2: Run the policy tests to verify they fail**

Run: `node --test scripts/desktop/compatibility.test.mjs`

Expected: current configuration does not declare the required installer mode or
full native-job matrix.

- [ ] **Step 3: Implement CI and packaging policy**

Use Xvfb for X11 and Weston headless for Wayland. Run embedded WDIO on native
Windows/macOS runners. Upload preflight, WDIO reports, screenshots, and logs on
failure. Require signing/notarization secrets in release-only jobs before
publication; do not make PR jobs depend on secrets. Add Windows ARM64 build
coverage and explain the native-runner limitation in documentation.

- [ ] **Step 4: Validate workflow syntax and policy tests**

Run: `node --test scripts/desktop/compatibility.test.mjs && pnpm lint .github/workflows/ci.yml apps/desktop/src-tauri/tauri.conf.json`

Expected: policy tests pass and edited configuration is formatted.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows apps/desktop/src-tauri/tauri.conf.json docs/desktop-runtime.md scripts/desktop
git commit -m "ci(desktop): add cross-platform GUI runtime coverage"
```

### Task 5: Cascade verification and merge preparation

**Files:**
- Modify: `docs/desktop-runtime.md` only if verification changes a documented command.

- [ ] **Step 1: Run focused runtime verification**

Run: `pnpm desktop:preflight -- --json && pnpm test:desktop:native && xvfb-run --auto-servernum pnpm test:desktop:native`

- [ ] **Step 2: Run required repository gates**

Run: `pnpm format-check && pnpm typecheck && pnpm lint && pnpm test && pnpm audit:emoji && pnpm audit:tokens`

Record pre-existing failures separately from new failures.

- [ ] **Step 3: Build test and release paths**

Run: `pnpm --filter @strata/desktop build && pnpm --filter @strata/desktop tauri build --debug --config src-tauri/tauri.test.conf.json --features wdio && pnpm --filter @strata/desktop tauri build --debug --no-bundle`

- [ ] **Step 4: Commit final documentation corrections**

```bash
git add docs/desktop-runtime.md
git commit -m "docs(desktop): record verified runtime commands"
```
