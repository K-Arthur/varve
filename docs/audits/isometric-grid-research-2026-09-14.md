# Isometric grid research and capability audit

**Date:** 2026-09-14
**Status:** research complete; implementation underway on `master`
**Scope:** document model, editor overlay, snapping pipeline, drawing tools,
persistence, export, website documentation.

This document separates **observed Varve behaviour**, **externally verified
facts** (with source and access date), **hypotheses**, and **product
decisions**. It exists because the earlier grid audits
(`grid-system-audit-2026-07-27.md`, `grid-system-audit-2026-09-09.md`)
correctly repaired the *cartesian* document grid but only ever asserted
"isometric geometry uses the shared camera projection" — it never verified
that the three line families form a lattice, that snapping exists, or that
users can construct on a plane.

## 1. Observed Varve behaviour (baseline, pre-repair)

All observations from `master` at `febd343d2` on Linux (CachyOS), Chromium
via Playwright, viewport 1280×800.

| # | Capability | State | Evidence |
| --- | --- | --- | --- |
| 1 | Isometric grid can be toggled (Inspector switch / command) | working | `DocumentPanel.tsx` `IsometricGridSection`, `createActionHandlers.ts:1106` |
| 2 | Grid is rendered at all | broken-by-default | `CanvasOverlays.tsx:226` returns `null` unless `gridOverlayMode === 'isometric'`; the only entry point sets the mode but the resolved grid must also be `visible !== false`; default `visible:false` |
| 3 | Overlay geometry forms the intended lattice | broken | `DocumentGridOverlay.tsx:92-108` spaces each family by the same *perpendicular* distance. A true isometric lattice has axis-step `s` and perpendicular family spacing `s·√3/2`; using `s` for both changes the lattice by 2/√3 ≈ 15.47% |
| 4 | Origin | partial | used as a single anchor for all families, so it *is* a lattice point, but rotation is applied as a screen-space rotation of the angle rather than a document-space rotation about the origin |
| 5 | Per-axis color / opacity / spacing | unconsumed | `IsometricAxis` stores all three; the overlay uses one `kind` class and one stroke style |
| 6 | Snap to isometric grid | missing | no `isometric` reference anywhere in `snapping.ts`, `toolContext.ts`, `SelectTool.ts`, `nudge.ts` |
| 7 | Active plane | missing | no plane concept in the model |
| 8 | Exact 2:1 dimetric | wrong constant | `gridTypes.ts:177` stores `26.565` (truncated). Inkscape added ratio input in 1.4 specifically because `26,565051` cannot be typed exactly |
| 9 | Custom axis preservation when switching preset | broken | `DocumentPanel.tsx` `handlePresetChange` overwrites `axes` with the preset; editing one axis flips to `custom` and the preset definition is lost |
| 10 | Focus during angle edit | broken | React key is `` `axis-${axis.angle}` `` — every keystroke remounts the row and steals focus |
| 11 | Active grid resolution | broken | `context.tsx:2232/3233/2655` and `usePersistentHistory.ts:86` use `Object.values(...)[0]` — incidental map order decides the grid |
| 12 | Sanitization of non-finite values | broken | `sanitizeGrid` applies `Math.max/min` to `NaN`, which propagates `NaN` into the model |
| 13 | Near-parallel axes | unvalidated | `validateIsometricAxes` only rejects duplicate angles within 0.1°; 0.1° apart is still ill-conditioned for a lattice |
| 14 | Viewport extents | fixed/unbounded | span is `2·diagonal + spacing·4`; at low zoom this is bounded by a 2048-line cap per family but phase is anchored at a *negative* offset, and no LOD/hysteresis exists |
| 15 | Export contamination | none observed | overlay is a separate DOM/SVG layer; scene export ignores it (verified by reading export pipeline and `grid-system-audit-2026-09-09.md`) |
| 16 | Grid artwork generation | missing | no command |
| 17 | Fit existing artwork to a plane | missing | no command or transform helper |

### Reproduction (baseline)

1. Launch the editor, open a document, Inspector → Properties → Isometric
   Grid, enable **Visible**, then Document → View → Grid → Isometric (or the
   keyboard/command path).
2. Observe the grid renders three families at 30°/150°/90° but the
   intersections of the 30° and 150° families do not line up with a
   consistent 24-unit lattice: measure the distance between adjacent
   intersections and between "cells"; it is `24/cos(30°) ≈ 27.7` world units
   along the axes, not 24.
