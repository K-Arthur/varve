# Branch Consolidation Plan (2026-08-17)

Goal: safely consolidate all live feature branches into `master` (the project
mainline) without introducing regressions. This plan is a methodology, not a
one-shot script: it re-runs triage, merges in dependency order, and gates every
merge behind verification checkpoints.

## 1. Measured inventory (2026-08-17)

Snapshot taken at plan time. Re-run `git branch --format='%(refname:short)'`
and the ahead/behind counts below before executing — concurrent agents can
advance `master`.

Mainline: `master` (origin HEAD). Local `master` was 16 commits ahead of
`origin/master` at snapshot time (unpushed).

### 1.1 Already merged — archive/delete candidates (no integration work)

| Branch | ahead | behind |
|---|---|---|
| `carry` | 0 | 253 |
| `feat/ci-windows-import-boundary` | 0 | 116 |
| `feat/nl-asset-search` | 0 | 194 |
| `feat/semantic-asset-similarity` | 0 | 149 |
| `feat/workspace-toolbar-composition` | 0 | 321 |
| `fix/release-macos-smoke` | 0 | 107 |
| `fix/release-publish-input` | 0 | 99 |
| `fix/release-unsigned-contingency` | 0 | 109 |
| `fix/release-windows-shell` | 0 | 108 |
| `opencode/push-master` | 0 | 70 |
| `security/hardening` | 0 | 420 |

Verified with `git branch --merged master`. Delete with `git branch -d`
(never `-D` — it refuses anything not fully merged, which is the safety net).

### 1.2 Live branches — the actual integration set

| Branch | ahead | behind | Verdict | Evidence |
|---|---|---|---|---|
| `audit/phase-2-accessibility` | 3 | 98 | **ARCHIVE — already integrated (cycle 1 result)** | `git cherry` marks all 3 commits `-`; subject-twins `51d1a4f6` / `326f3af7` / `d911e59d` on master; `d911e59d` stat-identical to branch commit `d3026852` |
| `feature/email-template-system` | 66 | 70 | MERGE next | 25 patch-unique commits vs master (41 already integrated); **fully contains `feat/blend-spaces`** |
| `worktree-auto-layout-engine` | 46 | 103 | MERGE after email | 9 patch-unique commits vs master (8 net-new; 1 duplicated in email) |
| `feat/blend-spaces` | 45 | 70 | ARCHIVE (subsumed) | 5 patch-unique commits, but `rev-list count vs email` = 0 — all arrive via the email merge |
| `recovery-bad-cache` | 1 | 361 | INVESTIGATE | Commit subject-twin `381cf56a` on master; `git cherry` says `+` (content differs) → superseded re-implementation, verify before archiving |
| `recovery-bad-color` | 1 | 368 | INVESTIGATE | No subject-twin found on master → either missing work or superseded by different approach |
| `recovery-text` | 2 | 368 | INVESTIGATE | Twin `9c4d52e7` on master for "rich text transactions"; second commit has no twin |

### 1.2.1 Patch-unique content (what actually needs to land on master)

