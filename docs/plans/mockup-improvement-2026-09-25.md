# Mockup Editing and Creation — Improvement Plan (2026-09-25)

Status: active. Scope: improve the existing mockup system in place — no new
workspace, mode, route, document model, or parallel renderer. Canonical
architecture: `docs/architecture/mockup-system.md`; ADR-0015; prior audits
`docs/audits/mockup-capability-audit-2026-08-05.md` (pre-implementation
baseline), `docs/audits/mockup-vertical-slice-report-2026-08-05.md`,
`docs/audits/mockup-editing-improvement-2026-09-13.md`.

Research: `docs/research/mockup-research-2026-09-25.md` (accessed
2026-09-25; source table, 22 catalogued competitor/user failure modes
C1–C22, algorithm and standards decisions).

## Coordination (2026-09-25 working tree)

Other agents own, in the same `master` worktree: staged compositor/tokens
edits (`packages/compositor/*`, `packages/tokens/*`), unstaged
retouch/token-sync/variable-binding edits (`packages/scene/src/bindings.ts`,
`tokens/`, `editor/src/tools/*Heal*`, `TokenSync/*`), and the canvas-fluidity
task (ownership record `docs/agents/canvas-fluidity-2026-09-25-ownership.md`,
which owns `CanvasArea.tsx`, `canvas/renderPipeline.ts`, `hitTest/`,
`StatusBar.tsx`, and related files). This task owns:

- `packages/editor/src/export/compositor.ts` (+ its test)
- `packages/editor/src/components/SpecPanel/export.ts` (+ its test)
- `packages/editor/src/render/mockup/mockupExport.ts`
- `packages/editor/src/render/mockup/mockupIr.ts` and mockup tests
- `packages/scene/src/mockup/*` and mockup tests
- `packages/editor/src/components/Mockups/*`,
  `components/Inspector/sections/MockupsSection*`,
  `components/MockupSurfaceOverlay.tsx`
- `packages/editor/src/mockup/*`
- mockup E2E specs, `docs/architecture/mockup-system.md`, the mockup audit
  and research docs, `apps/website/src/pages/features/mockups.astro`

No file above is claimed by another ownership record. `CanvasArea.tsx` is
explicitly NOT edited by this task (occupied); anything requiring a
`CanvasArea` drop-path change is recorded as an integration handoff instead.

## Defects reproduced / findings (pre-fix)

1. **SVG and vector-PDF export silently drop mockups.**
   `assessNodeCapability` (`export/compositor.ts`) has no mockup branch, and
   a mockup frame is a childless frame with a solid fill that assesses as
   natively supported. `findFlattenBoundaries` therefore never creates a
   raster boundary, `renderBoundaryToSurface` (which *does* decorate via
   `decorateMockupSubtree`) never runs, and the exported SVG/PDF contains
   only the frame background. `subtreeNeedsDecoration` in
   `render/mockup/mockupExport.ts` is exactly the missing helper and has no
   production caller. `exportNodeAsPdfX` never decorates at all.
2. **Childless unsupported containers never get a boundary.**
   `walkContainer` returns `false` for `children.length === 0`, and the root
   path only pushes a boundary when `allUnsupported` is true — so an
   unsupported childless frame is silently skipped even once (1) is fixed.
   Container-level raster reasons must be pushed directly, like
   `hasUnsupportedEffects` already is.
3. No menubar entry or keyboard shortcut exists for any mockup command
   (context menu + command palette only).
4. Dead exports with no production caller: `applyMockupToSelection`,
   `makeInstanceTemplateUnique`, `isMockupSelection`,
   `subtreeNeedsDecoration`.
