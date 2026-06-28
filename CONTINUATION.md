# Strata — Continuation Prompt (Session 3)

> Generated 2026-06-28 after completing Session 2 (P0 Frontend Depth).
> Covers everything remaining from the three original plans: Kickoff, Frontend Rework, and Market Analysis.

---

## 0. Current State (End of Session 2)

### Completed
| Phase | Task | Status |
|---|---|---|
| 0.0 | Bootstrap (toolchain, pnpm, cargo) | Done |
| 0.1 | Monorepo + CI (3-OS matrix) | Done |
| 0.2 | Render spike (ADR-0001, 86fps IR-replay) | Done |
| 0.3 | Design tokens (42/42 WCAG-AA, 3 themes) | Done |
| 0.4 | Icon system (Lucide, zero-emoji audit) | Done |
| 0.5 | APG components (Button, IconButton, Toolbar) | Done |
| 0.6 | Core crates (strata-core 8 tests, strata-engine 3 tests) | Done |
| 0.7 | Dual-backend facade (createEngine, 19 tests) | Done |
| 0.8 | Scene model (Document, ComponentDef, VariableStore, 11 tests) | Done |
| 0.9 | Editor shell (CSS Grid, 6 panels, 3 tests) | Done |
| 0.10 | **Vertical Slice** | **Done** |
| **S2** | **P0 Frontend Depth** | **Done** |

### What Session 2 delivered
- **Shortcut system** — `packages/editor/src/shortcuts/` with `ShortcutManager`, `useShortcuts` hook, `ShortcutPalette` (Ctrl+/). 16 bindings (undo/redo/delete/new/open/save/export SVG/zoom reset/select all/group + tool toggles v/r/e/t/h). Platform-aware modifiers (Cmd on Mac, Ctrl on Linux/Windows).
- **Canvas keyboard navigation** — Arrow nudge (1px, 10px with Shift, 0.5px with Alt), Tab/Shift+Tab cycling through objects, Escape clears selection, Enter renames, `aria-live` announcer for selection changes.
- **Layers tree upgrade** — Full APG Tree View (`role="tree"`, `role="treeitem"`) with roving tabindex, Arrow/Home/End/Space navigation, type-ahead find, HTML5 drag-to-reorder calling `moveNode()`. Menu bar Open button consolidated onto Shell's `#file-open-input`.
- **NumberInput scrubbing** — Reusable `<NumberInput>` in `@strata/ui` with drag-to-scrub, Arrow up/down increment/decrement, Shift/Alt step modifiers, min/max clamping. Replaced inspector X/Y/W/H raw inputs.
- **All gates pass** — 66 JS tests, 15 Rust tests, lint 0, typecheck 11/11, emoji 0, tokens 42/42.

### Test counts
- **Rust:** 15 (strata-core 8, strata-engine 3, 4x smoke)
- **JS:** 66 (engine 19, scene 11, ui 20, shared 1, editor 15)

---

## 1. Remaining Work — Priority Order

### Phase 1 Features (from Kickoff Plan §8)

| # | Task | Priority Score | What to build | Blocked by |
|---|---|---|---|---|
| 1.1 | **Component Slots & Children** | 8.33 | `ComponentDefinition` with typed slots; instances fill slots with arbitrary local content; master non-slot changes propagate; slot content stays local. Update layers tree to show nested slotted children. Research Figma & Penpot slot models (study, do not copy). | 0.10 |
| 1.2 | **Batch Typography & Variables + math** | 8.0 | Multi-select variables table; edit one property across all. Math expressions (`{base}*1.5`) with alias resolution and mode-aware overrides. Safe arithmetic evaluator (no eval). | 1.1 |
| 1.3 | **CSS-native layout + breakpoints** | 5.0 | Taffy-based flex/grid/gap/wrap layout into the scene model. Container queries, `clamp()` fluid sizing. Breakpoints with overlap validation. | 1.1 |
| 1.4 | **Print font outlining + PDF export** | 8.0 | Export PDF with text paths outlined as Bezier (no font substitution). Noto font outline. RGB PDF with outlined paths. | 1.1 |
| 1.5 | **CMYK + PDF/X stub** | 3.0 | ICC profile-based RGB to CMYK conversion, bleed/trim/registration marks, PDF/X-1a and PDF/X-4 output. | 1.4 |
| 1.6 | **Local spec inspector** | 6.0 | Parse spacing/padding/type/assets from document model; display them in a developer-facing spec tab. | 1.3 |
| 1.7 | **Auto-trace** | 6.67 | `crates/strata-trace` implementing Potrace/vtracer-class contour + centerline tracing. Multi-threaded via rayon. Adjustable color count, threshold, path expansion. In-canvas integration. | 0.11 |
| 0.11 | **Packaging** | — | `.AppImage` + `.deb` on Linux CI. Then `.rpm`, Flatpak, AUR (CachyOS-priority). | 0.10 |

