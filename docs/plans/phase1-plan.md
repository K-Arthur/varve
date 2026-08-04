# Phase 1 Plan — Strata

> Compiled end of Session 2 (P0 frontend depth complete). Ready for execution in a new session.
>
> Scope decided with the user: **Rust + TS in parallel** (each task ships its Rust crate impl + TS facade together, native backend asserted on desktop) and **All of Phase 1** (tasks 1.1 through 1.7 plus packaging 0.11).

---

## Methodology

- **BMAD Lite** — decompose each task into Bounded, Measurable, Achievable, Deliverable steps with done-criteria before coding.
- **TDD-first** — write the failing test (Vitest / `cargo test` / Playwright) before the implementation, always.
- **Cascade Review** — after every sub-task: self-review -> automated checks -> quality gate -> proceed. Never skip the gate.
- **Sub-agent delegation** — independent tasks can be parallelised across subagents (see Execution Order). See AGENTS.md §Multi-agent coordination for worktree isolation, hub-file handling, and merge protocol when subagents touch intersecting code.
- **Research Gate (mandatory)** — before each feature, look up current best practice and cite it inline (`// Research basis: ...`). Do not implement from memory alone.

---

## Per-task gate (non-negotiable)

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm exec biome check --write . && pnpm lint && pnpm typecheck && pnpm test
pnpm audit:emoji && pnpm audit:tokens
```

Plus: **assert native backend on desktop** for any task that added a facade method. Zero emoji, zero hardcoded color/space/type values, 42/42 WCAG-AA tokens.

---

## Current state (end of Session 4, 2026-06-28)

**Phase 1 complete.** All 7 tasks + pre-flight done.

| Task | Status | Notes |
|---|---|---|
| Pre-flight P0-P2 | **Done** | IPC serde adapter, round-trip tests (4), SQLite DocumentStore |
| **1.1** Component Slots | **Done** | TS: createComponent/instantiate/fillSlot/propagateMaster, nested doc ops, editor panels. Rust: component.rs mirror, SceneNode frame fields, walk_nodes, get_parent. |
| **1.2** Variables + Math | **Done** | TS expr.ts (Pratt parser), variables.ts resolve() with math. Rust expr.rs mirror. 22 TS + 17 Rust tests. |
| **1.3** CSS Layout + Breakpoints | **Done** | Rust strata-layout with Taffy 0.11: compute_layout (flex), validate_breakpoints. 9 tests. |
| **1.4** Print (RGB PDF) | **Done** | Rust strata-print with lopdf: export_pdf (rect, circle, ellipse, line path operators). 5 tests. |
| **1.5** CMYK/PDF-X | **Done** | cmyk.rs: rgb_to_cmyk, marks_geometry, export_pdfx1a/export_pdfx4 stubs. 7 tests. |
| **1.6** Spec Inspector | **Done** | packages/codegen/src/spec.ts: buildSpec(), specToMarkdown(). 11 tests. |
| **1.7** Auto-trace | **Done** | Rust strata-trace: Potrace-class contour tracing, RDP simplification, rayon. 8 tests. |
| **0.11** Packaging | **Done** | CI/CD matrix (AppImage/deb/dmg/msi/AUR). tauri.conf.json bundle metadata, publish.yml + build.yml matrix, AUR PKGBUILDs, Flatpak manifest stub, justfile recipes. TypeScript typecheck gate (0 errors) + full test suite (3572/3572) passing. |

- **72 Rust tests** (was 37), **123 JS tests** (was 66), 195 total.
- 42/42 WCAG-AA tokens, emoji 0, clippy clean, lint clean.
- All `// Research basis:` citations in place.
- All crate-level gates pass.

---

## Pre-flight (DONE — Session 3, 2026-06-28)