3. Draw a rectangle; drag it. No snap guide appears, at any zoom — the grid
   is present but snapping is not implemented.

## 2. Externally verified facts

| Fact | Source | Version | Accessed | Consequence for Varve |
| --- | --- | --- | --- | --- |
| Axonometric grid angles can be entered as the ratio of the rhombus they form; the 2:1 game-art case corresponds to `26,565051°` and is explicitly called out as impossible to type exactly without ratio input | Inkscape 1.4 release notes / MR !6132 | 1.4 | 2026-09-14 | Store exact ratio and compute `atan2(b, a)`; never a truncated degree constant |
| Inkscape's axonometric grid exposes `Angle X`, `Angle Z`, `Spacing X`, `Spacing Y`, and "major line every N"; the third line family is vertical | Inkscape 1.4 manual + `CanvasAxonomGrid` doxygen (`angle[Y] == 0`) | 1.4 | 2026-09-14 | Two configurable families + implicit vertical is an established, comprehensible model; major-line spacing is a first-class control |
| Inkscape documents `Y spacing` as twice the height of the rhombus vertex: `2·24·sin(α/2)` (community worked example for 24-unit spacing at 26.565°) | InkscapeForum.com thread #27387 | 1.4 era | 2026-09-14 | Communities treat Inkscape spacing as a *per-family perpendicular measurement* and routinely get it wrong; Varve must state its unit unambiguously |
| Affinity's isometric panel distinguishes **Edit in Plane** (new shapes are drawn in the selected plane) from **Fit to Plane** (existing objects are transformed onto the plane), and mirrors the selection to the plane while editing | Affinity Help Center, Isometric panel; Envato Tuts+ A–Z; Lessons in Design tutorial | Designer 2.x | 2026-09-14 | Keep these two capabilities separate in commands and UI copy, as the mission requires |
| Affinity's `Fit to Plane` has a long-standing, still-open defect where a selection of individual line/curve layers with a combined ±90° rotation is transformed inconsistently, because decomposition is applied per object and picks one object's rotation | Affinity forum thread "Isometric grid fit to plane inconsistent result with lines" | Designer 2.5.7 | 2026-09-14 | Varve must apply **one** affine to the whole selection in world space, never per-object decomposition; explicit regression test |
| Krita isometric grids cannot match 2:1 game tiles; users report drift that grows across a tilemap and impossible alignment in Godot; the accepted explanation is that game "isometric" is *dimetric* and Krita only offers true 30° isometric | Krita Artists forum "Isometric pixel art uncapable" | Krita 5.x | 2026-09-14 | Name presets honestly: **True isometric (30°)** vs **Dimetric 2:1 (26.565°)**; never call arbitrary angle sets isometric |
| Aseprite users request an isometric grid with snap-to-vertices; the working prototype optimises from per-tile drawing to two families of clipped parallel lines (`O(n²) → O(n)`) and defaults to 16×8 (2:1) | Aseprite issue #5612 | 1.3.x | 2026-09-14 | Viewport-driven parallel-line generation is the correct rendering model; snapping must target vertices/intersections |
| Snapping guides to pixel boundaries breaks isometric intersections because intersections rarely land on pixel centres | Krita Artists "Isometric snappy grid" thread | Krita 5.x | 2026-09-14 | Grid snapping must operate in world/screen continuous space; pixel-grid snapping stays a separate, explicit concern |
| The image of a circle under a plane's affine map is an ellipse whose axes are the singular vectors of the 2×2 linear part; at 2:1 the ground-plane foreshortening is exactly 1:2 | Pixel-art workflow reference (0xdarkmatter), deriving from standard SVD/affine geometry | n/a | 2026-09-14 | Plane ellipses are computed from the basis SVD, not eyeballed |
| SVG's initial coordinate system has +Y downward; nested transforms define their own systems | W3C SVG 2 coordinate systems | SVG 2 | 2026-09-14 | All conversions must be explicit about which space they are in; degrees at the UI boundary, radians in affine math |

## 3. Hypotheses (to be tested during implementation)

1. **H1.** The existing `IsometricGrid.axes[].angle` contract is a *line
   direction* (the family runs parallel to that direction), measured in
   degrees, counter-clockwise in document space (i.e. 30° runs down-right
   under +Y-down because `sin(30°) > 0`). The overlay's use of
   `(cos, sin)` as direction and `(-sin, cos)` as normal matches this; there
   is no 90° error, only a spacing error. *Test:* compare overlay output with
   the canonical basis in `isometricGeometry.test.ts`.
