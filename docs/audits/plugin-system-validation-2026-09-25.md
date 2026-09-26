# Plugin vertical-slice validation — 2026-09-25

Baseline: `042508de`. The research and defect trail is in
[plugin-system-evidence-2026-09-25.md](plugin-system-evidence-2026-09-25.md).
This report distinguishes demonstrated behavior from source-level enforcement
and platform work that could not be run locally.

## Risk-based scenarios

| Scenario | Evidence at this revision | Result and limit |
| --- | --- | --- |
| A. Offline local install, analysis, disable, reload | `tests/e2e/plugins/local-manager.spec.ts` installs the real Rust-built ZIP through File → Manage Plugins, runs selected-layer analysis, disables it, reloads, and finds it still disabled. | Chromium pass. The selected sample is a rectangle; a mixed vector/text/image source remains to be exercised in the editor. |
| B. Undoable edit and package removal | Same spec previews a numbered layer name, applies it, removes the package, then undoes, redoes, saves, and reopens the document without the package. `controller.test.ts` rejects stale/locked targets atomically. | Chromium and unit pass. Nested components and export without a plugin need a fuller document fixture. |
| C. Competing work and stale results | Controller binds results to document, session, revision, selection revision, and plugin generation; at most two jobs run at once. | Source-level enforcement plus unit output/proposal checks. Two simultaneous plugins and tab switching need browser/native tests. |
| D. Contextual UI lifecycle | Trusted Inspector registry tests exercise registration, mode filtering, error recovery, copies, and ownership. The packaged section is mounted through the host renderer. | Unit and Chromium Inspector text checks pass. Reorder and persisted hide preferences are not API v1 features. |
| E. Permission denial and revocation | Browser test revokes `selection.read` while a noncooperative guest runs; its Worker stops, Run becomes unavailable, and no later failure or edit appears. Optional `document.write` remains denied on update. | Chromium pass. File, network, native, clipboard, and cross-plugin storage APIs are absent, so destination-grant scenarios do not apply to v1. |
| F. Update and recovery | Browser test reviews a permission-expanding update without granting new access, then restores the prior package. The ZIP parser tests malformed content. | Chromium and unit pass. Interrupted IndexedDB commit, multi-window state refresh, and data-schema migration are outside this first contract. |
| G. Fault containment | Controlled valid Wasm guest enters a tight loop. Browser test stops it, then runs it to the five-second timeout and observes quarantine and an actionable Retry route. Wasm section checks reject extra memories and unbounded tables. Package review compiles without instantiation, so a guest start section cannot execute until Run. | Chromium pass; guest linear memory maximum is 256 pages (16 MiB). Native WebView behavior remains unverified. |
| H. Hostile packages and UI | Parser accepts exactly two stored ZIP entries and rejects unsafe paths, links, duplicates, unsupported fields, and CRC failures; guest output is bounded text and checked proposals. | 20 parser tests plus contract/worker tests pass. No arbitrary HTML UI is supported. Native IPC/egress probes remain. |
| I. Portability without plugin | Plugin commands produce ordinary Varve node-name updates; package/grants are local IndexedDB records, not document fields. | Undo/redo and save/reopen after removal pass. Cross-profile open, copy/paste, and export need explicit fixture coverage. |
| J. Developer workflow and long session | `examples/plugins` has a typed Rust SDK, two packages, locked build, ABI smoke, and a static CLI validator. | Rust 3/3, package build/smoke, and browser installation pass. Folder watching, source maps, multi-hour resource plateau, and four-GB hardware profiling are not implemented. |

## Resource and platform evidence

- Exact sample archives: Style Readiness 120,782 bytes; Number Selected Layers
  77,391 bytes. The parser allows at most 2 MiB per package, 32 KiB of
  manifest, and 1 MiB of Wasm. A profile holds at most 32 plugin records and
  each record may retain one previous package for rollback.
- A guest has a 4 MiB initial imported linear memory, a 16 MiB maximum, at
  most one declared function table of 1,024 entries, at most 64 KiB input and
  output per run, a five-second Worker timeout, and a global two-job cap.
  These are enforced limits; total WebView/process memory has no hard OS cap.
- On this development machine, 100 sequential static parse/hash operations
  averaged 5.80 ms for the 120,782-byte sample and 3.77 ms for the
  77,391-byte sample under Node. This is a parser micro-measurement, not an
  application startup or four-GB-device claim.
- Browser tests use Chromium and an isolated Playwright browser context.
  They do not establish WebKitGTK, WebView2, or WKWebView confinement.