| Surface | Commits | Count |
|---|---|---|
| Email feature (schema v2.21, compiler, workspace mode, export, embedded assets, docs) | `866c8cd6` `92e909f8` `d9b16c7b` `1e4aaccf` `81ef97e1` `67611d72` `c227c6a1` `a007fed9` `8acecdd8` `584cac64` `276c1d98` | 11 |
| Layout engine (per-axis sizing, flow/absolute, flex repair, reflow, inspector) | `36f4731d`≡`292a1932` `c42ac80d`≡`b12a18b1` `26b3a1e4` `2b623bad` `6dd0dc4f` `251adafa` `48212cab` `f95c9c95` | 8 net-new |
| Motion playback hardening | `5d4f7b18` | 1 |
| Onboarding (empty-state shortcuts, What's New) | `d4bbeb32` | 1 |
| Colour blend policy (renderers + SVG import) | `f235d099` `cc818957` | 2 |
| Desktop OS file associations | `ad1d38fd` | 1 |
| a11y: RecoveryDialog autofocus/focus-visible | `c6cf4593` (worktree only) | 1 |
| Release/docs riders (v0.1.2 matrices, troubleshooting guide, website regen, tooling checkpoint) | `962764c8` `d48e902d` `4ff745c4` `73b97dab` `7d841cdf` `3b95a501` `317df9f9` | 7 — triage against master; may be intentional master-content duplicates with different patches (VERIFY before including) |

Cross-branch twins confirmed patch-identical: `36f4731d` ≡ `292a1932`,
`c42ac80d` ≡ `b12a18b1` (same patch-id). During a rebase, ONE copy is merged
and the other dropped by the conflict review — merging both is a no-op that
pollutes the manifest.

### 1.3 Remote-only branches — all merged (triage 2026-08-17)

Fetched and measured; every one is fully contained in master (ahead=0):

`feat/adjustment-effects-hardening`, `feat/ai-model-recovery`,
`feat/animated-media`, `feat/canvas-invalidation`, `feat/export-workspace`,
`feat/gradient-map-system`, `feat/input-system`, `feat/properties-panel-ia-audit`,
`feat/upscale-deferred-work`, `feat/wasm-trace-effects-pdf-hardening`,
`motion-mode-followup`, `perf/canvas-optimization`, `perf/webkit-render-path`.

Zero live work in the remote inventory. Deletion of remote refs is a
coordinated action (parallel agents may reference them) — owner confirmation
required before `git push origin --delete`.

## 2. Methodology overview

Five phases. Each merge is an independent checkpointed cycle; no merge advances
past a red gate.

```
Phase 0  Baseline hygiene       sync master, clear/triage dirty trees and stashes
Phase 1  Genealogy triage       8 branch verdicts, 4 counters, subject-twin search
Phase 2  Sequencing             3 merges in dependency order + archive list
Phase 3  Per-merge gate loop    rebase → verify:plan → verify:affected → audits
                                → feature E2E → merge --no-ff → escalate when needed
Phase 4  Multi-pass review      independent red-team review, post-merge drift check
Phase 5  Termination            delete merged branches, record verdicts, update docs
```

## 3. Phase 0 — baseline hygiene

1. `git checkout master && git pull --ff-only` (or push local master first if
   ahead — never rebase a shared mainline).
2. **No branch switching with a dirty tree.** Stash with a descriptive message:
   `git stash push -m "opencode: preserve <branch> working-tree changes before
   returning to master"`. Twelve stashes existed at snapshot time; triage each
   before any `stash clear` / `gc`:

   | Stash | Origin | Classification |
   |---|---|---|
   | `@0` preserve email-template working tree (goldens, snapshots, fixtures, settings) | this session | KEEP — review against email merge |
   | `@1` "unrelated changes - email template, etc." | email sessions | KEEP — likely same class; review against email merge |
   | `@2` preserve untracked work | email sessions | KEEP — review untracked files against email merge |
   | `@3` empty-canvas-state copy tweak | stray restored | REVIEW — small, may already be landed |
   | `@4` preserve-master-work | prior session | REVIEW |
   | `@5` WIP on blend-spaces (motion playback) | blend-spaces | REVIEW after email merge (blend-spaces subsumed) |
   | `@6` WIP hover states (master) | prior session | VERIFY subject on master, then discard |
   | `@7`/`@8` phase-2-accessibility preservation | a11y sessions | REVIEW against a11y merge (#1) |
   | `@9` codex-preserve-user-worktree-before-publish | prior session | REVIEW |
   | `@10`/`@11` wip-image-fit-all | prior session | VERIFY landed (fixed 2026-08-11), then discard |

   Rule: `stash show -p` any stash before discarding; grep master's log for its
   subjects first.
3. Record the merge manifest (branch, base, ahead/behind, verdict) — it is the
   coordination artifact for parallel agents.

## 4. Phase 1 — genealogy triage (0-cost, highest-value detection)

Four counters detect hidden relationships that plain `git merge` misses:

| Check | Command | Catches |
|---|---|---|
| Merged status | `git branch --merged master` | Already-landed branches (11 found) |
| Subsumption | `git rev-list --count <b> --not <candidate>` = 0 | Branch fully contained in another (blend-spaces ⊂ email) |
| Reimplementation | `git cherry master <b>` shows `+` + `git log --all --grep=<subject>` finds a twin | Same fix landed with different patch content — merging would silently re-apply the OLD implementation over the NEW one |
| Staleness | `git merge-base` date vs master tip | Branches needing rebase-first strategy (recovery-*, 361+ behind) |

Rules:
- `git cherry` `+` alone proves nothing. Pair it with a subject search and a
  semantic diff of the touched files. Verdicts: MERGE / ARCHIVE (subsumed or
  superseded) / DISCARD (recovery artifacts confirmed landed) / INVESTIGATE.
- Never merge a branch whose work exists on master in different form without a
  reviewer explicitly ruling the twin equivalent.
- A branch fully contained in another must be archived, not merged — merging it
  is a no-op that pollutes history and the manifest.

## 5. Phase 2 — sequencing

Order by dependency, size, and staleness:

1. ~~`audit/phase-2-accessibility`~~ **RESOLVED: no merge** — fully integrated on
   master (cycle 1 result). Archive the branch.
2. `feature/email-template-system` — rebase onto master; during conflict review
   drop the cross-branch twins (`36f4731d`/`292a1932`, `c42ac80d`/`b12a18b1`)
   and triage the 7 release/docs riders against master content.
3. `worktree-auto-layout-engine` — after email lands, its 8 net-new commits go
   through the same loop; the twin patches become no-ops by then.

`feat/blend-spaces`: do NOT merge. Archive with a note pointing at the email
branch merge commit. `recovery-*`: investigate each; archive with a verdict
record.

## 6. Phase 3 — per-merge gate loop (TDD + iterative integration)

Each branch merges as its own cycle, in a dedicated worktree, on a scratch
integration branch:

```bash
git worktree add .worktrees/integrate-<branch> -b integrate/<branch> master
# 1. rebase the feature branch onto current master (ff-first; rebase for
#    divergence; resolve conflicts as semantic decisions with the branch owner)
git rebase master
# 2. understand the impact before running anything
pnpm verify:plan
# 3. affected validation, Tiers 0-4 (format+lint on touched files is Tier 0 —
#    no whole-repo lint per merge)
pnpm verify:affected
# 4. architecture + health gates when the diff touches system-level files
node scripts/audit-architecture.mjs --ci     # context.tsx / CanvasArea / Shell / hub files
node scripts/audit-health.mjs                # hub-file import budgets, complexity ceilings
# 5. feature-specific E2E/visual/perf (canvas/pointer classes are E2E-only —
#    unit tests never prove them)
npx playwright test tests/e2e/<feature> --project=chromium --reporter=list
# 6. domain audits when touched
pnpm audit:tokens && pnpm audit:emoji && pnpm audit:docs
# 7. green gate → merge with --no-ff, tag the integration checkpoint
git checkout master && git merge --no-ff integrate/<branch> -m "merge: <branch> (integration checkpoint)"
```

Checkpoint = the merge commit is a named, re-verifiable state. Never stack a
second merge on a first that has not passed its full gate.

**Escalation triggers** (require `pnpm verify:full` with
`VARVE_FULL_GATE_REASON`): schema/serialization migrations, golden regeneration
(`canonical-document.json` + `.sha256`), cross-package foundational API changes,
test-runner changes. The email merge triggers this — it carries schema v2.21
and regenerated goldens. Also mandatory: write/update the feature E2E before
declaring the merge verified if the branch touches canvas, pointer, or layout
code (see AGENTS.md "Automated UI/canvas testing").

Heavy tasks (verify:affected on big merges, Playwright) must acquire the
cross-worktree lease (`scripts/quality/heavy-lease.mjs`) — concurrent agents
must not saturate the machine.

## 7. Phase 4 — structured collaboration (multi-pass review)

Three passes, each an independent agent or reviewer role:

1. **Pre-merge red team (sub-agent review).** A separate agent with fresh
   context reviews the branch diff against the architecture constraints, not
   the test results:
   - hub-file import budgets (no new import into `CanvasArea.tsx`/`Shell.tsx`
     without removing an equal-or-greater one);
   - complexity ceilings and the 70% extraction rule (pre-commit enforces,
     reviewer double-checks `// COMPLEXITY:` comments on over-ceiling files);
   - hook ordering invariance (new hooks placed after dependencies, before the
     `value` useMemo, added to its dep array);
   - `ActionRegistry` overwrite order (real handlers before no-op stubs);
   - no native `<select>`, no hardcoded color/space/type values, no emoji,
     no `any`, no `unsafe_code`;
   - pixel-reuse rules: any partial-redraw/cache path must have the
     hash-surface oracle check (`window.__strataPerf.forceFullRedraw()`),
     not just frame-rate metrics.
2. **Gate verification (cascade).** No single agent signs off alone. The
   coordinator confirms the union: affected tests green, E2E green, architecture
   audit at baseline, token/emoji/docs audits zero-violation. Where hub files
   intersect, the coordinator runs `just gate` after the merge.
3. **Post-merge drift check.** After each merge, an independent pass compares
   the merged tree against the branch intent (re-verify:plan diff shrinks to
   exactly the merged commits; check no unrelated files rode in; check goldens
   match the schema commit).

## 8. Risks, missing assumptions, edge cases

| # | Risk | Detection | Mitigation |
|---|---|---|---|
| 1 | **Content-different twins merge silently.** Fix landed on master with different patch content; `git merge` reports clean, old implementation wins (recovery-* pattern, `8ba0a09e` vs `381cf56a`). **Already proven in cycle 1:** `audit/phase-2-accessibility` was "3 commits ahead" yet 100% patch-identical to master | `git cherry` `+` status + subject-twin search + semantic diff | INVESTIGATE verdict before any merge; reviewer rules twin equivalence; archive not merge |
| 2 | **Subsumed branches merged anyway** (blend-spaces ⊂ email proven) | containment counter = 0 | ARCHIVE verdict; manifest prevents double work |
| 3 | **Wrong merge order** creates phantom conflicts or duplicate hunks (email and worktree share subject-twin commits) | ancestry check between branches; subject search across all branches before the first rebase | fixed sequencing + rebase-first strategy; drop equivalents during conflict review |
| 4 | **Stale branches resurrect reverted fixes** (recovery-*, 361+ behind; worktree 103 behind) | merge-base date vs master tip; check reverted commits' subjects in branch range | rebase onto fresh master first; semantic conflict resolution, never text-merge; revert-hunt in review pass |
| 5 | **Schema/golden drift.** Email branch regenerates `canonical-document.json` + `.sha256` (schema v2.21) | golden file diffs flagged in review | commit goldens inside the schema commit; full-suite escalation for that merge |
| 6 | **Hub-file budget violations** from big merges (email: 66 commits) | `scripts/audit-health.mjs`, architecture audit, pre-commit | gate before merge; extract to adapter modules; no import additions without removals |
| 7 | **E2E-only regressions** (canvas/pointer/CSS layout — invisible to Vitest) | AGENTS.md rule: write Playwright spec for any canvas/pointer/rendering change | feature E2E in the gate loop; visual regression project for new surfaces (email workspace) |
| 8 | **Dirty tree / stash loss** during switches (20 files stashed on email branch; 11 stashes total) | `git status` check before any switch | stash-push protocol with descriptive messages; triage stashes before GC |
| 9 | **Parallel-agent drift.** Concurrent agents commit to master and edit AGENTS.md mid-session (observed) | re-run ahead/behind before every gate | never rebase shared master; re-triage before each merge cycle; worktree protocol for same-file work |
| 10 | **Remote-only branches untriaged** | fetch + run Phase 1 counters on each | **Resolved 2026-08-17 — all 13 merged; remote deletion requires owner confirmation** |
| 11 | **Unpushed mainline.** Local master 16 ahead of origin/master at snapshot | `git rev-list --count origin/master..master` | push or coordinate before pull-based agents proceed |
| 12 | **Branch checked out in a worktree.** `.worktrees/nl-asset-search` still checks out `feat/nl-asset-search` (a merged branch) | `git worktree list` before `git branch -d` | `git branch -d` already refuses in-worktree branches — treat refusal as protection, list worktrees when deleting |
| 11 | **Unpushed mainline.** Local master 16 ahead of origin/master at snapshot | `git rev-list --count origin/master..master` | push or coordinate before pull-based agents proceed |

Missing assumptions to confirm with the user/owners before execution:
- Are `recovery-*` branches pure safety nets (superseded by incident-response
  fixes) or do they carry fixes that never landed? (recovery-bad-color's
  `52139499` has no twin.)
- Is `worktree-auto-layout-engine` still owned, or a leftover worktree branch
  (its commits overlap the email branch)?
- May merged branches be deleted (local and/or remote), or should they be
  archived as tags first? Remote-only inventory is confirmed fully merged
  (2026-08-17), so only ownership/permission is the blocker.

## 10. Cycle 2 execution log (feature/email-template-system)

Status: **in gate** (full-suite running under heavy-task lease).

Operation log:
- Worktree `.worktrees/int-email`, integration branch `integrate/email` created at
  the email tip, rebased onto current master.
- Rebase result: **23 commits ahead of master** (43 of the branch's 66 collapsed
  as already-upstream — the concurrent agent's ongoing master work absorbs them);
  123 files, +5596/−725 vs master.
- Conflict resolutions (all semantic, all "keep master's newer evolution"):
  - `MicroHints/*` add/add conflicts — master's onboarding feature is the newer
    superset; branch's early iteration dropped.
  - `colorInterpolation.ts` — master's exported `lerpHue` with full hue-direction
    support supersedes the branch's private earlier version; the branch's genuine
    addition `blendEvaluation.ts` still landed via `f235d099`.
  - `settings.ts`, `OnboardingLayer.tsx`, `editor.css` — master wins.
- **Rider regression caught and reverted:** `e8e5edc6` (checkpoint rider) deleted
  `knip.json` and re-resolved `pnpm-lock.yaml` to a pre-knip state after knip
  6.32.0 was adopted on master. Reverted (`revert(tooling)` commit restoring
  master's knip.json / package.json / pnpm-lock.yaml; diff vs master = empty).
  The rider's marketing/docs files remain in the merge — website-unit/e2e in the
  gate decides whether the stale Astro-5-era copy is safe.
- Rider `317df9f9` (crop SE-handle probe spec) — merged as a 128-line Playwright
  spec; flagged for post-merge review: keep as regression guard or drop.
- Rider `a1eae62f` (OS file associations, 305 insertions incl. Rust) — kept; needs
  the desktop-native gate result before sign-off, and Windows/Linux double-check.

Remaining: full-gate result → merge `--no-ff` into master with checkpoint tag →
archiving verdicts → cycle 3 (worktree-auto-layout-engine, 8 net-new commits).

### Cycle-2 blocker ledger (architecture baseline flux)

The full gate (run 1) failed on: (a) merge-markers smuggled into
`packages/engine/src/types.ts` by a rushed `git add -A` during rebase conflict
resolution — fixed via commit `51d42f47` (kept HEAD's doc comments; whole-tree
marker sweep clean); (b) architecture audit red: 6 scene cycles + 22 total vs
baseline max 19.

Investigation outcome — **no cycle is merge-introduced**:
- All 6 flagged scene cycles exist identically on master (identity-compared; the
  2026-08-17 background master audit fails with the SAME 6 cycles and 23 total).
- Cycle closer for 5 of them is a pre-existing inline `import('./types')` at
  `colorManagement.ts:553` (present on master and on the merge-base).
- The merge even REMOVES one engine cycle (`filters.ts → types.ts`).
- Root cause: the shared `.architecture-baseline.json` was refreshed on
  2026-08-18 (agent's goal-state: 0 cycles, max 2) ahead of master's committed
  code (still has 22-23). The merge tree's 22 ≤ master's 23.

Decision: do NOT remediate master's pre-existing cycles inside this merge (it
would collide with the concurrent agent's in-flight cycle work on the same
files). Validation of the merge continues via the full gate; the architecture
lane is expected to stay red until the agent's cycle work lands on master, at
which point this branch must be re-based and the gate re-run before merge.

### Cycle-2 fix commits (5)

- `51d42f47` fix(engine): strip merge markers smuggled into `types.ts`
- `revert(tooling)` restore knip adoption swept out by stale checkpoint rider
- `fix(e2e)` drop unused `elementFromPoint` binding in crop probe spec
- `3e11b778` test(scene): regenerate schema v2.21 goldens/fixtures/assertions
- (rebase) 23 commits incl. schema v2.21, email feature, blend policy

The golden regeneration surfaced a methodology gap: the branch committed the
schema but not its golden output. Those regenerated files (canonical-document
golden + sha, 4 demo fixtures, snapshots, version assertions) sat in the
"preserve email-template working-tree changes" stash created at session start —
they belong WITH the migration, not stashed beside it. Recovery rule: when a
schema-migration branch is merged, first locate its golden/test companions in
working-tree stashes before regenerating from scratch. Vitest then went
157/157 + 7/7 on the 12 files it originally failed (42 tests + 24 snapshots).

### Re-rebase onto advanced master (2026-08-18, shell-recovery session)

Master advanced 12+ commits (release tooling, README rewrite, website works,
product-truth verifier). `integrate/email` was re-based:

- Checkpoint rider `e8e5edc6` SKIPPED (its marketing content is Astro-5-era,
  superseded by master's newer website/release work); the earlier
  `revert(tooling)` commit auto-dropped as a no-op because the rider no longer
  exists in the branch.
- Release-facts riders (`eb72e0bb` README, `2c0022a4` website, `ba1754b2`
  matrices) SKIPPED as superseded by master's version-driven tooling.
- `revealMainWindow.ts` doc-comment conflict resolved toward BRANCH (theirs —
  documents the feature's new file_open.rs/osFileOpen.ts architecture).
- **Result: 21 commits ahead of master. Tree diff vs the previously-fully-
  validated tip (3e11b778): 0 deletions, 4 adds, 44 modifications — all the
  adds/mods are master's newer content; test-relevant tree byte-identical
  (only `tests/e2e/canvas/crop.spec.ts` differs, from master), so the
  15,356-test full-vitest green carries over.**
- New branch HEAD: `7b51daaa` (golden regen commit atop the re-based set).

Remaining lanes at close: E2E (email domain + full chromium), `desktop-native`
(pnpm test:desktop:native), `wasm` (just wasm-check), `bench:render`, and the
final full-gate run — then `git merge --no-ff integrate/email` with checkpoint
tag. The architecture lane stays red until the concurrent agent's cycle
remediation lands on master (shared baseline at max_cycles 2 vs 22-23 real).
Optional: decide whether rider `3a69e14e` (troubleshooting guide) should stay —
it survived the re-base, keep it (docs audit clean).

## 11. Definition of done

- `master` contains the union of all MERGE-verdict work, each through its own
  green gate.
- `feat/blend-spaces` archived (subsumed); `recovery-*` archived with verdict
  records; merged branches deleted with `git branch -d`; stashes triaged.
- Merge manifest + verdicts recorded in this document; session history updated.
- Final full gate: `pnpm verify:full` with stated `VARVE_FULL_GATE_REASON`
  (release checkpoint) OR coordinator `just gate` — one of the two, with reason.

## 12. Re-triage (2026-08-20) — the 2026-08-17 inventory is OBSOLETE

The prior snapshot's central claim ("most branches already merged / remote-only
inventory fully merged") does NOT hold against the live `master` (tip `95f54e9b`,
2026-08-20). Re-running the four genealogy counters:

- `git branch --merged master` → **empty for every live branch** (`merged=.`
  for all 33). None are merged into current master.
- Common merge-base for every non-figma branch = `32a5c855` (2026-06-29).
  `master` has advanced ~7 weeks / ~2498 commits past that base. The
  uniform `behind=2498` is not a coincidence — it is master's 7-week lead
  beyond the June-29 fork point, shared by all stale branches.

### 12.1 Corrected verdicts

| Branch | ahead | behind | base | Verdict |
|---|---|---|---|---|
| `feat/figma-native-import` | 49 | 4 | 2026-08-20 | **MERGE-next** — rebase onto master, gate, `--no-ff` |
| `feat/canvas-invalidation` | 435 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/wasm-trace-effects-pdf-hardening` | 406 | 2498 | 2026-06-29 | REBASE-FIRST |
| `motion-mode-followup` | 553 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/properties-panel-ia-audit` | 779 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/adjustment-effects-hardening` | 835 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/upscale-deferred-work` | 909 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/ai-model-recovery` | 1015 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/gradient-map-system` | 1072 | 2498 | 2026-06-29 | REBASE-FIRST |
| `perf/canvas-optimization` | 1067 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/export-workspace` | 1077 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/input-system` | 1122 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/animated-media` | 1724 | 2498 | 2026-06-29 | REBASE-FIRST |
| `perf/webkit-render-path` | 1617 | 2498 | 2026-06-29 | REBASE-FIRST |
| `feat/ci-windows-import-boundary` | 2227 | 2498 | 2026-06-29 | REBASE-FIRST / likely obsolete |
| `fix/release-macos-smoke` | 2236 | 2498 | 2026-06-29 | INVESTIGATE (stale release tooling) |
| `fix/release-publish-input` | 2244 | 2498 | 2026-06-29 | INVESTIGATE |
| `fix/release-unsigned-contingency` | 2234 | 2498 | 2026-06-29 | INVESTIGATE |
| `fix/release-windows-shell` | 2235 | 2498 | 2026-06-29 | INVESTIGATE |
| 14× `dependabot/*` | 1899–2274 | 2498 | 2026-06-29 | VERIFY relevance (bumps may be obsolete) |

### 12.2 Implications

1. **The 2026-08-17 "already merged" verdicts were CORRECT in substance** — but
   `git branch --merged` could not prove it because the work landed on `master`
   as *rebased/cherry-picked equivalents*, not as the branch tips' ancestors.
   The four-counters triage (§1) missed this; `git cherry` (run 2026-08-20)
   proves it — see §12.3. None of these branches needs a rebase-merge.
2. **Only `feat/figma-native-import` is integration-ready** (contemporary base,
   49 ahead / 4 behind). It should be the first and possibly only near-term
   merge, via the Phase-3 gate loop.
3. **The 7-week-stale bulk cannot be fast-forward or clean-merged.** Each needs
   rebase-first onto current master with semantic conflict resolution; expect
   heavy churn given master's 7-week evolution. Per-branch containment/twin
   checks (Phase 1) are still required before any of them — a branch whose
   work already landed in master's 7-week lead must be archived, not rebased.
4. **Dependabot branches are suspect.** Their bumps target versions from
   June; master has since moved. Verify each bump is still applicable before
   spending rebase effort — many will be no-ops or conflicts against newer
   deps already on master.
5. **Scope decision required from the owner** before proceeding beyond figma:
   is the goal to land ALL 33 branches (large, multi-day, high-conflict), or
   only the high-value feature set? The methodology supports either, but the
   sequencing and lease budget differ materially.

### 12.3 `git cherry` verdicts (2026-08-20) — the decisive check

`git cherry master <branch>` compares patch-ids: `-` = an equivalent change
already exists on master; `+` = unique work not on master.

| Branch | `+` unique | `-` on master | Verdict |
|---|---|---|---|
| `feat/adjustment-effects-hardening` | 0 | 814 | **ARCHIVE** (work shipped) |
| `feat/ai-model-recovery` | 0 | 989 | **ARCHIVE** |
| `feat/animated-media` | 0 | 1678 | **ARCHIVE** |
| `feat/canvas-invalidation` | 0 | 427 | **ARCHIVE** |
| `feat/ci-windows-import-boundary` | 0 | 2163 | **ARCHIVE** |
| `feat/export-workspace` | 0 | 1047 | **ARCHIVE** |
| `feat/gradient-map-system` | 0 | 1042 | **ARCHIVE** |
| `feat/input-system` | 0 | 1091 | **ARCHIVE** |
| `feat/properties-panel-ia-audit` | 0 | 761 | **ARCHIVE** |
| `feat/upscale-deferred-work` | 0 | 885 | **ARCHIVE** |
| `feat/wasm-trace-effects-pdf-hardening` | 0 | 399 | **ARCHIVE** |
| `motion-mode-followup` | 0 | 539 | **ARCHIVE** |
| `perf/canvas-optimization` | 0 | 1037 | **ARCHIVE** |
| `perf/webkit-render-path` | 0 | 1574 | **ARCHIVE** |
| `fix/release-macos-smoke` | 0 | 2170 | **ARCHIVE** |
| `fix/release-publish-input` | 0 | 2172 | **ARCHIVE** |
| `fix/release-unsigned-contingency` | 0 | 2168 | **ARCHIVE** |
| `fix/release-windows-shell` | 0 | 2169 | **ARCHIVE** |
| 13× `dependabot/*` | 1 each | ~1850 each | **VERIFY bump** (one trivial version bump each) |
| `dependabot/github_actions/actions-all-cf8c28f1bd` | 0 | 1852 | **ARCHIVE** (fully redundant) |
| `feat/figma-native-import` | 52 | — | **MERGE** (real paint/brush work) |

Interpretation: 18 feature/fix/perf branches carry **zero unique commits** —
every commit is an equivalent of a commit already on `master`. Merging them
would be a redundant, conflict-prone no-op. The 14 dependabot branches each
carry exactly one unique commit (the dependency bump); 13 are still possibly
relevant (e.g. master biome `^2.5.7` < bump `2.5.8`), 1 is fully redundant.

### 12.4 Corrected execution plan

The consolidation is far smaller than any prior snapshot implied:

1. **`feat/figma-native-import` — MERGE (in gate).** Integration worktree
   `.worktrees/integrate-figma` created; rebased onto `master` (52 commits,
   zero conflicts). Tier-0 format fixed (auto-formatted 158 files + 1 import
   order). Units green in isolation (35/35) but **one flaky/order-dependent
   failure in `learning-system.test.tsx`** appeared only inside the affected
   suite run — must be stabilized or understood before merge. Full
   `verify:affected` (incl. E2E) exceeds the 120s cap and was not completed.
2. **18 feature/fix/perf branches — ARCHIVE, do not merge.** Because their tips
   are NOT ancestors of `master`, `git branch -d` will *refuse* (correct
   protection). Safe archive path: `git tag archive/<b> <b>` then
   `git branch -D <b>` — the tag preserves the ref. Confirm with owner before
   deleting remote-tracking refs.
3. **14 dependabot branches — verify then apply-or-archive.** For each, inspect
   its single `+` commit's target version against `master`'s current version.
   If master is behind, cherry-pick the one commit (trivial, low-risk). If at
   or above, archive like step 2.
4. **No rebase-first integration is required for any stale branch** — the
   §12.2 "REBASE-FIRST" verdicts are superseded by this cherry evidence.
   The only real merge is figma.

### 12.5 Updated risks

- **R13 — false "ahead" panic.** `rev-list --count` reported 400–2244 "ahead"
  commits, suggesting massive divergence. `git cherry` revealed 0 unique.
  Lesson: never triage merge-safety on commit counts alone; always run
  `git cherry` to separate content from object divergence.
- **R14 — archive must use tag+`-D`, not `-d`.** Because equivalent-work
  branches aren't ancestry-merged, the plan's "delete with `git branch -d`"
  rule fails here. Tag-first preserves history; `-D` is justified only after
  the tag exists and owner confirms.
- **R15 — figma flaky test.** `learning-system.test.tsx` passes alone (35/35)
  but failed once in the affected suite (1/35). Order-dependent or timing
  flake — a merge blocker until reproduced and fixed or quarantined, else it
  will red CI intermittently.
- **R16 — dependabot bump drift.** 7-week-old bumps may target versions master
  has since passed; applying blindly could downgrade or conflict. Verify each
  target version before cherry-pick.