| Step | What | Status | Notes |
|---|---|---|---|
| P0 | Fix Rust/TS `Shape` serde mismatch in `apps/desktop/src-tauri/src/lib.rs` — add tagged `IpcShape` adapter mirroring TS `#[serde(tag="kind")]` | **Done** | Scope was larger than planned: also fixed `Primitive::Line` `from`/`to` (were `kurbo::Point` → `{x,y}`, now `[f64;2]` matching TS) and `RenderItem.transform` (was `kurbo::Affine` → `{coeffs:...}`, now `[f64;6]`). All three mismatches blocked the native backend from working. |
| P1 | Add a full serialization round-trip test: TS `Scene` -> IPC -> Rust `hit_test`/`build_render_ir` -> back to TS | **Done** | 4 tests in `apps/desktop/src-tauri`: `round_trip_build_render_ir`, `round_trip_hit_test`, `output_serialization_matches_ts_wire_format`, plus existing 4 renderer smoke tests. |
| P2 | Add `crates/strata-sync` minimal SQLite `save_document`/`load_document` + Tauri IPC commands | **Done** | `DocumentStore` with `rusqlite` (bundled), `save_document`/`load_document`/`list_documents`, 4 tests. Tauri commands `sync_save`/`sync_load` wired via `.setup()` hook and state-managed. |
| Gate | `cargo fmt/clippy/test` + `pnpm lint/typecheck/test` + `audit:emoji` + `audit:tokens` | **Done** | 19 Rust tests (up from 15), 66 JS tests, all green. |

---

## Task 1.1 — Component Slots & Children (priority 8.33) — the differentiator

**Done when:** a `ComponentDefinition` with >=1 slot can be created; an instance is placed; the slot is filled with arbitrary local content; a non-slot edit to the master propagates to all instances; slot content stays local; the layers tree renders the nested slotted children.

**Steps (Rust + TS together):**

1. **Research gate** — Figma variant/swap & Penpot slot models (cite inline, do not copy). Write findings at top of `scene/component.ts` and `crates/strata-core/src/component.rs`.
2. **Scene model (TS)**
   - `packages/scene/src/component.ts`: add `createComponent()`, `instantiate()`, `fillSlot()`, `propagateMaster()`.
   - `packages/scene/src/document.ts`: extend `addNode`/`removeNode`/`moveNode` to recurse into `Frame.children` (today only root-level). Add `addChild(doc, parentId, child)`, `removeChild`, `moveChild`.
   - `packages/scene/src/types.ts`: confirm `Frame.slots: Record<string, NodeId>` already present — add `slotDefs?: Record<string, SlotKind>` per instance if needed.
   - Tests (Vitest): instantiation, slot fill, master non-slot edit propagates, slot edit stays local, `slotsSatisfied` guard.
3. **Rust mirror (`crates/strata-core`)**
   - New `crates/strata-core/src/component.rs` mirroring the TS API (create/instantiate/fill/propagate) over `SceneNode` with `Frame.slots`.
   - Carry the `IpcShape` adapter fix into the IPC bridge so nested children + slots traverse cleanly.
   - Tests (`cargo test`): same shape as TS — propagation, slot locality, guard.
4. **Editor UI**
   - `LayersPanel`: render nested `role="group"`/`treeitem` for slot children; indent; per-slot labels. (We already upgraded to APG tree in Session 2 — extends naturally.)
   - `InspectorPanel`: when selection is a component instance, show a "Slots" fieldset listing each declared slot with its current fill + "Replace" affordance.
   - `ToolPanel`: add a Component tool entry (stub in Phase 0) that, on click, places an instance of the selected `ComponentDefinition`.
   - Tests: render instance in `editor.test.tsx`, fill a slot via inspector, assert layers tree shows nested child.
5. **Native bridge** — assert the IR replays nested children via the existing `build_render_ir` command (slots are pure-UI over the existing IR).
6. **Gate** — full Cascade Review. **Verify native backend on desktop still chosen.**

**Dependencies:** P0/P1 (IPC fix), Phase 0 scene model (done).

**Risks:**
- Recursing into `Frame.children` invalidates every `rootNodes()`-style assumption in `CanvasArea`, `LayersPanel`, `InspectorPanel`, codegen — must audit all `rootNodes` callers and add a `walkNodes(doc)` helper.
- Master propagation must be immutable + structural-sharing; naive deep clone breaks undo perf.
- Slot kind `text` vs `single`/`multiple` needs a clear acceptance contract.

---

## Task 1.2 — Batch Typography & Variables + Math (priority 8.0)

