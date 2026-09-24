# Design token system — surfaces, canvas identity, and the document-derived accent

Scope: the authoritative contract for Varve's application design tokens —
how reference values become semantic roles, how shell surfaces are tiered,
how canvas overlay marks keep their own identity, and how the opt-in
document-derived accent mode may (and may not) override them. Application
interface tokens only; user-authored document styles, swatches, and color
variables are a separate system (see `palette-extraction-system.md` for the
artwork-facing analysis pipeline). Interface sizing/density lives in
`interface-sizing-system.md`. Token ownership, the semantic CSS contract, and
theme lifecycle/persistence live in `theme-system.md`; this document owns the
surface and identity tiers composed from them.

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
- `pnpm audit:tokens` runs two gates: the WCAG pair audit (315 pairs as of
  2026-09-23) and `scripts/quality/audit-token-usage.mjs`, which fails on any
  `var()` reference to a custom property nothing defines, and on any literal
  fallback attached to a property that *is* defined (a fallback on a defined
  token can only ever paint an unthemed value, and it hides the token's
  absence). Undefined-by-design runtime hooks are listed in that script with a
  reason.
- Hard rule (AGENTS.md): no hardcoded color/space/type values in component
  CSS — trace to custom properties.
- `pnpm lint:css` (stylelint over `packages/ui/src`) bans hex colours and
  duplicate custom properties inside one block, and is part of the affected
  closure for shared UI stylesheets.

### Surface tiers

Shell backgrounds are achromatic and tiered by function. The tier values are
the five `surface-*` semantic roles in `color.ts`; `--elevation-surface-*` is
emitted as an alias **of** them, so there is exactly one place to change a tier
and exactly one set of values for the contrast audit to validate:

| Tier | Semantic role | Elevation alias | Function |
|---|---|---|---|
| 0 | `surface-app` / `surface-base` | `--elevation-surface-default` | workspace surround, canvas backdrop |
| 1 | `surface-sunken` | `--elevation-surface-sunken` | recessed regions, status bar |
| 2 | `surface-raised` | `--elevation-surface-raised` | docked panels, menubar |
| 3 | `surface-hover` | — | control states (`--interactive-hover-surface`) |
| 4 | `surface-overlay` | `--elevation-surface-overlay` | floating surfaces, popovers |

Dark tiers are front-lit: a higher tier is *brighter*, not darker. High
Contrast collapses tiers 0/1 to black and keeps tiers 2/4 as two distinct
near-blacks so nested floating surfaces remain separable.

Docked separation uses keylines (`--color-border-subtle`) plus
`--border-micro`; floating surfaces add `--elevation-shadow-raised`. All
HUD chrome is opaque — translucent HUD backgrounds are not part of the
contract (contrast over arbitrary artwork cannot be guaranteed).

**History (2026-09-19).** The tier values used to live as literals inside
`generate-token-css.ts`, in three per-theme blocks, and the generator then
redeclared `--color-surface-*` as aliases of them. That inverted the documented
direction, so the browser painted the generator literals while
`CONTRAST_PAIRS` audited the `color.ts` values — 11 of 15 surface roles drifted,
and the drift guard could not see it because it reads each token's first
declaration. The values were moved into `color.ts` (adopting the rendered
literals, so no surface changed appearance), the alias direction was restored,
and `tokens.test.ts` now asserts that no custom property is declared twice in a
theme block and that no `--color-surface-*` is ever aliased *from* an
`--elevation-*`. `stylelint`'s `declaration-block-no-duplicate-custom-properties`
rule — previously disabled, and the exact rule that would have caught this — is
enabled again.

### Feedback colour: graphics grade versus text grade

`feedback-*` is graded at 3:1 (WCAG 1.4.11 non-text) and is correct for status
dots, chips, fills, and borders. Components also render feedback colours as
*text*, which needs 4.5:1 (WCAG 1.4.3), so each feedback hue has a text-safe
partner:

| Graphics (3:1) | Text (4.5:1) | Meaning |
|---|---|---|
| `--color-feedback-success` | `--color-text-success` | saved, valid, complete |
| `--color-feedback-warning` | `--color-text-warning` | caution, degraded |
| `--color-feedback-danger` | `--color-text-danger` | error, destructive |
| `--color-feedback-info` | `--color-text-info` | neutral notice |

Use `feedback-*` for marks and fills, `text-*` for words. The `text-*` roles are
additionally graded against the hover surface, because a status message must
stay legible after a pointer lands on its row.

### Theme-invariant domain colours

Some values are deliberately *not* themed, because the interface theme has no
authority over what they encode. They are named in `tokens.css` under
`Theme-invariant domain colors` rather than left as literals:

| Token | Why it cannot follow the theme |
|---|---|
| `--color-media-viewer-backdrop` / `-foreground` | an image or HDR preview is judged against a fixed neutral backdrop, or the app theme biases tonal perception |
| `--color-depth-scale-near` / `-mid` / `-far` | the depth-mask legend states *document* depth; re-theming it would change what the legend says |

The same standard applies to canvas overlays drawn over arbitrary artwork:
marching-ants dual strokes, mask-preview polarity, and subject-picker states use
fixed values because a themed mark could vanish into artwork of the same colour.
Those are recorded in the canvas-identity contract above and in
`docs/architecture/theme-system.md` § Interface colour versus authored colour —
not hidden behind a broad lint exemption.

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

## 3. Adding a token, or a literal

1. Add the role to `SemanticToken` in `color.ts` and map it in **every** theme.
2. Add the meaningful foreground/background pairs to `CONTRAST_PAIRS` — at the
   grade the consumer actually needs. A role used as text needs AA; a role used
   as a mark needs UI. Do not add a pair for only one theme.
3. Run `pnpm --filter @varve/ui tokens:generate`, then `pnpm audit:tokens`
   (pairs + usage) and `pnpm lint:css`.
4. Consume the semantic role in components. No `theme === 'dark' ? … : …`
   branches, no ramp positions, no literal fallbacks.

If a value genuinely cannot be themed, give it a name in the token layer under
`Theme-invariant domain colors` and state why the theme has no authority over
it. Do not leave an unexplained literal, and do not widen a global lint
exemption to hide one.

## 4. Known debt (recorded, not guessed)

- Canvas overlays in `packages/editor/src/canvas/overlayManager.tsx` still hold
  fixed dual-tone and document-visualisation literals (marching-ants
  `rgba(0,0,0,…)`/`rgba(255,255,255,…)` pairs, mask-preview polarity, preview
  mode overlays). These are intentionally theme-independent — see § Canvas
  overlay identity — but they should be *named* as domain tokens and read from
  the once-per-theme-revision colour cache rather than re-declared per draw
  call. That migration needs canvas E2E coverage over artwork, so it is
  deliberately not bundled with the token-plumbing repair.
- `packages/editor/src/canvas/pageDecorations.ts` carries
  `FALLBACK_COLORS` literals that are only reached when `getComputedStyle`
  returns nothing. They are dead in practice but remain a silent-literal
  hazard of the same class the usage audit now blocks elsewhere.
- `--z-*` (legacy z-index) and `--radius-sm/md/lg/xl/2xl` compatibility names
  remain in use alongside `--elevation-z-*` and the semantic radius scale.
  Both are layout, not colour, and are tracked by `audit:radius`.
- Px-based component geometry intentionally does not scale with the UI
  font-size preference (see `interface-sizing-system.md` §Font size).
