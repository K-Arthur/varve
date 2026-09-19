# Inspector Design Tab — Pass-3 Report: Sentence-Case Hierarchy and Landing of the Pass-2 Units (2026-09-19)

> Deliverable report for the third 2026-09-19 Inspector Design-tab pass.
> Traceability ids resolve in:
> - `docs/research/inspector-design-tab-case-research-2026-09-19.md` (`RES-201`+)
> - `docs/audits/inspector-design-tab-audit-2026-09-19-pass3.md` (`IA-028`+)
> - `docs/design-system/inspector-spec-pass3.md` (`REQ` table)
> - Pass-2 corpus: `inspector-design-tab-audit-2026-09-19-pass2.md` (`IA-###`),
>   `inspector-spec-pass2.md`, `inspector-design-tab-research.md`
> Baseline evidence: `reports/inspector-redesign/baseline-matrix/` (git-ignored)
> Pass-3 evidence: `reports/inspector-redesign/pass3-matrix/` (git-ignored)

## 1. Executive summary

Pass 3 did two things.

**It removed the Design tab's block-capital treatment.** The maintainer
reported capital-letter overuse; the census confirmed it — 29
`text-transform: uppercase` declarations set *every* section title and
*every* property label in caps, plus micro labels, badges, legends, and
category chips, with no scoped rationale. All 29 are removed; 17 title/micro
rules moved from `--tracking-wide` to `--tracking-micro` with the caps. The
hierarchy now rests on size, weight, color, and card containment — all of
which already existed. The research says the case decision was never
evidence-based in either direction: all-caps can help *isolated glanceable
words* at small sizes (Arditi & Cho 2007; Sawyer et al. 2017), but it costs
word-shape recognition in scanning reading (Tinker; GOV.UK, GCA, and British
Dyslexia Association guidance), and the panel's transformed strings include
long phrases where the isolated-word case cannot apply. A new gate rule (E5)
blocks the return of block capitals without a recorded exception.

**It landed the pass-2 implementation that was sitting uncommitted.** The
pass-2 Phase-4 work (focus-ring geometry tokens, `--insp-*` component tokens,
label line-height unification, fixed-rem type ramp, gate E4/W2/W3/W4, and
Inspector-scoped literal-fallback removals) was validated and committed.
Units pass 3 did not complete are enumerated with reasons in §12.

## 2. Findings-to-fixes traceability

| Finding | Evidence | Requirement | Implementation | Validation |
|---|---|---|---|---|
| IA-028 block-capital overuse | 29-declaration census; baseline screenshots; maintainer report | spec-pass3 §1 (no uppercase; hierarchy without caps) | 29 declarations removed across 5 stylesheets; 17 tracking normalizations | pass3 `caseCensus` (0 uppercase roles); E5 gate; screenshot inspection |
| RES-201/202 case evidence | Arditi & Cho 2007; NN/g 2017; GOV.UK; GCA; BDA | same | same | research addendum |
| IA-002 label line-height split | pass-2 metrics (15 vs 16.2px) | spec-pass2 §1.4 | wrap modifier → `var(--type-interface-label-line-height)` | pass3 type census (one label key) |
| IA-018 focus geometry untokenized | pass-2 audit | spec-pass2 §3.2 | `--focus-ring-width` / `--focus-ring-offset-inset` + 66 consumption sites | gate clean; tokens 309/309; matrix screenshots |
| IA-019/021 row height, viewport-coupled type | pass-2 audit | spec-pass2 §1.2/1.3 | `--insp-row-height`, `--insp-icon-size(-lg)`, fixed-rem ramp | pass3 metrics |
| IA-022 raw font-size literals | pass-2 audit | spec-pass2 §6 (R10) | E4 rule + 4 literals fixed | gate clean |
| Inspector `var(--x, literal)` fallbacks | concurrent token-hygiene workstream | (adopted) | 4 TSX + satellite CSS files | `audit:tokens:usage` clean |

## 3. Research-informed decisions