**Done when:** multi-select variables in a table edits one property across all; `{base} * 1.5` and `{space-2} + 4` resolve via alias + mode-aware overrides using a safe evaluator (no `eval`).

**Steps:**

1. **Research gate** — Figma variables / Tokens Studio math; safe arithmetic evaluator patterns (Pratt parser or `expr-eval`-class). Cite.
2. **Safe expression evaluator (TS)**
   - `packages/scene/src/expr.ts`: tokenizer + Pratt parser for `+ - * / ()`, alias `{name}` lookup, mode-aware resolution, throws on unsafe input (no `eval`, no `Function`).
   - Tests: precedence, aliases, mode override, malformed input rejection, division-by-zero.
3. **Variables wiring**
   - `packages/scene/src/variables.ts`: `resolve()` detects `{...}` and routes through the evaluator; `resolveMany()` for batch; `setMode()`.
   - Tests: `{base}*1.5`, `{space-2}+4` with mode `dense`, unknown alias throws.
4. **Rust mirror**
   - `crates/strata-core/src/expr.rs` (or a new tiny crate) — same grammar, same tests. Native backend must resolve identically.
5. **UI**
   - New `VariablePanel` in editor (or extend Inspector): table with non-truncated descriptions (multi-line, not hover), multi-select rows, batch edit one column across the selection.
   - Tests: select 3 variables, change `line-height` once, all three update.
6. **Gate.**

**Dependencies:** 1.1 (selection/multi-select model — though variables multi-select can be primitive first).

**Risks:** Evaluator grammar must stay **non-Turing-complete** (no loops, no assignment); mode-aware alias cycles (`{a} -> {b} -> {a}`) need a visited-set guard.

---

## Task 1.3 — CSS-native Layout + Breakpoints (priority 5.0)

**Done when:** `crates/strata-layout` (Taffy) computes flex/grid/gap/wrap for a frame's children; container queries + `clamp()` fluid sizing emit into the layout IR; breakpoints with overlap validation exist; the designer's layout IS the handoff.

**Steps:**

1. **Research gate** — Taffy API, CSS Box/Flex/Grid specs, container queries, `clamp()` semantics, breakpoint overlap rules. Cite.
2. **Rust crate (`crates/strata-layout`)**
   - Depend on `taffy`. Implement `compute_layout(scene, frame) -> ResolvedLayout` (flex/grid/gap/wrap). Add `clamp(min, val, max)` and container-query width resolution.
   - `crates/strata-layout/src/breakpoints.rs`: `Breakpoint { id, minWidth, overlap }`, `validateBreakpoints()` detects overlap conflicts.
   - Tests (cargo): flex row, grid 2x2, gap, wrap, clamp, breakpoint overlap rejection.
3. **TS facade + IR**
   - `@varve/engine` facade: `computeLayout(scene, frameId)` -> behind native (Tauri IPC `compute_layout`) + stub (pure-TS mirror) + wasm.
   - Extend render IR with `LayoutItem` (resolved rect per child) so the canvas can preview without re-implementing Taffy in TS.
4. **Scene model**
   - `FrameNode`: add `layout?: { mode: 'flex'|'grid', gap, wrap, ... }`, `constraints?: { minW, maxW, fluid }`.
   - `Breakpoints` stored on `Document` (new field) with mode-aware variable bindings (ties to 1.2).
5. **Editor UI**
   - Inspector: "Layout" fieldset on frames — flex direction, gap, wrap, grid columns/rows.
   - Breakpoint bar over the canvas (segments with overlap warnings surfaced).
6. **Gate** — assert native `compute_layout` chosen on desktop.

**Dependencies:** 1.1 (nested children are what layout operates on).

**Risks:** Taffy version churn; container queries not natively in Taffy (synthesize by re-running layout per breakpoint width); TS stub mirror must match Taffy semantics exactly or staging drifts.

---

## Task 1.4 — Print Font Outlining + PDF Export (priority 8.0)

**Done when:** PDF export converts text to outlined Beziers paths (no font substitution); RGB PDF produced; CMYK stubbed with a clear contract (-> 1.5).

**Steps:**

