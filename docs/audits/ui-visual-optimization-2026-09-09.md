# UI and visual optimization audit — 2026-09-09

Status: implementation checkpoint on `master`

This is the current-state record for the UI and visual-design optimization
pass requested on 2026-09-09. It complements the durable design-system
contracts in [`docs/design/design-principles.md`](../design/design-principles.md),
[`docs/design/visual-direction.md`](../design/visual-direction.md), and the
interface sizing contract in
[`docs/architecture/interface-sizing-system.md`](../architecture/interface-sizing-system.md).

## A. Repository UI map

| Surface | Entry point | Styling source | Visual verification |
|---|---|---|---|
| Desktop/web editor shell | `apps/desktop/src/main.tsx`, `packages/editor/src/Shell.tsx` | `packages/ui/src/tokens/tokens.css`, `packages/ui/src/components/components.css`, `packages/editor/src/editor.css` and domain CSS | Playwright `tests/e2e/canvas/**`, menu/settings visual specs, deterministic screenshot harness |
| Home/workspace browser | `packages/home/src/HomeShell.tsx` | `packages/home/src/home.css` plus `@varve/ui` primitives/tokens | `tests/e2e/home/**`, home empty/populated fixtures |
| Shared primitives | `packages/ui/src/components/` | `packages/ui/src/components/components.css` and component CSS | Vitest component tests, stories, token/audit scripts |
| Marketing/documentation site | `apps/website/src/layouts/Layout.astro`, `apps/website/src/pages/` | `apps/website/src/styles/global.css`, `theme.css`, imported shared tokens | `apps/website/tests/e2e/`, website visual snapshots, static build |
| Product screenshot pipeline | `scripts/screenshots/`, `apps/website/src/data/screenshot-manifest.json` | Generated captures from the running editor | `pnpm screenshots:product`, manifest tests, website visual suite |

The desktop app and website share the token vocabulary and local font families,
but intentionally differ in density: the editor is a professional workspace;
the website uses the same color and type roles with more editorial spacing.

## B. Baseline evidence

Baseline captures were taken from the running local servers at 1440×900 (editor)
and 1280×720 (website), with a 390×844 narrow website pass attempted using the
Chromium browser profile. The following compositions were inspected directly:

- Home empty state: clear shell, but the active sidebar item is the strongest
  filled surface in an otherwise quiet layout.
- New Design dialog: the advanced-settings summary has insufficient separation
  between its label and current-state hint; this is a P1 clarity defect.
- Editor empty state: the canvas is correctly dominant, with compact menubar,
  layers rail, inspector, floating tool rail, and status bar using the shared
  token system.
- Marketing homepage: strong editorial hero and real product screenshot; the
  product screenshot frame still uses generic three-dot window chrome.
- Marketing Layers page: consistent type and surface language, but the page
  should continue to frame product UI as the same system shown in the app.

The baseline command was:

```bash
pnpm exec playwright screenshot --device='Desktop Chrome' \
  --wait-for-timeout=3000 http://localhost:1420/ /tmp/varve-ui-baseline/desktop-home.png
pnpm exec playwright screenshot --device='Desktop Chrome' \
  --wait-for-timeout=3000 http://localhost:4397/ /tmp/varve-ui-baseline/website-home.png
```

The New Design and editor captures were taken after opening the real dialog and
creating a real empty document through Playwright. They were visually inspected,
not treated as proof merely because the browser completed the capture.

## C. Prioritized audit