2. **H2.** Snapping a multi-object selection happens through a single
   translation of the selection bounds in `SelectTool.snapPosition`; adding
   a joint (2-D) candidate will preserve relative arrangement without any
   per-object logic. *Test:* Playwright move-selection scenario plus a unit
   test on `snapPosition` with an oblique option.
3. **H3.** The existing sticky-snap session can be reused for lattice
   snapping by storing lattice candidates as a `SnapLock` keyed by grid id +
   origin + spacing; invalidation on grid change is then a string compare.
   *Test:* unit test that changes the grid and expects release.

## 4. Product decisions (recorded, with rationale)

| ID | Decision | Rationale |
| --- | --- | --- |
| D1 | `IsometricGrid.spacing` means **projected length of one lattice step along each axis** (the lattice constant `s`), not perpendicular distance between lines | Intersection snapping, plane `(u,v)` coordinates, and "move by one grid step" all become `s`-multiples. Per-family perpendicular distances are then derived (`s·sin θ`) and can never disagree |
| D2 | Axis `angle` stays **degrees**, **line direction**, screen/document space, `+Y` down, clockwise on screen (equivalent to CCW in math convention with Y-down). Affine math uses radians and converts at the boundary | Matches the existing schema contract (H1) and the Inspector's "Angle … deg" input; avoids a silent 90° flip |
| D3 | Named planes: `top` = axes Right(30°) + Left(150°) (ground); `front` = Right(30°) + Vertical(90°) (faces the lower-right); `side` = Left(150°) + Vertical(90°) (faces the lower-left) | Matches Affinity's Top/Front/Side habit; identical undirected pairs, but the *basis order* is documented so `u`/`v` have stable meaning |
| D4 | A legacy document's stored spacing is migrated by `s_new = s_old / sin θ`, where θ is the angle between the first two visible axis directions. For the standard preset this is exactly `2/√3` and preserves the drawn grid | Satisfies "avoid silently reinterpreting saved spacing": geometry is preserved and the semantic change is versioned and tested |
| D5 | Display density (LOD) never mutates authored spacing; it selects a nested multiplier from a fixed ladder (`1, 2, 4, 8, …`) and major lines keep their identity | Standard CAD/design behaviour; prevents phase jumps and preserves "major line = authored multiple of `spacing`" |
| D6 | Snapping targets **all** lattice points by default, with an explicit "snap to visible lines only" switch. The snap overlay always reports the actual winning target kind | The mission requires the distinction to be exposed, not inferred |
| D7 | Plane-aware construction maps pointer world positions through `B⁻¹`, applies tool constraints in plane coordinates, and maps results back through `B`. Rectangles become editable closed paths (projected quads); ellipses become the exact affine image of a plane circle (paths whose control points are the affine image of a cubic circle approximation) | Keeps artwork editable, avoids a "screen-space ellipse that looks plausible", and reuses existing path/tool infrastructure |
| D8 | "Fit to plane" composes one world-space affine for the whole selection: `T_world = translate(O) · B_plane · B_source⁻¹ · translate(−O_source)`, and applies it as a single transform to each selection root's world transform. It is a distinct command from the grid's active plane | Directly addresses the Affinity `Fit to Plane` defect class; no per-object decomposition |

## 5. Capability matrix after repair

Tracked in `docs/architecture/grid-system.md` § Isometric as the authoritative
current-state matrix; this audit records the *baseline* matrix in §1 only so
that the two documents cannot drift.

## 6. Open questions / uncertainty

- **U1.** Exact Affinity plane naming for the left/right bases differs by
  document orientation; Varve will publish its own mapping (D3) rather than
  claim parity.
- **U2.** The `2/√3` migration factor assumes the legacy grid was the standard
  30/150/90 preset. For legacy custom axes the visible geometry cannot be
  preserved exactly because the legacy renderer was not lattice-consistent;
  the migration preserves the first family's perpendicular spacing and
  records that the conversion happened (`spacingMode: 'axis-step'` is set).
- **U3.** Pixel-art exactness (integer stepping) depends on raster density and
  antialiasing; Varve documents the 2:1 principal direction and provides a
  pixel-grid snap toggle but does not claim pixel-exact output.
