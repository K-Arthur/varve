# Local plugin API v1 hardening and manager discovery: validation record

Date: 2026-09-27. Work and commits are on the shared `master` branch. The
requested starting revision was
`757e507e3b25aa6ae24220424fd815ba43cde9df`; concurrent work advanced
`master` during this task. No push, deployment, or remote setting change was
performed.

## Agent Validation Report

Changed scope: plugin Wasm feature/ABI validation; IndexedDB revisions and
transactional replacement; cross-window authorization and lifecycle/safe-mode
recovery; plugin manager thumbnails, search, pinning, filters, and sorting;
sample SDK packages and fixture generation; architecture/evidence docs; website
feature/docs copy and current screenshots.

Validation plan: `GIT_INDEX_FILE=/tmp/varve-plugin-discovery-implementation-a8ed44b82c6e.index pnpm verify:plan --staged`
selected 22 changed files and `@varve/editor`. It selected changed-file
format/lint, emoji/radius audits, E2E typecheck, focused plugin unit tests,
manager E2E, editor/desktop unit and typecheck lanes, and the plugin E2E
domain. Full-suite escalation was `NO`. A separate full checkpoint was run
because the requested IndexedDB migration and foundational authorization guard
meet the repository's explicit escalation rule.

The website/docs milestone plan selected 23 staged files and
`@varve/website`: format/lint, emoji/radius/docs audits, website unit/typecheck,
and website E2E. Full-suite escalation was `NO`.

Commands actually run:

- `GIT_INDEX_FILE=/tmp/varve-plugin-discovery-implementation-a8ed44b82c6e.index pnpm verify:plan --staged`
  — produced the 22-file implementation plan above.
- `GIT_INDEX_FILE=/tmp/varve-plugin-discovery-implementation-a8ed44b82c6e.index pnpm verify:affected --staged`
  — format/lint, emoji/radius audits, E2E typecheck, focused plugin tests
  (27/27), and plugin manager E2E (18/18) passed. The editor package unit lane
  then reported seven unrelated failures, so the runner stopped before the
  remaining package/typecheck and plugin-domain lanes. Across that package run,
  8,202 tests passed, two were skipped, and seven failed in workspace
  navigation, mode/panel registries, layout deletion, and text-edit overlay
  tests. No plugin test failed. The radius-lane registration used by the gate
  belongs to another in-progress change and was not staged into this plugin
  commit.
- `GIT_INDEX_FILE=/tmp/varve-plugin-docs.index pnpm verify:plan --staged`
  — produced the 23-file website/docs plan above.
- `GIT_INDEX_FILE=/tmp/varve-plugin-docs.index pnpm verify:affected --staged`
  — format/lint, emoji/radius/docs audits passed. Website unit tests reported
  238 passed and the same one unrelated missing
  `performance-settings-dark.png` manifest entry, so the runner stopped before
  its website E2E lane. Website typecheck and the targeted two-base website E2E
  were run separately and passed.
- `pnpm audit:radius` on the current shared worktree — passed (2,576 active
  source files, 1,462 CSS radius declarations, 54 inline declarations, 10
  documented geometry exceptions, and no legacy consumer).
- `pnpm audit:tokens` — passed all 303 token pairs across three themes; the
  usage scan checked 580 custom properties and nine documented override hooks.
- `pnpm audit:docs` — passed (1,092 docs, 665 links, 177 ADRs indexed).
- `pnpm typecheck:e2e` — passed on the current shared worktree.
- `pnpm --filter @varve/website typecheck` — passed Astro checking for 162
  files with no errors, warnings, or hints.
- `pnpm exec vitest run packages/editor/src/plugins/package.test.ts packages/editor/src/plugins/controller.test.ts --reporter=dot`
  — passed, 27 tests.
- `node examples/plugins/build.mjs --package-only` and
  `node --experimental-strip-types scripts/plugins/validate.mjs <package>`
  — passed package construction and static validation for the sample and E2E
  fixtures; validation accepted eight archives.
- Plugin manager E2E — passed 18/18 tests, including the full local inventory,
  artwork alt text, description/command search, pin/filter/sort, responsive
  manager, permissions, lifecycle, and recovery cases. This was the browser
  lane in the staged affected gate on current `master`.
- `node scripts/quality/heavy-lease.mjs 'e2e: final plugin recovery visual captures' -- env VARVE_LEASE_TIMEOUT=3600000 VARVE_E2E_OUTPUT_DIR=plugin-visual-final VARVE_E2E_PORT=1534 pnpm exec playwright test tests/e2e/plugins/local-manager.spec.ts --project=chromium --workers=1 --grep 'keeps plugin recovery available while safe mode suppresses contributions|stops a noncooperative guest and quarantines a timed-out retry|shows new access on update and restores the last working package|keeps the current plugin usable when its rollback archive is corrupted' --reporter=list`
  — passed 4/4 and retained the safe-mode, timeout, rollback, and corrupt
  rollback screenshots for inspection.