| ID | Issue / location | Evidence and consequence | Severity | Root cause | Implementation |
|---|---|---|---|---|---|
| UI-01 | New Design advanced summary, `packages/home/src/home.css` | “Advanced settings” and the current intent/color hint visually concatenate in the real 1440×900 dialog capture | P1 | Inline flex summary has no explicit visual divider or spacing contract | Fixed in this pass with a separated summary treatment and narrow-layout wrapping |
| UI-02 | Home active navigation, `packages/home/src/home.css` | Active Recent row carries a high-saturation filled treatment that competes with the primary empty-state action | P2 | Selection treatment was inherited from an accent-filled navigation pattern | Fixed in this pass with a quieter wash plus a persistent accent rail |
| UI-03 | Home file thumbnail controls, `packages/home/src/home.css` | Drag handle and type badge use translucency/blur while the adopted application surface model is opaque | P2 | Legacy “glass” treatment survived the opaque-surface migration | Fixed in this pass with opaque token-backed surfaces |
| UI-04 | Marketing product screenshot frame, `apps/website/src/components/ProductShowcase.astro` | Generic desktop-window dots make the real application capture feel like a mockup | P2 | Showcase wrapper predates the current product-chrome direction | Fixed in this pass with a Varve workspace frame and status treatment |
| UI-05 | Editor domain controls, `packages/editor/src/components/Inspector/` and Layers | Inline/domain controls remain a known migration area even though the visual language is mostly coherent | P2 | Specialized editor widgets predate some shared primitives | Partially addressed: Inspector field containment, responsive control sizing, and canonical one-location property editing are covered; Tree/Combobox ownership work remains deferred |
| UI-06 | Website feature page composition | Feature pages are visually consistent but have no shared product-frame primitive for domain screenshots | P3 | Each page owns its screenshot framing locally | Deferred; candidate for a later Astro component extraction |

## D. Design direction adopted

The existing Varve direction is retained and made more explicit:

- **Work-first density:** the canvas and document content remain the dominant
  visual surface; editor chrome stays compact and measured.
- **Quiet structure, strong state:** use opaque elevation surfaces and 1px
  micro-borders for structure; reserve teal for actions, selection, focus, and
  meaningful current-state indicators.
- **Readable summaries:** a control label and its current state are separate
  pieces of information and must have intentional spacing, alignment, and
  truncation behavior.
- **One geometry vocabulary:** controls, menus, dialogs, cards, and panels use
  the existing compact/default/large heights and semantic radius/elevation
  tokens.
- **Product-truth marketing:** the website shows real captures and frames them
  as Varve workspace surfaces rather than generic SaaS or operating-system
  mockups.

This is a refinement of the existing Neo-Bento × Linear hybrid, not a new
framework or visual skin.

## E. Component consolidation and access map

| Category | Canonical owner | Duplicates / debt | Decision |
|---|---|---|---|
| Buttons and icon buttons | `@varve/ui` `Button` / `IconButton` | Local home and editor buttons remain for domain-only affordances | Keep shared primitives; migrate only equivalent controls |
| Dialog shell | `@varve/ui` `Dialog` | Domain content remains local | Keep one shell; fix content anatomy at the owning surface |
| Menus/popovers | `@varve/ui` `Menu`, `ContextMenu`, `Popover` | Specialized canvas overlays remain specialized | Preserve shared geometry/ownership contracts |
| Panel/layout surfaces | `@varve/ui` `Panel` plus editor panel CSS | Layers/Inspector need domain-specific tree/forms | Keep domain composition; use shared tokens for chrome |
| Home file cards | `@varve/home` file card recipe + `.bento-cell` | No new card variant introduced | Keep card visual hierarchy, remove translucent legacy surface treatment |
| Marketing product screenshots | `ProductShowcase.astro` | Feature-page screenshot blocks are separate and intentionally deferred | Improve the homepage frame now; extract later when requirements converge |

## Inspector follow-up — 2026-09-09

The deferred inspector slice now has a bounded implementation. A single selected
node exposes X, Y, W, H, Opacity, and Fill in the canonical Design/Properties
sections. The controls reuse the existing setters and binding presentation,
keep image dimensions proportional like the full Layout section, and remain
selection-aware for empty and mixed selections. Their presentation uses the
existing token and input-field grammar: compact controls, quiet separators,
keyboard focus rings, and a focused colour editor.

The implementation keeps one authoritative editing location per property. This
avoids introducing a second state model or duplicate geometry, opacity, and
fill controls while retaining the existing command and binding paths.

