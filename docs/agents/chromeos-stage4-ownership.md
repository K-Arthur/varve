# ChromeOS Stage 4 ownership record

**Task:** `chromeos-stage4-2026-09-12` (responsive workspace, touch, stylus,
trackpad, keyboard, accessibility)
**Coordinator:** opencode (design-tool interaction / accessibility session)
**Started:** 2026-09-12
**Updated:** 2026-09-12
**Base SHA:** `c4e16a7f763887b2f1feb64a20e7c5c621da307e`
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`, per explicit
user instruction to work on `master` and not create a branch.

## Scope owned by this task

Stage 4 of the user-requested ChromeOS decomposition: make the browser/PWA
editor a responsive workspace rather than a shrunken desktop, and make the
unified mouse/touch/pen/trackpad/keyboard behavior and accessibility hold up on
the Lenovo Chromebook Duet 11 target (8 GB primary; 4 GB and x86 Chromebooks as
constrained secondary targets).

- Responsive workspace measurement and repair at representative CSS viewports
  (960x600, 1200x750, 1280x800, 600x960, 800x1280, 480-640 split-screen) with
  fractional DPR and browser zoom considered.
- Virtual-keyboard / visual-viewport adaptation for text editing and
  viewport-anchored surfaces, using progressive enhancement (VirtualKeyboard
  API where present, VisualViewport fallback, neither required).
- Coarse-pointer target sizing and hover-independence repairs, reported against
  WCAG 2.2 SC 2.5.8 (24x24 CSS px minimum) with the project's 44 px goal.
- Device-emulated E2E coverage for touch, pen, viewport matrix, and keyboard
  insets; real-Duet gaps documented rather than claimed.
- ChromeOS keyboard-conflict documentation (Launcher/Search, Ctrl+1-8, etc.).
- Marketing-website copy that states only what the tested browser build does.

This stage does **not** claim Duet hardware validation. No Duet is attached to
this session; the hardware checklist in the Stage 4 audit is the handoff.

## Files owned (one writer at a time)

| Path | Purpose |
|---|---|
| `docs/agents/chromeos-stage4-ownership.md` | This record |
| `docs/audits/chromeos-stage4-input-responsive-2026-09-12.md` | Research ledger, gap analysis, evidence, remaining gaps |
| `packages/editor/src/canvas/keyboardInset.ts` (new) | Keyboard/visual-viewport inset model + subscription + CSS-var publication |
| `packages/editor/src/canvas/keyboardInset.test.ts` (new) | Unit tests for the above |
| `packages/editor/src/canvas/useKeyboardInset.ts` (new) | React lifecycle wrapper (if split from the model) |
| `packages/editor/src/editor.css` | Responsive/coarse-pointer/keyboard-inset CSS additions only |
| `apps/desktop/src/App.tsx` | Mount the keyboard-inset publisher once |
| `tests/e2e/interaction/*.spec.ts` (new) | Device-matrix, touch, pen, inset acceptance |
| `docs/architecture/input-system-behavior-matrix.md` | ChromeOS-reserved-shortcut and virtual-keyboard sections |
| `docs/architecture/responsive-workspace.md` (new) | Breakpoints, panel state, reset paths |
| `apps/website/src/pages/docs/browser-demo.astro` | Touch/pen/keyboard-browser guidance |
| `apps/website/src/pages/support/troubleshooting.astro` | Browser touch/pen troubleshooting (append-only) |

**Deliberately not owned:** `packages/editor/src/Shell.tsx`,
`CanvasArea.tsx`, `context.tsx` (hub import ceilings and active uncommitted
writers); `tests/e2e/shared.ts` and shared E2E infrastructure (active writer);
the uncommitted font, clipboard, generative-edit, preset, import, menu, and
visual-harness paths visible in `git status`; `docs/release/platform-support-matrix.md`
(Stage 5 record); `docs/agents/chromeos-stage{1,2,5}-ownership.md`.

## Shared interfaces and single-writer surfaces

| Surface | Stage 4 contract |
|---|---|
| Input normalization and gesture pipeline | Reuse `tools/inputNormalizer.ts`, `canvas/inputPipeline.ts`, `canvas/navigationState.ts`, `canvas/wheelClassifier.ts`; no parallel input path and no Chromebook-only input mode. |
| Adaptive profiles | Consume `canvas/adaptiveProfile.ts`; do not add a second capability system or device-name gate. |
| Tool transactions/undo | No change to transaction policy; interactive acceptance reuses existing undo boundaries. |
| Hub files | No new imports to `Shell.tsx`, `CanvasArea.tsx`, or `context.tsx`. |
| CSS custom properties | New properties are additive with safe fallbacks; no token renames; no per-device stylesheet fork. |
| Lockfiles/package manifests | No dependency changes. |
| Service worker/PWA metadata | Stage 2 ownership; untouched. |

## Coordination rules

- Other agents are active in this worktree (font lifecycle, clipboard,
  generative editing, presets, import/menu work, UI visual optimization).
  Before each patch and commit, re-check `git status --short`, preserve their
  changes, and commit only paths listed above via `git commit -- <paths>` so
  their staged index entries are never included.
- Serialize commits on `master`; no rebase, reset, global stash, history
  rewrite, force-push, or worktree removal.
- Reserve `VARVE_E2E_PORT=1494` for browser runs from this task. Do not use
  1420/1481/1491/1492/1493 and do not run heavy suites while other agents'
  vitest/Playwright jobs are active.
- Temporary evidence lives in `/tmp/varve-chromeos-stage4-*`; only distilled
  results and committed test-output paths are referenced from documentation.
- Screenshot/visual inspection is required for every responsive claim; an
  automated pass that was never inspected is recorded as uninspected.

## Handoffs

- Duet hardware run: the hardware checklist in the Stage 4 audit (real OSK,
  USI Pen 2 pressure/tilt/eraser, two-finger pinch, palm touches, trackpad
  pinch, ChromeVox).
- Stage 5's Linux ARM64 route remains independent; Stage 2's installed-PWA
  evidence remains independent.
- Support-tier promotion remains Stage 7 work; nothing here changes the matrix.