**Adopted.** Sentence case for titles and labels (GOV.UK/BDA/GCA + word-shape
literature); hierarchy via size/weight/color rather than case; modest
tracking (`--tracking-micro`) retained on labels as a legibility aid.

**Rejected.** Keeping caps for short labels only (unenforceable in CSS,
reintroduces ambient casing); restoring small caps (BDA lists it with
uppercase); a user casing preference (same reasoning as pass-2's rejected
label-visibility toggle); removing the transform on non-Inspector surfaces in
this pass (Layers panel, ContextControlBar, SpecPanel have their own owners
and corpora — recorded as follow-up, §12).

## 4. Before/after evidence

- Before: `reports/inspector-redesign/baseline-matrix/` (pass-2 capture,
  05:11–05:25) + HEAD case census (29 declarations).
- After: `reports/inspector-redesign/pass3-matrix/` (same harness,
  `VARVE_MATRIX_PHASE=pass3`, heavy lease, isolated port).
- Computed proof: `caseCensus` in the pass-3 metrics records
  `text-transform` per role; 0 non-`none` transforms in all 48 captured
  states (27 light-rail + 12 theme + 9 text-scale; badge/hint/label/
  section/value roles). Text-scale label keys (12/18/24px at 100/150/200%)
  confirm the fixed-rem ramp still scales with root font size (IA-021).
- Typography deltas vs baseline: label census collapses to the single
  16.2px line-height key (the 45-label 15px wrap split is gone, IA-002);
  section tracking measures 0.26px vs 0.65px (wide → micro).
- Scroll budget (expanded worst case): within ±4px of baseline for
  no-selection/text/image states; ellipse@240 −173px and text@240 −25px
  from sentence-case copy that now fits one line. No state grew.
- Targets: 0 failing undersized targets under the SC 2.5.8
  spacing-exception harness.
- Representative comparisons: `shots/light-rectangle-320.png`,
  `shots/light-text-320.png`, `shots/light-image-320.png`,
  `shots/dark-image-320.png`, `shots/textscale-200-text-320.png` in both
  directories; the light-rectangle pair was inspected directly before
  committing.

## 5. Design-system changes

**New tokens (pass-2, landed here).** `--focus-ring-width` (2px),
`--focus-ring-offset-inset` (-1px) in `sizing.ts` → generated
`tokens.css`; `--insp-icon-size` (12px), `--insp-icon-size-lg` (14px),
`--insp-row-height` (`var(--target-min-compact)`) in the Inspector block.

**Changed tokens.** `--insp-label-size` → `0.75rem` (fixed);
`--insp-value-size` → `0.8125rem` (fixed) — no longer viewport-coupled.

**New rules.** Gate E4 (raw font-size), W2 (raw line-height inventory), W3
(icon off-step inventory), W4 (bespoke grid inventory), and E5 (block
capitals / `font-variant-caps`).

**Removed.** 29 `text-transform: uppercase` declarations; 17
`--tracking-wide` title/micro trackings normalized to `--tracking-micro`.

**Deleted one-offs.** None this pass.

## 6. Clutter reduction accounting

No function was hidden, moved, collapsed, or removed. The change set is
case and tracking only. Every affordance that existed at pass-3 start still
renders with the same reachability.

## 7. Accessibility results

- `audit:inspector-css` clean (including E5).
- `audit:tokens` (root): 309/309 WCAG-AA pairs across 3 themes +
  token-usage scan clean (556 properties; 9 documented hooks).
- `@varve/ui` typecheck pass; tokens unit lane 47/47.
- Target sizes: inherited pass-2 state has 0 failing targets under the
  SC 2.5.8 spacing-exception harness; pass-3 metrics re-check (see §9).
- Remaining limitation: screen-reader and real-device lanes not performed in
  this environment (honest gap, carried from passes 1–2).

## 8. Performance results

No performance work in this pass. The changes are declaration deletions and
tracking-value substitutions; no layout-algorithm change. The pass-2
performance probe numbers stand as the recorded baseline (no claim).

## 9. Real-world scenario validation

