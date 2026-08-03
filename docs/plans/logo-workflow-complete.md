# Logo-Creation Workflow — Architecture Map and Progress Tracker

Session start: 2026-08-03. Goal: complete Strata's logo-creation workflow —
vectorization UI, per-glyph typography with kerning-off, ICO/ICNS/PDF export,
and a first-class visual Logo panel — delivered as one connected workflow.

## 1. Repository audit (2026-08-03)

### Already implemented and wired (verified file:line)

| Area | Status | Location |
|---|---|---|
| Logo project model + ops (concepts, variants, palette, brief, clear-space) | Built | `packages/scene/src/logo/logoProject.ts`, types at `packages/scene/src/types.ts:1355-1446` |
| Migration 2.11 → 2.12 for logoProject | Built | `packages/scene/src/version.ts:693-739` |
| Editor glue (create project/concept/duplicate/variant/brief) | Built | `packages/editor/src/context/useLogoProject.ts` |
| Logo workspace mode config | Built (tool list mirrors design — see §4) | `packages/editor/src/workspace/workspaceTypes.ts:768-860` |
| Logo presets (1024/horizontal/vertical/badge/mark/favicon) | Built | `packages/shared/src/presetRegistry.ts:701-778` |
| Small-size preview dialog + engine | Built | `packages/editor/src/components/LogoPreview/LogoPreviewDialog.tsx`, `logo/logoPreview.ts` |
| Geometry ops (expand/offset/round/simplify/mirror/radial) | Built | `packages/editor/src/geometry/vectorOps.ts`, `context/useLogoGeometry.ts` |
| Logo audit rules (thin strokes, excessive points, text-left-editable, missing monochrome) | Built | `packages/scene/src/auditAdapter.ts:358-520` |
| Deterministic ZIP package export (PNG 1x/2x + SVG + palette + README + manifest) | Built | `packages/editor/src/logo/logoPackageExport.ts` |
| Raster→vector tracer: Rust (strata-trace, 2865 lines) + WASM + TS engine (`rasterTrace.ts`) + provider chain (worker→direct→wasm→native) | Built | `crates/strata-trace/`, `packages/engine/src/rasterTrace.ts`, `upscaleProviders/traceDispatch.ts` |
| Live-trace model (nondestructive per-node params, flatten/clear, error state) | Built | `packages/scene/src/liveTrace.ts`, `types.ts:1154-1222` |
| Trace orchestration in editor (`traceSelectedImage`) + QuickBar/Inspector entry points | Built | `context.tsx:7618-7763`, `SelectionQuickBar`, `ImageEnhancementSection.tsx:155-209` |
| Background removal + SAM2 segmentation (adjacent, reusable) | Built | `context/useBackgroundRemoval.ts`, `backgroundRemoval/SubjectIsolationService.ts` |
| Text-to-outline document op (per-glyph ShapeNodes + holes + metadata) | Built | `packages/scene/src/textToOutlines/convertTextToPath.ts`, `context/convertTextOutline.ts` |
| Rust shaping (rustybuzz glyph IDs + GPOS) exposed via Tauri `shape_text_command` | Built, **no frontend caller** | `crates/strata-print/src/shaper.rs`, `apps/desktop/src-tauri/src/lib.rs:1435-1446` |
| Canvas text rendering (tracking/letter-spacing per-char path) | Built | `packages/engine/src/replay.ts:2165-2412` |
| Export infra: canonical model, presets, naming, preflight, service, dialog, report | Built | `packages/scene/src/export/`, `packages/editor/src/exportService.ts`, `components/Export/` |
| PDF: vector (strata-print) + raster fallback, PDF/X-1a/X-4, fonts, ICC | Built | `packages/editor/src/components/SpecPanel/export.ts:538-716`, `crates/strata-print/` |
| Settings store (localStorage) + workspace panel config + `useWorkspaceMode` switching | Built | `packages/editor/src/settings.ts`, `workspace/useWorkspaceMode.ts` |
| Undo/transactions (begin/commit/abort, 50 entries) | Built | `context.tsx:2210-2537` |

### Implemented but inaccessible / command-only

