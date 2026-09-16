# Object Filters Inspector UI/UX Review & Redesign (2026-09-15)

**Task:** Complete review, competitive analysis, redesign, marketing alignment, and verification of the Object Filters section in the Inspector panel (`SmartFiltersSection`).
**Working Branch:** `master`
**Companion Files:**
- Catalog Taxonomy & Icons: `packages/editor/src/components/Inspector/sections/smartFilterCatalog.ts`
- Section Component: `packages/editor/src/components/Inspector/sections/SmartFiltersSection.tsx`
- Styling & Layout: `packages/editor/src/components/Inspector/sections/smartFilters.css`
- Vector Finishing Actions: `packages/editor/src/components/Inspector/sections/VectorFinishingQuickActions.tsx`
- Marketing Pages: `apps/website/src/pages/features/image-treatments.astro`, `apps/website/src/pages/docs/tools/image-treatments.astro`

---

## 1. Executive Summary

The Object Filters section of the Inspector panel allows users to attach non-destructive procedural effect stacks to any renderable object (vectors, images, text, frames, and groups). Prior to this redesign, the interface exhibited several usability bottlenecks common in creative software: flat, unsorted select lists of 50+ items, indistinguishable filter stack rows, hidden blend mode and opacity states requiring full row expansion to inspect, no one-click whole-stack A/B toggle, and plain empty states.

Through competitive analysis of Photoshop, Affinity Photo, Figma, and Blender, we identified the key pain points creative professionals encounter with non-destructive filter stacks. We overhauled the Object Filters Inspector panel into a clean, intuitive, and tactile surface that eliminates hidden states, accelerates filter discovery through categorized and searchable menus, and provides immediate visual feedback.

---

## 2. Competitive Research & Real-World User Pain Points

The table below separates **observed product behavior** (verified against
vendor documentation, tutorials, and public forum threads) from the Varve design
response. Where a claim rests on a general UX principle rather than a specific
product complaint, it is phrased that way.

| Application | Observed failure & public complaint | Varve's response |
|---|---|---|
| **Adobe Photoshop** (Smart Filters) | *Hidden blending state.* Per-filter blend mode and opacity live behind a small "Edit Blending Options" icon that must be double-clicked; Adobe's own documentation describes the double-click, and third-party tutorials repeatedly note that users simply do not know the controls exist ("I'm surprised at the number of folks who don't know that Smart Filters also have blending options" — TipSquirrel). State applied months earlier is easy to forget. | **Live Row Badges:** non-normal blend modes (Multiply, Screen) and non-100% opacity are badged directly on the collapsed row, so a stale `Multiply @ 50%` can never hide. |
| **Affinity Photo** (Live Filter Layers) | *Long flat menus.* The New Live Filter Layer menu presents the whole filter catalogue as one long list with no inline search, and filters affect everything below them in the layer stack — a placement subtlety tutorials must repeatedly explain. | **Categorized & Searchable Catalog:** 52 filters grouped into 5 semantic families with inline search; the stack order is the single, explicit placement model. |
| **Figma** (Effects / Styles) | *No persistent visibility toggle.* Forum threads with sustained votes document that toggling an applied effect/style means removing or detaching it ("Ability to toggle visibility of applied Style without removing it", 2021; "Ability to toggle visibility for styles and variables", 2023), and mass removal across objects is blocked by the panel ("How to remove all Effects from many objects at once?", 2022). A 2025 feature request asks for quick effect access because applying effects "requires several clicks and searching in the right panel". | **Section Header Bypass + per-row eye:** one click disables the entire stack while keeping every entry (and its settings) intact; rows toggle individually without removal. |
| **Blender** (Modifier stacks) | *Nested-container fatigue is a general stacked-editor cost.* Deeply nested cards, collapsed disclosure triangles, and small drag targets are recurring usability guidance themes; there is no Varve-specific failure to copy here, only a pattern to avoid. | **Flat Row Layout & Distinct Affordances:** a single-level row with a dedicated grab handle, explicit selected/disabled styling, and no nested cards inside the stack. |
| **Generic vector apps** | *Photo filters on vectors are destructive or invisible.* Filtering a shape commonly rasterizes it or silently changes little, leaving users unsure whether anything happened. | **Tactile Vector Finishing Cards:** one-click Grain / Vignette / Highlight Glow presets tuned to be visible on flat fills, applied as non-destructive stack members so paths and fills stay editable. |

