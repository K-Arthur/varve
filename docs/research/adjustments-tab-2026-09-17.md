# Adjustments tab review — research and decision ledger (2026-09-17)

**Scope.** The Inspector's **Adjustments** tab and the dialogs it contains:
`AdjustmentsPanel` and the sections it composes (`Image Tuning`, `Image &
Vector`, `Background Removal`, `Colorize`, `AI Denoise`, `Depth Mask`, `Depth
Blur`, `Line Art`, `Generative Edit`, `Detect Text Regions`, `Recognize Text`,
`Identify Font`, `Frame Interpolation`, `Extract Palette`) plus the
adjustment-layer surface (`AdjustmentPanel`, `Adjustment Scope`, `Mask`, the
Add-adjustment dialog) and the vector path (`Adjustment Layer` access, `Effect
Studio` access, `Object Filters`, `Layer Effects`).

**Working state.** `master` @ `a06a0c02a` plus this session's uncommitted
changes; the tree already carried extensive uncommitted work from other
sessions (font pipeline, generative editing, effects, export surfaces, home
interface). Nothing outside the paths listed in the ownership record was
staged or modified.

## Research refresh (run at execution time)

| # | Source | Date read | Claim used | Confidence | Applies to | Response |
|---|---|---|---|---|---|---|
| S1 | Google Design, "Better, Easier, Emotional UX" (link in task) | 2026-09-17 (re-read) | Expressiveness research reports usability loss when familiar structure/labels are removed | Documented by product team; not independently reproduced | Whole Inspector | Do not remove established structure; fix units/copy instead of restyling |
| S6 | W3C "Understanding Target Size (Minimum)" | 2026-09-17 | 24×24 CSS px minimum, with exceptions for spacing; adjacent targets must be unambiguous | Normative | Dense rows (filter stack, scope target list) | Audited: stack rows ≥24 px, targets have visible labels; no change needed |
| S7 | W3C ARIA APG Spinbutton | 2026-09-17 | Spinbutton semantics: Arrow/Page stepping, no silent value rewriting | Normative | `NumberField` consumers | Adjustment layer opacity now uses the shared spinbutton contract with % units |
| S10 | W3C "Understanding Animation from Interactions" | 2026-09-17 | Motion must be suspendable; state must not depend on animation | Normative | Dialog/scroll behavior | No motion changes made; existing prefers-reduced-motion handling untouched |
| S11 | Playwright visual comparisons | 2026-09-17 | Rendering differs by environment; baselines are per-platform and diffs must be inspected | Vendor doc | E2E captures | Captures are written to `reports/ui-review/adjustments-tab-2026-09-17/`, not asserted pixel-exact |
| R1/R2 | `AGENTS.md`, `docs/quality/validation-strategy.md` | 2026-09-17 | Affected-scope validation, no default full suite | Repository policy | This change | `pnpm verify:plan` → affected closure; targeted vitest + E2E audit spec |

First-hand code/UI evidence gathered this session:

| # | Evidence | Method | Finding | Confidence |
|---|---|---|---|---|
| E1 | `AdjustmentPanel.tsx` vs `AppearanceSection.tsx` | source reading | Layer opacity in the Adjustments tab was a bare 0–1 field (`step 0.01`), while the Design tab's Appearance section and every effect-opacity row in the *same* panel use 0–100 %. At full opacity the panel displayed `1`; typing `50` was clamped to `1`. | Confirmed |
| E2 | `AdjustmentScopeSection.tsx` | source reading | The document-scope impact preview was a hand-rolled `div` overlay (`role="dialog"`, no `aria-modal`, no focus trap, no Escape, no backdrop dismissal) — the only modal in the Inspector not using the shared `Dialog`. | Confirmed |
| E3 | `AdjustmentScopeSection.tsx` | source reading | The same scope mode was labelled three ways: readout `Single Image` / `Explicit (0 targets)` / `Document`, selector `Single image` / `Multiple targets` / `Document (global)`, help row `Multiple explicit targets`. Counts used `target(s)`, `frame(s)`, `page(s)`, `adjustment(s)`. | Confirmed |
| E4 | `AdjustmentScopeSection.tsx` | source reading | A brand-new adjustment layer showed `EST. PIXEL AREA 0.0 MPix` directly above a warning that nothing is targeted — a zero-value readout that adds noise to the inactive state. | Confirmed |
| E5 | `AdjustmentPanel.tsx` | source reading | The selected filter's header repeated the `NN %` value immediately above the editable "Effect Opacity" field, and the panel carried two inline `style` attributes (`position: relative`, header percentage). | Confirmed |
| E6 | `AdjustmentPanel.tsx` | source reading | `aria-haspopup="menu"` announced on a control that opens a modal `Dialog` (the Add-adjustment picker). | Confirmed |
| E7 | `sectionRegistry.ts` vs section components | source reading | Section-title drift between the registry (section manager, availability) and the rendered section: registry `OCR / Recognize Text` vs component `Recognize Text`; registry `Extract Palette` vs component `Palette`. (`content-aware-fill` is a third, larger drift: component + Object menu say `Generative Edit`, registry + the CAF dialog title say `Content-Aware Fill` — left unchanged, see Decisions.) | Confirmed |
| E8 | `adjustment.css` | source reading | `.insp-select` was declared twice (here and in `inspector.css`); this copy was stale, and this stylesheet is only loaded when an adjustment component mounts, while `LayoutSection` (Design tab) consumes the class — the same "styles depend on session history" class of bug that `.insp-btn` had. `.insp-overlay*` rules became dead once E2's overlay was replaced. | Confirmed |
| E9 | `AdjustmentPanel` `Auto WB` | source reading | The abbreviated visible label had an `aria-label` but no visible/tooltip expansion, and its disabled state (no measurable preview) had no explanation. | Confirmed |
| E10 | `AiToolsHintSection.tsx` + `AdjustmentsPanel.tsx` + `PropertiesPanel.tsx` | source reading | The Photo-workspace gate added in `b91c5b862` (eleven AI sections require `workspaceMode === 'image'`) is bypassed by the Adjustments tab, which renders the AI cluster for any image selection in any workspace. The intended "switch to Photo mode" hint is only wired into the Properties composition. This is deliberate for quick-bar reachability (PropertiesPanel comment: Remove background / Upscale / Vectorize complete inside this tab in every workspace) but is not documented as an exception in `featureOwnership.ts`. | Partly confirmed (code paths); product intent inferred from two conflicting comments |
| E11 | `ImageEnhancementSection.tsx` | source reading | Four raw `<input type="number">` fields (Colors, Min area, Max paths, Alpha threshold) bypass the shared `NumberField`; `Number(value) \|\| default` silently rewrites a cleared field to the default, which the mission contract forbids. | Confirmed |
| E12 | running app (audit spec, 1280×720, light theme) | screenshot + DOM metrics | The Add-adjustment picker was a **modal** `<dialog>` 514×675 px: it dimmed the whole app (canvas included), covered the inspector, had no type-ahead, and its 25th item ("LUT") was clipped at the scroll edge. It also announced `aria-haspopup="menu"` while opening a dialog. | Confirmed |
| E13 | running app, axe-core 4.12 via Playwright | automated scan | `.insp-warning` ("No targets selected; this adjustment is currently inactive") renders `--color-feedback-warning` at 12.48 px on the light inspector surface: **3.12:1**, below the 4.5:1 AA threshold. The AA-safe `--color-feedback-warning-strong` token exists and is the convention elsewhere (`HistogramWidget`, `DocumentFontsPanel`, `vectorize.css`). | Confirmed |
| E14 | running app (audit spec, 20 rem inspector) | screenshot | "Affected targets" clipped to **"AFFECTED TARGET"** in the scope section; the label column is `white-space: nowrap` with `overflow: hidden` and the two-word label exceeded it. | Confirmed |
| E15 | running app (audit spec, vector selection) | DOM inventory of section identity | In the Adjustments tab's object-selection composition, **Layer Effects** rendered in legacy (sessionStorage) disclosure mode (`data-section-id` absent) while the same component in the Design tab is registry-managed (`sectionId="effects"`). Collapse/hide state therefore drifts between the two tabs and the section manager cannot reach the Adjustments copy. `Effect Studio` is legacy in both compositions with different IDs by design (compact access vs full gallery) and was left alone. | Confirmed |
| E16 | running app, axe-core 4.12 via Playwright (image selection) | automated scan | Two `.image-tuning__toggle` "On" buttons (Exposure, Contrast) measure **3.6:1** in the light theme. Root cause: `imageTuning.css` references three tokens that do not exist in `tokens.css` — `--color-accent`, `--color-focus`, `--color-warning` — so every one of those declarations falls back to a raw hex (`#0c8f8f`, `#62c9c9`, `#c98b36`). Seven usages total (batch line, preset hover border, two focus rings, two accent-color declarations, warning text). | Confirmed |
| E17 | running app (audit spec, empty state screenshot) | screenshot + copy grep | The Adjustments empty state instructs users to create an adjustment layer "from **Properties** or Object". There is no "Properties" in the UI: all eight workspace configs label the first inspector tab **Design**. The visible creation affordances are the Design tab's "Adjustment Layer" section and the Object menu's "New Adjustment Layer". | Confirmed |
| E18 | running app (audit spec, image scroll capture) | screenshot | In `Image & Vector`, the button "**Open Vectorize Dialog…**" (Title Case, names the implementation) sits beside "Enhance image…" and "Trace monochrome" (sentence case, task language); the dialog it opens is titled "Vectorize image". | Confirmed |

