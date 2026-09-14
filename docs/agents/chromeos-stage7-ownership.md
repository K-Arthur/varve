# ChromeOS Stage 7 ownership record

**Task:** `chromeos-stage7-integrated-acceptance-2026-09-13`
**Coordinator / integrator:** Codex
**Started:** 2026-09-13
**Branch:** `master` (the requested integration branch; no task branch)
**Working tree:** `/home/kevina/CodingProjects/varve`
**Base SHA at ownership:** `ceb6c3962af1cfd7ce5acbd06a80c90a509a1b4f`
**Reserved E2E port:** `1497`
**Temporary evidence root:** `/tmp/varve-chromeos-stage7-*`
**Evidence status:** collected 2026-09-13; Duet hardware unavailable; promotion blocked

## Scope

Stage 7 is the independent integration and quality pass for the ChromeOS
program. It consumes the Stage 1–6 handoffs, revalidates the current `master`
tree, runs the bounded browser/website/package checks that are possible on the
Linux x86-64 host, records the exact candidate SHA, and produces a device kit
for the Lenovo Chromebook Duet 11M889. It does not promote a route without
real-device evidence and does not publish, tag, deploy, or change DNS.

The Duet is not attached to this session. All physical-Duet rows therefore
remain `NOT RUN`; synthetic Chromium, package, and x86 desktop observations are
labelled as their actual route and are not substituted for hardware evidence.

## Owned paths

| Path | Contract |
|---|---|
| `docs/agents/chromeos-stage7-ownership.md` | This coordination record |
| `docs/audits/chromeos-stage7-integrated-acceptance-2026-09-13.md` | Research ledger, integration evidence, route matrix, benchmarks, visual review, hardware kit, and release decision |
| `docs/screenshots/chromeos-stage7-2026-09-13/` | Deliberately inspected website screenshots; not visual-regression baselines |
| `apps/website/src/pages/docs/chromebook.astro` | Small Stage 7 truth correction only; Stage 6's completed route page remains the source of layout and route behavior |
| `apps/website/tests/e2e/chromeos-stage7-truth.spec.ts` | Regression for the correction and the explicit unverified-device boundary |

The two website paths are borrowed for this handoff from the completed Stage 6
task. They are single-writer surfaces for this pass; existing unrelated
website changes are preserved. No editor hub, renderer, input, service-worker,
manifest, package manifest, lockfile, release artifact, support-matrix, or
shared test-infrastructure file is owned here.

## Shared interfaces and handoffs

| Surface | Owner / dependency | Stage 7 rule |
|---|---|---|
| Browser/PWA implementation and tests | Stage 2 (`chromeos-stage2-ownership.md`) | Consume the existing production-artifact evidence; do not add a second service worker or persistence system |
| Adaptive rendering, resource recovery, model gating | Stage 3 | Report measured route evidence separately from the implementation claims |
| Responsive/input/a11y behavior | Stage 4 and `drawing-input-2026-09-13` | Use existing specs and visual artifacts; physical USI/OSK/ChromeVox behavior stays device-only |
| Linux ARM64 packaging | Stage 5 | Treat package/runner evidence as package evidence, not Crostini GUI evidence |
| Website/download/support truth | Stage 6 | Recheck the published wording; edit only the explicitly owned correction path |
| `docs/release/platform-support-matrix.md` | Shared release surface | Propose any tier change in the audit; do not edit without a separate single-writer handoff |
| `apps/website/src/pages/product.astro` and `download.astro` | Stage 6 completed surfaces | Read-only in this pass unless a newly reproduced contradiction requires a handoff |

Inherited handoffs are the committed Stage 1–6 ownership records and their
audits. Exact commit IDs and whether each result was re-run on the integrated
candidate are recorded in the Stage 7 audit; a prior agent's reported pass is
not accepted without a reproducible command or artifact.

## Coordination and safety

- Recheck `git status`, staged paths, `HEAD`, and active worktrees before every
  patch and before every commit. Other agents may continue committing to
  `master`; never stage the whole repository or commit another agent's work.
- Commit only the owned paths, progressively, with explicit path lists. Do not
  reset, clean, blanket-stash, force-push, or terminate processes not started
  by this task.
- Keep browser profiles, ports, test data, and evidence output isolated. Do not
  collect serial numbers, account data, private document paths, or user files.
- A website screenshot is evidence only after it is opened and inspected. A
  Playwright emulation is evidence for Chromium behavior at the emulated CSS
  geometry only, never for a physical Duet's panel, digitizer, battery, or
  latency.

## Completion handoff

The audit contains the exact commands and outcomes, inspected screenshot and
export paths, route support decisions, skipped checks with reasons, and the
smallest next physical verification step. The frozen candidate code SHA is
`614bc7a79ca60e047fd2bc3831d0e2bc41fa0ac0`; the evidence record commit ID is
written into the audit after the final owned-path commit lands. Hardware
promotion remains blocked until the Duet kit is run with normal security
settings and its artifacts are reviewed.
