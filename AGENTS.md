# AGENTS.md — Varve

Local-first, cross-platform design suite. Native Rust engine on desktop
(Tauri 2), WASM behind the same facade on web. Linux (CachyOS/Arch) is the
primary dev OS.

## Toolchain (confirmed working, 2026-06-29)
- Rust: `~/.cargo/bin` (rustc 1.96 / cargo 1.96). Source with `. "$HOME/.cargo/env"`.
- pnpm 11.9: `~/.local/share/pnpm/bin`. Export `PNPM_HOME="$HOME/.local/share/pnpm"` and add `$PNPM_HOME/bin` to PATH.
- just 1.54: `~/.local/bin`.
- Node 26, npm 11.16.
- wasm32 target installed.
- WebKitGTK 2.52.4 / GTK 3.24.52 / librsvg / openssl / fontconfig / fuse2 confirmed via pkg-config.
- Optional: `cmake`, `xdotool` (not needed for core build).

## Regression protocol (mandatory after every architecture/system change)

After ANY change that touches:
- type definitions, interfaces, or generics
- imports, re-exports, or module boundaries
- function signatures or overloads
- state shape or context values
- test files or test infrastructure

Run in order:
```bash
pnpm format          # or format-check
pnpm typecheck       # 15/15 packages must pass
pnpm lint            # 0 new errors on touched files
pnpm test            # full test suite must pass (excludes .bench.ts — run separately)
pnpm bench           # benchmark mode for .bench.ts files (optional, perf-sensitive)
pnpm audit:docs      # docs naming/index/link drift — zero violations
pnpm audit:emoji     # zero violations
pnpm audit:tokens    # 120/120 WCAG-AA (3 themes)
```

Failure at any step means the change introduced a regression. Fix before committing.
Do NOT skip steps — each catches a different class of error.

### Code-health check (triage gate)

After any system-level change (new context provider, new hub file, new tool system,
or any change to `context.tsx` / `CanvasArea.tsx` / `Shell.tsx`), run the
architecture audit to verify architectural metrics haven't regressed:

```bash
node scripts/audit-architecture.mjs --ci
```

Check these thresholds (2026-07-27 post-remediation):
| Metric | Current | Ceiling |
|--------|---------|---------|
| Avg cyclomatic complexity (editor) | 26.3 | 52.0 |
| Dependency cycles (madge) | 4 | 6 |
| Layer violations | 0 | 0 |
| Hub files over budget | 0 | 0 |
| Editor max complexity (context.tsx) | 833 | 847 |
| CanvasArea max complexity | 780 | 630 |
| Shell.tsx import count | 46 | 49 |

See `docs/audits/architecture-health-baseline-2026-07-25.md` for full
measurements. If any threshold is breached, stop and investigate.
Use `node scripts/audit-architecture.mjs --update` to reset the baseline after
intentional improvements.

## Architecture constraints (do not violate)

Every rule below was discovered through root-cause investigation of real regressions.
Adding new violations will silently break tests and block CI.

### No circular `workspace:*` dependency chains

A package must never import from another package that transitively imports back to it.
TypeScript + Vite module resolution will either fail outright or produce non-deterministic
builds depending on evaluation order. To break a cycle, move the shared code into the
dependent package itself (or into `@varve/shared` if it belongs to no single owner).

### Sub-context `onReady` pattern (Session 44+)

`EditorProvider` in `context.tsx` composes sub-contexts (`MotionProvider`, `PrototypeProvider`,
`ViewportProvider`) as nested JSX children. A sub-context's hooks MUST NOT be called at the
`EditorProvider` function body level because the provider wrappers haven't mounted yet.
Instead, the sub-context accepts an `onReady` callback prop that reports its value back to
`EditorProvider` via `useState`. **New sub-contexts MUST follow this pattern** — see
`MotionProvider.onReady` in `MotionContext.tsx` and its usage at `context.tsx:5617`.

### ActionRegistry overwrite order

`Shell.tsx` calls `registerEditorActions(editor, callbacks)` BEFORE
`registerAllShortcuts(() => null)`. This ordering is required because `registerAllShortcuts`
pre-populates the registry with no-op stubs — if it runs first, the `r.has(id)` guard in
`registerEditorActions` silently skips registering real handlers. Any new registration path
must respect this priority: real handlers first, no-op stubs second.