- `createIconVariant`, `createSmallVariant` — handlers exist (`createActionHandlers.ts:301-302`), no menu item, no shortcut, no palette entry.
- Logo commands are File-menu + shortcuts only; **no visual panel** (`logo-system.md:99` deferred).
- `icon.ico`/`.icns` have **no encoder** (`scene/export/capabilities.ts:511-516` declares ico `supported: false`; ICNS zero code).
- SVG export ignores `VectorExportSettings.text: 'outline'` (`exportService.ts:217-223`).
- Per-glyph positioning / kerning modes: `CharacterFormat.kerning: 'auto'|'manual'|'none'` exists (`types.ts:780`) with **zero readers/writers**; no per-cluster adjustment storage; shaping seam (`shaping.ts`, `shapingCache.ts`) is dead code in the product.

### Known traps (from previous sessions, verified)

- `context.tsx` / `Shell.tsx` / `Menubar.tsx` are hub files at import ceilings — no new imports without weight parity (audit-health enforced).
- `ActionRegistry` overwrite order: real handlers first, no-op stubs second (`Shell.tsx:207-229`).
- Sub-contexts must use the `onReady` callback pattern — but the Logo panel will consume the **top-level editor value**, not a sub-context.
- Undo pollution: every `updateDoc` outside a transaction pushes an undo entry — preview slider moves must NOT call `updateDoc`.
- Unrelated uncommitted work in `packages/scene` (colorManagement, gradientPresets, swatches, colorConversion, `colorValidation.ts`) — **must not be committed**.

## 2. Target architecture

```text
┌────────────────────────────  Logo panel (packages/editor/src/components/LogoPanel/)  ────────────────────────────┐
│  Project section ── Create section ── Source Prep ── Vectorize (preview) ── Typography ── Variants ── Validation │
│  ── Export Package                                                                    (all drive existing         │
└──────────────┬──────────────────────────────────────────────────────────────────────────────── commands/services) ┘
               │ useEditor() facade (LogoPanelHost reads editor value once, passes props down)
               ▼
┌──────────────────────────────────────────────  Shared services  ──────────────────────────────────────────────┐
│ vectorization/  session model + settings validation + presets + source prep (pure ImageData ops) + preview     │
│                 renderer (panel canvas, bounded resolution) + stale/cancel guard (request id + generation)      │
│ glyph/          kerning modes ('auto'|'none') + per-cluster GlyphAdjustment model + pair adjustments +         │
│                 grapheme utilities + bounds envelope                                                            │
│ export/         ico.ts (ICONDIR+PNG entries), icns.ts (ICNS container), package builder (per-variant formats,  │
│                 naming tokens, deterministic ZIP, structured report)                                            │
└──────────────┬──────────────────────────────────────────────┬─────────────────────────────────────────────────┘
               ▼                                               ▼
   Scene model (document 2.13):                     Engine (render/export parity):
   TextNode.kerningMode, glyphAdjustments,          replay.ts cluster renderer (kerning-off, glyph
   pairAdjustments; LogoProject unchanged;          transforms), sceneToEngine.ts IR plumbing,
   migration 2.12 → 2.13                            convertTextToPath.ts applying adjustments
```

### Data-flow: vectorization session

```text
select raster node → LogoPanel reads source asset (imageCache)
  → SourcePrep (panel-local canvas, preview res ≤ 1024px, never writes the source)
  → settings (mode/threshold/minArea/simplify/maxPaths/… from VectorizationSettings)
  → trace dispatch (existing engine chain: worker → direct → wasm → native)
  → panel preview canvas: original | prepared | traced overlay, diagnostics
  → Apply → editor.traceSelectedImage(settings) → insertTraceGroup (one undo entry)
  → source preserved; liveTrace used only when user picks "live trace" mode
```

### Data-flow: glyph editing

```text
TextNode (document)                    Renderer (replay.ts)
├─ kerningMode: 'auto' | 'none'  ───►  'none' → per-cluster fillText (no cross-cluster kerning)
├─ glyphAdjustments: {i: {dx,dy,advance,rotation,scaleX,scaleY}} ──► cluster transforms
├─ pairAdjustments: {i: px}      ───► advance of cluster i+1 += px
├─ tracking / letterSpacing      ───► unchanged (applies in both paths)
└─ textToOutlines                ───► per-glyph ShapeNodes positioned by adjustment map
```