- `pnpm build:website` and `pnpm build:website:pages` — both passed.
- `node scripts/quality/heavy-lease.mjs 'e2e: plugin feature and guide at root and GitHub Pages bases' -- env VARVE_WEBSITE_E2E_PORT=44341 VARVE_WEBSITE_E2E_PORT_ROOT=44342 pnpm exec playwright test --config=playwright.website.config.ts apps/website/tests/e2e/plugins-pages.spec.ts --project=custom-domain --project=ghpages --workers=1 --reporter=list`
  — passed 2/2. Desktop and mobile routes checked image loading, correct
  GitHub Pages asset paths, and horizontal overflow.
- `pnpm test:website` — 238 passed and one failed because an unrelated
  shared-tree page references the missing
  `performance-settings-dark.png` screenshot-manifest entry.
- `node scripts/screenshots/validate.mjs` — all plugin screenshot hashes and
  dimensions validate; it reports the unrelated orphan
  `apps/website/public/screenshots/performance-settings-dark.png` and its
  5.58 MB captured PNG set above the existing 5 MB advisory threshold.
- `node scripts/audit-architecture.mjs --ci` — passed separately: 14
  dependency cycles, no layer violations, and 41 maximum unstable modules
  against the enforced ceiling of 49. Shared hub-budget warnings concern
  Menubar/context and are outside this plugin change.
- 50 lifecycle cycles — 150 Workers created and terminated, zero active at
  completion; Chromium heap delta was 0 bytes. This measures JS heap, not
  browser-process RSS or all native allocations.
- `VARVE_FULL_GATE_REASON='IndexedDB v2 migration and foundational plugin authorization guard' pnpm verify:full`
  — attempted once in the isolated validation snapshot at
  `04abd6a16124a710eb9499bd68d6947c0262732a`. The architecture dead-export stage hit its own
  `ts-prune` timeout. The gate continued to workspace typechecks, then stopped
  on unrelated `WorkspaceMode` errors for `"logo"` in
  `packages/scene/src/auditAdapter.ts:365` and
  `packages/scene/src/logo/logoAudit.test.ts:20`. Downstream full unit,
  Rust, and browser stages did not run. The full checkpoint was not repeated.
- Linux native: `pnpm --dir apps/desktop exec vite build --mode wdio` passed.
  The Tauri debug build passed using
  `pnpm --dir apps/desktop exec tauri build --debug --no-bundle --config src-tauri/tauri.test.conf.json --config /tmp/varve-plugin-tauri-skip-tsc.json --features wdio`;
  the temporary config skipped the repository's unrelated failing
  pre-build typecheck and still embedded the freshly built Vite app. The
  focused WDIO plugin spec passed 1/1 on Linux WebKitGTK 605.1.15
  (WebKitGTK 2.52.6, GTK 3.24.52). The binary SHA-256 is
  `33c6e5f972227ba49ca0ee468ea952546fbc123b2be470f3029d8f338ecfa78e`;
  embedded app entry SHA-256 is
  `c8197bd6294f35d8c858738232c10b4a8916b11814d31276b1b720b1781ae326`.
  The build source baseline was `04abd6a16124a710eb9499bd68d6947c0262732a`
  plus the plugin working diff. Chromium/Playwright output was not counted as
  native evidence. The plugin source diff used for the build hashes to
  `8183b25160455af15ab87b541de481fdb3a375b6e3970707912debd0f8445d3e`.
- `pnpm desktop:preflight` — passed; confirmed the available Linux native
  dependencies. Windows/WebView2 and macOS/WKWebView were not available here.

Passed: affected static checks, focused parser/controller tests, package
building and static fixtures, plugin manager and recovery-capture browser
scenarios, website builds and route browser checks, token/radius/docs and
separate architecture audits, the 50-cycle lifecycle resource check, and the
source-matched Linux WebKitGTK install/run/review/apply/remove scenario.

Skipped as unrelated or unavailable: remaining package/typecheck and plugin
domain lanes were not run after the affected editor package unit lane failed.
Full Rust workspace tests and the full application visual suite did not reach
execution after the full checkpoint's unrelated typecheck failure. The website
unit failure and screenshot-validator orphan are outside the plugin
implementation. Windows/WebView2 and macOS/WKWebView remain unverified. The
complete forced-colors, reduced-motion, every-theme, and assistive-technology
matrix remains to be run.

Escalations: one justified `pnpm verify:full` migration/auth checkpoint was
attempted and failed before full tests for unrelated repository type errors.
Native WebKitGTK was built and tested with the above documented pre-build
typecheck override; platform evidence was not inferred from Chromium.

Full suite run: no. The explicit full gate was attempted, but exited during
workspace typechecking before full unit/Rust/browser stages.

