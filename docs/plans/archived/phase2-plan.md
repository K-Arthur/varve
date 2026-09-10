# Phase 2 Plan — Strata

> Compiled end of Session 2. Phase 2 executes *after* Phase 1 lands (slots, variables/math, layout, print, spec, trace, packaging). Phase 2 = offline-first depth + strategic bets.
>
> Scope decided with the user: **Rust + TS in parallel** (each task ships its Rust crate impl + TS facade together, native backend asserted on desktop).
>
> Source: Kickoff prompt section 8 (Phase 2) + Frontend Rework sections 12, 13, 16, 17, 19. Priority range 4.0-5.33.

---

## Methodology

Same as Phase 1: BMAD Lite + TDD-first + Cascade Review gate after each task + Research Gate (`// Research basis: ...`) cited inline. Independent tasks parallelised via subagents (see AGENTS.md §Multi-agent coordination for worktree protocol, hub-file handling, and merge coordination when subagents touch intersecting code).

### Per-task gate (non-negotiable)

```bash
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
pnpm exec biome check --write . && pnpm lint && pnpm typecheck && pnpm test
pnpm audit:emoji && pnpm audit:tokens
```

Plus: **assert native backend on desktop** for any facade method added.

---

## Phase 1 prerequisites Phase 2 consumes

- `crates/strata-sync` SQLite `save_document`/`load_document` (Phase 1 Pre-flight P2).
- `crates/strata-layout` Taffy layout IR (1.3) — the presentation runtime replays layout.
- `crates/strata-print` RGB PDF outlining (1.4) — CMYK pipeline (2.5) extends it.
- Scene model with slots + nested children (1.1) — sync must reconcile nested trees.
- Variable store with math + modes (1.2) — asset caching keys on resolved token values.

---

## Task 2.1 — Local-First Yjs/SQLite CRDT Sync (priority 5.0, demand 5/5)

**Done when:** the document lives in local SQLite; Yjs CRDT drives real-time multiplayer when connected; edits queue offline and reconcile at page granularity on reconnect; conflict resolution is automatic and visible; no file locks; no 2 GB ceiling (desktop is native).

**Steps (Rust + TS together):**

1. **Research gate** — Yjs docs, Automerge docs, "Local-First Software" essay (Kleppmann et al. 2019), CRDT perf under large docs, Yjs persistence patterns, awareness protocol. Cite at top of `crates/strata-sync` and `packages/collab`.
2. **Rust crate (`crates/strata-sync`)**
   - Depend on `rusqlite` + `yrs` (the Rust Yjs port) or a Yjs-compatible CRDT. Persist document snapshot + CRDT update log to SQLite. Implement `load_doc`, `apply_update`, `snapshot`, `offline_queue` (ordered pending updates), `reconcile_on_reconnect` (page-granular merge).
   - Tests (cargo): offline edit -> reconnect -> remote edits merge without data loss; concurrent edit on same property -> CRDT deterministic merge; large document (10k nodes) update latency budget.
3. **TS package (`packages/collab`)**
   - `@varve/collab`: `CollabProvider` wrapping an awareness-aware Yjs doc, sync transport (WebSocket relay when online, offline queue when not). Serialize scene <-> Yjs doc. Tie `collab` <-> `scene` Document via a双向 sync adapter.
   - Tests (Vitest): offline queue replays on reconnect; awareness presence updates; two simulated clients converge.
4. **Tauri IPC**
   - Commands: `sync_load`, `sync_apply_update`, `sync_snapshot`, `sync_offline_flush`. Assert native backend chosen.
5. **Editor UI**
   - Presence avatars in topbar (stack with "+N more"), live cursors with user names, `aria-live` join/leave announcements. Conflict indicator (2s flash, last-write-wins for most props, visible for non-resolvable).
   - Offline banner: `navigator.onLine` + `offline` event -> "Working offline — changes will sync when you reconnect" (non-intrusive, no functionality blocked).
   - Sync-conflict resolver UI: "Use mine" / "Use theirs" / "View diff".
   - Tests (Vitest + axe-core).
6. **Gate.**

**Dependencies:** Phase 1 Pre-flight P2 (SQLite stub), 1.1 (nested-tree sync).

**Risks:**
- `yrs` crate maturity vs Yjs JS — if mismatched, embed Yjs JS via a thin WASM shim and keep Rust for SQLite persistence only. Decide in research gate.
- Reconnect reconcile must be page-granular (not whole-doc) or large docs thrash.
- Awareness + cursor traffic must be throttled.

---

## Task 2.2 — Local Asset & Font Caching (priority 4.0)

**Done when:** imported system fonts, variables, and shared asset libraries persist to local disk (content-addressed, LRU eviction) so design systems do not break offline; a local font-matching parser with weighted resolution resolves offline.

**Steps:**

