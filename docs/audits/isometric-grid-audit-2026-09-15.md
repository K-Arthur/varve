# Isometric grid & plane-aware construction — research + audit

**Date:** 2026-09-15
**Authors:** maintainer (isometric workstream)
**Scope:** `packages/scene` grid model, `packages/editor` overlay/snapping/tools/Inspector,
persistence/migrations, export behavior, website documentation.
**Status:** Milestone 1 complete (research, contracts, capability matrix). Implementation
proceeds in later milestones; this document is updated as evidence lands.

## 1. Method

Repository instructions (`AGENTS.md`) and concurrent work were checked first: grid
sources (`packages/scene/src/gridTypes.ts`, `packages/editor/src/canvas/gridRenderer.ts`,
`gridAdapter.ts`, `DocumentGridOverlay.tsx`, `tools/snapping.ts`,
`Inspector/panels/DocumentPanel.tsx`, `context/usePersistentHistory.ts`,
`components/CanvasOverlays.tsx`) are unmodified in the shared working tree, so this
workstream owns them. No other agent claimed them.

External research below was completed **before** implementation. Sources are cited with
access date and applicable version, plus what Varve decided because of each finding.
Findings are separated into externally verified facts, observed Varve behaviour,
hypotheses, and product decisions.

## 2. Observed Varve behaviour (baseline reproduction)

Reproduced by reading the current sources; every item is marked for a regression test.

| # | Observation | Evidence | Severity |
|---|-------------|----------|----------|
| O1 | The isometric overlay draws each axis family with the **same perpendicular line spacing** (`step` from `grid.spacing`), across all three families, regardless of the angle between families. The intersections of those families do not form the lattice described by any basis in which one construction step equals `spacing`. | `DocumentGridOverlay.tsx:78-108` | High — visible grid and any derived snapping disagree by construction |
| O2 | The overlay's angle convention is implicit: `angle` is treated as a **line direction** (`ux,uy = cos,sin`), and lines are offset along its normal. Nothing in `gridTypes.ts` states the contract. | `DocumentGridOverlay.tsx:88-105`; `packages/scene/src/gridTypes.ts:112-119` | High — schema ambiguity |
| O3 | Extents are fixed: `span = viewportDiagonal * 2 + spacing*4`, drawn from a single offset enumeration with `count < 2048`. Enumeration starts at `floor(min/step)*step` without re-anchoring to the origin when the family offset is not a multiple of the step after LOD (`step = spacing * ceil(6/(spacing*zoom))`). Display density changes can move line phase. | `DocumentGridOverlay.tsx:80-105` | Medium — phase/density; far panning is covered by the diagonal span but bounded by 2048 lines |
| O4 | Per-axis `color`, `opacity`, and `spacing` exist in the schema (`IsometricAxis`) and have Inspector UI for color/opacity, but the overlay ignores all of them (single CSS class; no axis styling). | `gridTypes.ts:112-119`; `DocumentPanel.tsx:822-851`; `DocumentGridOverlay.tsx:137-146` | Medium |
| O5 | Isometric grid snapping does not exist anywhere: `snapping.ts` snaps only to world-axis horizontal/vertical lines and cartesian grids (`snapCoordToGrid`, `snapPointToRotatedGrid`). The Inspector renders a "Snap to isometric grid" switch that changes persisted state only. | `snapping.ts:500-527, 648-688`; `DocumentPanel.tsx:757-766` | High — the toggle is inert |
| O6 | The overlay `visible` switch and the global overlay mode are two independent authorities. `CanvasOverlays.tsx` additionally filters isometric grids by `visible !== false` and then by scope, but selects **the first entry** of the `isometricGrids` map — incidental iteration order is treated as user intent. `usePersistentHistory.ts` and `context.tsx` repeat the same `Object.values(...)[0]` pattern. | `CanvasOverlays.tsx:226-240`; `usePersistentHistory.ts:86-89`; `context.tsx:2232-2235` | High — active-grid ambiguity |
| O7 | The Dimetric preset stores the truncated constant `26.565` and `153.435`. Exact 2:1 is `atan(1/2) = 26.56505117707799…°`; the stored constant is off by ~5.1e-5° (sub-pixel at small sizes, but wrong by construction and it never converges). There is no ratio input. | `packages/scene/src/gridTypes.ts:174-181` | Medium — precision/terminology |
| O8 | Custom axis rows are keyed by `axis-${axis.angle}`. Editing an angle remounts the row and destroys focus; two axes at 180°-equivalent undirected directions are accepted as distinct. | `DocumentPanel.tsx:783`; `validateIsometricAxes` (`gridTypes.ts:132-147`) | Medium — interaction + validation |
| O9 | Selecting a preset replaces `axes` wholesale; a custom configuration is destroyed by a transient preset visit. There is no policy statement. | `DocumentPanel.tsx:711-726` | Medium |
| O10 | `sanitizeGrid` clamps with `Math.max/min`, which propagates `NaN`; `originX/originY` are clamped to ±100000 (a valid distant origin is silently moved), and `rotation` is normalized to [0,360) after a `NaN` guard is absent. Malformed saved grids can persist as `NaN`. | `packages/scene/src/gridTypes.ts:428-476` | High — corrupt documents |
| O11 | The isometric `rotation` is stored in **degrees** while `DocumentGrid.rotation` is stored in **radians**. Both are documented only as "rotation". | `gridTypes.ts:59` vs `:128`; `DocumentGridOverlay.tsx:87` | Medium — unit hazard |
| O12 | There is no plane concept: no active plane, no plane-aware drawing, no fit-to-plane operation. The three axis families are all drawn identically. | whole repository (`isometric` grep) | High — workflow gap |
| O13 | No export/exclusion code path mentions isometric grids; the overlay is SVG chrome and is not a scene node, so it is already excluded from exports. Must be locked with a test rather than assumed. | `CanvasOverlays.tsx` render tree; export modules | Low (verify only) |