Cluster identity: **grapheme-cluster index** (Intl.Segmenter, UAX #29) — stable across
font/size/kerning/ligature changes. Text content changes invalidate the map
(deterministic policy, surfaced to the user; adjustments at indices that still
exist after an edit are retained — documented limitation for prefix-only edits).

### State ownership

| State | Owner |
|---|---|
| Logo project, concepts, variants, palette | Document (`Document.logoProject`) |
| Vectorization settings/presets, last-used | Editor settings (`settings.ts` — `logo` store), NOT document |
| Preview bitmaps, request ids, worker state | Panel-session state (React refs), disposed on apply/cancel/selection change/unmount |
| Kerning mode, glyph adjustments | Document (TextNode, migrated 2.13) |
| Panel visibility | EditorState + settings (`PanelSettingsStore`) + workspace config (`panels.logo`) |

## 3. Milestones and status

| # | Milestone | Commit | Status |
|---|---|---|---|
| 1 | Repository audit + architecture plan | `affcd3ae` | done |
| 2 | Logo workspace tool curation (specific tools per workspace pattern) | `39f577c4` | done |
| 3 | Logo panel shell + workspace/command/persistence integration | `9dc4826e` | done |
| 4 | Vectorization session model, source prep, presets, preview, apply, stale/cancel safety | `4aa8e393` + `3629c21d` | done |
| 5 | Glyph adjustment + kerning-mode data model, migration, replay integration | — | pending |
| 6 | Per-glyph editing UI (panel + inspector) and kerning-off behavior | `8600c0e8` | done |
| 7 | Text-to-outline parity (adjustments applied) | — | pending |
| 8 | ICO encoder + validation | `5618c1c5` | done |
| 9 | ICNS encoder + validation | `5618c1c5` | done |
| 10 | PDF package integration | `711314ed` | done |
| 11 | Package-export frontend (variants/formats/naming/preview/report) | `711314ed` | done |
| 12 | Unit/integration/Playwright tests + fixtures | `ee3fe699`, `b81b9976`, `a2a875be` | done* |

* Playwright suite runs green for panel visibility, workspace scoping, and the View menu toggle; full-suite green is blocked by the concurrent dev-server churn (mid-test app reloads), documented in §5.
| 13 | Documentation (logo-system.md update) + final verification | next | in progress |

## 4. Logo workspace tool curation decision

Current logo toolbar (`workspaceTypes.ts:783-812`) mirrors the design workspace
(18 tools). Following the established pattern of task-focused modes (compare
image mode: 21 retouch-specific tools; motion mode: 14 animation tools), the
logo workspace gets a logo-specific set:

| Group | Tools |
|---|---|
| Selection/navigation | select, lasso, hand, zoom |
| Vector refinement | pen, pencil, nodeEdit |
| Wordmark | text |
| Structure | frame |
| Geometric marks | rect, ellipse, line, arrow |
| Color/measure | scale, eyedropper |

Removed: polygon, star, inspect (available in design/print). Boolean flyout
retained (logo construction). Rationale: logo work is mark drawing (vector),
wordmark typography, and artboard management — not UI inspection or free
polygon/star construction.

## 5. Honest limitations (updated per milestone)

- Optical kerning is not implemented anywhere — **not offered**; only `auto` (font kerning) and `none`.
- Browser-path kerning-off uses per-cluster drawing (each cluster its own fillText) — kerning is disabled between clusters; intra-cluster GPOS (rare) may remain.
- ICNS output is the modern PNG-based container (macOS 10.7+); legacy 24-bit chunks are not produced.
- PDF inside logo packages: vector PDF on desktop (strata-print), raster PDF fallback in browser (existing behavior) — disclosed in the export report.
- Glyph adjustments keyed by grapheme index: text edits invalidate deterministically (see §2), no automatic remap of adjusted positions across edits.