1. **Research gate** — content-addressable storage patterns (BLAKE3 for hashing, LRU eviction), fontconfig (Linux) / Core Text (macOS) / DirectWrite (Windows) abstraction, woff2/otf parsing, font matching weighted resolution (CSS Fonts 4 `@font-face` matching). Cite.
2. **Rust crate (`crates/strata-sync` extends, or new `crates/strata-assets`)**
   - `AssetCache` over SQLite + on-disk blob store: `store(blob) -> hash`, `load(hash) -> blob`, `evict_lru(bytes_budget)`. `FontRegistry` abstracting per-OS discovery via a `platform` trait (fontconfig/CoreText/DirectWrite live only there per AGENTS.md §2.3). Local font-matching parser with weighted resolution.
   - Tests (cargo): store -> load -> identical; LRU eviction respects budget; font matching picks best family/style/weight; platform trait toggled.
3. **TS facade**
   - `@varve/engine` (or new `@varve/assets`): `cacheAsset(blob)`, `loadAsset(hash)`, `listFonts()`, `matchFont(spec)` behind native + stub.
   - Tauri commands.
4. **Editor UI**
   - Asset panel: list (virtualised, IntersectionObserver thumbnails), import, usage counts, "Used in N frames". Empty state with SVG illustration + CTA. Offline indicator when assets local.
   - Tests.
5. **Gate.**

**Dependencies:** 2.1 (storage layer shares the SQLite store). Independent of 1.x otherwise.

**Risks:** Font licensing — bundle Noto subset; platform trait must keep `#[cfg]` out of feature code (AGENTS.md §2.3); LRU must never evict in-use fonts.

---

## Task 2.3 — Offline Presentation & Prototype Runtime (priority 5.33)

**Done when:** a self-contained local runner plays interactive prototypes — triggers, state transitions, animations — with zero connectivity, for trade-show floors and client pitches.

**Steps:**

1. **Research gate** — Figma prototype interactions, state machines, IOTA-style state charts, `requestAnimationFrame` + Web Animations API, offline PWA-style packaging. Cite.
2. **Rust crate (`crates/strata-layout` extends)**
   - Resolve layout per breakpoint offline (already native via 1.3). Add `prototype_runtime` that advances frame states given inputs.
   - Tests (cargo): state transition given trigger; animation timeline step.
3. **TS package (`packages/editor` or new `packages/present`)**
   - `PrototypeRuntime`: event -> trigger -> state transition -> layout replay -> canvas paint. Runs entirely on local engine (native on desktop, wasm/web on web but offline-capable).
   - Tests (Vitest): trigger fires transition; no network calls; reduced-motion variant collapses animation durations.
4. **Editor UI**
   - "Present" toolbar entry (icon, no emoji) -> enters fullscreen presentation mode. Prototype inspector: triggers (tap/click/hover/key), destination frame, transition (instant/slide/fade/push), duration. Escape exits. Reduced-motion honoured.
   - Tests.
5. **Gate.**

**Dependencies:** 1.1 (frames), 1.3 (layout replay), 2.2 (assets local so the deck runs offline).

**Risks:** Animation must use `transform`/`opacity` only (Frontend Rework §6.1); reduced-motion zero-duration via tokens; fullscreen API cross-OS (Wayland quirks).

---

## Task 2.4 — Hybrid Vector-Raster Canvas (priority 4.0)

**Done when:** a drawing layer where pressure-sensitive raster brushes coexist with editable vector paths, so line art scales without blur; targets Procreate's vector deficit + Illustrator's raster limits.

**Steps:**

1. **Research gate** — `wgpu` raster layers + `lyon` vector layers compositing, pressure via `PointerEvent.pressure`, Procreate/OpenCanvas brush models, tile-based raster for memory. Cite.
2. **Rust crate (`crates/strata-engine` extends)**
   - Hybrid render: vector pass (existing IR) + raster pass (tile-composited brush strokes stored as content-addressed blobs from 2.2). `paint_stroke(brush, pressure, points) -> RasterTile`. Composite at frame time.
   - Tests (cargo): stroke rasterises to expected tile coverage; composite order vector-under-raster; no blur on vector at high zoom.
3. **TS facade**
   - `@varve/engine`: `paintStroke`, `compositeHybrid(frame)`.
   - Tauri command.
4. **Editor UI**
   - Brush tool (toolbar entry, grouped with pen/pencil). Pressure sensitivity via Pointer Events. Brush settings (size, opacity, flow, hardness). Drawing layer toggles vector/raster visibility.
   - Tests.
5. **Gate.**

**Dependencies:** 1.1 (nodes), 2.2 (raster blobs stored as assets).

**Risks:** Brush memory on large canvas — tile-based mandatory; pressure calibration curve; vector/raster z-order contract must be explicit; sync of raster strokes via CRDT (2.1) is large — **scope decision needed** (see Open Questions).

---

## Task 2.5 — CMYK + ICC Print Pipeline (priority 3.0, completes print story)

**Done when:** ICC profile-based RGB->CMYK conversion; bleed/trim/registration marks; PDF/X-1a and PDF/X-4 output.

**This is the Phase 1 Task 1.5 delivered earlier as a stub — Phase 2 promotes it to production.**

**Steps:**