- `pnpm desktop:preflight` passed on Linux with WebKitGTK 2.52.6 and a GUI.
  The first debug WDIO Tauri build was killed by Linux OOM on 2026-09-25 at
  09:23:13: kernel log records a `rustc` process near 9.9 GiB anonymous RSS.
  A single-Cargo-job retry also ended in `rustc` SIGKILL. The native spec
  lives at `tests/wdio/plugin-native.e2e.ts` and was not run because neither
  debug build completed; native confinement remains unverified.

## Inspected visual artifacts

- Actual editor preview: [light manager and rename preview](../../apps/website/public/screenshots/plugins-rename-preview-light.png).
- Actual editor access review: [dark 1024-pixel window](../../apps/website/public/screenshots/plugins-permission-review-dark.png).
- Actual selection Inspector: [light host-rendered analysis section](../../apps/website/public/screenshots/plugins-inspector-analysis-light.png).
- Actual timeout recovery: [failed package with diagnostic, Disable, and Retry](../screenshots/2026-09-25-plugin-system/plugin-failed-retry.png).
- Built marketing page: [desktop](../screenshots/2026-09-25-plugin-system/website-desktop.png) and [mobile](../screenshots/2026-09-25-plugin-system/website-mobile.png). Both were opened and inspected; no horizontal overflow or broken images were detected.
- The three editor captures are registered in the generated website screenshot manifest with hashes and matching canonical copies under `docs/screenshots/product/`. `node scripts/screenshots/validate.mjs` reports 27 captured scenes and zero violations. The docs index and feature-card screenshot changes were visually inspected before updating their exact baselines.

## Honest boundary

The guest package cannot import JavaScript functions, WASI, Tauri, network,
filesystem, or DOM APIs. The host-authored Worker itself has browser APIs, so
this is a constrained Wasm capability boundary, not a separate OS sandbox.
The native main window still has broad first-party Tauri capabilities; the
plugin path does not expose them to guest code. A local publisher label and a
checksum are not authentication or a safety certification.

## Agent Validation Report

Changed scope: application plugin package/runtime/store/manager, trusted
Inspector registry, Settings and menu wiring, Rust SDK and two samples,
domain-local E2E fixtures, website pages and captures, and this documentation.

Validation plan: `pnpm verify:plan --staged` selects touched format/lint and
audits; the changed unit tests, E2E typecheck and plugin browser spec;
editor/desktop package tests and typechecks; and the Settings and plugin E2E
domains. It reports `Full-suite escalation: NO`. Placing the plugin fixture
archives under `tests/e2e/plugins/fixtures/` keeps their scope within the
plugin domain rather than the repository-wide shared-fixture rule. The
website/docs milestone separately selects website unit tests, website
typecheck, and the website browser suite; it also reports no full-suite
escalation.

Commands actually run (from the repository root, with a separate Git index
for this work):