## Decisions

| # | Decision | Alternatives rejected | Reason |
|---|---|---|---|
| D1 | Layer opacity becomes a 0–100 % `NumberField` (`unit="%"`, `step 1`) converting to 0–1 on change | Keep 0–1; show "×" multiplier | One unit vocabulary in one panel; matches Appearance and the effect rows; removes the clamp trap |
| D2 | Impact preview moves to the shared `Dialog` (native modal, focus handling, Escape, backdrop rules, `AlertDialog`-consistent button roles) | Keep the overlay and add focus management | Repairing an ad-hoc modal duplicates an existing primitive; the shared one is already audited |
| D3 | One `SCOPE_MODE_LABELS` map feeds the readout, the selector and the dialog; counts are pluralized by a helper | Patch copy strings individually | Prevents the drift from recurring in the next edit |
| D4 | Hide the pixel-area row when nothing is targeted | Show `0.0 MP`; show `—` | The warning below already states inactivity; a zero readout is noise, and the estimate is meaningless with no targets |
| D5 | Remove the duplicated percentage in the filter-editor header; remove both inline styles | Keep header %, drop the editable field | The value stays visible in the editable "Effect Opacity" row directly below; the header duplicate added no information |
| D6 | ~~Add-adjustment trigger announces `aria-haspopup="dialog"`~~ **superseded by D11** | Keep the modal and re-announce it | Initial minimal fix; the running-app evidence (E12) then showed the container itself was the problem |
| D7 | Registry `ocr` title becomes `Recognize Text`; `PaletteSection` title becomes `Extract Palette` | Rename the registry entries instead; rename everything to match the dialog | The component title is what users see and the Object menu already says "Extract Palette"; renaming the component is the smaller, evidence-backed change. `content-aware-fill` was **left alone**: "Generative Edit" (menu + section) and "Content-Aware Fill" (dialog title + specs) are both load-bearing, and a cross-surface rename is a product decision with a much larger blast radius |
| D8 | Delete the stale `.insp-select` copy and the now-dead `.insp-overlay*` rules from `adjustment.css` | Leave the duplicate | Duplicate cascade winners are load-order dependent; `inspector.css` is the canonical, always-loaded owner |
| D9 | Wrap `Auto WB` in a `Tooltip` with `disabledReason` | Rename the button to "Auto White Balance"; leave as is | Keeps the compact row width while making the abbreviation and the disabled state discoverable |
| D10 | E10/E11 recorded as findings with recommendations, not changed in this slice | Fold them into this change | E10 is a documented product tension (quick-bar reachability vs Photo-mode gating) that needs a product answer, not a drive-by edit; E11 is a mechanical migration across four fields that deserves its own validated slice |
| D11 | The Add-adjustment picker becomes the canonical `@varve/ui` `Menu` (anchored popover) and the local modal, grid CSS, and hand-rolled arrow-key handling are deleted | Keep the Dialog with a smaller grid; make it searchable in place | E12: a modal dims and blocks the canvas exactly when a user is choosing a filter to preview; the shared Menu already provides focus-on-open, focus-return, Escape, outside-click, viewport-capped scrolling, and type-ahead — all of which the local picker either lacked or re-implemented. The five specs that targeted the old classes were migrated to role/name lookups (the same roles, so behavior coverage is preserved) |
| D12 | `.insp-warning` text switches to `--color-feedback-warning-strong` | Darken the base warning token; add a tinted badge background | E13: the `-strong` token is the repository's established AA-safe text variant; changing the shared base token would alter fills and borders across the app |
| D13 | "Affected targets" gets the established `--wrap` label treatment and "Estimated pixel area" becomes "Pixel area" | Shrink the label font; widen the label column | E14: the Inspector's answer to multi-word labels is wrapping, not smaller text; the shortened label stays truthful and keeps the row compact |
| D14 | `AdjustmentsPanel` renders `<EffectsSection sectionId="effects" />` | Leave legacy mode; give the Adjustments copy a new id | E15: the two compositions must share one section identity so collapse state, hide/show, and the section manager agree; a new id would perpetuate the drift under a different name |
| D15 | `imageTuning.css` swaps its seven undefined-token usages for the canonical ones: `--color-interactive-default` (accent text/borders/slider), `--color-interactive-focus-ring` (focus outlines), `--color-feedback-warning-strong` (warning text) | Add the missing tokens (`--color-accent`, `--color-focus`, `--color-warning`) to the token system; keep the raw fallbacks | E16: the tokens never existed, so the fallbacks were the real values — unthemed raw hex in a token-only codebase, and one of them fails AA in the light theme. Inventing new token names to match a typo would multiply the vocabulary; the canonical roles already exist |
| D16 | Empty-state copy points at the visible affordances: "create one from the Design tab or the Object menu" | Keep "Properties"; rename the tab back | E17: every workspace labels the tab "Design"; the empty state is the *only* place a new user is told where adjustment layers come from, so a dead destination name is a real recoverability problem |
| D17 | The Vectorize button becomes "Vectorize image…" | Keep "Open Vectorize Dialog…"; use Title Case | E18: matches the dialog title it opens and the sibling buttons' sentence case in the same section; "Dialog" is implementation language, not task language |

## Known limitations / not claimed

- No real screen-reader or touch-device session was run; keyboard and DOM/ARIA
  behavior were exercised in the running app and with axe.
- `content-aware-fill` naming drift remains (D7).
- The AI-cluster/Photo-mode tension (E10) remains.
- `ImageEnhancementSection`'s raw numeric inputs (E11) remain.
- Other warning-token usages in the same tab (`.colorize-section__stale`,
  `.smart-filters__unavailable`, `.font-detect-badge--plausible-match`,
  `.adj-lut-editor__warning`) were not independently measured against the
  light theme in this pass; only `.insp-warning` was (E13). They are the same
  class of risk and are recorded as follow-up.
- Font, localization, and RTL behavior of the changed strings was not
  re-evaluated beyond the existing constraints (no new hard-coded widths were
  introduced; the labels are English-only in this codebase today).
- The vector path's section rhythm fix (`.adjustments-object-panel`) was
  verified by construction (it now matches `.insp-panel`), not by a measured
  before/after capture.
- `EffectStudioAccessSection` keeps its own legacy disclosure id
  (`effect-studio-adjustments`) because it is a different component from the
  full `EffectStudioSection` in the Design composition; unifying those is a
  larger IA decision.