1. **Research gate** — ISO 15930 (PDF/X-1a, X-4), ICC `transform` via `lcms2`/`icc` crate, bleed/trim/registration marks, live transparency (X-4) constraints. Cite.
2. **Rust crate (`crates/strata-print`)**
   - Promote stubs: real `rgb_to_cmyk(profile, rgb)` via ICC; `marks.rs` geometry; `export_pdfx1a` + `export_pdfx4` with real operators. Remove the "preview — not production-certified" banner once tests pass the production contract.
   - Tests (cargo): known RGB->CMYK via standard profile; marks placement; X-1a forbids live transparency (must flatten); X-4 allows transparency (must preserve).
3. **Facade/UI**
   - Export panel: enable the PDF/X outputs; profile selector (bundled ISO Coated v2 + SWOP); bleed input; "Include registration marks" toggle.
4. **Gate.**

**Dependencies:** 1.4, 1.5 stub.

**Risks:** ICC profile licensing (bundle FOSS profiles); X-4 transparency flattening fallback; black-point compensation.

---

## Phase 2 frontend depth (parallel deployment-group items)

These are listed in the Frontend Rework prompt as deferred P1/P2/P3 items that pair naturally with Phase 2 because they expose Phase 2 functionality. Schedule them with their dependent Phase 2 task.

| Item | Depends on | What |
|---|---|---|
| Settings panel (FR §17) | 2.1, 2.2 | Appearance, shortcuts, collab, AI, account sections; persist to localStorage + profile |
| AI assistant panel (FR §13) | 2.1 | Chat `role="log"`, suggestion preview/apply, loading + error states, prompt-injection warning surface |
| Plugin sandbox UI (FR §16) | 2.2 | Plugin list, enable/disable, marketplace cards, permission request dialog, error boundary + reload |
| Collaboration UI polish (FR §12) | 2.1 | Presence avatars, cursors with idle fade, conflict indicator, `aria-live` join/leave |
| Error handling UI (FR §19) | 2.1 | Offline banner, sync-conflict resolver, AI-unavailable graceful degradation, plugin crash boundary, browser compat warning |
| Storybook stories (FR §21) | all | Per component: variants, states, dark + HC themes, keyboard demo, a11y annotations |
| Playwright E2E (FR §20) | all | Keyboard-only full workflow, axe-core zero violations, Lighthouse a11y >= 95, 1000-layer scroll 60fps |

---

## Execution order (after Phase 1 done)

1. **2.1 Sync** (serial — foundation for 2.2 and presence UI).
2. Parallelise: **2.2 Asset/font cache** || **2.3 Presentation runtime** (both depend on 2.1's storage / 1.3 layout).
3. **2.4 Hybrid canvas** (after 2.2 for raster blob storage).
4. **2.5 CMYK/PDF-X** (promotes 1.5 stub; independent of 2.1-2.4).
5. Parallelise the frontend-depth group: **Settings** (+ Collab/AI panels) depend on 2.1/2.2; **Plugin UI** on 2.2; **Storybook/E2E** last.
6. Final `just gate` + 3-OS artifact build (extends Phase 1 0.11).

---

## Open questions to resolve at the Phase 2 kickoff

1. **CRDT crate choice** — `yrs` (Rust) vs Yjs (JS over WASM shim). Research gate decides; affects whether `crates/strata-sync` owns the CRDT or just persistence.
2. **Raster-stroke sync scope** — syncing brush strokes over CRDT (2.1) is large. Decide: strokes local-only until reconnect (simpler) vs live stroke streaming (harder). Recommend: local-first + batch-sync on reconnect for Phase 2; live streaming deferred to Phase 3.
3. **Presentation runtime transport** — does the local runner export a self-contained `.strata.present` bundle (assets embedded) for trade-show offline? Recommend yes (reuses 2.2 blob store).

---

## Definition of Done for Phase 2

- [ ] Two simulated clients converge after offline edits + reconnect (CRDT deterministic)
- [ ] Asset/font cache survives offline; LRU eviction respects in-use; font matching picks best family/style/weight
- [ ] Prototype runtime plays triggers + transitions offline; reduced-motion honoured
- [ ] Hybrid canvas paints a pressure-sensitive raster stroke over editable vectors; vector stays crisp at high zoom
- [ ] CMYK PDF/X-1a + X-4 export with ICC + bleed/trim/marks; X-1a flattens transparency, X-4 preserves it
- [ ] Presence UI: avatars, cursors with idle fade, `aria-live` join/leave, conflict indicator
- [ ] Settings/AI/Plugin panels present; plugin crash boundary works; AI panel surfaces injection warnings
- [ ] Playwright E2E: keyboard-only full workflow passes; axe-core zero violations; Lighthouse a11y >= 95; 1000-layer scroll 60fps
- [ ] Storybook stories present for every component with a11y annotations
- [ ] Every crate/module carries its `// Research basis: ...` citation
- [ ] All gates green; no emoji; 42/42 tokens; zero new hardcoded values
- [ ] Native backend asserted on desktop; 3-OS artifacts build

---

*Built end of Session 2. Execute after Phase 1.*