```text
pnpm verify:plan --staged
pnpm verify:affected --staged
pnpm exec vitest run packages/editor/src/plugins/package.test.ts packages/editor/src/plugins/contract.test.ts packages/editor/src/plugins/controller.test.ts packages/editor/src/plugins/wasmLimits.test.ts packages/editor/src/components/Inspector/PluginSections.test.tsx packages/editor/src/components/Inspector/__tests__/pluginSections.test.ts
pnpm exec vitest run packages/editor/src/Menubar.test.tsx packages/editor/src/components/Settings/SettingsDialog.test.tsx packages/editor/src/menu/__tests__/localization.test.ts
pnpm exec vitest run packages/editor/src/plugins/guestWorker.test.ts
pnpm exec vitest run packages/editor --maxWorkers=2
pnpm exec vitest run apps/desktop --maxWorkers=1
pnpm exec vitest run packages/editor/src/StatusBar.test.tsx --maxWorkers=1
pnpm exec vitest run packages/editor/src/menu/__tests__/menuSnapshot.test.ts --update --maxWorkers=1
pnpm --filter @varve/editor typecheck
pnpm --filter @varve/desktop typecheck
pnpm typecheck:e2e
pnpm audit:docs
pnpm audit:emoji
pnpm audit:tokens
pnpm audit:spacing
node scripts/quality/audit-interface-sizing.mjs
node scripts/audit-architecture.mjs --ci
node scripts/audit-health.mjs --staged
cargo fmt --manifest-path examples/plugins/Cargo.toml --all --check
cargo test --manifest-path examples/plugins/Cargo.toml --locked --offline
node examples/plugins/build.mjs
node --experimental-strip-types scripts/plugins/validate.mjs examples/plugins/dist/style-audit.varveplugin
node --experimental-strip-types scripts/plugins/validate.mjs examples/plugins/dist/batch-rename.varveplugin
node scripts/quality/heavy-lease.mjs 'plugin manager final browser spec' -- npx playwright test tests/e2e/plugins/local-manager.spec.ts --project=chromium --workers=1 --reporter=list
VARVE_LEASE_MIN_MEM_MB=4096 node scripts/quality/heavy-lease.mjs 'plugin post-review final browser spec' -- npx playwright test tests/e2e/plugins/local-manager.spec.ts --project=chromium --workers=1 --reporter=list
node scripts/quality/heavy-lease.mjs 'plugin settings affected browser domain' -- npx playwright test tests/e2e/settings --project=chromium --workers=1 --reporter=list
node scripts/quality/heavy-lease.mjs 'settings plugins nav snapshot confirmation' -- npx playwright test tests/e2e/settings/settings-dialog.spec.ts --project=chromium --workers=1 --reporter=list -g 'keeps switch fields labeled'
pnpm --filter @varve/website build
pnpm build:website
pnpm build:website:pages
node scripts/screenshots/validate.mjs
node scripts/screenshots/product.mjs --review-dir /tmp/varve-plugin-reviewed.s09DvR --scenes plugin-rename-preview,plugin-permission-review,plugin-inspector-analysis --sync-reviewed
GIT_INDEX_FILE=<plugin index> VARVE_E2E_WORKERS=1 VARVE_LEASE_MIN_MEM_MB=4096 pnpm verify:affected --staged
VARVE_LEASE_MIN_MEM_MB=3500 node scripts/quality/heavy-lease.mjs 'plugin site snapshot update' -- pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/visual.spec.ts --project=ghpages --workers=1 --update-snapshots -g 'docs page light|features page dark'
VARVE_LEASE_MIN_MEM_MB=3500 node scripts/quality/heavy-lease.mjs 'plugin website targeted browser checks' -- pnpm exec playwright test -c playwright.website.config.ts apps/website/tests/e2e/search.spec.ts apps/website/tests/e2e/visual.spec.ts --workers=1 -g 'desktop trigger opens the dialog with popular destinations|docs page light$|features page dark$'
VARVE_LEASE_MIN_MEM_MB=3500 node scripts/quality/heavy-lease.mjs 'plugin final site captures' -- node --input-type=module
GIT_INDEX_FILE=<plugin index> git commit -m 'feat(plugins): add bounded local Wasm plugin workflow'
```

Passed: both TypeScript package checks and E2E typecheck; 72 focused
package/Inspector unit tests, one guest review security test, 60 menu/Settings
tests, 50 menu snapshot tests, and 80 desktop package tests; six plugin
Chromium scenarios passed again after the static-review security fix; the
commit checkpoint passed all 73 direct plugin/Inspector tests and E2E
typecheck; Rust SDK/sample tests 3/3; both built ZIP ABI smokes and
static checks; docs, emoji, token, interface-sizing, health, and architecture
audits; website build (107 pages); inspected real editor and website images.
The website milestone passed all 239 unit tests, Astro typecheck with zero
diagnostics, and both production/base-path builds. Its first browser run
passed 576 tests and identified four expected integration differences: one
extra search suggestion under both base paths and the docs and feature-index
screenshots. The suggestion was removed to retain the existing five-item
menu; both changed screenshots were inspected and regenerated without
increasing pixel tolerances. The six focused browser checks then passed
across the GitHub Pages and custom-domain builds. The final marketing page
was captured again at 1440 and 390 CSS pixels: zero horizontal overflow and
zero broken images in both, followed by visual inspection.
The Settings domain passed 22/23 tests; its sole mismatch was the reviewed
golden image for the added Plugins navigation row. Its pixel tolerance was
unchanged, and the focused rerun passed against the updated image.

`pnpm verify:affected --staged` stopped in Tier 0 on a raw spacing value in
`packages/editor/src/components/TokenSync/TokenSyncPanel.css`, which was
already staged by another concurrent workspace task and is outside this
change. All plugin spacing findings were fixed; the remaining spacing audit
reports only that Token Sync value. The selected downstream plugin and
Settings tests were run directly as shown above. Native Linux validation was
attempted twice via `pnpm desktop:build:test`; both builds were killed by
memory pressure before the WebKitGTK spec could run. Windows and macOS native
checks require those platforms.

The broad editor package unit run was stopped after about 22 minutes when
swap reached roughly 22/22 GiB and available memory fell near 2 GiB. Before
stopping it, 24 menu snapshots differed solely by the new Manage Plugins
item; the exact snapshot was updated and its 50-test file then passed. It
also found a `StatusBar.test.tsx` cursor-position assertion failure that
reproduces in an isolated run. A separate concurrent task has an unstaged
`StatusBar.tsx` change extracting the cursor readout into a new component;
neither file is in the plugin diff. Another concurrent, unstaged
`workspace/sessionBroker.ts` change and its new test also failed. These
are shared-worktree findings, not evidence of a plugin regression. The
editor package run did not complete, so no package-wide pass is claimed.