### Frontend Depth (from Frontend Rework Prompt) — Session 2 wiped all P0 items

| Priority | Area | What's built | What's needed |
|---|---|---|---|
| **P0** | ~~Shortcut system~~ | **Built** | Centralised `ShortcutManager`, platform-aware modifiers, searchable/remappable panel (`Ctrl+/`), all canvas/edit/file ops mapped |
| **P0** | ~~Canvas keyboard navigation~~ | **Built** | Tab/Shift+Tab object navigation, arrow nudging (1px/10px/0.5px), Enter to edit, Escape clear, `aria-live` announcer |
| **P0** | ~~Layers tree upgrade~~ | **Built** | Full APG Tree View: `role="tree"`, `role="treeitem"`, `role="group"`, roving tabindex, drag-to-reorder, type-ahead find |
| **P0** | ~~NumberInput scrubbing~~ | **Built** | Drag-to-scrub on numeric fields, arrow key increment/decrement, Shift/Alt modifiers, live preview |
| **P1** | ColorPicker | Hex input only | Hue slider ARIA pattern, Saturation/Lightness 2D area, RGBA/HSL/HSB inputs, eyedropper (`EyeDropper API`), swatch history |
| **P1** | Resizable panels | Fixed-width CSS Grid | Resize handles with `role="separator"`, keyboard arrow resize, persist widths to localStorage |
| **P1** | Dialog / Modal | None | APG `role="dialog"`, `aria-modal`, focus trap, Escape to close, scroll lock, return focus on close |
| **P1** | Context menu | None | Right-click on canvas/layers with `role="menu"`, full keyboard support, submenus, type-ahead |
| **P1** | Toast / Notification | None | `role="status"` (info) / `role="alert"` (errors), auto-dismiss + manual close, stacking (max 3) |
| **P1** | Select / Combobox | None | APG Combobox pattern, type-ahead filtering, virtualise long lists |
| **P2** | Tooltip system | None on toolbar | 300ms hover delay + immediate on focus, `@floating-ui/dom` positioning, dismiss on Escape/scroll |
| **P2** | Responsive breakpoints | Full desktop only | Tablet/phone adapt: bottom-sheet inspector, floating toolbar, collapsed panels below 768px |
| **P2** | ~~Keyboard-only canvas~~ | **Built** | Tab/Shift+Tab object navigation, arrow nudging (1px/10px/0.5px), Enter to edit, Ctrl+A/G/Shift+G |
| **P2** | Onboarding / empty states | None | First-run welcome + template picker, interactive spotlight tour, empty state illustrations (SVG, no emoji) |
| **P2** | Error handling UI | None | Offline banner, sync conflict resolver, AI/plugin crash boundaries, browser compat warning |
| **P3** | Codegen panel UI | Functions exist, no UI | Tabbed export panel with syntax-highlighted code, copy button, framework selector |
| **P3** | Settings panel | None | Appearance, shortcuts, collab, AI, account sections. All settings persist to localStorage |
| **P3** | Stories / Storybook | None | For every component: all variants, all states, dark+HC themes, keyboard demo, a11y annotations |
| **Phase 2** | Collaboration UI | None | Presence avatars + cursors, `aria-live` join/leave announcements, conflict indicators |
| **Phase 2** | AI assistant panel | None (stub package) | Chat interface (`role="log"`, `aria-live`), suggestion preview/apply, error + loading states |
| **Phase 2** | Plugin sandbox UI | None (stub package) | Plugin list with enable/disable, marketplace cards, permission request dialog |

### Cross-Cutting Technical Debt

