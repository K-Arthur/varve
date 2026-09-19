# Repository Hygiene Audit — Progress Ledger

**Date:** 2026-07-26 (pass 1, complete) / **2026-08-04 (pass 2, complete) / 2026-08-12 (pass 3, complete) / 2026-08-16 (pass 4, complete) / 2026-08-21 (pass 5, complete) / 2026-08-22 (pass 6, complete) / 2026-08-24 to 2026-08-25 (pass 7, complete) / 2026-09-19 (pass 8, complete)**
**Branch:** master

> Working ledger for hygiene audits. Pass 8 is documented below; pass 1–7
> history is retained further down.

---

## Pass 8 (2026-09-19)

Repository-wide cleanup pass (misplaced docs, plans lifecycle, repository
metadata, tooling drift) executed against a shared dirty tree carrying
concurrent unrelated work from other sessions. Only this pass's own changes
were staged; no concurrent modification was reverted, overwritten, or staged.
The full gate was not run — `pnpm verify:plan` escalates to `FULL-SUITE
ESCALATION: YES` solely because of the concurrent workspace/toolchain edits in
the tree, and this pass touches documentation, ignore rules, and two tooling
scripts only.

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `UI_UX_PANEL_CANVAS_{AUDIT,TARGET,VERIFICATION}.md` (repo root) | Misplaced current-state docs — the only inbound reference was `docs/audits/ui-visual-optimization-2026-09-12.md`, and neither README nor the docs index mentioned them | Yes | `git mv` to `docs/audits/ui-ux-panel-canvas-{audit,target,verification}-2026-08-29.md`; fixed all three cross-references; added the trio plus the previously unindexed `ui-visual-optimization-2026-09-12.md` to the `docs/README.md` audit table | Done |
| `docs/repository-hygiene-progress.md` | Contradictory metadata — `.gitignore` created the file as "temporary" on 2026-07-25, but passes 6 and 7 deliberately committed it; the rule matched a tracked file and did nothing | Yes | Removed the stale `/docs/repository-hygiene-progress.md` ignore rule; ledger remains tracked | Done |
| `.tmp-export-*.mjs`, `.tmp-inspect-onnx.mjs`, `.tmp-tabbar-diag.mjs` (root) and `packages/engine/.tmp-{gd-probe,inspect-onnx,matte-gray}.{mjs,cjs}` | Unignored scratch — days-old one-off diagnostics with zero tracked references (`export-surfaces-review-2026-09-17.md` already describes its capture script as transient) | No (untracked) | Added `.tmp-*` to `.gitignore`; moved the files to `/tmp/opencode/varve-leftovers-2026-09-19/` (recoverable) | Done |
| `.tmp-layers-capture/` | Scratch capture dir for the concurrently active Layers work | No (untracked) | Left in place; now covered by the `.tmp-*` ignore rule | Done |
| `.flatpak-builder/`, `.codex/`, `.agents/` | Unignored build cache / local AI-tool dirs (only untracked content) | No | Added ignore rules alongside the existing `.claude/` and `.devin/` entries | Done |
| `playwright.{depth,retouch,photo-verify,export-inspector}.local.config.ts` | Untracked local-run configs whose own headers declare them "not part of the committed test matrix" (machine `/var/tmp` and `/dev/shm` accommodations) | No (untracked) | Added `/playwright.*.local.config.ts` with an explicit `!playwright.layer-fidelity.local.config.ts` exception for the committed config | Done |
| `docs/plans/{logo-system-progress,persistent-history-progress,workspace-navigation-progress,deterministic-undo-progress,bg-removal-deferred,export-system-deferred,export-infrastructure-redesign}.md` | Completed plans presented as active — each self-declares completion (milestone tables all landed; export workstreams "complete") | Yes | Archived to `docs/plans/archived/` with status banners; repaired relative links for the new depth; updated all inbound references (AGENTS.md, architecture docs, audits, the export progress ledger) | Done |
| `docs/plans/export-system-deferred.md` (header) | Stale claim — the 2026-07-07 header said the print-engine workstream (font outlining, PDF/X, ICC CMYK) was "still-open" while the same file's Completion Status and `crates/varve-print/{outline,cmyk,icc}.rs` show it implemented; also cited an undated audit path | Yes | Rewrote the header to match reality; corrected the audit citation to `import-export-compatibility-audit-2026-07-07.md` | Done |
| `docs/architecture/canvas2d-system.md:6` (`docs/audits/canvas-system-audit.md`) and `icon-library.md:6` (`docs/architecture/icon-system-audit-2026-08-02.md`) | Stale code-span path citations invisible to `audit:docs` link checking (targets renamed/moved to dated names and `docs/historical/`) | Yes | Corrected both paths | Done |
| `.github/CODEOWNERS:15` | Broken path — `/.github/hooks/` does not exist; hooks live in `.githooks/` (and were absent from CODEOWNERS) | Yes | Replaced with `/.githooks/` | Done |
| `scripts/generate-icons.sh:3` | Stale pre-rename path in the shim comment (the retired master-icon filename); master art is `varve-app-icon.svg` | Yes | Corrected the comment; shim still delegates to `apps/desktop/build-icons.sh` | Done |
| `scripts/release/product.mjs` | Legacy fallback — `documentExtension()` fell back to `'strata'` (and documented it as the example) although `tauri.conf.json` registers `["varve"]` first; `verify-product-truth.test.mjs` asserts the `varve` expectation | Yes | Fallback and comment changed to `varve` | Done |
| `scripts/audit-workspace-api.mjs` | Stale allowlist entry — `packages/editor/src/workspace/useWorkspace.ts` no longer exists; `__setWorkspaceModeUnsafe` now lives in `context/useWorkspaceMode.ts`; script had been failing against the moved file | Yes | Updated the allowlist entry; ran the enforcer (clean, 4629 files) rather than deleting the only guard for the one-switch-path invariant | Done |
| `scripts/validate-pdf.ts`, `scripts/check-lint-trend.mjs`, `scripts/audit-touched-files.mjs` | Orphaned/superseded tooling — the `.ts` PDF validator targeted nonexistent fixtures and was superseded by `validate-pdf.sh` (CI shell-checked); the lint-trend script invokes a `poke` tool that does not exist anywhere; the touched-files enforcer is superseded by the Tier-0 `lint:touched`/`format:touched` verify lanes and was never wired into `just gate` as its header claimed; all three have zero references | Yes | Deleted (git history retains them) | Done |

### Investigated, no action needed (pass 8)

