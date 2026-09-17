# Interface density and UI font size — research and baseline (2026-09-17)

**Date of research:** 2026-09-17 (repository docs verified same day; external
sources checked same day).
**Companion ownership record:**
[`../agents/interface-density-2026-09-17-ownership.md`](../agents/interface-density-2026-09-17-ownership.md)
**Contract updated:**
[`../architecture/interface-sizing-system.md`](../architecture/interface-sizing-system.md)

## 1. Problem statement (measured)

The repository already contains a density contract —
`packages/ui/src/components/components.css` defines
`[data-density="compact"|"comfortable"|"cozy"]` blocks (added 2026-07-05,
"Phase 2b: Neo-Bento CSS primitives + density controls") — and the Layers
panel consumes `--density-rows-*` with `:root` fallbacks. But:

1. **No runtime surface ever sets `data-density`.** The root dataset was
   `null` in the baseline run, so the `:root` comfortable block silently
   applied everywhere. The Layers audit of 2026-09-15 recorded "compact
   density keeps its 28 px rows" as a *decision*, but no user can reach that
   density: the preference did not exist.
2. **"UI font size" is a dead preference.** `settings.appearance.fontSizeUI`
   is stored, rendered as a Select in Settings ▸ Appearance
   (`SettingsDialog.tsx:602-609`), and applied by nothing — no consumer
   reads it anywhere in the repo. This is the §5 "visible entry point with no
   wiring" defect class.
3. **The virtualizer estimate disagrees with reality.** `LayersTree.tsx:547`
   hardcodes `estimateSize: () => 28` while comfortable rows render at
   37.8px measured (34px min-height + content growth). `measureElement`
   corrects after mount, but every estimate-driven scroll computation (jump
   to index, overscan bounds before remeasure) starts from the wrong number.

### Baseline measurements (real Chromium 1.62, isolated port 1520, 1440×900)

| Probe | Value |
|---|---|
| `documentElement.dataset.density` | `null` |
| `--density-rows-min-height` resolved | `34px` (comfortable `:root` block) |
| `.layers-row` rendered height | `37.8px` (min 34px + content) |
| Row gap / padding | `2.96px` / `5.92px 2.96px 5.92px 5.92px` |
| Row font size | `14.72px` (`--font-size-sm` at 16px root) |
| Virtualizer spacer for 2 rows | `76px` (≈ measured 38px × 2, post-remeasure) |
| `estimateSize` | `28` |

Screenshots: `/tmp/opencode/density-baseline/baseline-editor-default.png`,
`baseline-settings-appearance.png` (copied to
`docs/screenshots/2026-09-17-interface-density/` with the evidence commit).

## 2. External evidence (checked 2026-09-17)

| Source | Finding | Type |
| --- | --- | --- |
| Figma Forum, UI3 feedback threads (2024–2025, rechecked 2026-09-17) | The strongest recurring complaints about a density-adjacent redesign are not "too few controls" but (a) unstable vertical positions of familiar controls, (b) values hidden behind hover/synonyms ("Fill/Hug" hiding width/height), (c) sub-scale text/targets ("everything is so small"), and (d) extra clicks for ordinary operations. Users consistently ask for a *choice* ("allow this to be configurable") rather than a single enforced arrangement. | User reports (first-hand, forum) |
| Figma, "Our approach to designing UI3" (2024-10-01) | Figma deliberately reduced chrome and then **reversed** specific density decisions after feedback (floating side panels, hidden blend-mode text). Confirms that density reductions are reversible product decisions, not one-way facts. | Official product communication |
| Google Design, "Better, easier, emotional UX" (M3 Expressive research) | Expressive changes measured *worse* on task performance when familiar structures/text labels were removed; expressiveness is not a usability argument by itself. | Research summary (Google) |
| WCAG 2.2 SC 1.4.10 Reflow / 1.4.4 Resize Text | Text enlargement must not break layout or functionality; the interface must remain usable at enlarged text. Varve already covers 200% browser zoom in E2E (`toolbar-followup.spec.ts`), but an in-app enlargement preference was stored without effect. | Standard |
| WCAG 2.2 SC 2.5.8 Target Size (Minimum) | 24×24 CSS px minimum; dense rows do not get a spacing exception when the row gap is 0. The Layers panel already enforces `--target-min-compact: 24px`. | Standard |
| Linear / Figma density practice (as referenced by the existing `components.css` comment "Research basis: Linear compact/comfortable/cozy") | Density switches are row-geometry contracts, not separate re-implementations: one attribute, token-driven values. | Design-system reference |