### Module instability ceiling (Session 48+)

Hub files (Shell, CanvasArea) are inherently unstable. Every new import added to
them drags the whole module graph. Follow these rules:

1. **Hub files must not import leaf modules directly.** Before adding another import,
   ask: can the integration live in a thin adapter module?
2. **Prefer dependency injection over direct imports in hub files.**
3. **New hub files must target I < 0.85.**

| File | Imports (Ce) | Instability (I) | Status |
|------|-------------|-----------------|--------|
| `CanvasArea.tsx` | 82 | 0.95 | **Over budget** — must not increase |
| `Shell.tsx` | 71 | 0.93 | **Over budget** — must not increase |
| `Menubar.tsx` | 14 | 0.88 | At risk |
| `context.tsx` | 40 | 0.36 | Healthy |

**No new import may be added to CanvasArea.tsx or Shell.tsx without first removing
an existing import of equal or greater weight.** Enforced by `scripts/audit-health.mjs`.

### Cyclomatic complexity ceiling — ENFORCED

| Context | Ceiling | Warning at | Block at |
|---------|---------|------------|----------|
| React component body | **200** | 160 (80%) | 200 |
| Non-component function | **50** | 40 (80%) | 50 |
| Tool handler (onPointerDown, etc.) | **30** | 24 (80%) | 30 |
| Test assertion body | **15** | 12 (80%) | 15 |

**70% rule:** When a function reaches 70% of its ceiling, any new
functionality MUST be extracted into a new function/module — not added
to the existing function. This is checked in pre-commit.

**Ceiling is a hard block, not a suggestion.** Pre-commit rejects
commits that increase complexity of any function already at or over its
ceiling. The only allowed operation on over-ceiling functions is
extraction (reducing their complexity).

**Over-ceiling files must have a `// COMPLEXITY:` comment** at the top
of the file with current complexity and a plan to reduce it. Without it,
pre-commit blocks any change to that file.

### Hook ordering invariance

React hooks must be called in the same order on every render. When extracting code
from `EditorProvider`:
1. Identify all hook dependencies
2. Create the hook function in `context/useX.ts`
3. Place the hook call AFTER all hooks it depends on and BEFORE the `value` useMemo
4. Add hook return values to the `value` useMemo dependency array
5. **Never split a hook call across conditionals, loops, or early returns**

See `context/usePersistence.ts` and `context/useBackgroundRemoval.ts` for the pattern.

### The clean version is not always the fast version (render/replay hot path)

Varve is a design app — frame time beats complexity score. `CanvasArea.tsx`'s
`replaySubtreeToCtx` (and any function like it: a big `switch` over node/primitive
kind, called once per node per frame) is a classic case where the "obvious"
refactor — replacing the switch with a dispatch table or visitor pattern keyed by
`node.kind` — can make the hot path **slower**, not faster. A monomorphic
`switch` on a small closed set of string/enum kinds gets good branch prediction
and is a strong inlining candidate for the JIT; a table of closures
(`{ rect: fn, ellipse: fn, ... }[kind]()`) produces a megamorphic call site the
JIT can't specialize, which can cost more than the readability win is worth in a
loop that runs per-node-per-frame.

**Rule:** any structural change to `replaySubtreeToCtx`, `replayIr`, or an
equivalent per-node/per-frame dispatch function must be benchmarked before merge
(see the performance harness under `docs/quality/` — benchmark at 100 / 1k / 10k
/ 50k nodes, full-frame and incremental-frame). If a change regresses frame time,
**the readability improvement does not justify it in this specific function** —
revert or find a version that's both faster and clearer, don't ship the
regression on the strength of the diff looking nicer. This applies whether the
change comes from a manual refactor or an automated one (e.g. Stryker-adjacent
cleanup tooling, codemods).