- **Screenshot orphan analysis** (62 files with no per-filename reference, mostly in `2026-09-17-toolbar-review/`, `2026-09-15-toolbar-review/`, `2026-09-15-workspace-switcher-review/before/`, `shape-builder/2026-09-14-verification/`): every file sits in a dated evidence directory referenced at directory level by its audit, the capture workflow is currently active (34 toolbar-review PNGs are regenerated in the dirty tree), and the repo deliberately commits dated screenshot evidence — preserved as an owner-review list rather than deleted.
- **`.windsurf/plans/`**: documented as intentional brand-history artifacts by `documentation-truth-audit-2026-08-16.md`; kept.
- **`tests/reference/`** (untracked CPU/GPU model-comparison PNGs, ~1.2 MB, zero references): preserved as uncommitted evidence; owner should decide track/ignore/remove.
- **Stale pre-rename-name comments in `scripts/audit-perf.mjs` / `audit-emoji.mjs`** (references to section numbers of the original pre-rename planning spec) and the legacy document-extension/MIME/storage-key identifiers: intentional historical/compat references under the rename policy; left untouched.
- **`docs/agents/session-history.md`**: phantom citation `docs/superpowers/plans/pre-existing-test-failure-investigation.md` (never existed in history) and undated plan paths in session records — historical point-in-time records, left unedited.
- **Plans with self-contradictory status (reviewed in the pass 8 follow-up below)**: `frequency-separation-liquify-plan.md`, `deterministic-undo-redo-engine.md`, `tools-deferred.md` verified and archived; `pages-frames-surface-model.md` header corrected and kept (edge cases remain open); `website-progress-tracker.md` and `layers-panel-deferred.md` left for the active website/layers workstreams.
- **Unwired-but-plausible tooling**: `scripts/release/re-sign-release-feed.mjs` (its one-shot workflow no longer exists, needs CI-only secrets — release-adjacent, so not deleted), `scripts/patch-manifest.mjs` (one-off manifest mutator for a field absent from the current manifest), `scripts/regenerate-menu-matrices.test.mjs` (a real drift gate whose counts/hardcoded matrix expectations currently fail because `defs.ts` carries concurrent uncommitted menu growth — do not wire until the owning session regenerates the matrices), and manual helpers `scripts/{visual-review,inspect-bundle}.mjs`, `scripts/release/update-packaging.sh`, `apps/desktop/scripts/verify-icons.sh`.
- **Icon/lighting scripts** (`just generate-icons`, `scripts/install-dev-icons.sh`) and WebKitGTK/Flatpak paths: verified current; the earlier-refactor icon flow already points at `varve-app-icon.svg` outside the shim comment fixed above.

### Verification (pass 8)