A later editor typecheck rerun failed in a different concurrent, unstaged
change: `packages/editor/src/intelligence/autoNamer.test.ts:565` indexes a
literal object with a general string. That test file is absent from the
plugin commit. The plugin-specific typecheck had passed before that change;
the final shared-worktree editor typecheck is therefore not claimed as green.

Skipped as unrelated: Rust workspace tests (new examples form their own
locked workspace, tested above) and the full renderer visual suite (no global
renderer change). The selected website browser suite ran, followed by the
exact repaired checks described above. Full repository suite run: no; neither
milestone planner requested escalation.

## Second pass — completion and integration (2026-09-25)

Baseline for this pass: `78c28571` (the local Wasm plugin workflow above was
already merged). The working tree also carried unrelated concurrent work
(canvas/Token Sync/session broker); all commands below ran against an
isolated Git index containing only the files listed here.

### Defects found and fixed

1. **Native `<select>` in the manager.** The command picker was raw native
   markup, violating the repository rule "No native `<select>` elements."
   Replaced with the shared `@varve/ui` `Select` combobox (visible "Command"
   label kept and wired via `aria-labelledby`; the shared skin and listbox
   own focus and keyboard behaviour). A new repository guard,
   `tests/unit/native-select.test.ts`, fails on raw `<select>` anywhere in
   `packages/` and `apps/` outside the sanctioned `NativeSelect.tsx` primitive.
2. **Cross-realm byte guard.** `parsePluginPackage` rejected anything failing
   `instanceof Uint8Array`, and `checkStoredRecord` did the same for stored
   archives. A structured clone can return a view from another realm (seen
   with `fake-indexeddb` under jsdom), which made a valid stored package
   repair-disable as "not bytes". The check is a sanity guard, not a security
   boundary: both now use `ArrayBuffer.isView` and normalize through
   `Uint8Array.from` before any validation, size, identity, or digest work.
3. **Empty-transaction commit on apply.** If `apply()`'s inner revalidation
   no-oped, `commitTransaction` still pushed the snapshot: an empty undo
   entry that cleared redo and reported a phantom success. `apply()` now
   tracks whether the updater changed the document and aborts with "The
   document changed; run the preview again" instead. The pre-check and commit
   are synchronous today, so this is source-level hardening against future
   async re-entry, not a reproduced live race.
4. **Declared-but-unreachable panel hide.** `hideContribution` /
   `showContribution` existed with registry tests but had no user route and
   no persistence (registration state was session-local). Hiding is now owned
   by the installation record (`StoredPlugin.hiddenPanels`), mirrored into
   the registry on every reconciliation, re-applied on fresh registration
   after reload, retained across update and rollback when the panel is still
   declared, dropped with uninstall, and exposed in the manager card as one
   Show/Hide control per contributed panel. It never touches the document,
   undo history, permissions, or runtime state.

### New browser coverage (task scenario letters)

`tests/e2e/plugins/local-manager.spec.ts` now runs 10 scenarios (was 6):

- **A (extended):** mixed vector + ellipse + text selection analysed in one
  run — "Selection style audit: 3 layers", "shape 2, text 1", real font
  family line, zero locked; the same result renders in the host Inspector
  contribution; layer count unchanged.
- **B (extended):** two selected layers with one locked through the layers
  context menu — preview proposes exactly one rename, the locked name is
  untouched, and undo/redo stay coherent after the package is installed.
- **C:** two installed plugins — analysis result obtained first, then the
  noncooperative loop fixture occupies the second job slot; the first
  result and both cards' states survive the other plugin's Stop.
- **D:** hide a contributed panel, verify it leaves the Inspector, reload
  the app, find the preference persisted on the card, show it again, and
  confirm the section renders with a selection.
- Previously passing A/B/E/F/G scenarios were re-run unchanged in the same
  pass (install/inspect/disable/persist, update permission diff + rollback,
  noncooperative Stop + timeout quarantine + Retry, revoke-during-run).

### Unit and guard coverage added

- `packages/editor/src/plugins/controller.panels.test.ts` (5 tests, real
  `fake-indexeddb` store, valid packaged record): ready registration,
  hide mirrored into the registry and record, unknown-panel rejection,
  show round-trip, and a fresh-session restore via `vi.resetModules()` with
  the same local store.