### Root cause summary

The isometric grid was delivered as *display chrome with a settings panel*, not as a
geometric model. There is no canonical basis; the overlay, the (missing) snapping, and
the (missing) plane operations would each have to re-derive geometry from an
under-specified `{axes[].angle, spacing}` pair, so they cannot agree. The repair is a
single canonical module (`packages/scene/src/isometricGeometry.ts`) that every consumer
imports.

## 3. External research (accessed 2026-09-15)

### 3.1 Ratio-based axonometric configuration (Inkscape 1.4)

**Fact.** Inkscape 1.4 added ratio-based angle entry for axonometric grids because
`26,565051` is "difficult to set exactly without the ratio option"; the documented
example is the 2:1 isometric-game ratio. The axonometric grid itself has `Angle X`,
`Angle Z` (measured from horizontal, `angle[Y] == 0` in the implementation) and
`Spacing X`, `Spacing Y`, plus emphasis (major) line spacing.

**Consequences for Varve.**
1. Store an exact ratio (e.g. `2:1`) and derive the angle as `atan(ratio)` instead of
   storing truncated degrees (fixes O7).
2. Keep `angle` defined explicitly as the direction of the line family measured
   counter-clockwise from +X in document space, Y-down (fixes O2).
3. Provide a "major line every N" control for the isometric grid, matching the
   document-grid `subdivisions` vocabulary.
4. Inkscape's own bug tracker shows the ratio UI needing fraction simplification and
   Enter-to-apply (`!6132` review notes) — Varve should normalize the entered ratio and
   apply on commit, not on each keystroke.

*Uncertainty:* Inkscape's `spacing_ylines` semantics (perpendicular spacing for the
angled families vs vertical spacing for the vertical family) are implementation
details of its Gtk grid; Varve does not copy them. Varve defines its own spacing
contract (§4).