| Gate | Result |
|------|--------|
| `node scripts/audit-docs.mjs` | Passed (1028 docs, 575 links, 175 ADRs indexed) |
| `node scripts/audit-emoji.mjs` | Passed (4888 files) |
| `node --test scripts/release/{release-pipeline,linux-package-metadata,verify-product-truth}.test.mjs` | Passed (3/3 files) |
| `node scripts/audit-workspace-api.mjs` | Passed after the allowlist fix (4629 files) |
| `node scripts/quality/verify.mjs plan` | Reported `FULL-SUITE ESCALATION: YES` — reason: concurrent workspace/toolchain edits already in the shared dirty tree (not this pass's changes). Full suite deliberately not run for a docs/metadata pass. |
| `git status` review | Concurrent modifications left untouched. An external index reset mid-pass left this pass's moves as delete + untracked in `git status` (worktree content is correct; `git add -A` restores rename detection) |

### Pass 8 follow-up (2026-09-19) — candidate review

The deferred candidate list above was subsequently reviewed; items with strong
evidence were actioned, items owned by an active workstream or of release-level
sensitivity were recorded instead of changed.

| Item | Action | Status |
| ---- | ------ | ------ |
| `docs/plans/{frequency-separation-liquify-plan,deterministic-undo-redo-engine,tools-deferred}.md` | Verified against code (`docs/architecture/frequency-separation-liquify.md` + two E2E specs exist; `packages/history/src/rasterTileStore.ts` exists; `NodeEditTool.ts`, `snapping.ts`, boolean registry entries, floating palette all present); banner added; archived | Done |
| `docs/plans/pages-frames-surface-model.md` | Header corrected to "decisions implemented (2026-08-08); edge cases remain open" — the plan itself says the edge-case list is unfinished; kept in `plans/` | Done |
| Ten unindexed architecture docs + `design-token-system.md` | Index rows added to the `docs/README.md` architecture table | Done |
| `theme-system.md` ↔ `design-token-system.md` competing token authority | Explicit cross-links added in both docs (token ownership/lifecycle vs surface/identity tiers) | Done |
| `inspector-spec.md` ↔ `inspector-spec-pass2.md` precedence | Precedence recorded in the `docs/README.md` Inspector entry (pass 2 governs forward work; pass 1 retains its `IMPL-` history); the spec files themselves not edited while the Inspector workstream is active | Done |
| `.github/workflows/model-validation.yml` unused `full_validation` dispatch input | Removed (declared, never referenced); `validate-workflows` passes | Done |
| `scripts/audit-contacts.test.mjs` | Ran clean; added to `pnpm test:ci:tools` (its header already claimed membership) | Done |
| `docs/audits/onnx-model-decision-matrix.md`, `intelligence-feature-roadmap.md` | Zero inbound references; renamed with their internal dates (2026-07-21) per the dated-record convention | Done |
| `scripts/regenerate-menu-matrices.test.mjs` | Not wired: the drift gate is correct but fails on concurrent uncommitted growth in `packages/editor/src/menu/defs.ts`; the owning session must run `node scripts/regenerate-menu-matrices.mjs` and refresh the hardcoded per-menu counts before it can join CI | Reported |
| 62 screenshot orphans; `tests/reference/` (untracked model-comparison corpus); `zz-*.spec.ts` diagnostics; `visual-validate-overlap.mjs`; `scripts/release/re-sign-release-feed.mjs`; `scripts/patch-manifest.mjs`; `docs/audits/deferred-lint-debt.md`; `session-history.md` phantom citation | Reviewed and retained: dated screenshot evidence sets are referenced at directory level and partly regenerated by active work; `tests/reference/` has no tracked generator; the diagnostics may still belong to open investigations; the scripts are release/manifest-adjacent; `deferred-lint-debt.md` is a current suppressions register; the phantom citation is inside a historical record | Reported |

---

## Pass 7 (2026-08-24)

Post-0.2.1-release drift sweep (release shipped same day, commit `abe6a17d`
through `9b3410a3`). Full-scope documentation truth audit per the standing
methodology; focused on drift accumulated since pass 6 (2026-08-22) rather
than re-auditing already-verified areas. Three parallel read-only research
passes covered: (a) new 0.2.1 feature docs vs. code, (b) getting-started/dev
docs vs. reality, (c) release/signing/CI docs vs. workflows. Result (b) and
most of (c) found no genuine problems — this repo's release/signing docs
already followed the "document credential-dependent vs. implemented, never
overclaim" discipline the audit calls for.

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `.github/workflows/release.yml` (checkout step comment, ~line 426) + `scripts/release/check-bundled-assets.mjs` (header comment) | Stale: both claimed `.onnx` models are "LFS-tracked" via `.gitattributes`; LFS was fully retired 2026-08-20 (980 MB ddcolor source exhausted the free bandwidth quota) and models are committed directly | Yes | Rewrote both comments to describe the current no-LFS state; kept the pointer-guard rationale as defense-in-depth against a future accidental LFS re-adoption. Flagged but not actioned in pass 6 ("out of docs scope"). | Done |
| `CHANGELOG.md` `## [0.2.1]` "Changed" — updater feed bullet | Overclaim: stated the v0.2.0 feed "was re-signed and republished under these targets" (Windows NSIS + macOS), but the committed `apps/website/public/updates/stable.json` (last touched 2026-08-22, before the tag) only has `linux-x86_64`/`linux-aarch64` entries — the feed generator gained Windows/macOS *capability*, but that republish only actually covered Linux | Yes | Rewrote the bullet to separate "generator now supports these targets" (true) from "the v0.2.0 republish covered Linux AppImage targets only" (what actually happened); this is the same gap pass 6 flagged as "cannot substantiate, flag for release-owner confirmation" — it has since shipped as dated release-note text, so left un-fixed it would now actively mislead a user about cross-platform auto-update coverage | Done |
| `docs/plans/selection-system-implementation.md` | Completed plan masquerading as active work — phases 4/6/7/8 marked "pending" (2026-08-23) for editor UI wiring that landed later the same day (`2671cf33`) and shipped in 0.2.1; verified against real code (`SelectionSourcesPanel.tsx`, `context.tsx` quick-mask state, `createActionHandlers.ts` refine/transform actions, `menu/defs.ts` Pixel Selection submenu) — all present and wired | Yes | Added a status banner (complete, points at the new architecture doc and the validation report's "Deferred UI completion" section) and archived to `docs/plans/archived/` per the pass 3–6 convention; fixed the two path references in `docs/audits/selection-validation-report-2026-08-23.md` | Done |
| Missing canonical architecture doc for the pixel/node selection-tool system (pixel lasso, quick mask, refine, transform, image-derived sources, saved area selections) | Missing documentation — a major 0.2.1 feature area had only a dated pre-work audit and a now-archived plan, no current-state doc | No (new) | Wrote `docs/architecture/selection-system.md`, verified against source (menu defs, action handlers, engine modules) rather than restating the plan/audit; indexed in `docs/README.md` with a disambiguating note against the pre-existing `architecture/object-selection-system.md` (AI/SAM2 object selection — a different system) | Done |
| `docs/release/linux-ecosystem-readiness.md` (:20, :155), `docs/release/distribution-decision-matrix.md` (:32) | Stale version-gate labels — AUR readiness gated on "v0.1.3" / "Later — v0.1.1"; repo is now at v0.2.1, AppStream metainfo has shipped since v0.2.0 (3 `<release>` entries in the metainfo XML), and today's commit `9b3410a3` re-verified the PKGBUILD against the real published v0.2.1 AppImage | Yes | Updated gate labels to reflect current reality: technically ready now, blocked only on human AUR account/push steps (already accurately described elsewhere in the same doc) — not a version milestone | Done |
| `docs/README.md` index gaps | New 2026-08-23 dated audits (`selection-system-audit-2026-08-23.md`, `selection-validation-report-2026-08-23.md`) unindexed since pass 6 predates them | Yes | Added rows | Done |

### Investigated, no action needed (pass 7)

- Old-name audit (the pre-rename product name — see TRADEMARKS.md for the retired name itself): ~300 grep hits across code/docs/tests. Spot-checked a representative sample — the `.strata` legacy document-file extension (intentional compatibility, documented in README/CHANGELOG/TRADEMARKS.md/tauri.conf.json) and inline comments citing section numbers of the original pre-rename planning document for historical design rationale. All defensible per the repo's own stated rename policy (TRADEMARKS.md, README.md "Architecture" section); no blind rename performed. The one debug-global identifier found (`window.__strataPerf`) was a real rename candidate, not defensible the way the file-format extension is — see the pass 7 follow-up below, it was renamed.
- `docs/architecture/pages-layers-frames-shapes-system.md` doesn't mention the new Layer States "Solo View" feature — considered adding a section, but that doc's scope is pages/masters/spreads/page-numbering specifically, not layer visibility; Solo View is already documented in detail in `docs/audits/layers-system-audit-2026-08-23.md` §"Solo View and selection workflows." Left as-is rather than force a topical mismatch.
- Perspective tool (new 0.2.1 feature): no dedicated architecture doc exists. Self-contained tool (four-corner transform + its own Inspector section); judged proportionate to leave undocumented at the architecture level per the same standard applied to other single-tool additions.
- `docs/release/linux-ecosystem-readiness.md` / `docs/release/website.md`: don't mention the new website Linux distro-family download picker. Website content itself carries this; judged low-value to duplicate in release-engineering docs.
- Coverage Math (`blendAreaSelections()`, Phase 8 of the selection work) confirmed engine-only with no editor UI — documented as a known limitation in the new `selection-system.md` rather than silently omitted.

### Verification (pass 7)

| Gate | Result |
|------|--------|
| `node scripts/audit-docs.mjs` | Passed (596 docs, 141 links, 161 ADRs indexed) |
| `node scripts/audit-contacts.mjs` | Passed (5423 files) |
| `node scripts/audit-emoji.mjs` | Passed (3762 files) |
| `node scripts/validate-workflows.mjs` | All 10 workflows valid (covers the release.yml comment edit) |
| `node scripts/release/check-bundled-assets.mjs` | Ran; reports pre-existing local-only gitignored model files unrelated to this pass's comment-only edit (not a regression) |
| Biome on touched files | Clean |
| `git status` review | Confirmed several concurrent, unrelated in-progress edits from other sessions in this shared repo (website pages under `apps/website/src/pages/`, `docs/brand/github-repository-presence.md`) — left untouched, not committed, not reviewed as part of this pass |

### Pass 7 follow-up (2026-08-25) — the three items flagged above as deferred

All three items above ("investigated, no action needed" bullet 1's debug
global, and the two carried-over pass-6 items) were requested to be
addressed rather than left deferred. Re-investigated each and acted:

| Item | What investigation found | Action | Status |
| ---- | ------------------------- | ------ | ------ |
| `window.__strataPerf` debug-perf global | Live, actively-used identifier (not just historical): read by 6 E2E specs and 3 perf/capture tooling scripts (`.mjs`/`.py`) at runtime. Two of those scripts already carried `window.__varvePerf ?? window.__strataPerf` fallback checks — evidence a rename to `__varvePerf` (the repo's established `window.__varve*` debug-hook convention, e.g. `__varveCrashTest`, `__varveSimilarityTest`) had been started and left half-done. | Renamed in the 2 source files that install the handle, the 6 E2E specs, 3 perf/capture scripts (removing the now-dead fallback branches), and current docs (`AGENTS.md`, `scripts/perf/README.md`, 3 current-state architecture docs). Left untouched in dated/historical records (`docs/audits/`, `docs/perf/` dated reports, `docs/architecture/interaction-latency-2026-08-10.md`, `docs/plans/branch-consolidation.md`) per this repo's policy of not retroactively editing point-in-time snapshots. Verified: editor typecheck clean, Python/`.mjs` files parse, Biome clean. | Done |
| `docs/architecture/icon-system.md` "duplicate cluster" (4 docs) | Not actually 4 overlapping docs on close read. `icon-system.md`'s own H1 is "ADR-0006 — Icon System Architecture" — it was a misfiled ADR living outside `docs/adr/` and missing from the ADR index (sequence jumped 0005→0008). That misfiling was the actual root cause: it collided by basename with the unrelated `docs/design/icon-system.md`, making the pair look like duplicates. `icon-library.md` (user-facing icon search/insert/cache) and `icon-system-naming.md` (naming rules only, already explicitly deferring "current-state contract" to `design/icon-system.md` in its own opening line) are cleanly scoped already — no merge needed. | `git mv` to `docs/adr/0006-icon-system-architecture.md`, added to the ADR index table. Fixed a genuinely broken in-file link discovered along the way: the ADR (and `docs/audits/icon-library-implementation-report-2026-08-04.md`, 2 places) cited `docs/architecture/icon-system-audit-2026-08-02.md`, which moved to `docs/historical/` in an earlier pass. | Done |
| `.architecture-baseline.json` vs `.health-baseline.json` disagreement | Read the actual CI-mode comparison logic in `scripts/audit-architecture.mjs` rather than guessing: only the per-package cycle-identity allowlist and the global `max_cycles`/`max_layer_violations` ceilings fail the build. The stored `hubFiles` snapshot and `max_unstable` are informational-only, never compared in `--ci` mode — so the two baselines disagreeing was cosmetic, not a functional gate risk. Confirmed both `audit-health.mjs` and `audit-architecture.mjs --ci` passed cleanly against the live tree (15 cycles, 0 layer violations, unchanged from pass 6) before touching anything. | Ran `--update` alone first as a mistake: with only `--update` (no `--ci`/`--all`) the script's `RUN_ALL` flag logic skips every check, so it silently wrote a hollowed-out baseline (`"cycles": {}`), which would have disabled the cycle-regression gate entirely. Caught via `git diff` before staging anything; reverted from a pre-update backup; re-ran correctly as `--update --ci`. That run tightens more than it loosens: 2 now-fixed cycles drop out of the editor package's allowlist (`max_cycles` 19→17), hub-file counts refresh to live values (e.g. `CanvasArea.tsx` 3375→1415 lines — a real refactor since 2026-08-10, not a measurement bug). Re-ran `--ci` once more against the new baseline to confirm it still passes. `.health-baseline.json` untouched — separately gated, already passing with margin. | Done |

### Verification (pass 7 follow-up)

| Gate | Result |
|------|--------|
| `pnpm --filter @varve/editor typecheck` | Passed |
| `python3 -m py_compile` on the 3 touched perf/webkit scripts | Passed |
| `node --check` on the 2 touched `.mjs` scripts | Passed |
| `node scripts/audit-docs.mjs` | Passed (596 docs, 141 links, 162 ADRs indexed — was 161) |
| `node scripts/audit-architecture.mjs --ci` (before and after the baseline update) | Passed both times, exit 0 |
| `node scripts/audit-health.mjs` | Passed |
| Biome on all touched files | Clean |

---

## Pass 6 (2026-08-22)

Comprehensive documentation truth audit — code-to-documentation verification
against live implementation. No workflow or Rust source changes; all edits are
docs only (Markdown + one git-mv for misfiled audit).

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `AGENTS.md` code-health threshold table (lines 98–107) | Stale per-file complexity/import/cycle numbers (dated 2026-07-27; live values diverged by 2026-08-22) | Yes | Resynced to live `audit-architecture.mjs --ci` output + enforced ceilings; changed to artifact-anchored format that cites `.architecture-baseline.json` and `audit-health.mjs` as authoritative instead of hardcoding volatile numbers | Done |
| `AGENTS.md` module-instability table (lines 154–163) | Baseline column (2026-07-27) no longer matches live counts (context 73→76 = at ceiling; Menubar 17→18; CanvasArea 34→35) | Yes | Added live-count column; annotated that `audit-health.mjs` output is authoritative over the table | Done |
| `AGENTS.md` workspace-mode table (lines 504–512) | Listed seven modes; eight exist (Email `Ctrl+Shift+7` fully wired since 2026-08) | Yes | Added Email row; changed "Seven" to "Eight" | Done |
| `AGENTS.md` loading-experience-audit path (line 408) | Points at `docs/audits/loading-experience-audit.md` — file does not exist (dated suffix missing) | Yes | Fixed to `loading-experience-audit-2026-07-08.md` | Done |
| `AGENTS.md` apps/web row (line 598) | Claims scaffold "lands in task 0.9"; `pnpm-workspace.yaml` says "removed 2026-07-12 … deferred indefinitely" | Yes | Updated status to "removed from workspace"; task 0.9 deferred | Done |
| `docs/architecture/workspace-system.md` (lines 213, 273, 301, 310) | Four "seven" mentions for built-in workspace count; now eight | Yes | Updated to "eight" or "every built-in"; added source references (`workspaceTypes.ts`) in intro | Done |
| `docs/development/setup.md` (lines 10, 20–22) | Node "26+" overstates machine-enforced minimum (engines floor is 22.12); Ubuntu prereqs missing libssl-dev/libfontconfig1-dev/libglib2.0-dev/cmake/pkg-config vs CI | Yes | Node row annotated with engines floor; Ubuntu list extended to match CI | Done |
| `docs/development/setup.md` (wasm commands) | Commands `just wasm-build` / `wasm-build-all` need `wasm-pack` — not listed in prerequisites | Yes | Added wasm-pack prerequisite note | Done |
| `docs/development/setup.md` (line 111) | `just gates` described as "Audits only"; actually runs health, architecture, typecheck-regression too | Yes | Fixed label to "Quality audits + health/architecture checks" | Done |
| `README.md` (line 186) | `just check-env` comment claims "verify Rust/pnpm/just/Node toolchain" — recipe never checks Node | Yes | Fixed to "Rust, pnpm, just, and WebKitGTK pkg-config" | Done |
| `docs/release/platform-support-matrix.md` (:107, :180) | Stale line-number citations (`print_linux.rs:6` → :7; `tauri.conf.json:180` → moved to generic label) | Yes | Replaced brittle line refs | Done |
| `docs/release/signing-decision-record.md` row D | "Not in use" for updater signing; implemented since 2026-08-13 | Yes | Updated row + dated correction note (keeps the 2026-08-08 record accurate for its date) | Done |
| `docs/architecture/icon-system-naming.md` (lines 5, 37, 49, 73) | Claims "Lucide (outline) / Phosphor (filled)" — code switched to Tabler-first 2026-08 | Yes | Fixed vendor mapping; cross-references `design/icon-system.md` as canonical contract | Done |
| `docs/email/current-state-audit.md` | Dated audit (2026-08-20) in `docs/email/` instead of `docs/audits/`; zero inbound refs | Yes | Moved to `docs/audits/email-current-state-audit-2026-08-20.md`; `docs/email/` dir removed | Done |
| `docs/README.md` index gaps | Missing rows for trust-boundaries, browser-demo, signing docs (6), custom-domain-runbook, email-routing, object-selection-parity, semantic-similarity-benchmark, macos-intel-feasibility, email audit, icon row description | Yes | Added all missing rows; differentiated stale description on icon row | Done |

### Not changed (flagged as discrepancies / follow-ups)

| Item | Status | Evidence |
|------|--------|----------|
| CHANGELOG.md Unreleased: feed-republish claim | Cannot substantiate from committed `stable.json` (only linux entries) — may be a production-only truth; flag for release-owner confirmation | `apps/website/public/updates/stable.json:4-13` has no windows/darwin entries |
| `release.yml` LFS comment (line ~426) | Stale comment says models are "LFS-tracked"; `.gitattributes` retired LFS 2026-08-20 | Workflow code change; out of docs scope; recommend separate follow-up |
| `docs/architecture/icon-system.md` duplicate cluster | 4 docs overlap; recommendation to merge naming rules into `design/icon-system.md` and relocate architecture entry to `docs/adr/0006-*` — high-risk refactor, flagged for separate cleanup pass | `docs/README.md:254`, `docs/architecture/icon-system.md`, `docs/design/icon-system.md` |
| `.architecture-baseline.json` hub snapshots | Disagree with `.health-baseline.json` (captured during transient refactor state 2026-08-10); `audit-architecture.mjs --update` recommended but would affect CI gate scope — flag for release-owner | `.architecture-baseline.json:91-115` vs live |
| `apps/desktop/public/wasm/package.json` version 0.1.2 | Generated artifact; stale vs workspace version 0.2.0; refreshed by `just wasm-build` | `apps/desktop/public/wasm/package.json:5` |

### Verification (pass 6)

| Gate | Result |
|------|--------|
| `pnpm audit:docs` | Passed (588 → 589 docs after moves/additions; 141 links; 161 ADRs) |
| `pnpm audit:emoji` | Not re-run (only Markdown changes; emoji audit is code-level) |
| `node scripts/audit-health.mjs` | Passed (baseline from pass 5; no hub files changed) |
| `node scripts/audit-architecture.mjs --ci` | Ran successfully (15 cycles; 49 unstable; 0 layer violations; 3 hub over budget warnings) — used as evidence, not re-run post-edit |

---

## Pass 5 (2026-08-21)

Post-v0.2.0-release drift sweep. Companion audit snapshot relocated from root
(see `docs/audits/documentation-truth-audit-2026-08-16.md`).

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `docs/plans/{session-04-packaging,download-funnel,rename-strata-consultation}.md` | Self-declared COMPLETE/IMPLEMENTED plans + historical rename record still at plans top level | Yes | Archived to `docs/plans/archived/`; refs updated in AGENTS.md, docs/README.md, release-readiness-audit.md, scripts/audit-contacts.mjs | Done |
| `DOCUMENTATION_AUDIT_SUMMARY.md` (root) | Stale point-in-time audit (led with v0.1.2 facts) presented as current guidance | Yes | Moved to `docs/audits/documentation-truth-audit-2026-08-16.md` + historical banner; ledger ref updated | Done |
| `docs/architecture/plain-text-newline-layout-gap.md` | "Status: fixed" bug note in current-state architecture dir; zero refs | Yes | Moved to `docs/historical/` | Done |
| `docs/plans/archived/{triage-remediation,workspace-navigation-progress}.md` | Byte-identical duplicates of top-level files that inbound refs actually cite | Yes | Deleted archived copies (top-level retained) | Done |
| `docs/plans/raster-pyramid-progress.md` | Top-level duplicate of archived copy; all phases Done; zero inbound refs to either | Yes | Deleted top-level copy (archived retained) | Done |
| `docs/architecture/paint-draw-system.md` vs `paint-system.md` | Overlapping paint docs; paint-draw had zero refs but unique content | Yes | Merged unique sections (workspace integration, raster targeting order, tile persistence contract) into canonical `paint-system.md`; deleted overlap | Done |
| `packages/editor/src/context/useSelectionSets.ts` | 0-byte source file, zero imports | Yes | Removed; `@varve/editor` typecheck green | Done |
| `docs/screenshots/download/` (18 PNGs) | One-off download-page review captures; sibling capture dirs already gitignored by pass 3 | Yes | Untracked + gitignored (`/docs/screenshots/download/`) | Done |
| `apps/desktop/src-tauri/linux/dev.varve.desktop.metainfo.xml` | Only release entry was 0.1.2 after v0.2.0 shipped | Yes | Added `<release version="0.2.0" date="2026-08-21"/>` | Done |
| `.github/workflows/build.yml:10` | Stale `main` push trigger (regression of pass 3 fix after release merges) | Yes | Removed; workflow validation green | Done |
| `docs/README.md` index gaps | effect-rendering/live-effects-system shared an identical purpose string; blend-spaces, auto-layout-system, paint-system, design/icon-system, privacy/analytics, licensing/* unindexed; auto-layout-audit-2026-08-20 missing from dated list | Yes | Differentiated entries; added missing rows/list item | Done |
| `docs/audits/input-system-audit-2026-08-01.md:205` | Anchor fragment `#7` matches no heading slug | Yes | Fixed to full heading slug | Done |
| `docs/plans/ai-model-recovery-progress.md` | Pending rows lag master (branch-consolidation §12.3: branch shipped via other sessions) | Yes | Status banner added pointing at the triage verdict; file kept | Done |
| AGENTS.md hub table + onReady ref | Import counts drifted from `.health-baseline.json` (context 70→73, Menubar 15→17); unverifiable baseline date claim; brittle `context.tsx:5617` line ref | Yes | Resynced numbers to baseline artifact, dropped date claim, removed line number | Done |

### Kept after investigation (pass 5)

- `stryker.conf.json`, `wdio.conf.ts`, `boot-watch.mjs`, `knip.json`, `models-source/*.onnx` (LFS), `.windsurf/plans/*` — prior pass decisions re-verified, still wired/deliberate.
- `packages/import/src/gradient/__fixtures__/empty.grd` — 0 bytes by design (empty-file fixture).
- `docs/plans/{branch-consolidation,pages-frames-surface-model,discovery-content-plan,macos-intel-feasibility}.md` — verified active/binding against codebase.
- `docs/design/icon-system.md` — unindexed but current (Tabler support is real: `TablerIcon.tsx`); indexed instead of folded.
- Flatpak `tag: v0.0.0` stub — intentional placeholder documented in-file.

### Reported, not actioned (pass 5) — RESOLVED BY 2026-08-22

- `packaging/aur/varve-desktop-bin/{PKGBUILD,.SRCINFO}` **now at v0.2.0** with real SHA-256 (`:44`, `from SHA256SUMS.txt`).
- `scripts/release/version.mjs` TARGETS **now covers** `appstream-releases`, `pkgver-line`, and `srcinfo-version` target kinds (`:77-82`).
- Both items shipped between pass 5 and pass 6; the pass-5 comment above is historical context only.

### Verification (pass 5)

| Gate | Result |
|------|--------|
| `pnpm audit:docs` | Passed (571 docs, 141 links, 161 ADRs indexed) — before and after commits |
| `pnpm audit:contacts` | Passed (4905 files) after path update |
| `pnpm audit:emoji` | Passed (3655 files) |
| `just validate-workflows` | All workflows valid (covers build.yml edit) |
| `xmllint` metainfo | Well-formed |
| `pnpm --filter @varve/editor typecheck` | Passed (useSelectionSets removal) |
| `node scripts/audit-health.mjs` | Passed (source of resynced counts) |
| Biome on touched script/doc | Clean |
| Final drift grep (old paths, useSelectionSets, paint-draw, non-archived plan paths, build.yml main) | Zero hits |
| `pnpm verify:plan` | Inspected; escalated only due to concurrent agents' uncommitted editor/website changes left untouched in the tree — their scope, not this pass |

### Commits

- `81c89374` docs: archive completed plans, dedupe progress records, refresh doc index
- `c56025b8` docs: complete plan-archive moves missed by split-index commit
- `304bf969` chore: repair stale references surfaced by repository hygiene pass 5
- (this commit) pass 5 ledger entry

---

## Pass 4 (2026-08-16)

Companion to the docs truth/modernization audit (see
`docs/audits/documentation-truth-audit-2026-08-16.md`).

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `playwright.warm-1431.config.ts`, `playwright.warm-profile.config.ts` | One-off session E2E configs (hardcoded port 1431) | Yes | Removed — zero references (scripts, CI, docs, local tooling); session-specific by their own headers | Done |
| `playwright.mockups.config.ts` | Worktree-session E2E config (self-described "for the mockups worktree session") | Yes | Removed — zero references | Done |
| `packages/ui/src/icons/_backup_2026-06-30/` (8 strata SVGs) | Pre-rework icon backup | Yes | Removed — called "stale" by `docs/audits/icon-system-implementation-report-2026-08-02.md`; pre-rename strata sources; git history preserves | Done |
| `apps/desktop/src-tauri/icons/_backup_2026-06-30/` (3 strata SVGs) | Same-era backup in Tauri icon dir | Yes | Removed (same evidence); generated output regenerable from `packages/ui/src/icons/varve-app-icon.svg` | Done |
| `docs/plans/website-{strategy,product-truth-matrix,research-findings}.md` | Dated (2026-07-08) pre-rename Phase A/B/C deliverables | Yes | Archived to `docs/plans/archived/` per convention; superseded by the tracker + `docs/release/website.md`; refs updated in tracker + README | Done |
| `playwright.e2e-verify.config.ts` | Local E2E verification config | Yes | Kept — referenced by local `.claude/settings.local.json` workflow | Keep |
| `stryker.conf.json` + deps | Mutation testing | Yes | Kept — wired into `validation-impact.config.mjs` heavy-task lease + `docs/quality/test-reality.md` | Keep |
| `apps/desktop/src-tauri/icons/strata*.svg` (top level) | Pre-rename filenames | Yes | Kept — documented as retained ("Tauri window icons still reference them") and allowlisted in `scripts/audit-docs.mjs` | Keep |
| `docs/historical/` (6 records) | In-flight docs audit reclassification | No (new) | Retained — `scripts/audit-docs.mjs` HISTORICAL_PREFIXES extended with `docs/historical/` (gate was failing before this fix) | Done |
| `docs/plans/{quit-close-lifecycle,logo-workflow-complete,projects-home-workspace-completed}.md` | Self-marked-complete plans | Yes | Archived to `docs/plans/archived/`; refs updated in `docs/architecture/lifecycle-system.md`, `docs/audits/lifecycle-current-state-2026-08-09.md`, `AGENTS.md` | Done |
| `tests/e2e/caf-debug*.spec.ts` (7) | Abandoned debug scripts from the 2026-07-23 audit-panel session (fiber digging, console.log; 6/7 zero assertions) | Yes | Removed — real coverage exists in `tests/e2e/caf/caf.spec.ts` (58 assertions; uses `caf-test.png` + `caf-4k.png`, both fixtures kept) | Done |
| `boot-watch.mjs` | Dev-server watchdog utility, zero references | Yes | Kept + wired: added `just boot-watch` recipe so it is discoverable | Done |
| `ci-debug-report-website.md` repo name | Claimed fixed by the docs audit | No | Verified already `K-Arthur/varve` (committed in `baad3dc0`) | Done |

### Verification (pass 4, round 2)

| Gate | Result |
|------|--------|
| `pnpm audit:docs` | Passed (534 docs, 135 links, 161 ADRs indexed) — after adding `docs/historical/` to the historical whitelist |
| `pnpm audit:emoji` | Passed (3479 files) |
| `biome check scripts/audit-docs.mjs` | Clean |
| `pnpm verify:plan` | Tier 0 covers touched docs/audit script; heavy tiers triggered by concurrent agent source edits (not ours) |
| Final drift grep (warm-1431, warm-profile, mockups config, backup dirs, old website-doc paths) | No stale references in current-state docs |
| `pnpm audit:docs` re-run (after plan-archive moves) | Passed (534 docs, 135 links, 161 ADRs) — `docs/plans/archived/` links updated in lifecycle-system, lifecycle audit, AGENTS.md |
| Drift grep (`caf-debug`, archived plan names) | Zero references; `git grep caf-debug` empty |
| `just --list` | Parses; new `boot-watch` recipe listed |
| `git status` review | Our changes staged/isolated; concurrent agent edits (packages/, release.yml, website screenshot) untouched |

### Coordination note (index races with concurrent agents)

While committing the pass-4 changes, the concurrent a11y agent's commit flow
(`commit` → `git reset`) repeatedly emptied the shared index mid-hook, aborting
two commit attempts (exit 1, "no changes added to commit"). Nothing was lost —
reflog + on-disk state verified. Fix used: commit from an isolated index
(`GIT_INDEX_FILE=/tmp/opencode/hygiene-index git read-tree HEAD && git add <paths> && git commit`),
then drop the temp index. Landed as `fb8041f8`, `4301deec`, `54dc21e0`.
Future hygiene passes under concurrent agents should commit this way from the
start, and should expect biome `--staged` to see 0 files while the main index
is being reset (rely on the full gate for lint coverage).

---

## Pass 3 (2026-08-12)

### Inventory (fresh scan)

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `docs/plans/*.md` (24 files) | Completed/superseded plans | Yes | Archived to `docs/plans/archived/` per the convention documented in `session-04-packaging.md` (never previously executed) | Done |
| `docs/validation-repair-progress.md` | Root-level dated ledger | Yes | Moved to `docs/audits/validation-repair-progress-2026-08-07.md` (dated-audit convention; siblings 08-01/08-04) | Done |
| `docs/audits/ui-ux-redesign-memory.md` | Session memory in wrong dir | Yes | Moved to `docs/implementation-memory/` | Done |
| `docs/plans/layers-panel-completion-memory.md` | Session memory in wrong dir | Yes | Moved to `docs/implementation-memory/` | Done |
| `docs/reports/*.md` (3 files) | Dated reports in non-conventional dir | Yes | Moved to `docs/audits/` (dir now empty) | Done |
| `docs/release/marketing-copy-review-2026-08-04.md` + `-2026-08-10.md` | Dated review snapshots | Yes | Moved to `docs/audits/` | Done |
| `ci-debug-report.md` (root) | Generated CI debug dump | Yes | Removed (CI uploads it as an artifact; never meant to be tracked); gitignore widened to `/ci-debug-report*.md` | Done |
| `packages/home/test-results/.last-run.json` | Playwright output | Yes | Removed | Done |
| `docs/screenshots/{detach-flow,detach-multi,multi-window,table-modifiers}/` (43 PNGs) | Human-review captures | Yes | Untracked + gitignored; regenerable via `tests/e2e/workspace/capture.spec.ts` / `capture.mjs` | Done |
| `docs/ARCHITECTURE_BRIEF.md` | Dated snapshot presented as current | Yes | Banner + reclassified as point-in-time in README index (schema 2.14→2.20, 6→7 modes) | Done |
| `docs/menu-capability-matrix.md`, `docs/menu-workspace-matrix.md` | Hand-maintained matrices | Yes | Banner + reclassified as point-in-time; `menu/defs.ts` is the source of truth (each misses ~40 item ids) | Done |
| `docs/README.md` | Index | Yes | Reclassified brief/brand-guide/matrices; indexed previously unlisted docs (quality/validation-strategy, render-path-verification, security-hardening, testing/, tokens/, implementation/) | Done |
| `docs/privacy/runbooks.md` | Current doc | Yes | Fixed dead taxonomy path → `docs/privacy/crash-audit.md` | Done |
| `docs/desktop-runtime.md` + `pnpm-workspace.yaml` | Current docs | Yes | `@wdio/tauri-service` 1.2.0 → 1.3.0 (matches lockfile) | Done |
| `.opencode/config.json` | AI-tool config | Yes | last_commit refreshed to bede3444; deferred_plan → layers-panel-deferred.md (home-surface-deferred complete) | Done |
| `.github/workflows/{build,ci,model-validation,quantize}.yml` | CI triggers | Yes | Removed stale `main` branch (no such branch; origin/HEAD → master) | Done |
| `scripts/audit-docs.mjs` | Gate | Yes | Pruned dead `docs/reports/` whitelist entry; refreshed marketing-review paths | Done |
| `models-source/*.onnx` (1.2 GB LFS) | Data asset | Yes (LFS) | Retained — intentional, documented, published via `publish-model-assets.mjs` | Keep |
| `wdio.conf.ts` + `tests/wdio/*` + WDIO deps | Test infra | Yes | Retained — wired to `pnpm test:wdio` | Keep |
| `docs/research/` (3 dated files, 0 refs) | Research records | Yes | Retained — whitelisted historical dir by design | Keep |
| `docs/implementation/` (5 progress ledgers) | Progress ledgers | Yes | Retained — whitelisted historical; referenced from code comments | Keep |
| `docs/quality/` dated cycle reports | Dated records in current-state section | Yes | Retained; README annotated as dated | Keep |
| `.windsurf/plans/*.md`, `.jcodemunch.jsonc`, `.claude/`, `.devin/` | AI-tool config | Mixed | Retained per pass 2 decisions | Keep |
| `tools/ddcolor-export/`, `scripts/validate-pipelines/`, `scripts/tests/` | Tooling | Yes | Retained — model provenance + pipeline validation | Keep |
| `docs/screenshots/product/` | Deterministic capture pipeline | Yes | Retained — referenced by README and docs | Keep |

### Verification (pass 3)

| Gate | Result |
|------|--------|
| `node scripts/audit-docs.mjs` | Passed (483 docs, 95 links, 156 ADRs indexed) |
| `node scripts/audit-emoji.mjs` (pre-commit) | Passed |
| Pre-commit hooks (health, impact-config, workflow validation, action pinning, secret scan) | Passed on all commits |
| `pnpm test:ci:tools` | Passed (21 tests, incl. new regenerate-menu-matrices drift gate) |
| `pnpm format` | Clean after generator lint fixes |
| Final drift grep (old paths + newly archived plans) | No stale references |
| `git status` review | Only concurrent agent work (SiteHeader.astro, mask-unrelated-images.spec.ts) — untouched |

### Pass 3b — follow-up completion (menu generator + plan triage)

| Item | Decision | Status |
|------|----------|--------|
| `scripts/regenerate-menu-matrices.mjs` + `.test.mjs` | NEW — dependency-free parser over `menu/defs.ts` + `localization.ts`; regenerates both menu matrices; `--check` drift mode; wired into `test:ci:tools` | Done (commit `172030df`) |
| `docs/menu-*.md` | Regenerated — 176 menubar items, complete capability/workspace tables; README lists them as generated output | Done |
| `docs/plans/pages-frames-surface-model.md` | Kept — active proposal self-tracking implemented/open sections | Keep |
| `docs/plans/{canvas-system-remaining, consolidated-final-push, crop-trim-expand-overhaul, home-surface-cross-os, inspector-panel-redesign, redesign-strategy}.md` | Archived (30 files now under `docs/plans/archived/`) with codebase evidence; refs updated in agents/README + ADR-0002 | Done (commit `0f524593`) |
| `docs/research/`, `docs/release/implementation-plan.md`, `docs/agents/continuation.md` | Kept — whitelisted historical by design / self-marked complete / indexed historical | Keep |

### Commits

- `a073fd3f` docs: archive completed plans and rehome memory records
- `b50251d4` docs: annotate point-in-time records, repair stale references
- `e15fae09` chore: stop tracking generated CI/test artifacts and review captures
- `87697a30` ci: drop stale main branch from workflow triggers
- `3d7793db` chore(quality): prune dead docs/reports/ whitelist, refresh marketing-review paths
- `172030df` docs: generate menu matrices from defs.ts instead of hand-maintaining
- `0f524593` docs: archive six completed design/canvas/home/inspector plans

---

## Pass 2 (2026-08-04)

### Inventory (fresh scan)

| File or Pattern | Category | Tracked? | Decision | Status |
| --------------- | -------- | -------: | -------- | ------ |
| `scripts/perf/dump*.mjs` (21 files) | Debug script | Yes | Removed — one-off Playwright debug dumps, hardcoded ports, zero references | Done |
| `scripts/perf/make-doc.mjs` | Debug script | Yes | Removed — one-off bench-doc builder, superseded by workload corpus fixtures | Done |
| `scripts/perf/seed-and-open.mjs` | Debug script | Yes | Removed — superseded by `run-production-workload.mjs --fixture`; hardcoded doc version | Done |
| `scripts/perf/probe-*.mjs` (5 files) | Maintenance tool | Yes | Kept, now documented in `scripts/perf/README.md` (probe family table) | Done |
| `docs/validation-repair-progress.md` | Temporary report | Yes | Moved to `docs/audits/validation-repair-progress-2026-08-01.md` (dated-audit convention) | Done |
| `.opencode/config.json` | AI-tool config | Yes | Kept (documented in `docs/agents/README.md`); stale branch/commit refs refreshed to master/60f77ad3 | Done |
| `.windsurf/plans/*.md` | AI-tool config | Yes | Retained — Windsurf is a supported tool; plans documented in `docs/agents/README.md` | Keep |
| `.jcodemunch.jsonc` | AI-tool config | Yes | Retained — active MCP architecture config (in use this session) | Keep |
| `models-source/*.onnx` (3 files) | Data asset | Yes (LFS) | Retained — intentional Git LFS; README documents publishing flow via `publish-model-assets.mjs` | Keep |
| `apps/desktop/public/models/**` | Data asset | Yes | Retained — bundled offline models + manifest + validation reports, referenced by CI | Keep |
| Root `*_MEMORY.md`, `.system_memory.md`, etc. | AI memory | No (ignored) | Already ignored; canonical copies in `docs/implementation-memory/` | Keep |
| `GITHUB_PIPELINE_MEMORY.md` | AI memory | No (ignored) | Session-survivable local tracker, documented in AGENTS.md | Keep local |
| `.claude/settings.local.json`, `.devin/config.local.json` | Local config | No (ignored) | Local-only (`.claude/`, `.devin/` ignored); may contain local credentials — never tracked | Keep local |
| Baseline JSONs (`.architecture-`, `.health-`, `.render-perf-`, `.replay-browser-`, `.rust-coverage-`, `.typecheck-baseline.json`) | CI reference | Yes | Retained — referenced by audit scripts and CI gates | Keep |
| `ci-debug-report-website.md` | Temp report | No (ignored) | Already ignored via `/ci-debug-report-*.md` | Keep local |
| `wdio.conf.ts`, `playwright.e2e-verify.config.ts` | Test config | Yes | Retained — `wdio.conf.ts` wired to `pnpm test:wdio`; e2e-verify config used by local E2E verification workflow | Keep |
| `docs/release/marketing-copy-review-2026-08-04.md` | Temp report | No | Untracked, concurrent branding work — left untouched, do not commit | Watch |
| `apps/website/public/llms.txt`, `apps/website/src/types/` | New work | No | Untracked, concurrent work — left untouched | Watch |

### Secret review (pass 2)

Scanned tracked text files for API keys, tokens, private URLs, credentials,
home-directory paths. **No real secrets found.** CI workflow hits are
`${{ secrets.* }}` placeholders only. Local-only credential-bearing files
(`.claude/settings.local.json`, `.devin/config.local.json`) are gitignored and
mode-restricted; covered by `.gitignore` rules for `.claude/` and `.devin/`.

### Preventative changes

- `.gitignore`: added `scripts/perf/dump*.mjs` so one-off dumps cannot be
  recommitted.
- `scripts/perf/README.md`: added "Probe family" table documenting
  `probe-baseline`, `probe-scale`, `probe-large-doc`, `probe-latency`,
  `probe-cpu-profile` + a note that throwaway dumps belong in git history only.

### Verification (pass 2)

| Gate | Result |
|------|--------|
| Grep for references to removed files (`dump`, `make-doc`, `seed-and-open`, `validation-repair`) | No stale references |
| `pnpm lint` (touched files) | Passed |
| `pnpm test:ci:tools` | Passed |
| `git status` review | Only owned changes staged; concurrent work untouched |

---

## Pass 1 (2026-07-26) — history

### Removed from Git Tracking (`git rm --cached`)

| File | Category | Reason |
|------|----------|--------|
| `.devin/workflows/incomplete.md` | Empty tracked file | Zero content, unnecessary |
| `scripts/tests/__pycache__/test_convert_realesrgan.cpython-314.pyc` | Compiled Python bytecode | Should never be tracked |
| `reports/mutation/mutation.json` | 1.8 MB generated artifact | Stryker output, regenerable |

### Removed from Git Tracking & Deleted (one-off diagnostic scripts)

| Script | Reason |
|--------|--------|
| `scripts/diagnostics/check_editor.mjs` | One-off Playwright debugging, hardcoded localhost |
| `scripts/diagnostics/check_styles.mjs` | One-off style inspection |
| `scripts/diagnostics/clean_editor.mjs` | Duplicate of create_file patterns |
| `scripts/diagnostics/create_file.mjs` | Iterative debugging variant |
| `scripts/diagnostics/create_file2.mjs` | Iterative debugging variant |
| `scripts/diagnostics/create_file3.mjs` | Iterative debugging variant |
| `scripts/diagnostics/create_js.mjs` | Iterative debugging variant |
| `scripts/diagnostics/full_editor.mjs` | Superseded by visual-review.mjs |
| `scripts/diagnostics/inspect_fonts.mjs` | One-off font debugging |
| `scripts/diagnostics/open_editor.mjs` | One-off editor open test |
| `scripts/diagnostics/verify_fix.mjs` | One-off verification |

### Moved (pass 1)

| From | To | Reason |
|------|----|--------|
| `.opencode/plans/Redesign_Strategy.md` | `docs/plans/redesign-strategy.md` | Discoverability alongside other plans |
| `scripts/diagnostics/review_design.mjs` | `scripts/visual-review.mjs` | Canonical visual review tool |

### Verification (pass 1)

`pnpm format`, `pnpm lint` (changed files), `pnpm audit:emoji` all passed.
Pre-existing codegen typecheck errors baselined in `.typecheck-baseline.json`.