- `tests/unit/native-select.test.ts` (2 tests): repository-wide raw
  `<select>` guard with `NativeSelect.tsx` whitelisted.
- Existing plugin/Inspector suites re-run green (80 tests across 9 files).

### Commands and results (second pass)

```text
pnpm exec vitest run packages/editor/src/plugins packages/editor/src/components/Inspector/PluginSections.test.tsx packages/editor/src/components/Inspector/__tests__/pluginSections.test.ts tests/unit/native-select.test.ts tests/unit/button-system.test.ts
  → 10 files, 83 tests passed
pnpm --filter @varve/editor typecheck            → clean
pnpm typecheck:e2e                               → clean
pnpm exec biome check <10 touched source files>  → clean (3 files reformatted first)
pnpm audit:docs                                  → clean (1067 docs, 624 links)
pnpm audit:emoji                                 → clean (4999 files)
pnpm audit:spacing                               → only the pre-existing TokenSyncPanel.css raw value (other task's dirty file); all plugin CSS clean
node scripts/quality/audit-radius.mjs            → pre-existing flags only (PluginManager.css:999px status pill and PluginHostSection.css:22 exist at baseline); not part of the affected plan
node scripts/quality/audit-token-usage.mjs       → clean
node scripts/audit-health.mjs --staged           → health check passed
node scripts/quality/audit-interface-sizing.mjs  → clean
GIT_INDEX_FILE=<plugin index> pnpm verify:plan --staged   → 10 files, @varve/editor only, Full-suite escalation: NO
GIT_INDEX_FILE=<plugin index> pnpm verify:affected --staged
  → PASS format:touched, lint:touched, audit:emoji, audit:docs, typecheck:e2e,
    js-unit for controller.panels/controller/package/native-select,
    e2e:file tests/e2e/plugins/local-manager.spec.ts (370s),
    js-unit:@varve/editor (1051s, 7957+ tests), typecheck:@varve/editor,
    js-unit:typecheck @varve/desktop, policy
  → FAIL ci-tools — contaminated by the planner's own regression test
    (affected-plan.test.mjs runs `git add docs/capture.md`, which inherited
    GIT_INDEX_FILE and staged a blob that exists only in its temp repo).
    Entry removed, index rebuilt from HEAD, then:
pnpm test:ci:tools (standalone, no GIT_INDEX_FILE) → 23 passed, 0 failed
node scripts/quality/heavy-lease.mjs 'plugin manager extended browser spec' -- npx playwright test tests/e2e/plugins/local-manager.spec.ts --project=chromium --workers=1 --reporter=list
  → 10 passed (3.2m) on the second run after fixing the kind-name
    assertion (guest snapshots report `kind: shape` for vector shapes,
    not the geometry subtype)
```

A first full-editor-package attempt inside the same gate recorded 2 failures
in `TokenSyncPanel.test.tsx`; that file is another concurrent task's dirty
work and passed 17/17 in isolation minutes later. Classified as a
shared-worktree race, not a plugin regression; the re-run above is green.

### Inspected visual artifacts (second pass)

Captured by the passing browser run and opened for inspection:

- Light manager card with the shared `Select` command picker, status chip,
  and the new Inspector panels row (`test-results/…/plugin-installed.png`).
- Mixed-selection analysis result in the card: "3 layers",
  "shape 2, text 1", font-family line (`…/plugin-mixed-analysis.png`).
- Rename preview with Apply and the panels row
  (`…/plugin-rename-preview.png`).
- Fault-loop quarantine: Failed chip, time-limit diagnostic, Retry route
  (`…/plugin-failed.png`).
- Dark 1024-pixel permission review (`…/plugin-review-dark-1024.png`);
  the same test asserts zero horizontal overflow of the dialog content.

No layout, theme, or focus regression was detected. The canonical website
product screenshots still show the previous command control and should be
recaptured in the next website milestone (visual difference is the picker
skin only).

### Limitations of this pass (unchanged from the honest boundary above)

- Native Linux/Windows/macOS WebView verification remains blocked: the
  earlier debug builds on this machine were OOM-killed (kernel log: rustc
  near 9.9 GiB RSS) and available memory has not allowed a retry; the WDIO
  spec `tests/wdio/plugin-native.e2e.ts` is still unrun.
- Chromium E2E does not establish WebKitGTK/WebView2/WKWebView confinement.
- Not exercised in the editor: image-kind nodes in a plugin analysis (the
  SDK ABI smoke already uses a frame/text/image selection), nested-frame
  rename fixtures, cross-profile document portability, and a multi-hour
  resource plateau.
- The website feature/docs pages were not regenerated for the panel-hide
  control; no claim there contradicts it.