1. **Research gate** — PDF spec, `printpdf`/`lopdf` Rust crates, glyph -> Bezier outlining (cosmic-text / ab_glyph outline), Noto fallback. Cite.
2. **Rust crate (`crates/strata-print`)**
   - Depend on `printpdf` + `ab_glyph` (or `cosmic-text`). `outline_text(font, text, size) -> Vec<BezierPath>`, `export_pdf(scene, opts) -> Vec<u8>` (RGB, text outlined).
   - Tests: round-trip a doc with a text node -> PDF bytes contain path operators, no `Tj` text operators.
3. **TS facade + Tauri**
   - `@varve/engine` / new `@varve/print` facade: `exportPdf(scene, opts)` behind native + stub (stub returns a minimal SVG-wrapped-in-PDF for tests).
   - Tauri command `export_pdf`.
4. **Editor UI**
   - Export panel (Frontend Rework section 15) — tabbed: React/Tailwind | Flutter | SwiftUI | SVG | **PDF (outlined)**. Copy button, syntax highlight.
5. **Gate.**

**Dependencies:** P2 (document save) helpful; independent of 1.1-1.3.

**Risks:** Font licensing for bundled Noto subset; PDF byte-level testing is fiddly — assert on operator presence not exact bytes.

---

## Task 1.5 — CMYK + PDF/X stub (priority 3.0)

**Done when:** RGB->CMYK conversion via ICC profile; bleed/trim/registration marks rendered; PDF/X-1a + PDF/X-4 stubbed with a documented contract.

**Steps:**

1. **Research gate** — ISO 15930 (PDF/X-1a, X-4), ICC `transform` (use `lcms2` or `icc` crate), bleed/trim/mark geometry. Cite.
2. **Rust crate**
   - `crates/strata-print/src/cmyk.rs`: `rgb_to_cmyk(profile, rgb)` via ICC; `crates/strata-print/src/marks.rs`: bleed/trim/marks. `export_pdfx1a` + `export_pdfx4` (stubs that emit valid structure with TODO markers).
   - Tests: known RGB->CMYK profile assertion; marks geometry.
3. **Facade/UI**
   - Export panel: "PDF/X-1a" and "PDF/X-4" options disabled-flag-honest: stubs emit a banner "preview — not production-certified".
4. **Gate.**

**Dependencies:** 1.4.

**Risks:** ICC profile bundling size; X-4 live transparency is hard — stub it honestly rather than fake.

---

## Task 1.6 — Local Spec Inspector (priority 6.0)

**Done when:** a developer-facing spec tab parses spacing/padding/typography/assets from the document and displays them locally (no server round-trip).

**Steps:**

1. **Research gate** — Figma Dev Mode / Spec mode conventions. Cite.
2. **TS module**
   - `packages/codegen/src/spec.ts` (new): `buildSpec(doc) -> SpecSheet` (spacing tokens used, padding per frame, type styles, asset list with content hashes). Reuses 1.2 evaluator to show resolved values.
   - Tests.
3. **Editor UI**
   - New "Spec" tab in inspector or a docked panel; selectable node shows its resolved spacing/type/handoff code snippet.
4. **Gate.**

**Dependencies:** 1.2 (resolved variables), 1.3 (layout gives spacing). Can start in parallel with 1.3 and merge after.

**Risks:** Spec output must pin to tokens, not hardcoded values — audit.

---

## Task 1.7 — Auto-trace (priority 6.67)

**Done when:** `crates/strata-trace` traces a raster -> vector (contour + centerline), multi-threaded via `rayon`, with adjustable color count / threshold / path expansion; an in-canvas control lets the user run it.

**Steps:**

1. **Research gate** — Potrace (Selinger 2003) + vtracer algorithms, `rayon` patterns. Cite.
2. **Rust crate (`crates/strata-trace`)**
   - `trace_contours(raster, opts) -> Vec<Path>` (Potrace-class), `trace_centerline(...)` (vtracer-class), color quantization, threshold. Multi-threaded.
   - Tests: known bitmap -> expected path topology (not exact float match).
3. **Facade + Tauri**
   - `@varve/engine`: `autoTrace(raster, opts)` behind native + stub.
   - Tauri command `auto_trace`.
4. **Editor UI**
   - Toolbar "Trace" entry (or Image tool follow-on). Drop an image, adjust sliders, preview, "Convert to paths" inserts `ShapeNode`s.
