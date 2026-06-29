# AGENTS.md — Strata

Local-first, cross-platform design suite. Native Rust engine on desktop
(Tauri 2), WASM behind the same facade on web. Linux (CachyOS/Arch) is the
primary dev OS.

## Toolchain (confirmed working, 2026-06-28)
- Rust: `~/.cargo/bin` (rustc 1.96 / cargo 1.96). Source with `. "$HOME/.cargo/env"`.
- pnpm 11.9: `~/.local/share/pnpm/bin`. Export `PNPM_HOME="$HOME/.local/share/pnpm"` and add `$PNPM_HOME/bin` to PATH.
- just 1.54: `~/.local/bin`.
- Node 26, npm 11.16.
- wasm32 target installed.
- WebKitGTK 2.52.4 / GTK 3.24.52 / librsvg / openssl / fontconfig / fuse2 confirmed via pkg-config.
- Optional: `cmake`, `xdotool` (not needed for core build).

## Commands (run from repo root)
- `pnpm install` — install JS deps
- `just check-env` — verify toolchain on PATH
- `just test` — Rust (`cargo test --workspace`) + JS (`pnpm test` = Vitest)
- `just lint` — `cargo clippy -D warnings` + `pnpm lint` (Biome)
- `just format` — `cargo fmt` + `pnpm format`
- `just format-check` — verify formatting
- `pnpm typecheck` — `tsc --noEmit` across packages/*
- `pnpm audit:tokens` — WCAG 2.2 AA token gate (51 pairs across 3 themes)
- `pnpm audit:emoji` — zero-emoji gate (scales 271+ files)
- `pnpm --filter @strata/ui tokens:generate` — regenerate `tokens.css` from `color.ts`
- `just gate` — full Cascade Review gate (format-check + lint + test + audits)

## Running in the browser (stub backend, hot-reload)
```bash
cd apps/desktop
pnpm dev
# → http://localhost:1420 — Vite dev server, no Tauri window
```

## Running the desktop app (Tauri 2, native engine)
```bash
# Prerequisites: fresh Vite build (runs automatically with tauri dev)
cd apps/desktop
WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 DISPLAY=:0 GDK_BACKEND=wayland pnpm tauri:dev
```

## Current test counts
- **Rust:** 82 tests (75 workspace + 7 src-tauri): strata-core 32, strata-engine 4, strata-layout 9, strata-print 12, strata-sync 10, strata-trace 8, strata-desktop 7
- **JS:** 396+ tests across 58+ files: codegen 8, editor 130+, scene 70, engine 21, shared 24, ui 20, platform 41, home 13, E2E 21
- **Playwright E2E:** `pnpm test:e2e --filter @strata/home` (21 tests, 9 spec files, chromium)
- **Gates:** lint 0 warnings/errors on new/modified files; emoji 0 violations; tokens 51/51 WCAG-AA across 3 themes

## Ephemeral tree recovery

The working tree does NOT persist between agent sessions. If the session is
interrupted or the tree is recycled, recover with:

```bash
# The branch has the complete implementation
git checkout feat/home-start-page
# Or if the worktree was deleted:
git worktree add .worktrees/home-start-page feat/home-start-page
# Then resume work there
```

| Artifact | Location |
|---|---|---|
| Last commit | `9def86b` — "feat: complete tools system" |
| Branch | `feat/home-start-page` |
| Deferred plan | `docs/plans/layers-panel-deferred.md` (updated Session 11) |
| Tools plan | `docs/plans/tools-deferred.md` (updated Session 10) |

Always verify the commit exists before claiming work persisted:
```bash
git log --oneline -3
```

## Architecture decisions
- **ADR-0001** — native engine renders by **IR-replay** (not pixel-push). Validated empirically on Wayland: 86 fps vs 8.5 fps. Rust computes scene, emits compact IR (~42 KB/frame for 600 shapes); webview replays to canvas2D/WebGPU.
- **ADR-0002** — teal accent (#39d0c6), 12-step neutral+teal ramps, Light/Dark/High-Contrast themes.

## Quality gates (Cascade Review, §7) — every task must pass
TDD-first → tests green → token audit → zero emoji → axe-core zero violations
→ input-method audit (mouse/keyboard/touch/SR) → reduced-motion → 3-OS build
→ no layout thrash → assert native backend on desktop (not WASM).

## Multi-agent coordination

Multiple agents (subagents, parallel sessions) may touch the codebase concurrently:

| Scenario | Strategy |
|---|---|
| **Different crates/packages** | Safe in parallel. Package boundary (`crates/` vs `packages/`, or different crates/packages) is the isolation layer. E.g., Rust `strata-core` and TS `@strata/ui` never conflict. |
| **Same package, different files** | Safe in parallel if files are independent (no cross-imports). File is the unit of conflict. |
| **Same file** | **Must be sequential.** One agent finishes (commits), then the next rebases/merges. Use `git worktree add` for filesystem isolation — each agent/session gets its own worktree on its own branch. |
| **Hub files intersect** | Files like `CanvasArea.tsx` (imports from engine, scene, editor context) or `Shell.tsx` are integration hubs. Changes to dependencies may require hub updates. After parallel agents finish, the coordinating session runs `just gate` to catch integration breakage. |

**Worktree protocol** (via `using-git-worktrees` skill):
- Each agent creates a worktree: `git worktree add .worktrees/<feature> -b <feature>`
- Work in the worktree, commit, push branch
- Coordinator merges branches sequentially, resolving conflicts in hub files
- Verify with `just gate` after each merge

**When code must intersect** (e.g., both agents change `context.tsx`):
- Define the shared interface/type first (the "contract")
- Dispatch agents with the contract committed
- First agent to finish sets the baseline; second rebases onto it
- If that's not possible, sequence the work: one agent at a time touching the shared file

**Parallel implementation vs parallel investigation:**
- `dispatching-parallel-agents` — for independent *investigation* (debugging, research). Safe in parallel.
- `subagent-driven-development` — for sequential *implementation* per task. Explicitly forbids parallel implementation of the same area.

## Hard rules
- No emoji anywhere (§4.4). SVG icons via Lucide `<Icon>` only.
- No hardcoded color/space/type values — trace to CSS custom properties (§6).
- TS strict, no `any` (Biome enforces `noExplicitAny: error`).
- Rust `unsafe_code = deny` workspace-wide.
- Cross-platform: if it works on macOS but not Linux, it's not done.
- Each module cites its research basis in a top-of-file comment (§0.2).

## Layout — what each package/crate now contains

### crates/ (Rust)
| Crate | Status | Contents |
|---|---|---|
| `strata-core` | **Built** | Geometry primitives via kurbo (Point, Rect, Affine, Circle, Ellipse, Line), `Shape` enum with point-containment, `SceneNode` + `NodeId` + `hit_test()` (inverse-transform world→local, topmost wins), `rect_contains`, `point_to_segment_dist_sq`. 8 tests. |
| `strata-engine` | **Built** | `build_render_ir()` — scene→`Vec<RenderItem>` where each Item has transform+fill+primitive. `Primitive::Rect/Ellipse/Circle/Line`. The IR is the stable seam between native engine and webview (ADR-0001). 3 tests. |
| `strata-layout` | Stub | Taffy-backed flex/grid layout (task 1.3). |
| `strata-sync` | **Built** | SQLite save/load via `DocumentStore` with `save_document()`/`load_document()`/`list_documents()` + Tauri IPC commands `sync_save`/`sync_load`. 4 tests. |
| `strata-trace` | Stub | Auto-trace (Potrace/vtracer, task 1.7). |
| `strata-print` | **Built** | lopdf-based `export_pdf()` (rect/circle/ellipse/line/polygon/star path operators). Wired to Tauri via `export_node_pdf` command. CMYK/PDF-X in stub. 12 tests. |

### packages/ (TypeScript)
| Package | Status | Contents |
|---|---|---|
| `@strata/engine` | **Built** | `createEngine(backend)` facade (stub/native/wasm), TypeScript IR types matching Rust, `replayIr(canvas, ir)` — the 86fps canvas2D replay, geometry helpers (affine inverse/apply, point containment, hitTest), `ReplayTarget` interface. 19 tests. |
| `@strata/scene` | **Built** | Immutable `Document` with add/insert/remove/move/rename/reparent ops, `ShapeNode`/`TextNode`/`FrameNode`/`GroupNode` types, `groupNodes`/`ungroupNode`/`detachInstance` ops, `isContainer`/`getChildren` helpers, `ComponentDefinition` with typed `Slot[]`, `VariableStore` with modes+resolve, `slotsSatisfied()` guard. 70 tests. |
| `@strata/ui` | **Built** | Tokens: color ramps, 3 themes, WCAG-AA audit, `tokens.css` generated from TS. Icons: typed Lucide `<Icon name label>` with a11y contract, `TOOL_ICONS` + `CHROME_ICONS` maps. Components: APG `Button` (5 variants), `IconButton`, `Toolbar` (roving tabindex), `NumberInput` (drag-to-scrub, arrow inc/dec), `components.css` (token-styled). 20 tests. |
| `@strata/editor` | **Built** | `Shell` (CSS Grid: menubar/toolbar/canvas/layers/inspector/status), `EditorProvider` context (Document + tool state + zoom/pan + shape creation + undo/redo + editable props, shared `aria-live` announcer, `reparentNode`/`groupSelected`/`ungroupSelected`/`detachSelected` actions), `CanvasArea` (canvas + replayIr with hit-testing + zoom/pan + keyboard nudge + Tab cycling), `LayersPanel` (virtualized APG Tree View — `role="tree"`, roving tabindex, full keyboard map ↑↓→←Home/End/Enter/F2, type-ahead, multi-select Shift/Ctrl/Ctrl+A, expand/collapse, inline rename, search/filter, visibility/lock toggles, context menu, per-type auto-naming, `@tanstack/react-virtual`), `InspectorPanel` (editable position/size/fill with NumberInput scrubbing, layout/export/spec tabs), `Menubar` (platform-aware shortcuts), `shortcuts/` (ShortcutManager, useShortcuts hook, ShortcutPalette), `ToolPanel` with Select/Frame/Rect/Ellipse/Line/Pen/Text/Hand/Zoom tools, `TabStrip`, `VariablePanel`, `StatusBar`. 46 tests. |
| `@strata/codegen` | **Built** | `exportDocumentToSvg(doc)` — standalone SVG from Document. `exportDocumentToReact(doc)` — React/Tailwind JSX. Sub-path export. |
| `@strata/shared` | **Built** | `ordering` facade — real base-62 fractional-indexing via `fractional-indexing` package (CRDT-safe). `debounce`/`throttle`, `units` conversion. `PACKAGE` marker. |

### apps/
| App | Status | Contents |
|---|---|---|
| `apps/desktop` | **Built** | Tauri 2 app with Vite+React frontend. Rust: `build_render_ir`/`hit_test` IPC commands (native engine bridge), plus legacy spike commands. UI: `Shell` editor from `@strata/editor`. Run via `pnpm dev` (browser) or `pnpm tauri:dev` (native window). |
| `apps/web` | Stub | Next.js 15 scaffold (task 0.9+). |

### docs/
- `docs/adr/0001-native-render-in-tauri-webview.md` — IR-replay decision with empirical evidence
- `docs/adr/0002-design-tokens.md` — teal accent + token system rationale
- `docs/plans/phase1-plan.md` — Phase 1 execution plan (Component Slots through Packaging)
- `docs/plans/phase2-plan.md` — Phase 2 execution plan (Sync, Assets, Present, Hybrid, Print)
- `docs/plans/layers-panel-deferred.md` — Deferred DnD, E2E, axe-core, thumbnail, clipboard

## Phase 1 complete (Session 4, 2026-06-28)

All 7 tasks + pre-flight completed:

| Task | What |
|---|---|
| Pre-flight P0-P2 | IPC serde adapter, round-trip tests, SQLite DocumentStore |
| 1.1 Component Slots | TS scene model + Rust mirror + Editor UI (LayersPanel/InspectorPanel) |
| 1.2 Variables + Math | Pratt parser expr evaluator (TS + Rust), resolve() wiring |
| 1.3 CSS Layout | Taffy 0.11 compute_layout (flex), validate_breakpoints |
| 1.4 Print PDF | lopdf-based export_pdf (rect/circle/ellipse/line path operators) |
| 1.5 CMYK/PDF-X | rgb_to_cmyk, marks_geometry, stub PDF/X-1a/X-4 |
| 1.6 Spec Inspector | buildSpec() + specToMarkdown() with type styles/spacing/palette |
| 1.7 Auto-trace | Potrace-class contour tracing, RDP simplification, rayon |

**Remaining for next session:** Packaging (0.11) — .AppImage/.deb/.dmg/.msi CI matrix, CachyOS AUR PKGBUILD.

### Session 4: 72 Rust tests (was 37), 123 JS tests (was 66), all gates pass.

## Stabilization pass update (Session 5, 2026-06-28)

Phase A/B UI surfacing work is present in the working tree: multi-document tabs, tooltips, variables, export/spec/layout inspector panels, and auto-trace UI surfaces. This session added two small follow-through fixes:

| Area | Update |
|---|---|
| Test environment | Added `vitest.setup.ts` with a jsdom Canvas2D shim so editor tests fail on real console errors instead of logging the expected `HTMLCanvasElement.getContext` environment warning. |
| Drawing tools | Exposed the existing engine `line` primitive as an editor tool (`ToolId`, toolbar button, `L` shortcut, drag-to-create shape, type-aware name `Line 1`). |
| Verification | `pnpm test` reports 125/125 JS tests; `cargo test --workspace` reports 72/72 Rust workspace tests; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` reports 8/8 src-tauri tests; `pnpm typecheck`, `pnpm lint`, `pnpm audit:emoji`, and `pnpm audit:tokens` pass locally. |

## Layers Panel session (Session 6, 2026-06-29)

Full APG Tree View layers panel implemented:

| Area | Update |
|---|---|
| Scene model | Added `GroupNode` (kind:'group', children), `reparentNode`, `groupNodes`, `ungroupNode`, `detachInstance` ops, `isContainer`/`getChildren` helpers. `walkNodes` recurses into groups. 13 new tests. |
| Shared ordering | `packages/shared/src/ordering.ts` with `generateKeyBetween`/`midPoint` facade (array-index base, Phase 2 fractional-index ready). |
| Tokens | Added `tree-row`/`tree-row-hover`/`tree-row-selected`/`tree-row-focus`/`tree-indent-guide` — 51/51 WCAG AA pairs across 3 themes. |
| Editor context | Hoisted shared `aria-live` announcer; fixed undo to restore selection; added `reparentNode`, `groupSelected`, `ungroupSelected`, `detachSelected` actions. |
| LayersPanel | Complete refactor into `components/LayersPanel/` directory: `LayersTree` (virtualized APG tree, `@tanstack/react-virtual`, full keyboard map, multi-select, type-ahead, expand/collapse), `LayersRow` (React.memo, disclosure/icon/name/toggles/inline-rename), search/filter, context menu. |
| Dependencies added | `@tanstack/react-virtual`, `@dnd-kit/core/sortable/utilities`, `playwright`, `@axe-core/playwright`, `@playwright/test` |
| Verification | JS: 240 tests pass (was 125). Token audit: 51/51. Lint: 0 errors. Emoji: 0 violations. |

**Next:** DnD reorder+reparent with @dnd-kit, E2E Playwright suite, axe-core scan, thumbnail optimization (see `docs/plans/layers-panel-deferred.md`).

**Next Phase C slices:** polygon/star/image tools, real pen/path model, inline text editing, stroke/opacity/blend/radius, color picker, native `.strata` save/load, clipboard/duplicate/z-order/group.

## Inspector session (Session 7, 2026-06-29)

P1 deferred items implemented — align/distribute, rotation/flip, corner radius, token binding:

| Area | Update |
|---|---|
| Align/distribute | `alignSelected`/`distributeSelected` context methods + AlignDistributeBar (8-button toolbar in multi-select). 6 axes + 2 distribute. |
| Rotation + Flip | `setSelectedFlipH`/`setSelectedFlipV` context methods. Rotation NumberField (deg) + flip buttons in PositionSizeSection. |
| Corner radius | `setSelectedCornerRadius` context method + CornerRadiusSection with uniform/per-corner modes and link toggle. Only for rect shapes. |
| Token binding model | `PropertyBinding` type, `bindings` field on NodeBase, `resolveBinding()` in variables.ts. |
| Binding UI | `setSelectedBinding` context method + `TokenBindIndicator` (variable chip with unbind) + `BindingMenu` (searchable variable picker popover). |
| Engine fix | Removed extra `}` in `engine.ts` `shapeToPrimitive()`. Fixed `tokens.test.ts` URL scheme issue. |
| Verification | 331 JS tests pass (was 240). Lint 0 errors on new/modified files. Rust 73/73 pass.

## Deferred items session (Session 11, 2026-06-29)

Completed all remaining items from the Layers Panel deferred implementation plan:

| Area | Update |
|---|---|
| Fractional indexing | Swapped `ordering.ts` from array-index facade to real base-62 fractional-indexing (`fractional-indexing` package). Added `order: string` to `NodeBase`. Added `migrateDocument()` for backward compat. All insertion/move ops assign order keys via `generateKeyBetween`. |
| ImageNode | Added `ImageNode` kind to scene types + `makeImageNode` factory. Added `image` variant to engine `Primitive` + `replayIr` (image cache with progressive paint). Added image field support to Rust mirror. Wired editor `toEngineNode`, `nodeWorldBoundsFn`, LayersRow icon, codegen SVG export. |
| PathNode (bezier path) | Engine `Shape`/`Primitive` already had `PathPoint` + `path` variant; wired `engine.ts` `shapeToPrimitive`, `geometry.ts` `shapeContains` (closed=fill, open=tolerance stroke), `replay.ts` cubic bezier rendering. `arrow` variant also wired end-to-end. |
| Copy/Cut/Paste | `packages/editor/src/clipboard.ts` module with `ClipboardItem` API (dual MIME: `application/vnd.strata+json` + `text/plain`). Context `copySelected`/`cutSelected`/`paste` actions. Shortcut bindings (Ctrl+C/X/V/D). Context menu enabled. |
| Row thumbnail | `useThumbnail.ts` hook — OffscreenCanvas 28x28, `requestIdleCallback`, simplified shape rendering. Integrated into `LayersRow` with CSS styling. |
| Virtualization stress test | `useFlatTree.test.ts` — 5000-node flatten test with <200ms perf assertion. |
| E2E test expansion | Added search filter, keyboard reorder, and additional coverage tests to `tests/e2e/layers/layers.spec.ts`. |
| Verification | 226+ JS tests pass (scene 70, engine 21, editor 130+, shared 24, codegen 8). Rust 75/75 workspace tests. Tokens 51/51. Typecheck 0 errors on all modified packages. Lint 0 errors on modified files. |

## Spec Panel completion (Session 12, 2026-06-29)

All deferred phases D1-D8 of the Spec Panel implemented (except D5 token-aware codegen, which needs a schema change, and D6 cross-platform verification):

| Phase | What was done |
|---|---|
| **D1** E2E + axe-core | `tests/e2e/spec/measurement.spec.ts` (4 tests), `tests/e2e/spec/axe.spec.ts` (2 tests) |
| **D2** Syntax highlighting | PrismJS integration (`syntax.ts`), 6 language grammars, `CodeGenView` renders tokenized HTML |
| **D3** Diff-on-change | `useRef` prevCode tracking, +N/-N diff badges with `aria-live` |
| **D4** Tauri file-save | `save_file_bytes` Tauri command, `saveBlob` on Platform interface (tauri/web/memory impls), threaded through SpecPanel → AssetExportControls |
| **D7** PDF export | `strata-print` crate wired via `export_node_pdf` Tauri command, PDF format button in AssetExportControls (desktop-only) |
| **D8** Flutter/SwiftUI auto-layout | Recursive emitters: frames→Row/Column/HStack/VStack, groups→Stack/ZStack, children rendered depth-first. 6 new tests |
| **Pre-existing fixes** | 3 doc files cleaned of emoji, playwright-report ignored in emoji audit, position-lock test pattern fixed for `<input type="checkbox">` |

**Verification:** 43 JS test files (327 tests, +11 from prior session), Rust 75+ workspace + 7 src-tauri (80 total), emoji audit clean, typecheck clean across all packages.

## Key files to read before starting

| File | Why |
|---|---|
| `packages/engine/src/types.ts` | TS IR types (RenderItem, Primitive, Shape) — the webview contract |
| `packages/engine/src/replay.ts` | replayIr — canvas2D consumption of IR |
| `packages/engine/src/engine.ts` | Engine facade + stub backend + nativeEngine() Tauri bridge |
| `packages/scene/src/document.ts` | Immutable Document model with ops |
| `packages/scene/src/types.ts` | SceneNode types (ShapeNode, TextNode, FrameNode) |
| `packages/editor/src/Shell.tsx` | Editor app shell CSS Grid |
| `packages/editor/src/context.tsx` | EditorProvider with shared state + undo/redo |
| `packages/editor/src/CanvasArea.tsx` | Canvas region (replayIr + hit-test + zoom/pan) |
| `packages/editor/src/LayersPanel.tsx` | Re-exports from components/LayersPanel/ |
| `packages/editor/src/components/LayersPanel/` | Virtualized APG Tree View — LayersTree, LayersRow, useFlatTree, useTreeFocus, useTypeAhead, useAutoName, useThumbnail |
| `packages/editor/src/clipboard.ts` | System clipboard with `ClipboardItem` (dual MIME) |
| `packages/editor/src/InspectorPanel.tsx` | Editable position/size/fill |
| `packages/editor/src/Menubar.tsx` | File/Edit/View dropdowns with Save/Load/Export |
| `packages/editor/src/shortcuts/` | ShortcutManager, useShortcuts, ShortcutPalette |
| `packages/codegen/src/index.ts` | SVG + React code export |
| `crates/strata-core/src/scene.rs` | Rust SceneNode, hit_test |
| `crates/strata-engine/src/lib.rs` | Rust build_render_ir, Primitive enums (TS-compatible serde) |
| `crates/strata-sync/src/lib.rs` | DocumentStore: save/load/list documents via SQLite |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri commands (build_render_ir, hit_test, sync_save, sync_load, save_file_bytes, export_node_pdf) |
| `apps/desktop/src-tauri/src/renderer.rs` | Legacy render spike (archived) |
| `packages/editor/src/components/SpecPanel/` | Spec Panel: CodeGenView (syntax highlight + diff), AssetExportControls (PDF + platform save), MeasureOverlay, MeasurementReadout, SpecReadouts, AnnotationsDisplay |
| `packages/editor/src/components/SpecPanel/syntax.ts` | PrismJS syntax highlighting wrapper (6 languages) |
| `packages/codegen/src/flutter.ts` | Flutter emitter (Row/Column/Stack auto-layout) |
| `packages/codegen/src/swiftui.ts` | SwiftUI emitter (HStack/VStack/ZStack auto-layout) |
| `packages/platform/src/platform.ts` | Platform interface with saveBlob, searchFiles, reorderFile, listenForChanges |
| `pnpm-workspace.yaml` | Workspace config + allowBuilds |