Interpretation limits: forum reports are self-selected and product-specific;
they are evidence of failure *modes*, not prevalence. Varve translations are
proposals validated against Varve's own workflows below.

## 3. Decisions

### D1 — Two modes, not three

Ship **Default Pro** (the current comfortable contract) and **Compact Pro**
(the existing `compact` block). The `cozy` block stays in the shared CSS for
website/card surfaces but is not exposed in the editor: three choices with no
demonstrated need add decision load, and the prompt's own hypothesis values
(24–28px rows) are covered by the compact block at 28px rows.

Internal values stay `'default' | 'compact'`; the DOM attribute maps to the
existing CSS contract values (`comfortable` / `compact`) so no token or
consumer CSS changes.

### D2 — One application path, reused for the dead preference

A single module (`settings/interfaceDensity.ts`, modeled on
`context/reducedMotionManager.ts`) owns root application:

- `applyInterfaceDensity` sets `document.documentElement.dataset.density`;
- `applyInterfaceFontSize` sets (or clears) the root `font-size` inline style
  (small 15px / medium —browser default 16px— / large 18px); rem-based
  tokens (`--font-size-*`, `--space-*`) scale with it, px-based component
  geometry intentionally does not;
- `SettingsProvider`'s effect applies on mount and on change — this wires the
  density control **and** finally activates the existing "UI font size"
  control through the identical path. Reset flows through the same effect.

### D3 — No flash, same pattern as theme

`apps/desktop/index.html`'s pre-paint script (which already resolves the
theme before first paint) also reads `appearance.uiDensity` and
`appearance.fontSizeUI` from `varve-editor-settings` and applies both before
first paint. Unknown values normalize to the defaults; localStorage failures
are swallowed exactly like the theme script's.

### D4 — Virtualization is density-aware, measured-first

`LayersTree` reads the density through a subscription hook:
`estimateSize` returns the mode's row-height contract (compact 28, default
34) and a `useEffect` calls `virtualizer.measure()` when the mode changes, so
no stale cached height or anchored scroll survives a switch. `measureElement`
remains the authoritative per-row measurement.

### D5 — Touch accommodation stays device-derived

The prompt asks for an explicit touch accommodation "where needed". One
already exists and is deliberately **not** a setting: `@media (pointer:
coarse)` promotes interactive minimums to `--touch-target-min` (44px) and the
toolbar gates touch affordances via `useHasTouchInput`. A manual override
would change dimensions whenever a hybrid device's pointer class changes —
the exact "unpredictably resizes on hybrid devices" failure the workstream
warns against. Decision: keep the media-query route; document it; do not add
a second input-accommodation axis this pass.

### D6 — Density is an application preference, not document state

Like theme, density lives in `EditorSettings.appearance`, never in the
document, and must not create undo entries or dirty the file. Covered by an
E2E assertion (document stays clean; undo history unaffected).

## 4. Acceptance tests (from the prompt's scenario table)

Scenario "Change density during layer navigation" (§9) plus the
"Save/reopen" scenario drive the E2E spec: a deep tree with a scrolled,
selected item; switch modes; selection, scroll context, focus, and the
virtualizer's geometry must follow; the document must remain unmodified; the
preference must persist across reload; Reset to defaults must restore both
modes; and the UI font size control must measurably change interface text
(closing the dead-preference defect).

Explicit non-goals: no third density, no per-workspace density, no
auto-density that reacts to panel width, no expression of density in document
JSON, no new dependency.
