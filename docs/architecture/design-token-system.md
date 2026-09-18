# Design token system — surfaces, canvas identity, and the document-derived accent

Scope: the authoritative contract for Varve's application design tokens —
how reference values become semantic roles, how shell surfaces are tiered,
how canvas overlay marks keep their own identity, and how the opt-in
document-derived accent mode may (and may not) override them. Application
interface tokens only; user-authored document styles, swatches, and color
variables are a separate system (see `palette-extraction-system.md` for the
artwork-facing analysis pipeline). Interface sizing/density lives in
`interface-sizing-system.md`.

## 1. Token architecture

One direction, three layers:

```
reference values (packages/ui/src/tokens/color.ts — OKLCH ramps, one hue ladder each)
        ↓
semantic roles (SEMANTIC map in color.ts, per theme: light / dark / high-contrast)
        ↓
component + density tokens (components.css, editor.css consumers)
```

- `color.ts` is the single source of truth; `pnpm tokens:generate` emits
  `packages/ui/src/tokens/tokens.css` (including `prefers-color-scheme`,
  `prefers-contrast`, and `forced-colors` blocks). Never hand-edit
  `tokens.css`.
- `pnpm audit:tokens` validates every `CONTRAST_PAIRS` entry (WCAG 2.2 AA
  for text, 3:1 for non-text/UI) in all three themes; the count grows with
  the pair list (213 pairs as of 2026-09-17).
- Hard rule (AGENTS.md): no hardcoded color/space/type values in component
  CSS — trace to custom properties.

### Surface tiers

Shell backgrounds are achromatic and tiered by function (the
`--elevation-surface-*` set, aliased from the `surface-*` semantic roles):

| Tier | Token | Function |
|---|---|---|
| 0 | `surface-app` / `surface-base` | workspace surround, canvas backdrop |
| 1 | `surface-sunken` | recessed regions, status bar |
| 2 | `surface-raised` | docked panels, menubar |
| 3 | `surface-hover` / interactive surfaces | control states |
| 4 | `surface-overlay` | floating surfaces, popovers |

Docked separation uses keylines (`--color-border-subtle`) plus
`--border-micro`; floating surfaces add `--elevation-shadow-raised`. All
HUD chrome is opaque — translucent HUD backgrounds are not part of the
contract (contrast over arbitrary artwork cannot be guaranteed).

### Canvas overlay identity (added 2026-09-17)

Selection, handles, guides, and drop-target marks are drawn **over
arbitrary artwork**, so they have dedicated tokens and must never inherit
the interface accent family:

| Token | Role |
|---|---|
| `--color-canvas-selection` | selection outlines, handles strokes/fills, measurement marks |
| `--color-canvas-selection-wash` | translucent preview fills |
| `--color-canvas-handle-fill` | the dual-tone core inside handles (theme-inverted counter) |
| `--color-canvas-guide` | snap/alignment/perspective guides |
| `--color-canvas-drop-target` | drop/mask-target highlight outlines |

Values mirror what the overlays rendered before the split, except two
audited repairs: light-theme guides/drop-targets moved from accent T(6)
(1.78:1 on the board — a WCAG 1.4.11 fail surfaced when the pairs were
first added) to the selection step T(9); `ExportRegionOverlay` and
`KnifeHoverOverlay` stopped rendering hardcoded fallbacks for previously
undefined tokens. Contrast against the artwork itself cannot be proven by
a fixed pair — the mitigations are the dual-tone handle construction and
theme-stable hues. `CONTRAST_PAIRS` carries the shell-adjacency pairs
(surface-base, handle core).

Consumers migrated (2026-09-17): SelectionOverlay, NodeEditOverlay,
Warp/MeshWarp/GradientHandle/ShapeBuilder/TextEdit/PageTool/SpatialFilter/
BlurGallery/Perspective/MotionPath/FocusOrder/TextThread/ExportRegion/
KnifeHover overlays, TableEditOverlay, SpecPanel MeasureOverlay, Guide/
SnapGuides overlays, overlayManager accent marks, and the dimension pill.
`pageDecorations.ts` (print page accent ring) intentionally stays on the
interface accent family — page chrome, not interaction marks.

## 2. Document-derived accent (opt-in)

`settings.appearance.accentSource: 'fixed' | 'document'` (default
`'fixed'`). Implementation: `packages/editor/src/appearance/documentAccent.ts`;
preference application follows the density/font single-writer pattern via
`SettingsContext`; the editor shell publishes the extractable surface from
`StatusBar` via `useDocumentAccent`.

What document mode may re-tint: the accent family (`--color-accent-*`) and
the interactive family (`--color-interactive-*` except focus), plus
`separator-accent` and `tree-row-selected` — per-theme step mappings in
`OVERRIDABLE_TOKENS`. The derived ramp reuses the audited TEAL ladder's
lightness/chroma per step and rotates only the hue, so audited contrast
relationships hold by construction; the structural AA pairs are
re-validated at runtime and any failure falls back to the fixed accent.

What document mode must never override (enforced by the token split, not
by convention):

- keyboard focus (`--color-border-focus`, `--color-interactive-focus-ring`)
- canvas selection/handles/guides/drop-targets (§ Canvas overlay identity)
- semantic feedback (success/warning/danger/info)
- workspace identities, layer tags, text highlights, brand tokens
- the High-Contrast theme (always fixed)

Extraction rules:

- Source: the canonical `page-nav` thumbnail of the **active page** through
  `renderDocThumbnail` (`flattenSceneToEngine` → engine IR replay). Hidden
  pages are never sampled just because their pixels are computable.
- Bounded processing: 64×64 downsample, existing palette worker
  (`analyzePaletteInWorker`), cached by content, abortable.
- Candidate ranking: eligible swatches (chroma ≥ 0.045, lightness 0.30–
  0.88) ranked by `weight × chroma × roleBias` with deterministic
  tie-breaks (hue, then lightness).
- Honest fallbacks: empty, fully transparent, or grayscale documents keep
  the fixed accent. No eligible candidate → no override attribute.
- Gesture safety: trailing 400ms debounce — continuous editing or dragging
  never triggers extraction mid-gesture.
- Stale rejection: generation tokens + abort + context-key identity —
  edits, page switches, and document close invalidate in-flight work.
- Application: one `<style id="varve-doc-accent">` element plus
  `data-accent-source="document"` on the root. Documents, history,
  dirty-state, saved colors, and exports are never touched.

## 3. Known debt (recorded, not guessed)

- 93 undefined token names appeared in editor CSS at audit time; the
  canonical-name repairs shipped 2026-09-17 (accent/warning/danger/error/
  success). The ambiguous remainder (`--color-surface`, `--color-border`
  variants, `--color-status-*`) still renders fallbacks and needs a
  per-usage mapping table.
- `LayersPanel/layers.css` retains pre-repair references (active owner).
- `packages/ui` tooltip still uses a raw 10px shortcut label.
- Px-based component geometry intentionally does not scale with the UI
  font-size preference (see `interface-sizing-system.md` §Font size).