*Sources:*
- Inkscape 1.4 release notes — https://media.inkscape.org/media/doc/release_notes/1.4/Inkscape_1.4.html (accessed 2026-09-15)
- Inkscape wiki release notes — https://wiki.inkscape.org/wiki/Release_notes/1.4 (accessed 2026-09-15)
- Inkscape MR !6132 review thread — https://gitlab.com/inkscape/inkscape/-/merge_requests/6132 (accessed 2026-09-15)

### 3.2 Plane-aware drawing vs transforming existing artwork (Affinity Designer)

**Fact.** Affinity's published workflow has two distinct mechanisms:

- **Edit in Plane** — the shape tools draw directly on the currently selected plane
  ("draw a square using the Rectangle Tool … you'll notice it's drawing a shape already
  at the angle you want", with Shift producing a square *in plane coordinates*).
- **Fit to Plane** — transforms an existing selection onto the active plane from the
  Isometric panel.

Both are documented together with Top/Front/Side plane selection. The same docs and
tutorials treat `Fit to Plane` as a one-shot affine operation on existing art.

**Consequences for Varve.** Keep the distinction: `Edit in Plane` = plane-aware tool
handling (Milestone 4A); `Fit to Plane` = an explicit transform command (4B). Plane
selection must not transform existing selections.

*Sources:*
- Affinity help — Isometric panel — https://www.affinity.studio/help/panels-isometric-panel/ (accessed 2026-09-15)
- Affinity help — Isometric grids — https://www.affinity.studio/help/design-aids-grids-isometric/ (accessed 2026-09-15)
- Lessons in Design, "How To Do An Awesome Isometric Illustration in 9 Steps" — https://www.lessonsindesign.com/isometric-illustration-affinity-designer/ (accessed 2026-09-15)

### 3.3 Documented failure modes worth not repeating

| Failure | Source (accessed 2026-09-15) | What Varve must do instead |
|---|---|---|
| `Fit to Plane` produces inconsistent skews for multi-object selections; the reported trigger is per-object combined rotation being picked from the first object the operation sees. Multi-line selections transform differently from shape selections. | Affinity forum, "Designer v2.5.7 Isometric grid fit to plane inconsistent result with lines" — https://forum.affinity.serif.com/index.php?/topic/226219-designer-v257-isometric-grid-fit-to-plane-inconsistent-result-with-lines/ | Compute exactly one world-space affine for the whole selection; never decompose per object; never derive a rotation from one arbitrary child. Regression-test a mixed selection of a rect, four lines, and a text node. |
| Grid "isometric" vs game-art 2:1 conflation: users set 30° + cell spacing 32 and it "would not align" in Godot; the mismatch is compounded by grid snapping to pixel boundaries, and by lattice drift over distance. | Krita Artists — https://krita-artists.org/t/isometric-pixel-art-uncapable/178050 and https://krita-artists.org/t/isometric-snappy-grid-for-game-development-and-guide/29486 | Separate "True isometric (exact 30°)" from "2:1 dimetric (ratio-derived, pixel-art friendly)" in the preset UI with explicit labels; never imply pixel-grid snapping is isometric snapping; anchor line enumeration to integer lattice indices from the origin so there is no drift. |
| Free isometric guides without snap support force manual pixel counting; external reference layers are a common workaround. | Aseprite issue #5612 — https://github.com/aseprite/aseprite/issues/5612 | Provide real lattice/line snapping as part of the grid, not as a separate guide layer. |
| Perspective/plane helpers in plugins are frequently shape-limited (rectangles only) or silently break on custom geometry. | Figma "Fast Isometric" plugin reviews — https://www.figma.com/community/plugin/1249759048471403961/fast-isometric | Document plane-operation support per node kind; fail with an explanation rather than a silent no-op. |
| Users lose configured grids when temporarily switching presets, and angle-derived control keys lose input focus. | Inkscape MR !6132 discussion (fraction simplification); see also O8/O9 (Varve-local) | Preserve custom configuration behind an explicit policy; stable axis IDs; never key a row by an editable value. |

### 3.4 Oblique-lattice nearest point

**Fact.** Independent rounding of the two plane coordinates does not, in general,
produce the nearest lattice point in Euclidean (or screen) distance; it is only correct
when the basis is orthogonal (or, with the standard cube-rounding correction, for
triangular lattices expressed in three 120°-apart coordinates). For an oblique plane
basis the nearest-intersection problem is the 2D closest-vector problem.
Implementation consequence: a bounded neighbourhood scan around the rounded
coordinates is *empirically* adequate for the reduced bases Varve supports, but the
bound is not self-evident, so Varve uses an exact 2D Voronoi descent (relevant-vector
enumeration after Lagrange–Gauss reduction) and cross-checks it against brute force in
tests, including a documented counterexample for plain rounding.

*Sources:*
- Conway & Sloane, "Fast quantizing and decoding algorithms for lattice quantizers and codes", IEEE Trans. Inf. Theory 28(2), 1982 (relevant-vector decoding).
- Agrell et al., "Closest point search in lattices", IEEE Trans. Inf. Theory 48(8), 2002 (survey; bounded enumeration and decoding).
- Red Blob Games, "Hexagonal Grids" (cube rounding for the 120° family) — https://www.redblobgames.com/grids/hexagons/ (accessed 2026-09-15)

### 3.5 Pixel-art 2:1 vs true isometric

**Fact.** Pixel-art "isometric" is 2:1 dimetric: slope exactly 1/2 so a line steps an
integer number of pixels each step and tile seams close. True isometric's slope is
`tan(30°) = 1/√3`, which never lands on an integer pixel step; forcing it onto a pixel
grid produces the "drift / shimmy / seam" complaints above.

**Consequence.** Varve labels the two presets distinctly and documents that pixel-exact
output additionally requires integer origin/spacing and an integer-scaled raster export
pipeline; the grid alone does not make artwork pixel-aligned.

*Sources:*
- 0xdarkmatter claude-mods, pixel-art-workflow reference — https://github.com/0xdarkmatter/claude-mods/blob/main/skills/isometric-ops/references/pixel-art-workflow.md (accessed 2026-09-15)
- SLYNYRD Pixelblog, and Clint Bellanger, "Isometric Tiles Math" — https://clintbellanger.net/articles/isometric_math/ (accessed 2026-09-15)

## 4. Product decisions (canonical contracts)

These are Varve decisions, made from the evidence above.

### D1. Coordinate system

Document coordinates are X right, Y down, matching the rest of Varve (SVG/CSS
convention). Angles written to the document are degrees, measured from +X toward +Y
(so 30° points down-right — the standard isometric "right" axis). Radians are used only
inside camera and affine APIs; conversions at module boundaries are explicit and named
(`degToRad`, `radToDeg`).

### D2. Canonical basis

The canonical isometric grid is the lattice generated by two **construction basis
vectors** in document space:

```
e1 = s · (cos a1, sin a1)
e2 = s · (cos a2, sin a2)
```

where `s` is the **projected axis step** — the distance in document units between two
adjacent construction stations along either axis — and `a1, a2` are the axis
directions. The third (vertical) axis family is *derived*, not independent: it is the
family parallel to `e3 = e1 + e2` reflected through the origin, i.e. the direction that
completes the plane's third isometric axis when the basis is a standard isometric pair.
For the standard preset `e1, e2` at 30° and 150° give the undirected families 30°, 150°
and 90°, with `|e1| = |e2| = s` and pairwise projected angles of 120° between the three
directed axes (the standard isometric property); this is verified in the independent
geometry tests, including `e1·e2 = −s²/2`.

Spacing semantics: **`spacing` is the projected axis step.** It is *not* the
perpendicular separation between neighbouring parallel grid lines. For a lattice
generated by a unit basis the perpendicular separation of the family parallel to `e1`
is `|e2| · sin θ`, where θ is the angle between the two basis vectors (for the standard
preset, `s·√3/2`). All displayed values, snap steps, and plane coordinates are derived
from the single stored step via the basis.

### D3. Named planes

A plane is a pair of basis vectors plus the grid origin:

| Plane id | Label | Basis (standard iso) | Meaning |
|---|---|---|---|
| `top` | Top | `(e1, e2)` | Ground plane; both isometric diagonals |
| `front` | Front | `(e1, e3v)` | Face containing the +X isometric axis and the vertical axis (faces the viewer's right) |
| `side` | Side | `(e2, e3v)` | Face containing the −X isometric axis and the vertical axis (faces the viewer's left) |

`e3v` is the vertical family direction, `(0, -1)` for the standard preset, i.e. the
shorter of the two vertical directions when document Y points down. Plane names are
explicitly Varve names; they are not claimed to match any other application's
"front/left/right".

### D4. Two-dimensional interpretation

A screen/world point has a unique `(u, v)` in the active plane because the plane basis
is a 2×2 invertible map. Plane-aware tools convert the pointer into plane coordinates
with `B⁻¹`, apply the tool's rules there (including Shift constraints in plane
coordinates), and map the result back with `B`. No hidden depth value is invented.

### D5. Scope and precedence

- Isometric grids live in `Document.gridSettings.isometricGrids`, keyed by stable id.
- `Document.gridSettings.activeIsometricGridId` names the **active** grid. The active
  grid is never inferred from object iteration order.
- Precedence for the active grid: explicit `activeIsometricGridId` → sole visible
  document-scoped grid → none. Page/frame-scoped isometric grids are rendered when they
  own the point/page and may snap only when they are the active grid.
- Display visibility, snapping enablement, and edit locking remain distinct flags.

### D6. Presets

| Preset id | Label | Axes |
|---|---|---|
| `standard` | True isometric (exact 30°) | 30°, 150°, 90° |
| `dimetric-2-1` | Game-art 2:1 dimetric (`atan(1/2)`) | `atan(1/2)`, `180−atan(1/2)`, 90° |
| `trimetric` | Trimetric (15°/45°/75°) — directional guides | 15°, 135°, 75° |
| `custom` | Custom axes | user |

`trimetric` is labelled as *directional construction guides*: arbitrary line angles do
not establish a physically valid trimetric projection, and Varve does not claim they do.

### D7. Grid artwork generation

An explicit command converts the visible lattice (optionally the active plane only)
into ordinary bounded path geometry (one path per family, clipped to a finite rect),
wrapped in one undo step. Turning the overlay on or off never changes artwork;
construction grids are never exported implicitly.

## 5. Capability matrix (baseline → target)

| Capability | Baseline | Target milestone | Regression test |
|---|---|---|---|
| Canonical basis + exact presets | Missing (O1, O7) | M2 | `isometricGeometry.test.ts` (independent fixtures) |
| Viewport-driven overlay, phase-stable | Partial (O3) | M2 | overlay geometry tests + E2E pan/zoom |
| Per-axis style/visibility | Broken (O4) | M2 | inspector/E2E visual |
| Active grid resolution | Broken (O6) | M2 | persistence tests |
| NaN-safe sanitization/migration | Broken (O10) | M2 | version migration tests |
| Isometric snapping (intersections) | Missing (O5) | M3 | snapping unit + E2E drag |
| Isometric line snapping | Missing | M3 | snapping unit |
| Plane-aware rect/ellipse/line | Missing (O12) | M4 | E2E draw + geometry unit |
| Fit to plane (multi-object, one transform) | Missing | M4 | unit + E2E |
| Plane switch without transforming art | Untestable | M4 | E2E |
| Export excludes construction grid | Unverified (O13) | M5 | E2E export |
| Grid artwork command | Missing | M5 | unit + E2E |
| Constrained-device budget | Unmeasured | M5 | overlay benchmark |