**UX research grounding.** General filter-UI research (UXPin, "Filter UI and UX
Design", 2026) recommends a search field once a category exceeds roughly 10–15
options and progressive disclosure for advanced controls; the Object Filter
catalog applies both (52 searchable options; raw stack/photo-local filters shown
after the curated quick actions).

**Primary sources consulted**
- Adobe: *Apply Smart Filters* — editing blending options via the double-click icon.
- Photoshop Essentials: *Smart Filter Blend Modes and Opacity* (2012) — documents the icon-not-name interaction.
- TipSquirrel: *Blending Options for Photoshop Smart Filters* (2013) — the discoverability complaint above.
- Figma forum: threads 20336, 26426, 14713, 45138 (visibility toggles, mass removal, quick effects).
- Digital Camera World: *Master Live Filters in Affinity Photo* (2020) — flat menu and stack-position behavior.
- UXPin: *Filter UI and UX Design* (2026) — search-within-list and progressive-disclosure guidance.

---

## 3. Architecture & Key Enhancements

### 3.1 Categorized & Searchable Catalog (`smartFilterCatalog.ts`)
All 52 `SMART_FILTER_KINDS` (the engine `ADJUSTMENT_KINDS` list) are mapped into
5 intuitive categories, in this order:

- **Color & Tone (19 kinds):** Brightness, Contrast, Exposure, Levels, Curves,
  Saturation, Hue / Saturation, Hue Rotate, Vibrance, Color Balance, Temperature,
  Tint, Selective Color, Invert, Black & White, Grayscale, Sepia, Opacity,
  Threshold.
- **Blur & Detail (6 kinds):** Blur, Motion Blur, Sharpen, Surface Smooth,
  Micro Detail, Definition.
- **Texture & Finishing (10 kinds):** Grain, Vignette (`edgeFalloff`), Highlight
  Glow (`softBloom`), Halftone, Color Halftone, Dither, Posterize, Mosaic,
  Edge Ink, Palette Snap.
- **Atmosphere & Optics (10 kinds):** Bloom, RGB Split, Light Shafts, Lens Flare,
  Light Leak, Caustics, Atmosphere, Dehaze, CRT, VHS.
- **Color Grading (7 kinds):** Gradient Map, Duotone, Tritone, Channel Mixer,
  Photo Filter, Shadow / Highlight, LUT.

The mapping is exhaustive by construction: `buildSmartFilterGroups()` filters
each hard-coded family against the live kind set, then appends any future or
unassigned kind under **Other Effects**, so a new engine filter can never become
unreachable. Each kind is assigned a semantic Phosphor icon (`Drop`,
`Crosshair`, `GridFour`, `Sparkle`, `Palette`, `CircleHalf`, `Faders`) displayed
alongside its name in the stack row. The shared `Select` renders its search
field automatically for option lists above 10 entries, so the 52-entry catalog
is always searchable (placeholder "Filter options…", accessible name
`Filter Add Object Filter`).

### 3.2 Inspector Header Status & Whole-Stack Bypass
- Active filter count pill: `.smart-filters__count-badge`, `role="status"`,
  `aria-label="X active filter(s)"`; rendered only when the stack is non-empty.
- Whole-stack visibility toggle: `.smart-filters__stack-visibility`, labelled
  `Disable all Object Filters` / `Enable all Object Filters` with
  `aria-pressed`, disabled until the stack has at least one entry.
- Single click toggles `smartFiltersEnabled` on the object, enabling rapid A/B
  visual evaluation.

### 3.3 Visual Stack Rows & Muted State
- Selected row has an accent border (`border-left: 3px solid var(--color-interactive-selected-border)`) and elevated surface background.
- Disabled/bypassed filter rows use a sunken background, reduced opacity (0.65), and strike-through title to prevent confusion.
- Live badges on the row show:
  - Blend mode badge (e.g. `Multiply`, `Screen`) when blend mode is not `normal`.
  - Opacity percentage when `< 100%`.
  - Effect Studio provenance line (treatment name plus `· recipe member` / `· customized recipe`) beneath the filter name.
- Dedicated remove button (`.smart-filters__remove`) with danger hover highlight and accessible tooltip.

### 3.4 Compact Compositing Card
When a filter is selected, a card (`.smart-filters__compositing-card`) follows
the parameter controls and collects the stack-level compositing properties:
- Opacity slider with 0–100% range and live numeric input.
- Blend mode dropdown selector.
- **Reset** and **Duplicate** as compact 24×24 icon actions (accessible names
  preserved) on the card's label row, instead of a separate text-button row.

### 3.6 Clutter-reduction pass (2026-09-16)
A follow-up review removed competing treatments of the same information and
secondary chrome from the section without dropping any capability:

| Removed / changed | Why | Capability preserved by |
|---|---|---|
| Always-visible "Non-destructive" intro card | Repeated the same message on every render, pushed the stack below the fold | "Non-destructive" chip moved into the empty state, which also carries the non-destructive guidance sentence |
| "Advanced stack editor" hint while open | Described the open editor to people looking at it | Hint remains visible in the collapsed state, where it is informative |
| Object Finishing preamble paragraph and multi-line card copy | Duplicated the heading and card labels | Heading, one-line card descriptions, and a single hint line remain |
| Per-row stacked reorder chevrons at rest | Five controls per row made the stack noisy | Chevrons reveal on row hover/`:focus-within` for fine pointers; they stay in the tab order; touch pointers keep them always visible |
| Duplicate "100%" opacity readout, "Effect Opacity"/"Effect Blend" wording | The numeric input already shows the value; the card is already inside the effect | "Opacity" / "Blend" labels with the same accessible control names |
| Separate Reset/Duplicate button row | A third row of chrome in the card | Icon actions with `aria-label` and `title`, 24px targets |

### 3.5 Tactile Vector Finishing Quick-Actions
- Three quick-action cards (Grain, Vignette, Highlight Glow) styled as elevated
  button tiles with category icons, each carrying its calibrated preset
  (`grain` strength 35/scale 1/character 60; `edgeFalloff` strength -35/midpoint
  55/feather 65; `softBloom` strength 35/radius 20/threshold 0.35/softness 0.45).
- Maintains strict semantic `<fieldset>` and `<legend className="sr-only">Object finishing</legend>`.
- One-click adds a calibrated, immediately visible material finish without changing source fills or paths.
- Shown for non-image objects only; the photo-local hint steers image work to
  Image Tuning instead of implying flat-fill filters will do the job.

---

## 4. Verification & Audit Results

All results below were produced on 2026-09-16 against the committed state on
`master` (E2E on Chromium/Linux, one worker, isolated port).

| Audit / Test Gate | Metric / Target | Result | Status |
|---|---|---|---|
| **smartFilterCatalog unit tests** | taxonomy completeness (all 52 kinds reachable), icons, blend labels, unassigned-kind fallback | 5/5 passed | **PASS** |
| **SmartFiltersSection unit tests** | 15 tests: history transactions, range gesture, quick actions, presets, flat-fill hint, image exclusion, compact editor, recipe customization, unavailable future effects, curated collapse, badges, empty state | 15/15 passed | **PASS** |
| **PropertiesPanel Object Filters integration** | Object Filters hosted in the merged Design surface without the Studio gallery | passed | **PASS** |
| **Playwright E2E (`tests/e2e/canvas/smart-filters.spec.ts`)** | 17 scenarios: invert lifecycle (add/toggle/bypass/remove/undo), multi-filter stack, pointer drag reorder, frame filters, redesign-surface behaviour (catalog grouping/search/no-match, compositing Reset/Duplicate on a real photo, all three Object Finishing quick actions, chevron reveal contract, curated Effect Studio recipe collapse), real-world vector composition, real photograph workflow (catalog search, 65% + Multiply badges, Grain stack, full-canvas fingerprint bypass oracle, three-theme captures) | 17/17 passed | **PASS** |
| **Design System Tokens (`audit:tokens`)** | 201 color contrast pairs across light, dark, and high-contrast themes | 201/201 passed (WCAG 2.2 AA) | **PASS** |
| **Zero Emoji Gate (`audit:emoji`)** | 0 emoji or unauthorized pictograms across source code and styles | 0 violations (4,833 files scanned) | **PASS** |
| **Documentation Integrity (`audit:docs`)** | 0 broken links, naming drift, or unregistered ADRs | 964 docs, 527 links, 174 ADRs clean | **PASS** |
| **Marketing Website Build** | Static generation across all routes | 104/104 pages built; search index 101 pages / 1,070 anchors | **PASS** |

## 5. Visual validation record

Captured by the E2E scenarios above (`reports/` is gitignored; these are local
evidence artifacts). Each state was inspected at the inspector's default width
on Chromium/Linux:

| Artifact | State | Observed |
|---|---|---|
| `reports/smart-filters/photo-inspector-light.png` | Real photo + two-entry stack (Vignette 65% Multiply, Grain), light theme | Header count/eye intact; one-line "Advanced stack editor"; rows legible with badges; reorder chevrons not competing with the names; compact compositing card with icon actions |
| `reports/smart-filters/photo-inspector-dark.png` | Same state, dark theme | Selected-row accent, badge borders, and icon actions remain legible |
| `reports/smart-filters/photo-inspector-high-contrast.png` | Same state, high-contrast theme | Selected row uses the yellow high-contrast surface with black text; Multiply and 65% badges readable; no contrast collapse |
| `reports/smart-filters/photo-vignette-multiply.png` | Canvas after Vignette 65% Multiply + Grain | Real coastline photograph visibly vignetted and grained; object remains a transformable image node |
| `reports/smart-filters/photo-bypassed.png` | Canvas with the whole stack bypassed | Full-canvas fingerprint equals the untreated baseline; both stack rows and the count badge remain |
| `reports/smart-filters/real-world-inspector-panel.png` | Vector composition after quick-action + catalog workflow | Quick actions, stack rows, live Multiply badge, and compositing card all reachable in one scroll |

Visual review findings and resulting changes:

1. **First capture (pre-clutter pass)** showed the "Advanced stack editor"
   summary wrapping to two lines with its hint, a persistent intro card above
   the stack, and a third action row in the compositing card. These drove the
   clutter-reduction commits.
2. **Post-change captures** show the summary on one line, the guidance only in
   the empty state, and the compositing card at two rows (label+actions,
   control) per setting.
3. No theme-specific regression was found; the high-contrast selection surface
   remains readable with the new badges.

Known capture limitation: the Object Filters section is taller than the
inspector viewport, so element screenshots are stitched by Playwright and may
include neighbouring inspector content at the top of tall captures; the panel
region itself is correct in every artifact.

Functional contracts asserted directly by the same suite (not just pixels):

- The catalog renders all five group labels, narrows to the matching family on
  a query (`vign` hides `Blur & Detail` and the Blur option), and reports
  "No matching options" for a miss.
- **Reset** restores the parameter to its neutral default and the untreated
  photo pixels while keeping the row; **Duplicate** clones the entry in place
  without disturbing the original.
- Each of the three Object Finishing quick actions produces an immediately
  visible pixel change and removes cleanly back to the baseline.
- The reorder chevrons compute to `opacity: 0` at rest and `opacity: 1` on row
  hover and on keyboard focus, and the revealed control still reorders.
- An Effect Studio recipe shows the count and provenance notice, starts with
  the raw stack collapsed, and its named members stay toggleable — toggling
  one flips its provenance line to "customized recipe".