If yes, reason: the checkpoint was requested for the IndexedDB schema migration
and foundational authorization changes.

## Implementation and acceptance status

- Implemented: the guest Wasm validator accepts only the numeric function
  types and ABI signatures supported by the Rust SDK, rejects reference/GC
  types and imports before guest execution, and distinguishes the linear-memory
  ceiling from engine/process overhead. IndexedDB v2 adds durable revisions;
  compare-and-replace install/removal and the installation cap are transactional.
  Selection reads and document Apply are guarded by authoritative installation
  revisions and revalidated immediately before synchronous mutation. Cross-window
  notices invalidate caches but never grant access. Rollback removes obsolete
  commands; safe mode suppresses contributions/execution while preserving
  manager recovery and saved enable preferences. API v1 and canonical document
  serialization remain unchanged.
- Thumbnail contract: optional `description` and
  `thumbnail: { "path": "thumbnail.png", "alt": "..." }` metadata; one fixed
  static PNG path, at most 256 KiB and 512×512 pixels. The parser verifies
  declaration, dimensions, PNG chunk structure and CRC, rejects APNG and
  undeclared archive assets, and falls back to host-generated initials.
  Thumbnail art is untrusted presentation data, not publisher verification.
- Frontend: local plugin cards show artwork and alternate text, descriptions,
  searchable names/publishers/commands/descriptions/IDs/status, explicit
  All/Pinned/Needs attention filters with inventory counts, and A–Z/recent sort.
  Pins are presentation preferences separate from grants. Disabled, failed,
  and incompatible installs remain visible with recovery actions. Manager
  package controls remain available while plugin commands run.
- Automated-pass: package parser/controller tests (27/27); plugin manager E2E
  (18/18); website route E2E (2/2); Linux native WDIO (1/1); package fixture
  validator (8 archives); and 50 repeated lifecycle cycles. Additional authored
  E2E cases cover two-window revocation, stale Apply, rollback/corrupt archives,
  safe mode, mixed selections, locked targets, undo/redo, save/reopen/export,
  competing Workers, and repeated teardown.
- Visually inspected: manager discovery, permission review, analysis/Inspector,
  rename preview/apply, native removal, safe-mode startup and recovery manager,
  command-timeout error, successful rollback, and the retained current package
  after a corrupt rollback archive. The browser recovery captures are linked
  below. Product captures are checked in under `docs/screenshots/product/` and
  mirrored to `apps/website/public/screenshots/`. The plugin feature/guide was
  inspected at desktop and mobile sizes on custom-domain and GitHub Pages
  bases; the verified pages rendered all images without horizontal overflow.
  The manager E2E covers a narrow window and 200% text sizing. Full
  forced-colors, reduced-motion, every-theme, and screen-reader manual coverage
  is still pending.
- Native-verified: Linux WebKitGTK only, with the exact binary and bundle
  hashes above. Windows/WebView2 and macOS/WKWebView have prepared guidance but
  no run evidence.
- Blocked/deferred: the affected gate stopped after unrelated editor workspace
  test drift; the full checkpoint snapshot stopped on unrelated scene-package
  `WorkspaceMode` typing and an architecture dead-export timeout. Those
  repository failures were not repaired as part of plugin work. The website
  unit failure and screenshot-manifest orphan remain unrelated shared-tree
  defects.

### Recovery screenshots

These Chromium E2E captures were opened and reviewed. They document UI state;
they are not native-platform proof.

- [Safe-mode startup](../screenshots/plugin-system-acceptance/plugin-safe-mode-startup.png)
- [Manager while safe mode is active](../screenshots/plugin-system-acceptance/plugin-safe-mode-manager.png)
- [Timed-out command recovery actions](../screenshots/plugin-system-acceptance/plugin-failed.png)
- [Successful package rollback](../screenshots/plugin-system-acceptance/plugin-rollback-restored.png)
- [Corrupt rollback keeps the current package usable](../screenshots/plugin-system-acceptance/plugin-corrupt-rollback-retained.png)

## Migration and recovery

IndexedDB version 2 adds the revisions object store in an additive upgrade. The
upgrade seeds revision 1 for existing plugin records without rewriting package
bytes, grants, enabled preferences, Inspector preferences, or recovery archives.
Each accepted update and removal advances a durable revision in the same
transaction as the package write; a removal leaves a tombstone so
uninstall/reinstall cannot return to an old revision. The 32-installation cap is
checked in that transaction. BroadcastChannel messages invalidate other
windows' cached state, while each privileged read and Apply checks the
authoritative record and revision.

Package update rollback retains the previous validated archive and does not
expand grants. A failed update leaves the previous installation usable; explicit
rollback removes commands contributed by the failed version. The migration is
forward-only and non-destructive: downgrading the application does not delete or
rewrite newer IndexedDB data. This does not promise recovery after browser
profile corruption or user-cleared site data.
