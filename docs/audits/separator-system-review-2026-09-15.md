# Separator system review — all sections and components (2026-09-15)

**Scope:** every divider-like visual rule in both applications —
`packages/editor/src` (desktop editor) and `apps/website/src` (marketing site)
— plus the shared `@varve/ui` `Separator` primitive, menu separator recipes,
and the separator token layer.

**Method:** two read-only inventories (all CSS, Astro scoped styles, and
inline style objects), targeted external failure research, runtime probes in
Chromium (light/dark/high-contrast/forced-colors), rendered screenshots, and
regression specs. Evidence was collected before any implementation; the
"Remaining work" section of `docs/architecture/separator-system.md` is the
starting point.

---

## 1. Research ledger (checked 2026-09-15)

| Source | Type | Finding | Decision |
|---|---|---|---|
| [ARIA in HTML (W3C REC, 2026-08-11)](https://www.w3.org/TR/html-aria/) | Normative | `hr` has implicit `role=separator`; `none`/`presentation` are allowed overrides; explicitly setting `separator` is NOT RECOMMENDED | Keep native `hr` semantics; do not add redundant roles. Existing `role="presentation"` on the shared menu separator remains (allowed; menu-owned) |
| [MDN: separator role (2026-08-21)](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/separator_role) | Normative reference | Non-focusable separators are static structural elements; focusable separators need `aria-valuenow`; `aria-orientation` defaults horizontal | The three `role="separator"` splitters (Panel, PanelResizeHandle, PanelWidthDragEdge) are the only focusable ones and already follow the widget contract; decorative rules must not be tabbable |
| [MDN: forced-colors (2026-04-20)](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/forced-colors) + [CSS Color Adjustment](https://www.w3.org/TR/css-color-adjust-1/) | Normative reference | In forced-colors mode the UA forces `color`, `background-color`, `border-color`, `outline-color`, … ; author system-color keywords are honored, `forced-color-adjust: none` is the escape hatch | Separators drawn with `background` must be re-colored with system colors under `@media (forced-colors: active)`; do not use `forced-color-adjust: none` where a system color works |
| [Microsoft Edge blog — styling for Windows high contrast (2020-09-17)](https://blogs.windows.com/msedgedev/2020/09/17/styling-for-windows-high-contrast-with-new-standards-for-forced-colors/) | Platform guidance | Background images are reverted unless they contain `url()`; gradients are removed; author system colors override the forced value | `fade` and gradient-based rules need a forced-colors fallback; a `ButtonBorder`/`CanvasText` background survives |
| [Telerik Blazor splitter bug](https://www.telerik.com/forums/blazor-splitter-component-separator-has-accessibility-issues---separator-is-not-visible-in-aquatic-high-contrast-mode-or-in-desert-mode) | Vendor-confirmed user failure | "The Splitter resizers use a background color, which is removed by High Contrast mode… use borders as a workaround" | Direct precedent for Varve's background-based separators: invisible in High Contrast today |
| [Figma forum — divider/section separators in the property panel (2025-06)](https://forum.figma.com/suggest-a-feature-11/add-divider-or-section-separator-in-property-panel-41498) and [page/layer separator complaint](https://forum.figma.com/suggest-a-feature-11/the-separator-line-between-the-pages-section-and-the-layers-section-27552) | User complaints | Users ask for dividers in dense property panels; similar separators in different roles are "hard to distinguish" | Keep Varve's inspector group rules visible and role-appropriate; salience, not decoration |
| [Penpot community](https://community.penpot.com/t/some-feedback-after-not-so-extensive-penpot-testing/10043) and [Penpot page-separator PR](https://github.com/penpot/penpot/pull/8561) | User complaints + competitor implementation | "Removing unwanted lines and separations will always clean up the layout and reduce the noise"; their plain-divider PR flags the missing `role="separator"` | Do not add decorative separators; fix visibility and consistency of existing ones. Rules that are pure chrome stay container borders |
| [CSSWG csswg-drafts#3720 — `hairline` border-width](https://github.com/w3c/csswg-drafts/issues/3720) | Draft specification | A device-pixel `hairline` keyword is not shipped; 1px snapping across DPR is UA-defined and unspecified | Do not chase sub-pixel hairlines in CSS; keep the 1px `--separator-thickness` token |
| [Stripo — border thickness/blur (2026-05-28)](https://support.stripo.email/en/articles/13375235-border-thicknesses-are-not-the-same-or-why-do-the-lines-appear-blurry), [KDE discuss 150% scale](https://discuss.kde.org/t/1px-border-on-right-and-left-when-on-150-scale/14528) | Vendor + user reports | 1px rules render unevenly or blur at 125–150% OS scaling; browsers round 0.667–1.5 device pixels differently | Accept browser snapping; never use half-pixel widths or transforms to fake a hairline. Doubled adjacent rules must be removed (they compound the artifact) |

## 2. Verified inventory summary

Full inventories were produced for both apps (all files; no sampling).

| Application | Divider-like rules found | Structural (A) | Surface boundary (B) | Row/table rule (F/C) | Menu (C) | Affordance/splitter (D/E) |
|---|---|---|---|---|---|---|
| `packages/editor/src` | ~190 | ~45 | ~55 | ~60 | 4 recipes | 3 splitters + canvas/SVG marks |
| `apps/website/src` | ~120 grouped rules | ~30 | ~35 | ~20 | – | ~35 accent/artwork rules |

The shared primitive is used in production in two Inspector sections
(`ImageEnhancementSection`, `LensBlurSection` via `.insp-divider`). Every other
structural rule is still a container `border-*` declaration. That is not a
defect by itself: for one rule per boundary, container borders are cheaper than
an element per seam, and the separator-system doc already classifies shells,
virtualized rows, and surface boundaries as intentionally retained.

## 3. Prioritized issue register

### P1-1 — Separators are invisible in forced-colors mode (both apps)

`Separator.css` paints `solid` with `background` and `fade` with a
`linear-gradient`; `.varve-menu__sep` and `.editor-menubar__menu-sep` paint
with `background`. In forced-colors mode those channels are replaced by the
user's canvas color and gradients are reverted, so the rules vanish exactly
where the user asked for maximum contrast. The `dashed` variant survives
because it uses `border`.

Verified in Chromium with `forcedColors: 'active'` emulation; see §4.
**Affects:** `@varve/ui` Separator (all tones, solid + fade), UI menu
separators, menubar submenu separators, `.settings-divider`,
`.insp-separator`, `.timeline-playback-sep`, `.editor-menubar__divider`,
`.workspace-dock__divider`, and any other `background`-based rule.

### P1-2 — Four separator declarations paint nothing at all (invalid CSS) — FIXED

`--border-micro` is a full shorthand (`1px solid …`). Nesting it inside a
longhand produces `border-top: 1px solid 1px solid …` → invalid → **no line
paints**. Fifteen declarations were affected across the Mockups section,
Mockups panel, mockup surface overlay, and the Preflight warnings panel:

- `MockupsSection.css:52,74,102,192,210,243,254` (two of them separators)
- `MockupsPanel.css:71,105,141`; `MockupSurfaceOverlay.css:106`
- `PreflightWarnings.tsx:180,214,257,279` (inline styles)

Fixed to `border(-top): var(--border-micro)` / `borderTop: 'var(--border-micro)'`
(the established pattern used across the codebase). Runtime check:
fixed rule paints `1px`, the historical nesting paints `0px`
(`tests/e2e/theme/separators.spec.ts`). Static guard:
`packages/editor/src/components/__tests__/borderTokenShorthand.test.ts`
derives every shorthand token from `tokens.css` and fails on any nesting.

### P1-3 — Doubled separator seams

Two adjacent elements each drawing an edge, rendering a 2px seam (and
compounding fractional-DPR artifacts):

- `.editor__timeline-panel` `border-top` (`editor.css:2391`) over
  `.timeline-panel` `border-top` (`TimelinePanel.css:15`) — verified both
  apply to nested elements in `Shell.tsx`.
- `.context-control-bar` `border-bottom` + `.editor-tabs-row` `border-top`.
- High-contrast codegen: `.editor__codegen-panel` `border-left` +
  `.code-panel` `border-left` (HC override).

### P2-4 — Marketing homepage had a doubled section seam — FIXED

`ProductShowcase .showcase { border-bottom }` + the immediately following
`.interface-section { border-top }` rendered a 2px seam between the showcase
band and the interface section (verified: `showcase.nextElementSibling ===
.interface-section`). The showcase's bottom edge is removed; the band that
starts owns the boundary. Regression: `apps/website/tests/e2e/section-rules.spec.ts`
(exactly one of the two edges may draw). Homepage visual baselines
(`home-light`, `home-dark`, `home-mobile-light`, `home-mobile-dark`,
`showcase-light`) were updated after reviewing the diffs: the only change is
the removed 1px edge (element height 913 → 912).

### P2-5 — Website divider token drift — DOCUMENTED (token removal blocked)

- `--divider` is defined in light/dark/forced-colors blocks and asserted in
  `tokens.test.ts`, but has **zero consumers**. Removing it requires
  `pnpm test:website` to be green (the pre-commit checkpoint runs the touched
  test file), and that lane is currently red for unrelated pre-existing
  reasons — the site's own no-raw-colors test reports only the first offender
  per page, so it is green-gated behind cleaning up the mock-artwork palette
  across pages (including pages another session has dirty). Left in place and
  recorded; `--border-default`/`--border-subtle` remain the divider channels.
- Hardcoded border colors remain in `docs/tools/grids.astro:247,254,306,308,310,315`
  and `features/canvas.astro:534`. Inspection shows they are mock-artwork
  palette (simulated tool frames/guides), not content rules;
  `.layout-guide-section__note` (`#dd6d62`) is a content callout and is a
  legitimate candidate for `--brand-terracotta`, but the exact brand value was
  not verified in this session, so it is left documented rather than recolored.

### P2-6 — Vertical separator recipe drift (desktop)

Seven different recipes for the same "inline group rule" role:
`.editor-menubar__divider` (16px), `.workspace-dock__divider` (1rem/2px),
`.insp-separator` (18px), `.ccb__divider` (20px), `.selection-quick-bar__separator`
(20px + margin), `.floating-text-bar__separator` (20px), `.crop-toolbar__separator`
(24px). `FindReplaceBar.css:129-133` uses space tokens for a line
(`inline-size: var(--space-1)` ≈ 2.4–3.2px instead of 1px) — it reads as a
2–3px bar next to every 1px separator.

### P3-7 — Token fallbacks and duplicate definitions

- `var(--color-border-subtle, #2d3339)` / `#d8d8d8` fallbacks in
  `photoSource.css`, `imageTuning.css`, `ThumbnailPicker.css`.
- `editor.css:4955/4973/5003/5157` duplicate `TimelinePanel.css` selectors with
  equivalent-looking but HC-sensitive recipes (`--border-micro` vs the raw
  token). Cascade order decides; must be verified before removal.
- Inline text separators use four different colors (`--color-border-subtle`,
  `--color-text-muted`, `--color-text-muted-on-default`).

## 4. Runtime verification

Spec: `tests/e2e/theme/separators.spec.ts` (Chromium, real editor + disk-loaded
stylesheets). Reviewed captures: `docs/screenshots/2026-09-15-separators/`.

**Mechanism (verified).** Under `forcedColors: 'active'`, a background drawn
with an author color is replaced by the canvas color (`oklch(...)` →
`rgb(255, 255, 255)` on the light palette), a `linear-gradient` background
computes to `none`, and a background drawn with a system color keyword
survives — including when the value arrives through a custom property
(`--probe-token: CanvasText`). Borders are forced to `CanvasText` regardless.
This is the mechanism the fix relies on.

**Pre-fix state (verified).** The shared primitive's `solid` tone painted
`rgb(255, 255, 255)` (canvas) with no border, `fade` painted nothing at all,
and `.editor-menubar__menu-sep` painted the canvas color. `dashed` survived
through its border. Exactly the class of failure the Telerik splitter report
describes.

**Post-fix state (verified).** Light / dark / high-contrast app themes under a
forced-colors palette: `solid`, `dashed`, `fade`, `.varve-menu__sep`, and a
`background: var(--color-border-subtle)` rule each paint a channel distinct
from the canvas. Real editor journey (File menu open, four combinations of
light/dark/high-contrast × normal/forced-colors) passes with a visible,
full-width separator each time. Normal light/dark/high-contrast rendering is
unchanged (the light baseline test pins the subtle palette).

**Unverified.** Physical Windows Contrast Themes, Firefox/WebKit forced-colors
rendering, and native (Tauri/WebKitGTK) menus were not exercised. Playwright's
forced-colors emulation uses the browser's light/dark palette pair.

**Website.** `apps/website/tests/e2e/section-rules.spec.ts` passes in both
build variants; the updated homepage baselines were reviewed before
acceptance. `pnpm test:website` currently fails for reasons that predate this
session and are not separator-related: `demoDocuments.test.ts` reports all
four committed `.varve` fixtures stale (fixtures contain `formatVersion`
`2.27`, the working-tree writer emits `2.28`; regenerate with
`UPDATE_DEMO_DOCS=1 pnpm test:website` and review), and
`tokens.test.ts > pages/components/layouts contain no legacy or hardcoded
colors` flags two pre-existing artwork colors present in `HEAD`
(`features/canvas.astro` `background: #172126`,
`docs/tools/grids.astro` `color: #dce7eb`). Both are recorded here as
pre-existing red tests that block the website unit lane for every session.

## 5. Token generator drift (found while fixing)

`packages/ui/src/tokens/tokens.css` is generated by
`packages/ui/scripts/generate-token-css.ts`, but the committed file contains
hand edits the generator does not reproduce. Regenerating it during this
review produced a 411/384-line diff and, critically, **deleted
`--target-min-compact: 24px`** — a live WCAG 2.2 SC 2.5.8 token used by
compact controls (it exists only in the CSS; it was never added to
`src/tokens/sizing.ts`). This session added the token to `sizing.ts` (with its
rationale comment) so a future regeneration cannot drop it, hand-applied the
new forced-colors block to `tokens.css`, and made the matching generator edit.
The remaining drift (line wrapping, `0.2` vs `0.20`, comment placement) is
cosmetic but must be reconciled before anyone runs `tokens:generate` for real;
recorded as remaining work.

## 6. Remaining work (deferred deliberately)

- Reconcile `tokens.css` with `generate-token-css.ts` (line wrapping, `0.20`
  formatting, comment placement) so `tokens:generate` becomes a no-op again;
  the live-token deletion risk is already fixed.
- Vertical-recipe unification for the toolbar-family surfaces owned by the
  concurrent toolbar session (`FloatingToolbar`, `FloatingTextBar`,
  `ContextControlBar`, `SelectionQuickBar`, `CropOverlay`) — the audit records
  the exact drift; the surface owners should consume one shared recipe.
- `editor.css` vs `TimelinePanel.css` duplicate selector removal (cascade
  verification required; the duplicates currently provide the HC override).
- Editor doubled seams still open: `.editor__timeline-panel` +
  `.timeline-panel` both draw a top edge, and `.context-control-bar` +
  `.editor-tabs-row` both draw the bar boundary. Both need a runtime
  measurement in the Motion workspace and a shared-shell owner (the toolbar
  session was writing `editor.css` during this review).
- Website `prefers-contrast: more` handling (absent; `forced-colors` handled).
- Pre-existing website unit failures (stale demo `.varve` fixtures at schema
  2.27 vs writer 2.28; two raw artwork colors) block `pnpm test:website`;
  recorded in §4 rather than fixed here because they belong to other owners'
  work.