Evidence: `tests/e2e/inspector/quick-properties.spec.ts` verifies the real
browser flow, canonical X synchronization, absence of the duplicate surface,
empty/mixed-selection behavior, and the focused visual snapshot. `tests/e2e/inspector/control-layout.spec.ts`
audits inputs and dropdowns at 240, 320, 480, and 640px rail widths. The
repository-wide visual gate remains an integration check.

Important existing commands retain their current access paths:

- New/Open/Import: home toolbar as primary access; command/keyboard paths remain
  accelerated access; no duplicate business logic is added.
- Layers/Inspector: persistent editor panels as primary access; context menus,
  shortcuts, and command surfaces remain contextual/accelerated access.
- Export and workspace switching: existing menubar/action registry remains the
  canonical execution path.

## F. Implemented groups

### Group 1 — home/dialog visual clarity

- Added explicit spacing and a divider treatment between the Advanced settings
  label and its state hint.
- Allowed the summary to wrap cleanly at constrained widths without changing
  the dialog state model or keyboard behavior.
- Changed active home navigation to use a semantic accent wash and edge marker,
  preserving `aria-current` and the selected state.
- Replaced thumbnail-control translucency with opaque token-backed surfaces.

### Group 2 — marketing product framing

- Reframed the homepage product screenshot chrome as a Varve workspace surface.
- Kept the existing manifest-driven real screenshot, alt text, dimensions, and
  loading behavior intact.
- Preserved the website’s shared font/token imports and responsive layout.

## Inspector follow-up — section manager (same day, second pass)

A focused re-audit of the Inspector's section-manager popover
(`SectionManagerTrigger`), reported directly from a running session rather
than found by screen-scanning, turned up two real defects distinct from the
UI-05 responsive-containment work above:

1. `.insp-panel__header` was defined twice in `inspector.css` (once near the
   top of the file, once under a later "Panel header" section). The later
   rule won the cascade for the properties it redeclared but silently
   dropped the first rule's horizontal padding, leaving the section-manager
   gear button flush against the scrolling panel's own scrollbar track
   instead of clear of it — a real, reported click-target defect, not a
   cosmetic one.
2. `.insp-section-manager__label` had no overflow containment. In the
   popover's fixed 280px width, a longer section title ("Align &
   Distribute") wrapped to two lines while its sibling category badge and
   "required" flag stayed single-line and vertically centered against the
   row's now-taller height, reading as overlapping text.

Fixed by consolidating the header rule with a right inset matching the
content padding immediately below it, and giving the label the same
ellipsis-truncation-plus-tooltip treatment used for row names elsewhere in
the app (`Tooltip ... truncationOnly`). Verified with
`tests/e2e/inspector/section-manager-visual.spec.ts`, which asserts a
positive gear-to-scrollbar inset and a single-line row height; confirmed
failing pre-fix (0px inset, reproduced by reverting only the two changed
files) and passing post-fix. The existing `section-management.spec.ts`
suite (8 scenarios) and `SectionManagerTrigger.test.tsx` (2 tests) pass
unchanged.

A broader visual sweep of a real single-selection state (default width,
240px narrow width, dark theme) found the panel otherwise coherent — Quick
properties, Fill, Align & Distribute, and Layout all render cleanly at each
width and theme, consistent with the UI-05 responsive-containment work
landed earlier the same day. No marketing surface depicts this popover (no
`/features/inspector` page exists, and the one Inspector product screenshot
in the website manifest is a real, pipeline-generated capture rather than a
hand-coded mock), so no marketing change was needed for this fix.

## Inspector follow-up — Layer Effects and Corner Radius redesign (same day, third pass)

A design-inspiration pass (Figma/Sketch effect-stack and shadow-panel
references) targeted the two clearest, most-evidenced gaps against that
reference language: the Layer Effects row and the shadow-family parameter
layout it expands into, plus the structurally identical per-corner radius
quad.

### Baseline

Captured from the real running editor with a drop-shadow effect added and
expanded:

- The effect row was a flat, bottom-border-only strip carrying eight small
  icon buttons (expand chevron, reset, duplicate, an Eye/EyeOff visibility
  toggle, a square color swatch, the type label, two reorder chevrons, and
  remove) with no card container — reading as one continuous utility strip
  rather than a stack of distinct effects.
- `ShadowParams` spread X/Y, Angle/Distance, and Blur/Spread across three
  separate `InspectorFieldGroup` pairs down the column. In the fixed
  `--space-10` label column, "Distance" truncated to "Distan" — a real,
  reproducible clipping defect, not a hypothetical one.
- Opacity rendered as a raw 0–1 decimal ("0.3") instead of a percentage,
  unlike the established `unit="%"` + `value * 100` / `onChange(v / 100)`
  pattern already used elsewhere in the Inspector (e.g. `BrushSection`'s
  Stabilization field).
- `CornerRadiusSection`'s per-corner TL/TR/BL/BR fields used the same
  three-separate-pairs layout as the shadow quad.

### Delivered

- Two new shared, reusable primitives in `inspector.css`: `.insp-quad-grid`
  (a boxed 2×2 grid for grouping related numeric fields — shadow
  X/Y/Blur/Spread, per-corner radius) and `.insp-icon-field` (a small
  muted decorative icon ahead of a field's own visible label — the field
  keeps its text label, so the row stays legible without requiring the
  reader to have memorized icon meanings first, unlike a pure icon-only
  chip).
- `.insp-effect-row` is now a card (border, radius, raised surface) instead
  of a flat bottom-bordered strip; `.insp-swatch--round` gives the effect
  and glass-tint color swatches a circular face, matching the Figma/Sketch
  round color-chip convention.
- `ShadowParams`: X/Y/Blur/Spread now render as one boxed `.insp-quad-grid`
  with `MoveHorizontal`/`MoveVertical`/`Focus`/`Expand` icon prefixes;
  Angle/Distance stay as Varve's own polar-coordinate alternative to the
  same X/Y pair, now positioned after the quad rather than interleaved
  with it; "Distance" no longer truncates (`displayLabel="Dist"`, full
  "Distance" name preserved for assistive tech); Opacity now reads as a
  percentage.
- `CornerRadiusSection`'s per-corner fields use the same `.insp-quad-grid`
  with `CornerUpLeft`/`CornerUpRight`/`CornerDownLeft`/`CornerDownRight`
  icons.
- `TypographySection`'s Line height and Letter spacing — previously two
  full-width stacked fields — now share one `.insp-quad-grid` row with
  `AlignVerticalSpaceAround`/`AlignHorizontalSpaceAround` icons, matching
  the paired treatment the reference material shows for this exact field
  pair. "Letter spacing" gets `displayLabel="Letter sp."` for the same
  truncation-avoidance reason as ShadowParams' "Distance".
- **Correction during implementation:** the effect row's visibility toggle
  was first built as a bespoke `.insp-switch` CSS component (track + thumb
  on a bare button). Before shipping it, a check of `TypographySection`'s
  imports surfaced that `@varve/ui`'s `Switch` component already exists and
  is already used throughout the Inspector via the exact convention
  `<Switch className="insp-switch" .../>` (`BackgroundRemovalSection`,
  `ColorizeSection`, `TypographySection`, `LensBlurSection`,
  `InteractionSection`) — and `Switch.css` already defines
  `.varve-switch.insp-switch` sizing overrides for this exact context. The
  bespoke implementation was deleted and replaced with the real shared
  `<Switch>` component, avoiding shipping a second, colliding definition of
  the same class name with a different DOM shape.

### Investigated, no change made

Two sections the reference material specifically called out were checked
against real running output and found to already exceed the reference's
own capability, not fall short of it:

- **`FramePresetsSection`** already renders a searchable, grouped preset
  picker (`@varve/ui`'s `PresetPicker`) with favorites, recents, and
  user-created custom presets (save/rename/duplicate/delete) — materially
  more capable than the flat categorized dropdown shown in the reference.
- **`SelectionColorsSection`** already deduplicates paints across the whole
  selection and shows role (Fill/Stroke/Text/…), reference count, and
  editability per group — information the reference's flat hex+opacity
  list does not surface at all. Its square swatch tiles (vs. the new
  circular effect-row swatches) are a deliberate, precedented distinction:
  a larger "swatch library" tile grid scales to many distinct document
  colors better than a vertical list would, the same reasoning Figma
  itself applies differently across its own swatch contexts.

Changing either to imitate the simpler reference would have been a
regression, not an improvement, so neither was touched.

### Blend-mode dropdown: consolidated and grouped

Checking every `BLEND_OPTIONS` call site (the reference shows a
Darken/Lighten/Contrast/Component-clustered dropdown; Varve's rendered as
one flat list) surfaced that `BLEND_OPTIONS` was independently declared
four times — `AppearanceSection`, `FillSection`, `EffectsSection`,
`SmartFiltersSection` — and had drifted: `FillSection`'s copy includes
Plus Darker/Plus Lighter that the other three lack, and
`SmartFiltersSection` uses a narrower `AdjustmentBlendMode` type. Merging
the option *lists* would require verifying each render path actually
supports every mode (a correctness question this pass could not safely
answer), so each site keeps its own list unchanged. What's shared instead
is a new `groupBlendOptions()` helper (`controls/blendModeOptionGroups.ts`)
that clusters any such list into the standard families and feeds
`Select`'s existing `groups` prop — already a proven, tested path (used
elsewhere by `NewFileDialog`/`NewDesignDialog`) that every call site had
available but none was using. An unrecognized value lands in a trailing
"Other" group instead of being silently dropped. Verified with 4 unit
tests for the helper and a live capture of the grouped dropdown (`Normal`,
`Darken`, `Lighten`, `Contrast`, `Comparative`, `Component` headers,
matching the reference's clustering).

### Effect-type picker: category icons

`EFFECT_TYPE_OPTIONS` (the "new effect" picker in `EffectsSection`) gained
`icon` fields, matching the reference's icon-per-type add menu — but
category-level, not one glyph per exact effect. The curated `SolidIconName`
set has no literal "blur" or "shadow" glyph, and Varve's model has 16
effect types where the reference examples show far fewer, so inventing a
distinct icon for each of the 9 blur variants would mean picking glyphs a
reader has no prior reason to associate with "Tilt-Shift Blur" specifically
vs. "Path Blur." Instead, effects that share a rendering family share one
icon (all 9 blur types get `CloudFog`; `dropShadow`/`innerShadow` share
`StackSimple`; `outerGlow`/`innerGlow` share `Sparkle`) and the label text
still names the specific variant. `chromaticAberration` gets `Rainbow` and
`glitch` gets `Lightning` (both literal, unambiguous fits); `glassMaterial`
is left without an icon rather than force a misleading pick.

While picking these, the first choice for the shadow icon
(`'SquareOffset'`, present in the curated `SolidIconName` type) turned out
not to exist in the installed `@phosphor-icons/react` version at all — a
pre-existing stale entry in that type union, not something introduced
here. `SolidIcon`'s own runtime fallback caught it (console warning +
empty placeholder rather than a crash), which is how it surfaced: the
EffectsSection test suite's stderr output. Replaced with `StackSimple`
(verified against the installed package's actual exports) and added it to
the curated `SolidIconName` union in `packages/ui/src/icons/SolidIcon.tsx`
— a stacked-square glyph is also a reasonable icon for other
"layered/offset" UI beyond this one picker.

### Explicitly deferred (not attempted this pass)

- Pairing Weight+Size into one row in `TypographySection` (per the latest
  reference image) — Line height+Letter spacing is now paired (above);
  Weight+Size is a bigger change (a `Select` and a `NumberField` sharing
  one row, rather than two `NumberField`s) and was not attempted this pass.
- Adding another opacity summary. The inspector now has one canonical,
  variable-binding-aware Appearance field; any future shortcut must reuse that
  display contract rather than introduce a second editor.
- `VariantBox`'s all-caps section title (noted in the Layers pass) remains
  the same kind of debt as the Selection Sets fix already applied there,
  in a different component outside this pass's scope.

### Verification

- `pnpm exec vitest run packages/editor/src/components/Inspector` — 602
  tests across 61 files, unchanged pass rate before and after the `Switch`
  correction.
- `tests/e2e/inspector/effects-shadow-redesign.spec.ts` — two scenarios:
  the effect row's card/switch/round-swatch/boxed-quad structure, and the
  corner-radius quad. Both confirmed passing against the real running
  editor.
- Screenshots of the expanded Drop Shadow row were captured and reviewed
  directly in light and dark themes, and of the per-corner radius quad, at
  each step of the implementation (bespoke switch, then the corrected
  shared-`Switch` version).
- `pnpm exec vitest run .../TypographySection.test.tsx` — 5/5, after the
  Line height/Letter spacing pairing (also covered by the 602-test run
  above, run after this change).
- `pnpm exec biome check` clean on all changed files.

## G. Residual design-debt register

| Item | Severity | Reason deferred | Next action |
|---|---|---|---|
| Inline editor Tree/Combobox controls | P2 | Requires focused primitive ownership and behavior migration | Build/test canonical Tree/Combobox adapters before styling migration |
| Shared Astro product-frame component | P3 | Current feature-page frames have meaningful content differences | Inventory frame anatomy after the next screenshot-pipeline refresh |
| Full cross-runtime visual matrix | P2 | Linux Chromium was available; native Tauri and macOS were not in this session | Run release/desktop visual lanes on their supported hosts |

## H. Verification record

The final implementation record is maintained below as commits land. Every
meaningful UI change must include the affected-package planner, targeted tests,
and a fresh browser screenshot that is visually inspected in light/dark and at
the relevant constrained width where the surface supports it.

### Implementation and evidence

The scoped changes were delivered as three commits on `master`:

- `579caf25` — documented the repository UI map, baseline evidence, direction,
  access map, audit priorities, and residual debt.
- `0c32bedfc` — clarified home navigation, thumbnail controls, and the New
  Design advanced-settings summary.
- `5c3dc1c29` — reframed the marketing product screenshot as a Varve workspace
  surface while preserving the real manifest-driven capture.

Commands run for this pass:

```text
pnpm verify:plan
pnpm exec vitest run packages/home/src/NewDesignDialog.test.tsx --reporter=verbose
pnpm exec stylelint packages/home/src/home.css
pnpm --filter @varve/website typecheck
pnpm build:website
pnpm verify:affected
pnpm audit:docs
pnpm audit:emoji
```

Passed evidence:

- New Design dialog tests: 14/14.
- Website Astro check/typecheck: 0 errors, 0 warnings, 5 hints.
- Website static build: 79 pages built successfully.
- Docs audit: clean; emoji audit: clean.
- The staged commit checkpoints passed format, lint/health, impact-config,
  secret, contact, emoji, and docs checks.
- Fresh Playwright captures were visually inspected at desktop and narrow
  widths for the home/dialog surfaces, and at desktop, narrow, light, and dark
  themes for the marketing product frame. Evidence is retained in
  `/tmp/varve-ui-after/` during this session, including
  `new-design-dialog-light.png`, `new-design-dialog-narrow-2.png`,
  `home-empty-light.png`, `website-showcase-2.png`,
  `website-showcase-mobile-2.png`, and `website-showcase-dark-2.png`.

`pnpm verify:affected` selected the website/shared affected closure and
reported 188/192 website tests passing. Its four failures are pre-existing
fixture drift from concurrent schema work in the shared worktree: the committed
website demo `.varve` fixtures remain at format `2.22` while the concurrent
scene changes emit `2.23`. Those fixtures were not regenerated or staged as
part of this visual pass. Native desktop GUI, full visual regression, Rust
workspace, benchmark, packaging, and release lanes were deferred by the commit
checkpoint because they are outside the changed UI slice; the concurrent
worktree changes should receive their own affected validation once stabilized.