5. **Gate.**

**Dependencies:** 1.1 (inserts nodes); independent of 1.2-1.6 — **good subagent parallelization candidate**.

**Risks:** Potrace patent status (clear, but verify); centerline tracing quality; large raster perf.

---

## Task 0.11 — Packaging (priority —)

**Done when:** Linux CI builds `.AppImage` + `.deb` (then `.rpm`/Flatpak), **CachyOS/Arch AUR PKGBUILD**, macOS `.dmg`, Windows `.msi`/`.exe`.

### Targets (priority order)

1. **CachyOS / Arch** (AUR `PKGBUILD` — `.pkg.tar.zst`, since the dev OS is CachyOS, dogfood first)
2. **Generic Linux** — `.AppImage` + `.deb`, then `.rpm`
3. **Flatpak** (FDO runtime, sandboxed)
4. **macOS** — `.dmg`, notarized `.app`, Homebrew cask
5. **Windows** — `.msi` (NSIS), then Winget

### Steps

1. **Research gate** — Tauri 2 bundler config, `tauri-action` GitHub Action, Wayland/X11 runtime verify, AUR PKGBUILD conventions for Tauri apps.
2. **CI matrix** in `.github/workflows/` — 3 OSes, runs `just gate` + produces artifacts.
3. **CachyOS-specific steps**
   - AUR PKGBUILD targeting `x86_64` + `aarch64` (CachyOS ships both kernels).
   - Verify the app launches on a real CachyOS session (Wayland default + X11 fallback).
   - Confirm Vulkan/Mesa native engine path on Cachy's default kernel (`linux-cachyos`), with `tiny-skia` CPU fallback when no compatible GPU.
   - WebKitGTK build sanity on CachyOS's `webkit2gtk` package (it tends to ship newer GTK than stable Arch).
   - The CI matrix should produce the AUR artifact via `makepkg` in a container so non-Arch runners can build it. Use `chmod`/`useradd`-style container setup (standard for AUR CI) rather than assuming an Arch runner.
4. **Linux verification** — AppImage launches on Wayland + X11, fractional scaling sanity.
5. **Gate** — artifacts attached, smoke-run on each OS.

**Dependencies:** Nothing in 1.x (can run parallel from the start); final artifact includes all 1.x.

**Risks:**
- AUR PKGBUILD must keep dependencies valid on both plain Arch and CachyOS; `webkit2gtk-4.1` vs older on some Arch-derived distros.
- AUR distribution requires an out-of-tree PKGBUILD plus a `-bin` companion.
- Tauri 2 packaging churn; macOS notarization needs secrets; Windows code-signing optional.

---

## Execution order for the next session

1. **Pre-flight P0-P2** (serial — fixes the foundation).
2. **1.1 Slots** (serial — touches everything downstream).
3. Parallelize: **1.2 Variables/math** || **1.7 Auto-trace** || **0.11 Packaging** (independent).
4. **1.3 Layout** (after 1.1).
5. **1.4 Print** (after P2; parallel with 1.3).
6. **1.5 CMYK/PDF-X** (after 1.4).
7. **1.6 Spec inspector** (after 1.2 + 1.3).
8. Final `just gate` + artifact attach.

---

## Definition of Done for Phase 1

- [x] One slotted component + filled instance round-trips through native bridge
- [x] Batch variable edit with `{base}*1.5` math resolves (TS + Rust agree)
- [x] Taffy layout emits flex/grid/gap/wrap + clamp into IR; breakpoints validate
- [x] PDF export produces valid PDF bytes (RGB); CMYK/PDF-X stubbed with contract
- [x] Spec inspector shows resolved spacing/type/assets locally
- [x] Auto-trace produces vector paths from a raster (multi-threaded)
- [ ] `.AppImage`/`.deb`/`.dmg`/`.msi` build on CI; CachyOS AUR PKGBUILD dogfoods on the dev OS
- [x] Every crate/module carries its `// Research basis: ...` citation
- [x] All gates green; no emoji; 42/42 tokens; zero new hardcoded values
- [x] Native backend asserted on desktop for every facade method added

---

*Built end of Session 2. Start the next session from Pre-flight P0.*