## Commands (run from repo root)
- `pnpm install` — install JS deps
- `just check-env` — verify toolchain on PATH
- `just test` — Rust (`cargo test --workspace`) + JS (`pnpm test` = Vitest)
- `just lint` — `cargo clippy -D warnings` + `pnpm lint` (Biome)
- `just format` — `cargo fmt` + `pnpm format`
- `pnpm typecheck` — `tsc --noEmit` across packages/*
- `pnpm audit:tokens` — WCAG 2.2 AA token gate (120 checks across 3 themes)
- `pnpm audit:emoji` — zero-emoji gate
- `pnpm audit:docs` — docs drift gate (stale "Strata"/dead-path references in current-state docs, ADR index coverage, broken internal links). Historical docs (dated audits/plans/perf/session history/ADRs/CLA/licensing, and files under `docs/implementation-memory/`) may reference the old name; current-state docs must not.
- `pnpm --filter @varve/ui tokens:generate` — regenerate `tokens.css` from `color.ts`
- `just gate` — full Cascade Review gate (format-check + lint + test + audits)

### CI/CD Commands
- `just install-ci-tooling` — install GitHub CLI, act, and Docker for local CI/CD
- `just install-ci-tooling` (with `bash scripts/install-ci-tooling.sh --check`) — verify act/container-engine parity for local runs
- `just pin-actions` — check for unpinned GitHub Actions (supply chain security)
- `just pin-actions-fix` — pin all GitHub Actions to commit SHAs
- `just validate-workflows` — validate all workflow YAML files
- `just validate-workflows-staged` — validate only staged workflow files
- `just act-list` — list available GitHub Actions jobs for local testing (no container engine needed)
- `just act-dry <workflow>` — dry-run a workflow to check execution plan (no container engine needed)
- `just act-run <job>` — run a specific GitHub Actions job locally (requires docker/podman running)
- `just ci-debug <run-id>` — generate the automated failure-debug report for a run
- `just ci-health` — classify recent run failures (billing-block / never-started / real-failure)
- `just ci-tools-test` — regression tests for the CI tooling itself

### Remote CI health (billing blocks and runner outages)

GitHub can block job startup for account-level reasons (failed payments,
spending limits) — every run fails in ~3s with zero steps recorded and
*"The job was not started because recent account payments have failed..."*.
This is NOT a code failure; no workflow edit fixes it. Diagnose with
`just ci-health` (prints `BILLING` per run) and resolve at
https://github.com/settings/billing. `ci-debug.mjs` classifies such jobs as
`billing-block` / `never-started` / `real-failure` (see `docs/CI_CD_RESILIENCE.md`).

## Automated UI/canvas testing

**If a bug involves the canvas, pointer/drag interaction, or "something doesn't
render/respond" — write and run a Playwright E2E test before declaring a fix verified.**
Vitest/RTL unit tests never dispatch real `PointerEvent`s through the real DOM and
never hit real browser APIs. A whole class of real bugs — broken CSS layout, overlays
eating pointer events, browser API throwing — is invisible to unit tests.

### Running E2E tests
```bash
npx playwright install chromium
npx playwright test tests/e2e --project=chromium --reporter=list
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium --reporter=list
```

### Standard nav helper for canvas specs
```ts
async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.locator('dialog').getByRole('button', { name: /^create$/i }).waitFor({ timeout: 5000 });
  await page.locator('dialog').getByRole('button', { name: /^create$/i }).click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (await welcomeClose.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await welcomeClose.first().click();
  }
}
```

### Debugging recipe: collapsed or zero-size elements
Use `page.evaluate()` to pull real computed layout:
```ts
const info = await page.evaluate(() => {
  const el = document.querySelector('.some-element') as HTMLElement;
  const cs = getComputedStyle(el);
  return {
    rect: el.getBoundingClientRect().toJSON(),
    display: cs.display, height: cs.height, contain: cs.contain,
    parentClass: el.parentElement?.className,
  };
});
```

**Known trap — `<ErrorBoundary>` breaks CSS Grid/Flex placement.** Wrapping
something in `<ErrorBoundary>` that relies on being a direct grid/flex item
(such as `.editor-canvas`) collapses it to 0 height. Fixed by `display: contents`
on the ErrorBoundary wrapper.

### For future sessions
If the user reports "X doesn't work when I click/drag/interact," and X touches
CanvasArea, pointer events, or CSS layout:
1. Write a Playwright spec that drives the actual interaction
2. Run it. If it fails, use `page.evaluate()` to find the real DOM/CSS state
3. Only report a fix as done once the E2E test passes

## Ephemeral tree recovery

Recover with:

```bash
git checkout master
git log --oneline -3
```

| Artifact | Location |
|---|---|
| Working branch | `master` |
| Canvas responsiveness work | `perf/canvas-responsiveness` (6 commits ahead of master, merged 2026-07-27) |
| Deferred plan | `docs/plans/layers-panel-deferred.md` |
| Export deferred | `docs/plans/export-system-deferred.md` |
| Home/Workspace System | `docs/plans/projects-home-workspace-completed.md` |
| Packaging (0.11) | `docs/plans/session-04-packaging.md` |
| Loading Experience System | `docs/architecture/loading-system.md`, `docs/audits/loading-experience-audit.md` |
| Marketing Website | `apps/website/` - Astro 5 static site, 42 pages, GitHub Pages deploy. See `docs/plans/website-progress-tracker.md` |
| CI/CD pipeline memory (local, gitignored) | `GITHUB_PIPELINE_MEMORY.md` — session-survivable tracker for billing blocks, run classifications, and tooling state |

## Application Icon (cross-platform)

| Asset | Source | Generator | Location |
|---|---|---|---|
| Master art (1024x1024) | `packages/ui/src/icons/varve-app-icon.svg` | — | `apps/desktop/build-icons.sh` (source) |
| Mark-only (no background) | `packages/ui/src/icons/varve-icon.svg` | — | `apps/desktop/public/icons/favicon.svg` |
| Tauri PNGs + .icns + .ico | `varve-app-icon.svg` | `just generate-icons` | `apps/desktop/src-tauri/icons/` |
| Linux hicolor ladder (11 sizes) | `varve-app-icon.svg` | `just generate-icons` | `apps/desktop/src-tauri/icons/hicolor/` (as `dev.varve.desktop.*`) |
| Web/PWA favicons | `varve-icon.svg` + `varve-app-icon.svg` | `just generate-icons` | `apps/desktop/public/icons/` |

### Wayland icon fix
On Wayland, `tauri dev` does not install desktop entries — the compositor
shows a generic fallback icon. The `pretauri:dev` hook runs
`apps/desktop/scripts/install-dev-icons.sh` automatically on Linux:
```bash
just install-dev-icons
```

## Architecture decisions
- **ADR-0001** — native engine renders by IR-replay (not pixel-push). Rust computes
  scene, emits compact IR (~42 KB/frame for 600 shapes); webview replays to canvas2D.
- **ADR-0002** — teal accent, 12-step neutral+teal ramps, Light/Dark/High-Contrast themes.
- **ADR-0003** — Canvas2D default, WebGPU opt-in with fallback.
- **ADR-0004** — varve-bridge + varve-wasm for shared IPC/WASM IR.
- **ADR-0005** — Offline-first ONNX: bundled models manifest, remote download explicit only.

## WebGPU + WASM program

| Area | Location |
|---|---|
| Baseline bench + goldens | `packages/engine/src/bench/`, `packages/engine/src/__goldens__/` |
| Compositor | `packages/compositor/` — Canvas2D + WebGPU scaffold |
| Render worker | `packages/editor/src/render/` — OffscreenCanvas |
| WASM build | `just wasm-build` → `apps/desktop/public/wasm/` |
| Architecture docs | `docs/architecture/render-pipeline.md`, `docs/architecture/wasm-backends.md` |

## Canvas System

| Area | Location |
|---|---|
| Camera + floating origin | `packages/shared/src/viewport.ts`, `packages/editor/src/canvas/cameraState.ts` |
| Sticky snap | `packages/editor/src/tools/snapping.ts` |
| Draw hub | `CanvasArea.tsx` |
| Minimap | `components/Minimap/` |
| Collab (stub) | `PresenceIndicator`, `CollabCursorOverlay`, `useCollabPresence` |
| Perf | `canvas10k.bench.test.ts`, `SubtreeReplayCache` |

## Image Trace System

Native raster-to-vector with honest web fallbacks. Canonical docs:
`docs/architecture/image-trace-system.md`, ADR-0170.

| Area | Location |
|---|---|
| Rust engine | `crates/varve-trace/` (contours, pixel_art, centerline, bezier_fit, quantize, hierarchy) |
| Native IPC | `trace_image` / `trace_image_binary` / `begin_trace_job` / `cancel_trace` + `trace:progress` (apps/desktop/src-tauri/src/lib.rs) |
| Provider chain + gating | `packages/engine/src/upscaleProviders/traceDispatch.ts` (native-first under Tauri), `rasterTrace.ts` fallback |
| Dialog/workflow | `packages/editor/src/components/Vectorize/` (presets, preview, complexity estimate, Edit Trace) |
| Insert/re-trace ops | `packages/editor/src/imageOperations.ts` (`insertTraceGroup`, `replaceTraceGroup`) |
| Provenance | `GroupNode.traceMetadata` (schema 2.16) + `packages/editor/src/logo/vectorization/metadata.ts` |
| E2E | `tests/e2e/canvas/image-trace.spec.ts` |

Key rules:
1. Desktop traces MUST prefer the native provider (chain is native-first under
   Tauri); never reorder it behind the TS fallbacks.
2. The wire options contract is camelCase (`rename_all = "camelCase"` in
   `TraceImageOptions`); snake_case keys are silently dropped.
3. Centerline is native-only: TS providers declare it unavailable instead of
   emitting filled silhouettes.
4. Traces are bounded: 128 MB bytes, 64 MPixels, 100 k paths; decode is
   dimension-pre-checked (bomb guard).
5. Trace insertion is one undo entry; re-traces replace the old group in
   place; metadata stores no raster bytes.

## Motion System

Complete timeline-based animation workspace. Canonical doc: `docs/architecture/motion-system.md`.

| Phase | What | Key files |
|---|---|---|
| **P0** | MotionFacade playback, TimelinePanel, prototype renderer | `motion/MotionFacade.ts`, `interactions.ts` |
| **P2** | SM bridge, variable bridge, InteractionSection, Smart Animate | `stateMachineBridge.ts`, `smartAnimate.ts` |
| **P3** | Oklab colors, path morph, composite ops, markers, presets | `interpolation.ts`, `TimelineSampler.ts`, `motion.ts` |
| **P4** | Export CSS/Lottie, videoExport stub, sampler cache | `ExportDialog.tsx`, `videoExport.ts` |
| **P5** | Extension types only (skeleton/IK/audio deferred) | `motion-types.ts` |

## Workspace Mode System

Seven task-focused modes over the same document/scene/rendering/command/history
systems. Canonical contract, configuration resolution, persistence, and known
gaps: `docs/architecture/workspace-system.md`.

| Mode | Shortcut | Default Tool | Focus |
|---|---|---|---|
| **Design** | `Ctrl+Shift+1` | select | UI/UX, components, prototyping |
| **Print** | `Ctrl+Shift+2` | select | Multi-page, typography, preflight, colour management |
| **Draw** | `Ctrl+Shift+3` | paint | Raster painting, vector freehand, brushes |
| **Photo** | `Ctrl+Shift+4` | preserve | Nondestructive photo editing, adjustments |
| **Motion** | `Ctrl+Shift+5` | select | Timeline animation, keyframes, easing |
| **Logo** | `Ctrl+Shift+6` | select | Wordmarks, marks, monograms, badges, brand systems |
| **Codegen** | `Ctrl+Shift+9` | select | Code export |

Logo workflow docs: `docs/architecture/logo-system.md`,
`docs/plans/logo-system-progress.md`. New commands must register in
`ShortcutManager` + `createActionHandlers` + both menus; project state
lives in `Document.logoProject` (scene `logo/logoProject.ts`).

The bindings above come from the shortcut registry (`workspaceDesign` … in
`packages/editor/src/shortcuts/ShortcutManager.ts`). Older docs may show
`Ctrl+Shift+D/P/R/I/M` — those keys are now taken by Repeat Duplicate,
Present, Invert Selection, and Preview Mode, and do **not** switch
workspaces. Always resolve workspace shortcuts for display via
`workspaceShortcutLabel(mode)` (see `packages/editor/src/workspace/workspaceShortcutLabel.ts`),
never hard-code them.

### Invariants (do not violate)
1. Single document model — mode never forks the scene.
2. State preservation — switching modes preserves document, selection, viewport, undo history.
3. No remounting — mode switching patches `EditorState` only.
4. Safe interaction resolution — in-progress interactions committed before switch.
5. All tools accessible via keyboard shortcuts or command palette.
6. Shared commands — selection, transform, colour, layers, undo/redo, copy/paste identical.
7. One resolver — every consumer reads `getEffectiveWorkspaceConfig(mode)` (or
   the `useEffectiveWorkspaceConfig` hook), never `WORKSPACE_CONFIGS[mode]`
   directly. The raw map has no entry for an unknown mode; the resolver falls
   back to Design and merges the user's per-workspace overrides.
8. One switch path — `requestWorkspaceSwitch` on the editor context. It owns
   re-entrancy guarding, interaction resolution, and the announcement. Do not
   add a second entry point that patches workspace state directly.
9. No decorative config — every `WorkspaceConfig` field must have a runtime
   consumer. Key bindings and renderer policy are deliberately *not* workspace
   configuration; see the doc above for why.

## Text Pipeline

Multilingual text rendering, shaping, BiDi layout, and export. M1–M8 complete.
See `docs/architecture/text-pipeline.md`.

## Layout — what each package/crate now contains

### crates/ (Rust)
| Crate | Status | Contents |
|---|---|---|
| `varve-core` | **Built** | Geometry primitives, `Shape` enum, `SceneNode`, `hit_test()` |
| `varve-engine` | **Built** | `build_render_ir()` — scene → `Vec<RenderItem>` |
| `varve-layout` | Stub | Taffy-backed flex/grid layout |
| `varve-sync` | **Built** | SQLite DocumentStore + Tauri IPC |
| `varve-trace` | **Built** | Raster-to-vector tracing: silhouette/centerline/pixel-art modes, Oklab quantization, Bézier fitting, hole pairing, cancellation (`docs/architecture/image-trace-system.md`) |
| `varve-print` | **Built** | lopdf-based PDF export, CMYK/PDF-X, font outlining, ICC profiles, print backends |
| `varve-upscale` | **Built** | Native image upscaling — bicubic CPU + optional ONNX super-resolution |
| `varve-bgremove` | **Built** | Background removal: heuristic non-AI methods + optional ONNX matting |
| `varve-colour` | **Built** | Colour science: ICC transforms (tintbox), analytical conversion, WASM bindings |
| `varve-bridge` | **Built** | TS wire-format → `varve-core` `SceneNode` conversion (Tauri IPC + WASM) |
| `varve-wasm` | **Built** | wasm-bindgen glue for `varve-engine` (web IR build + hit test) |

### packages/ (TypeScript)
| Package | Status | Contents |
|---|---|---|
| `@varve/engine` | **Built** | Engine facade (stub/native/wasm), IR types, `replayIr`, geometry helpers |
| `@varve/scene` | **Built** | Immutable Document model, nodes, ops, master pages, spreads |
| `@varve/ui` | **Built** | Design tokens, icons (Lucide/Phosphor), APG components |
| `@varve/editor` | **Built** | Shell (CSS Grid), EditorProvider, CanvasArea, LayersPanel, InspectorPanel, shortcuts |
| `@varve/codegen` | **Built** | SVG, React, Flutter, SwiftUI code export |
| `@varve/prototype` | **Built** | Prototype engine: triggers, actions, animation, transitions, navigation |
| `@varve/shared` | **Built** | Ordering, debounce, easing, units |
| `@varve/import` | **Built** | SVG/PDF/PSD/AI/EPS import parsers |
| `@varve/platform` | **Built** | Platform abstraction (Tauri/web/memory) |
| `@varve/ai` | **Built** | Auto-trace controller and assist orchestrator (on-device + cloud) |
| `@varve/collab` | **Built** | CRDT awareness and reconnect over the varve-sync SQLite core |
| `@varve/compositor` | **Built** | Pluggable render compositor: Canvas2D baseline, WebGPU when available |
| `@varve/crash` | **Built** | Privacy-first crash reporting and recovery core |
| `@varve/help` | **Built** | Help system documentation and browser |
| `@varve/home` | **Built** | Home/Start surface: recent files, projects, templates, file management |
| `@varve/layout` | **Built** | CSS-native flex/grid layout IR mirroring the `varve-layout` crate |
| `@varve/print` | **Built** | TS facade for the `varve-print` crate: font outlining, CMYK, PDF/X |

### apps/
| App | Status | Contents |
|---|---|---|
| `apps/desktop` | **Built** | Tauri 2 app with Vite+React frontend |
| `apps/website` | **Built** | Astro 5 static marketing site, GitHub Pages deploy (see `docs/release/website.md`) |

## Release signing (code-signing pipeline)

Varve's release pipeline is certificate-ready but not yet signing: no Apple/
Azure certificates are owned. Canonical docs: `docs/release/signing-decision-record.md`
(strategy + current prices), `docs/release/code-signing-setup.md` (human
acquisition checklist), `docs/release/signing-rotation-runbook.md` and
`docs/release/signing-incident-runbook.md` (procedures).

Rules that must not be violated:
- Signedness in `release-manifest.json` derives ONLY from post-build
  verification reports (`verify-windows-signature.ps1` /
  `verify-macos-signature.sh`), never from secret presence. `signing-policy.mjs`
  encodes the fail-closed policy; `verify-release-trust.mjs` enforces it before
  checksums/attestation/draft.
- Stable releases require valid Windows Authenticode and macOS
  Developer ID + notarized + stapled; missing credentials fail in
  `signing-preflight` BEFORE the platform build starts.
- Windows signing uses Azure Artifact Signing via Tauri `signCommand`
  (artifact-signing-cli 0.11.0). The auth chain is a client secret — OIDC is
  not supported by that tool; do not invent a replacement wrapper without
  re-checking official docs.
- macOS uses Developer ID Application (never Apple Development/Distribution);
  the identity string is matched exactly.
- Tauri updater keys (when the updater lands) are separate from all other
  signing material and are not created until then.

## Quality gates (Cascade Review) — every task must pass
TDD-first → tests green → token audit → zero emoji → axe-core zero violations
→ input-method audit → reduced-motion → 3-OS build → native backend on desktop.

## Multi-agent coordination

| Scenario | Strategy |
|---|---|
| Different crates/packages | Safe in parallel |
| Same package, different files | Safe in parallel if independent |
| Same file | **Must be sequential** — use `git worktree add` |
| Hub files intersect | After parallel agents, coordinator runs `just gate` |

**Worktree protocol:** `git worktree add .worktrees/<feature> -b <feature>`, work, commit,
merge sequentially. Verify with `just gate` after each merge.

## Hard rules
- No emoji anywhere. SVG icons via Lucide `<Icon>` or Phosphor `<SolidIcon>` only.
- No hardcoded color/space/type values — trace to CSS custom properties.
- TS strict, no `any` (Biome enforces `noExplicitAny: error`).
- Rust `unsafe_code = deny` workspace-wide.
- Cross-platform: if it works on macOS but not Linux, it's not done.
- **No native `<select>` elements** — use `@varve/ui`'s custom `Select` component.

## Session history

Detailed per-session development records have been moved to
[docs/agents/session-history.md](docs/agents/session-history.md).

For new contributors and maintainers, see:
- [docs/development/setup.md](docs/development/setup.md) — development setup
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guidelines
- [README.md](README.md) — project overview and architecture
- [docs/agents/README.md](docs/agents/README.md) — AI-assisted development practices

## Masking System

Canonical doc: `docs/architecture/masking-system.md` — model, invariants,
compositing order, renderer parity, export semantics, effect targeting.

- Clipping relationship = a `GroupNode`/`FrameNode` whose `mask.type === 'clip'`
  points at one of its own children; every other child is clipped content.
- Invariants: source must be a direct child (frames/groups); masks are
  released when the matte leaves the container (`reparentNode`); mask/scope
  graphs are acyclic (`addMask` + `setMaskSourceNode` both run
  `detectMaskCycles`); adjustment nodes can never be mask sources.
- Copy/paste remaps mask sources and scope targets through the clone idMap;
  cross-document paste drops foreign references (`dropForeignReferences`)
  instead of leaking source-document ids.
- Adjustment spatial masks (clip/alpha/luminance on the adjustment node)
  compose with `scope`: scope = input set, mask = output region.
- Clip masks with invert/feather/density render through the alpha path;
  plain hard clips use `ctx.clip()`. Mask surfaces come from a bounded pool
  (`acquireMaskSurface`/`releaseMaskSurface`).
- E2E corpus: `tests/e2e/canvas/clipping-masks.spec.ts` (screenshots to
  `reports/masking-review/`).
