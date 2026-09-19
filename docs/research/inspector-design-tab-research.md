# Inspector Design Tab — External Research (2026-09-19)

> Scope: property-panel interaction patterns in professional creative tools,
> documented failure modes, density guidance from mature design systems, and
> the WCAG 2.2 / APG requirements that constrain a dense desktop Inspector.
>
> Every entry carries a stable `RES-###` id, a direct source, a source type,
> and a marker for **verified fact** vs **inference**. Varve-specific
> conclusions live in `docs/audits/inspector-design-tab-audit-2026-09-19.md`;
> requirements derived from these findings are `REQ-###` in
> `docs/design-system/inspector-spec.md`.

## Method

Sources were prioritised in this order: (1) official product documentation,
(2) official design-system documentation, (3) official accessibility
documentation, (4) official release notes, (5) source repositories/issues,
(6) credible engineering/design write-ups, (7) community discussions with
experiential evidence. A single community complaint is treated as a failure
mode to verify, never as a rule. Findings that could not be verified against a
primary source are marked **inference**.

---

## 1. What works — current implementations

### Figma (UI3)

| ID | Source | Date | Type | Observation | Verified? | Relevance to Varve |
|----|--------|------|------|-------------|-----------|--------------------|
| RES-001 | [Making the Move to UI3](https://www.figma.com/blog/making-the-move-to-ui3-a-guide-to-figmas-next-chapter/), [Navigating UI3](https://help.figma.com/hc/en-us/articles/23954856027159-Navigating-UI3) | 2025-03-25 | Official blog + help | UI3 shipped **optional property labels** (a toggle in the properties panel, default recommended *on* for learners). Labels were a response to UI3's icon-forward default. | Verified | Confirms that label visibility is a real tension in dense panels; it can be answered with a user-controllable option rather than one forced choice. |
| RES-002 | [UI3 Properties Panel Gripes](https://forum.figma.com/archive-21/ui3-properties-panel-gripes-8217) | 2024-09-20 | Community (multiple posters) | Complaints: default text/inputs too small; **X/Y and W/H split across sections** ("getting tripped up every time"); control placement felt unordered; boolean ops hidden in a "more" menu; panel "not easy to scan and parse". | Community evidence, multiple independent reports | Varve must keep X/Y/W/H spatially and section-wise together, and must not use raw smallness as the density strategy. |
| RES-003 | [Don't hide "Add New Property" behind hover](https://forum.figma.com/suggest-a-feature-11/ui3-don-t-hide-add-new-property-icon-in-right-panel-28058) | 2024-09-10 | Community (multi-user) | Hover-only "add property" affordance was functionally undiscoverable; users asked for it to be always visible or in a menu. | Community evidence, consistent across replies | Any add affordance in Varve's Inspector (`+ Add fill`, `+ Add stroke`, section add) must stay persistently visible, not hover-revealed. |
| RES-004 | [Please reconsider the mass switching of UI3](https://forum.figma.com/share-your-feedback-26/please-reconsider-the-mass-switching-of-ui3-on-april-30-38935), [UI3 Feedback](https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058) | 2025-03-25 | Community (large thread) | Independently repeated: Position/Size **jumping down the panel** when component properties are present; hiding W/H "Fill/Hug" state under hover lost the "Fixed" indicator; top-anchored Position & Layout preferred; floating gaps/panels create visual noise. | Community evidence, repeated pattern | Section order stability is a first-class requirement: common geometry sections must not be displaced by contextual sections. |
| RES-005 | Figma Actions (UI3 property controls) | 2025 | Official | Property controls are contextual by selection; overflow menus are the fallback for less-common actions. | Verified | Supports contextual section membership, provided discoverability is preserved. |

### Sketch (Copenhagen inspector rewrite)

| ID | Source | Date | Type | Observation | Verified? | Relevance to Varve |
|----|--------|------|------|-------------|-----------|--------------------|
| RES-006 | [A guided tour of Sketch Copenhagen](https://www.sketch.com/blog/a-tour-of-copenhagen/) | 2025-11-19 | Official blog | New Inspector behaviours: **scrub any numeric field by dragging its icon without focusing**; focusing a text field **selects its contents**; **double-click a slider resets it to its natural value**; clicking a toggle's **label** toggles it; Option reveals alternate control behaviour; complex popovers became **separate panels** that survive selection changes. | Verified | Directly testable against Varve's NumberField/scrubber. A "natural value" reset and label-click semantics are cheap, high-value interaction parity items. |
| RES-007 | [Irritating new accordion feature — r/sketchapp](https://www.reddit.com/r/sketchapp/comments/9r86pw/irritating_new_accordion_feature_522/) | 2018-10-25 | Community | Accidental collapse when clicking a section title; difficulty reclaiming collapsed sections; "way too easy to click slightly too high and suddenly you're changing the corner type"; users wanted scrub-on-label. | Community (older, but concrete failure mode) | Collapsed-section affordances must be unambiguous; adjacent controls must not sit close enough to mis-trigger; labels should be scrub targets where the model supports it. |
| RES-008 | [Cease to Increase](https://danieljwilson.me/2018/08/27/cease-to-increase/) | 2018-08-27 | Practitioner blog | Scrub steppers clamped at the screen edge stop increasing once the cursor reaches the edge; the fix is to keep increasing while the pointer is pinned at the edge. | Inference from a practitioner (single-source, mechanism is verifiable) | Pointer-capture scrubbing in Varve should not depend on screen-edge travel; use pointer capture + relative x-delta, not absolute cursor position. |

### Penpot

| ID | Source | Date | Type | Observation | Verified? | Relevance to Varve |
|----|--------|------|------|-------------|-----------|--------------------|
| RES-009 | [penpot#2750](https://github.com/penpot/penpot/issues/2750) | 2023-01-09 | Source repo issue | Expanded panel width not consistently respected across tabs. | Verified issue | Inspector width must be a stable, persisted property of the panel, not per-tab state. |
| RES-010 | [penpot#10306](https://github.com/penpot/penpot/issues/10306) | 2026-06-18 | Source repo issue | The same size information displayed twice (canvas badge + inspector). | Verified issue | Duplicate presentation of the same property is a real defect class — relevant to any Varve Y/X duplicate readouts. |
| RES-011 | [penpot#9706](https://github.com/penpot/penpot/issues/9706) | 2026 | Source repo issue | Token pills missing the gap that deeper levels have — visual hierarchy inconsistency at the first nesting level. | Verified issue | Spacing tokens must be applied uniformly across nesting levels; "first-level exception" is the failure. |
| RES-012 | [penpot#10225](https://github.com/penpot/penpot/issues/10225) | 2026 | Source repo issue | Wanted per-property unit conversion settings in the inspector. | Verified request | Unit display is a documented user need in inspectors; Varve's unit handling should be per-field, not global. |
| RES-013 | [penpot#9316](https://github.com/penpot/penpot/issues/9316) | 2026 | Source repo issue | Toolbar crowded as tools grew; proposal: group by family into flyouts with **keyboard navigation, Escape to close, predictable focus return, hover/focus labels**. | Verified issue + accepted design requirements | Any progressive-disclosure flyout in Varve needs the same keyboard contract; grouping is only acceptable with a disclosed, labelled entry point. |

### Framer / Affinity / others

| ID | Source | Date | Type | Observation | Verified? | Relevance to Varve |
|----|--------|------|------|-------------|-----------|--------------------|
| RES-014 | [Framer Academy interface lesson](https://www.youtube.com/watch?v=GnN5MqiXraw); [Framer code component property controls guide](https://noel.marketing/blog/framer-code-component-property-controls-example/) | 2024 / 2026 | Official + practitioner | Properties panel is explicitly contextual; guidance: keep the number of controls small and purposeful, order controls by how the editor thinks ("most frequently changed first, then visual adjustments, then optional"), give strong defaults, avoid exposing every setting. | Verified (official) + practitioner corroboration | Supports context gating + ordering by workflow frequency; warns against "expose everything" as a substitute for structure. |
| RES-015 | [Affinity Designer shortcut reference PDF](https://resources.serif.com/spotlight/learning/shortcuts/Affinity-Designer-Shortcuts-Windows.pdf), Affinity help | v1.10 / v2 | Official documentation | Transform-panel numeric fields accept **expressions**: `118+55`, `37*4`, `+=80`, `-=20`, `*=2`, `/=2`, `*=1.4`, `*=75%`, `h+30`, `h-5`, `2*h`, `h/2`, `gr*h`. Nudge distances are customisable. | Verified | A concrete, self-contained advanced numeric feature. Varve should only adopt expression entry if its field commit pipeline can parse and validate it without harming undo semantics. |
| RES-016 | [Lunacy / Plasmic / Webflow inspectors] | 2026 | Mixed | No primary-source documentation of a materially different Inspector interaction model beyond what Figma/Sketch/Penpot already establish. | Inference (absence of evidence) | Do not design against unverified assumptions about these tools; treat Figma/Sketch/Penpot findings as the operative corpus. |

---

## 2. What fails — documented complaints and defects

| ID | Failure mode | Sources | Independent confirmations | Varve applicability (to verify in audit) |
|----|--------------|---------|---------------------------|------------------------------------------|
| RES-017 | **Excessive smallness used as the density strategy** — tiny default type/inputs make the panel "photoshop-like" and hard to scan. | RES-002; RES-006; density guidance below | Figma forum thread (multiple posters) | Audit must measure type ramp and hit sizes before declaring any shrink acceptable. |
| RES-018 | **Unstable section order** — contextual sections displace geometry properties between selections, breaking spatial memory. | RES-004 | Multiple posters in one thread + separate feedback thread | Varve's contextual section prioritization must be checked for displacement of Position & Size. |
| RES-019 | **Hover-only discoverability** — essential add/affordance revealed only on hover. | RES-003 | Multiple replies | Check every Inspector header action and row action for persistent visibility. |
| RES-020 | **Accidental toggling/collapse from adjacent hit areas** — clicking near a control triggers the neighbouring one. | RES-007 | Reddit thread (multiple users) | Check target sizes and spacing around disclosure triggers and segmented controls. |
| RES-021 | **Panel width instability across tabs** and duplicated property readouts. | RES-009, RES-010 | Issues still open/closed with maintainer ack | Verify Varve Inspector width persistence and any duplicated geometry display. |
| RES-022 | **Density inconsistency across nesting/levels** (first level loses the gap the deeper levels have). | RES-011 | Maintainer-fixed issue | Check section body vs nested group spacing for one-off exceptions. |
| RES-023 | **Scrub interactions that depend on absolute pointer travel** are defeated by screen edges. | RES-008 | Practitioner; mechanism verifiable | Verify Varve's scrub implementation uses relative deltas/pointer capture. |
| RES-024 | **Missing keyboard contract on progressive disclosure** (flyouts). | RES-013 | Accepted issue requirements | Verify focus return, Escape, labels on any Inspector popover/flyout. |

---

## 3. Standards — WCAG 2.2 AA and WAI-ARIA APG

| ID | Source | Requirement (verbatim anchor) | Consequence for a dense Inspector |
|----|--------|-------------------------------|-----------------------------------|
| RES-025 | [Understanding SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) (updated 2026-05-11) | Pointer targets **≥ 24×24 CSS px**, or spaced so a 24px circle centred on each undersized target does not intersect another target. Zoom-independent. Note explicitly suggests offering a **density/mechanism to increase target area**. | Dense lanes below 24px are permitted **only** with ≥ the spacing exception. Icon buttons and swatches must be measured. |
| RES-026 | [Understanding SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) (updated 2026-06-15) | A focused component must not be **entirely** hidden by author-created content (sticky headers/footers are the named failure, F110; C43 = scroll-padding). | Sticky Inspector section headers + scroller must not bury a focused field; scroll-padding is the sanctioned fix. |
| RES-027 | [APG Spinbutton Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) | Up/Down arrow change value; Home/End to min/max; Page Up/Down optional larger step; direct text editing keys must not be intercepted; `aria-valuenow/min/max`, `aria-invalid`, labelled via `aria-labelledby`/`aria-label`. | Defines the numeric-field keyboard contract the Inspector must satisfy. |
| RES-028 | [APG Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) | Trigger is a button; `aria-expanded`; content relationship via `aria-controls` (only when the panel exists); Enter/Space activation is native. | Section headers must keep the button semantics already used, and must not reference non-existent panels. |
| RES-029 | [WCAG 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) | UI component boundaries and states ≥ 3:1 against adjacent colours. | Field borders, focus rings, swatch borders, and toggle states are in scope, in **all three themes**. |
| RES-030 | [WCAG 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Text ≥ 4.5:1 (normal), 3:1 (large). | Property labels are normal-size text; muted label colours are the most likely failures. |
| RES-031 | [WCAG 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) / [1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Content usable at 200% text size; no loss of information or two-dimensional scrolling for vertical content at 320 CSS px equivalent. | The panel must survive 200% root font size (an existing responsive spec already exercises this). |
| RES-032 | [APG Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | One tab stop (roving tabindex), arrows navigate, Home/End first/last. | Any Inspector toolbar (align & distribute) must follow this. |

---

## 4. Density guidance from mature design systems

| ID | Source | Date | Guidance | Verified? | Application to Varve |
|----|--------|------|----------|-----------|----------------------|
| RES-033 | [Cloudscape — Content density](https://cloudscape.design/foundation/visual-foundation/content-density/) | current | Two modes: comfortable (default) and compact; compact is for **data-intensive views**; compact must not be forced on informational/reading surfaces; users choose; 4px base unit; compact reduces internal padding and inter-component spacing. | Official design system | Varve's Inspector is an inherently data-dense editing surface; a compact-but-readable default is defensible, but the type must remain legible and the user's density preference (if any) respected. |
| RES-034 | [Material — Applying density](https://m2.material.io/design/layout/applying-density.html) | current | Density is adjusted in **4dp decrements**; adjust **dimensions, not padding**; touch targets stay ≥48dp for touch; users must opt in to high density; combine dense components with *less* dense group separation. | Official design system | Supports: keep control *heights* coherent while increasing *group*/section separation — exactly the opposite of uniformly shrinking gaps. |
| RES-035 | [SLDS display density](https://cdn.jsdelivr.net/npm/@salesforce/afv-skills@1.42.0/skills/design-systems-slds-apply/references/overviews/display-density.md) | current | Comfy stacks labels above fields; compact puts **labels on the same line as fields**; both must meet WCAG; 24×24 CSS px desktop minimum; density-aware tokens (`--slds-g-spacing-var-*`). | Official vendor documentation | Endorses Varve's inline label+field row as the compact idiom, provided labels remain readable and targets remain ≥24px. |
| RES-036 | [Blue Yonder design system — spacing/density](https://www.blueyonder.design/system/foundation/spacing) | current | Density modes: standard / compact (87.5%) / ultra-compact (75%). Never shrink primary typography below body size; preserve hit areas; keep destructive actions large; global layout spacing is the least risky knob. | Design system | If Varve adds density tokens, the Inspector may tighten row geometry but must not reduce label type below the body floor or shrink destructive actions. |
| RES-037 | [Nerio — spacing & layout](https://nerio.vpavlov.com/docs/foundations/spacing-layout) | current | Component geometry contracts come first; compact **remaps semantic spacing aliases**, never redefines primitives, and never shrinks text, focus, targets, or content; wrapping/long-localisation must be handled; 200% zoom and 320px reflow are explicit test cases. | Design system | Mirrors Varve's token architecture: add Inspector component-tier aliases, not new raw steps. |
| RES-038 | [Mesh design system — spacing](https://www.meshdesignsystem.com/foundations/spacing) | current | One shared scale for every margin/padding/gap; density chosen at product/section level; scale semantics: 1–3 tight (inside small controls), 4–6 standard (within components), 7–8 between groups/sections, 9–10 major separation. | Design system | A canonical justification for "row gap < section gap" and for forbidding one-off values. |

---

## 5. Synthesis (initial)

> The "Varve evidence" column is completed by
> `docs/audits/inspector-design-tab-audit-2026-09-19.md`; rows here that are
> already evidenced by the Sept-17 baseline are marked.

| Finding | Evidence | Likely root cause | Does Varve currently exhibit it? | Candidate resolution | Risks / trade-offs | Priority |
|---------|----------|-------------------|----------------------------------|----------------------|--------------------|----------|
| Unstable geometry placement between selections | RES-004, RES-018 | contextual sections inserted before/unordered relative to stable ones | Audit item (baseline order JSON exists per selection) | Fixed section order contract; contextual sections appended in defined slots | Displaces contextual content lower; needs scroll affordances | P0 |
| Hover-only or ambiguous header actions | RES-003, RES-019 | space-driven hiding | Audit item | Persistent labelled/`aria-label`ed actions | Slightly wider section headers | P1 |
| Scrub depends on absolute travel / no reset | RES-006, RES-008, RES-023 | implementation detail | Audit item (number-field spec exists) | Relative-delta pointer capture; double-click reset | Requires careful undo batching | P1 |
| Dense rows below 24px without spacing exception | RES-025 | compression without measurement | Audit item (input height 32px verified; icon buttons unknown) | Target-size token + audit rule; spacing exception documented per control | Visual density change | P0 |
| Inconsistent spacing between nesting levels | RES-011, RES-022, RES-038 | one-off local CSS | Audit item | Component-tier tokens; no raw values in Inspector CSS | Migration effort | P0 |
| Density without a legibility floor | RES-017, RES-033, RES-035, RES-036 | "smaller = more pro" assumption | Audit item | Type-role floor (labels ≥ 11px effective, values ≥ 12px) with token enforcement | Slightly taller rows | P0 |
| Duplicate property presentation | RES-010 | duplicated readouts | Audit item | Remove redundant displays | None material | P2 |
| Numeric expression entry | RES-015 | n/a — already implemented | No: `NumberField` evaluates arithmetic and `{alias}` expressions via `@varve/scene` `evaluate` (verified this pass) | Keep; pinned in the spec §5.3 | Parser edge cases already covered by `NumberField.test.tsx` | P3 (documented, not work) |

## 6. Patterns adopted / rejected (draft — confirmed after audit)

**Adopt (pending audit confirmation):**
- Inline label/field rows with a fixed label column (RES-035) — already Varve's primary idiom.
- Persistent labelled add-actions in section headers (RES-003).
- Stable section order with contextual insertion at defined slots (RES-004).
- Scrub-by-relative-delta with one undo entry per gesture, focus-selects-contents, double-click reset (RES-006, RES-008).
- Dense rows only where spacing still satisfies the 24px circle test or a documented exception applies (RES-025).
- Section separation strictly greater than intra-row spacing (RES-034, RES-038).

**Rejected / deferred:**
- Hiding labels behind an icon-only default (RES-001 is a *user option* in Figma, not a default to copy). Varve keeps visible labels; no new "label visibility" preference unless audit shows a specific failure that only an option can solve.
- User-selectable global density modes (RES-033, RES-036): unjustified for this scope — Varve has one professional editing surface, not end-user dashboards; adding a mode multiplies validation cost for marginal benefit. Component-tier compact tokens are the cheaper mechanism.
- Numeric expression entry (RES-015) unless the audit shows the current commit pipeline can host it without undo regressions. Recorded as P3.
- Panel-width coupling to tabs (RES-009): Varve already keeps one width var; no work.

## References

All URLs inline above. Community sources are marked as such; none is treated as
a universal rule. Date of research: 2026-09-19.