5. Drop-to-replace (drop an image on a mockup surface to replace that
   surface's source) does not exist; file drops land as new nodes via
   `CanvasArea.handleDrop`. `CanvasArea.tsx` is owned by the canvas-fluidity
   task — recorded as an integration handoff (see Slice F).

## Slices (dependency order; each leaves a working workflow)

### Slice A — Export parity: SVG / PDF / PDF/X (correctness core)

- `assessNodeCapability`: a frame carrying a live `mockup` payload is not
  natively supported for `svg`/`pdf` targets; it needs a raster boundary.
- `findFlattenBoundaries`: treat "container itself requires mockup
  decoration" as a container-level raster reason (root and nested paths),
  pushed directly instead of via the children walk — fixes (2).
- `exportNodeAsPdfX`: detect mockup content and block with an explicit,
  actionable error (no silent wrong output) unless a verified raster
  embedding path exists in `varve-print`.
- Wire `subtreeNeedsDecoration` into the PDF/X (and, if applicable, the
  vector PDF decision) so the helper is production code again.

Acceptance:

- Unit: `findFlattenBoundaries` yields a boundary for a mockup frame as
  root, as a nested child, and inside a childless container; no boundary
  for plain frames; `assessNodeCapability` returns `false` for mockup
  frames on `svg`/`pdf`, `true` on `raster`.
- Unit: `subtreeRequiresRasterPdfFallback` is true for a mockup subtree.
- E2E: real SVG export of a mockup frame downloads an SVG whose embedded
  raster contains composed mockup pixels (plate + artwork), not just a
  background rect.
- PDF/X: explicit error message surfaced (unit-tested), never a
  mockup-free PDF.

### Slice B — Complaint-driven appearance controls (C18 white-ink, section 9)

Per-surface artwork presentation: `blendMode` (normal default) and
`opacity` overrides on the baked artwork item — never `multiply` by
default, artwork identity preserved, reversible, part of override cache
identity, exposed in the Inspector appearance group, applied identically
on canvas and in every export host.

Acceptance: white artwork on a dark surface stays visible at the normal
default; switching to multiply reproduces the documented white-ink
disappearance (and is user-reversible); override round-trips through
save/reopen; cache invalidates on change; SVG/PDF exports inherit the
same composition through the Slice A boundary.

### Slice C — Discoverability and target clarity (section 10)

- Menubar entries for the two registered commands ("Apply Mockup…",
  "Create Mockup Template from Selection…") if the menu ownership surface
  is clean; verify command-palette entries still register after the
  ActionRegistry ordering rules.
- Remove or wire the dead exports found in (4).
- Verify Inspector surface-target distinction (instance vs surface vs
  mask), link/snapshot/missing indicators, escape/commit behaviour; fix
  what reproduction shows is broken.

### Slice D — Regression hardening for competitor failure modes

- C1: replacing source content leaves quad/rect/fit/mask/appearance
  byte-identical (explicit test).
- C2: replacement never changes the fit policy; default fit is `contain`.
- C4: no path resamples a resampled buffer (verify export samples the
  original source at output scale — test exists? extend).
- C7/C6: missing-source stale-preview labelling and export warning
  already exist — cover with a focused test if not already asserted.

### Slice E — Website, docs, changelog

- `apps/website/src/pages/features/mockups.astro`: align claims with
  verified behaviour (SVG/PDF parity after Slice A; bounded cylinder;
  explicit unsupported list: mesh, displacement, PSD smart-object
  re-render, model-assisted proposals).
- `docs/architecture/mockup-system.md`: host-parity section (add PDF-X
  boundary decision), deferred table, appearance override fields.
- ADR-0015 note, audit record, user-guidance docs, changelog entry.

### Slice F — Integration handoffs (not owned here)

- Drop-to-replace on a mockup surface: requires `CanvasArea.handleDrop`
  to resolve a mockup surface under the drop point and route to
  `setMockupBinding` instead of `importDroppedFiles`. Handoff recorded
  for the canvas-fluidity owner; the scene/editor action side
  (`replaceSurfaceSourceWithNode`) will be prepared here if budget
  allows.

## Validation policy

`pnpm verify:plan` → `pnpm verify:affected` for each slice; focused unit +
mockup E2E (heavy-lease wrapped, `--workers=1`) with screenshot evidence in
`docs/screenshots/mockup-review-2026-09-25/`; full gate only if the planner
escalates (schema change in `packages/scene/src/mockup/types.ts` will likely
escalate — run it with a stated reason at that slice boundary).