The matrix harness exercises imported still-life imagery, live text, frames,
groups, multi-selection, three themes, three rails (240/320/640), and
100/150/200% text scale. Additional realistic-content coverage (1k+ node
documents, RTL, long names) remains with the pre-existing corpus
(`design-tab-audit.spec.ts` and the export/masking corpora); pass 3 did not
add fixtures.

## 10. Cross-platform status

- Linux/Chromium: validated (all evidence).
- WebKitGTK (Linux desktop shell): not directly validated (Playwright WebKit
  lane cannot launch on this host — missing system libs, established in the
  pass-2 report).
- macOS/WKWebView, Windows/WebView2: not directly validated.
- The change is CSS `text-transform`/`letter-spacing` declarations only —
  no platform-specific API and no feature-support risk.

## 11. Concurrent-agent coordination

- The working tree contained the uncommitted pass-2 Phase-4 implementation
  and a concurrently-active repo-wide token-hygiene workstream
  (`packages/ui/src/tokens/color.ts`, `generate-token-css.ts`,
  `audit-token-usage.mjs`, `package.json` `audit:tokens`, UI-component
  fallback cleanups) plus a Panel-tool workstream (`PanelLayoutsSection`,
  `sectionRegistry`/`sectionComposition`/`sectionState`/`featureOwnership`,
  `PanelTool`).
- Adopted: Inspector-scoped pass-2 changes, including the two focus-ring
  lines in generated `tokens.css` staged as a single separable hunk (their
  source is the Inspector-pass-owned `sizing.ts`).
- Left untouched: the entire token-hygiene remainder, the Panel-tool
  changes, and their untracked files.
- The concurrent workstream edited `AGENTS.md` and `package.json` mid-session
  (new `audit:tokens` scope); no conflict with this pass.
- Rebase/pull: `git fetch` showed no incoming commits; the branch is ahead
  of `origin/master`. No merge conflicts encountered.

## 12. Remaining gaps

- **Not landed from pass 2** (recorded, with gates keeping inventory
  visible): icon-step normalization (72 off-step TSX sites, W3),
  IA-012 segmented selected-state unification, IA-010/011 typography-row
  alignment and contrast-chip placement, IA-008 pair trailing slot,
  IA-024 DocumentPanel numeric migration, IA-016 image-section grouping,
  IA-023 `prototype-flow` reachability.
- **Non-Inspector uppercase surfaces remain** (out of scope by ownership):
  `editor.css` `.insp-panel__score-issue-cat` (Audit tab),
  LayersPanel (`layers.css`, `layerStatesSection.css`),
  ContextControlBar, FloatingToolbar, SpecPanel, FontBrowser, UpscaleDialog,
  and others (75 declarations in `packages/editor/src` before this pass; 46
  outside the Inspector after it). Each has a different owner/workstream; a
  follow-up should apply E5-equivalent policy per surface with its own
  visual validation.
- **Editor package typecheck** fails on pre-existing errors from concurrent
  workstreams (no changed file contributes one).
- **Inspector unit lane**: 4 pre-existing failing files, verified unrelated
  (§4 of the audit addendum).
- **One pre-existing E2E failure, pinned but not fixed**: 
  `tests/e2e/inspector/ownership.spec.ts:352` ("brush behavior opens from
  Tool Options instead of Properties") fails deterministically (2/2 runs),
  including the snapshot-refresh run. Cause: `ToolOptionsPopover.tsx` sets
  `openSourceRef.current = 'tool-change'` when the brush tool activates and
  then returns before the focus handoff (`ToolOptionsPopover.tsx:347-362`),
  so the popover opens without moving focus, while the test asserts the
  `Brush` disclosure is focused. CSS cannot alter `document.activeElement`,
  and nothing this pass changed is imported by the popover; the mismatch
  belongs to the toolbar/popover workstream (the popover contract doc says
  pointer opens never move focus — the test predates the tool-change skip).
  The same spec file's eight screenshot assertions all pass.
- **Screen-reader and real-device validation** still not performed.