| Item | Where | Notes |
|---|---|---|
| Rust/TS `Shape` serde mismatch | `apps/desktop/src-tauri/src/lib.rs` | IPC adapter `IpcSceneNode` uses `strata_core::Shape` directly, but TS Shape uses `kind`-tagged serde. Only the `IpcSceneNode.shape` field needs a tagged `IpcShape` adapter for the IPC bridge to work end-to-end. Currently only `Primitive` (output) is aligned. |
| Native engine IPC end-to-end | `engine.ts` + `lib.rs` | `nativeEngine()` wired but untested at runtime. Need a full serialization round-trip test. |
| `strata-sync` SQLite | `crates/strata-sync/src/lib.rs` | Smoke test only. Needs `rusqlite` dependency, `save_document`/`load_document` commands surfaced as Tauri IPC. |
| Test coverage | Editor: 15 tests | Still no tests for Menubar actions, Inspector editing, undo/redo, SVG export, zoom/pan. |
| jsdom canvas crash | `editor.test.tsx` | `HTMLCanvasElement.getContext` throws in jsdom (benign, tests pass). Mock canvas or suppress. |
| Vite chunk size | `apps/desktop/dist` | 904 KB JS bundle. Lucide icons tree-shake needs audit. |

---

## 2. Execution Order — Next Session

### Session priority (what to tackle next)

See `docs/plans/phase1-plan.md` for the full execution plan. Summary:

1. **Pre-flight P0–P2** — Fix IPC Shape serde mismatch, add serialization round-trip test, land minimal SQLite save/load in `crates/strata-sync`.
2. **Task 1.1 — Component Slots** (#1 differentiator, Rust + TS in parallel):
   - Extend `ComponentDefinition` with instance creation, slot filling, master propagation
   - Mirror in `crates/strata-core/src/component.rs`
   - Update LayersPanel for nested slot children, Inspector for slot UI, ToolPanel for Component tool
3. **Parallel**: **Task 1.2** (Variables/math) || **Task 1.7** (Auto-trace) || **Task 0.11** (Packaging)
4. **Task 1.3** — CSS layout + breakpoints (after 1.1)
5. **Task 1.4** — Print font outlining + PDF (after P2)
6. **Task 1.5** — CMYK/PDF-X stub (after 1.4)
7. **Task 1.6** — Spec inspector (after 1.2 + 1.3)
8. Final `just gate` + artifact attach

---

## 3. Gate Requirements (same as always)

After every subtask:
```
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm exec biome check --write . && pnpm lint && pnpm typecheck && pnpm test
pnpm audit:emoji && pnpm audit:tokens
```

All must pass. Non-negotiable.

---

## 4. Key Files (Same as AGENTS.md)

| File | Why |
|---|---|
| `packages/engine/src/types.ts` | TS IR types (RenderItem, Primitive, Shape) — the webview contract |
| `packages/engine/src/replay.ts` | replayIr — canvas2D consumption of IR |
| `packages/engine/src/engine.ts` | Engine facade + stub backend + nativeEngine() Tauri bridge |
| `packages/scene/src/document.ts` | Immutable Document model with ops |
| `packages/scene/src/types.ts` | SceneNode types (ShapeNode, TextNode, FrameNode) |
| `packages/scene/src/component.ts` | ComponentDefinition + slots |
| `packages/scene/src/variables.ts` | VariableStore with modes |
| `packages/editor/src/Shell.tsx` | Editor app shell CSS Grid |
| `packages/editor/src/context.tsx` | EditorProvider with shared state + undo/redo |
| `packages/editor/src/CanvasArea.tsx` | Canvas region (replayIr + hit-test + zoom/pan + keyboard nav) |
| `packages/editor/src/LayersPanel.tsx` | APG Tree View from real Document |
| `packages/editor/src/InspectorPanel.tsx` | Editable position/size/fill with NumberInput scrubbing |
| `packages/editor/src/Menubar.tsx` | File/Edit/View dropdowns with platform-aware shortcuts |
| `packages/editor/src/shortcuts/` | ShortcutManager, useShortcuts, ShortcutPalette |
| `packages/codegen/src/index.ts` | SVG + React code export |
| `crates/strata-core/src/scene.rs` | Rust SceneNode, hit_test |
| `crates/strata-engine/src/lib.rs` | Rust build_render_ir, Primitive enums (TS-compatible serde) |
| `apps/desktop/src-tauri/src/lib.rs` | Tauri commands (build_render_ir, hit_test) |
| `apps/desktop/src-tauri/src/renderer.rs` | Legacy render spike (archived) |
| `pnpm-workspace.yaml` | Workspace config + allowBuilds |

---

## 5. Hard Rules (never break)

- No emoji anywhere. SVG icons via Lucide `<Icon>` only.
- No hardcoded color/space/type values — trace to CSS custom properties.
- TS strict, no `any`.
- Rust `unsafe_code = deny` workspace-wide.
- Cross-platform: if it works on macOS but not Linux, it's not done.
- Each module cites its research basis in a top-of-file comment.
- TDD-first: write the failing test before implementation.
- Native backend on desktop (no WASM ceiling — the strategic wedge).
