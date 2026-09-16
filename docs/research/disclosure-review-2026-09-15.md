# Disclosure / Accordion review — research ledger (2026-09-15)

Scope: the disclosure/accordion/collapsible-section system across the Varve
desktop editor and the Varve marketing website. Research checked 2026-09-15.
Each entry records source, finding, applicability, and the decision it drove.

## 1. Normative and guidance sources

| Source | Finding | Applies to | Decision |
|---|---|---|---|
| WAI-ARIA APG, "Accordion Pattern" (https://www.w3.org/WAI/ARIA/apg/patterns/accordion/) | Header is a button **inside** a heading; `aria-expanded` on the button; Enter and Space toggle; button is the only element inside the heading; `region` role only when panels contain headings or nested accordions and proliferation is not a concern (~6 panels). | Editor inspector sections, sidebar sections, website FAQ | Inspector registry mode already wraps the trigger in `h3`; sidebar controls and website FAQ did **not** expose headings — fixed. Do not add `role="region"` to every panel. |
| WAI-ARIA APG, "Disclosure (Show/Hide)" + WebAIM "Disclosures and Accordions" (https://webaim.org/techniques/disclosures/) | Collapsed content must leave the accessibility tree (`hidden`/`display:none`); focus inside collapsed content is a top failure; triggers must be real buttons and announce state. | Shared primitives | Verified: `DisclosureContent`/`AccordionContent` unmount or use `hidden`. Remaining gap: focus lost when a section collapses while focus is inside its content — fixed in the primitive. |
| WCAG 2.2 SC 2.5.8 Target Size (Minimum) — 24×24 CSS px; SC 2.5.5 Enhanced — 44×44 (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | 24×24 is the AA floor; stacked targets with no spacing do not qualify for the spacing exception. | All section headers and the sidebar collapse toggle | Headers already declare 24px minimums. Sidebar `SectionCollapseToggle` measured and documented; no target below 24px remains. |
| WCAG 2.2 SC 1.4.13 Content on Hover or Focus (https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) | Hover-only affordances are not sufficient; content must be dismissible, hoverable, persistent. | Sidebar collapse tooltips, hover reveals | Collapse controls are persistent, not hover-revealed. No action needed. |
| WCAG 2.2 SC 2.5.7 Dragging Movements (https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | Drag gestures need independent single-pointer and keyboard alternatives. | Section-manager reorder, panel resize (adjacent) | Out of scope here; section collapse is already click/keyboard. Recorded as not-in-scope, not claimed compliant. |
| Google Search Central changelog (retirement of FAQ rich results; announced 2025, retired 2026-05-07) | FAQ rich results no longer appear in Google Search; FAQ markup no longer buys a results dropdown. Content still helps users and can be quoted by AI/answer engines. | Website FAQ JSON-LD | Keep `FAQPage` structured data for answer-engine extraction, but stop describing it as a rich-result mechanism; add parity protection between schema and visible copy. |
| WHATWG HTML Standard, `details` `name` attribute (https://html.spec.whatwg.org/multipage/interactive-elements.html) | Native exclusive accordions are supported, but the spec itself warns exclusivity "can also frustrate users who have to open many items". | Website FAQ | Keep multi-open `<details>` (no `name`); matches NN/g guidance to allow multiple sections open. |
| "The state of `<details>` in 2024" (hellogreg.org) and builder.io "Animated accordions with details" (2025-03) | `<details>` announces role/state natively; headings inside `summary` are announced when navigating by heading except older Android TalkBack, and need `display: inline`; Chromium auto-expands closed details during find-in-page; `::details-content` is Baseline-newly-available (Sept 2025). | Website `<details>` surfaces | Keep native `<details>`; add a heading inside `summary` for question-level heading navigation; keep content in print via `::details-content` override; do not animate open/close (avoids the height-measure class of bugs). |

## 2. Real-world failure evidence (what other products got wrong)

| Source | Reported failure | Applies to | Decision |
|---|---|---|---|
| Bootstrap issue #41240, "Collapse function breaks with a large amount of content" (2025-03) | Opening a second panel after reading a long first panel lands the viewport mid-content of the new panel; maintainers closed it as browser scroll-anchoring, not fixable in the widget. | Any page/section where closing an item above moves content up | Guard the inspector scroll container against anchoring surprises; verify with a rendered scroll-stability scenario instead of assuming browser anchoring. |
| WordPress support "Weird scroll jump on mobile devices" (2025-03), Elementor Reddit "it scrolls too far up" (2025-02), GenerateBlocks "Mobile Accordions throwing users to bottom of page" (2023/2025), T3 Chat feedback "Reasoning Accordion Behaves Poorly and Scrolls Randomly" (2025-12) | Repeated, cross-product complaint: expanding/collapsing reflows the page and the user loses their reading position. | Editor inspector sections; website FAQ | Two mitigations: (a) never scroll the page as part of toggling, (b) keep the toggled header/trigger in place. Add a rendered test that asserts scroll position stability across toggle. |
| Blender issue #123653 + #141506, "Editing keymap collapses panel" / expanded items collapse after edits (2024–2026, user: "made me ragequit learning blender for a month") | Panel collapse state resets as a side effect of editing data. This is the highest-severity editor-specific complaint found. | Inspector registry state | Verify collapse state survives: property edits, selection changes, undo/redo, section reorder, hide/show, workspace switches, and reload. Add regression tests. |
| Godot issue #81481, "Visual shader inspector panel always collapse on value change" (2023) | Inspector panel folds on every value change, making tuning "cumbersome". | Inspector sections with numeric editing | Same verification as Blender above; no section state may depend on document mutation identity. |
| Figma forum, "Variables panel navigation/selection is bugged" (2024) and "Nested variant state not persisting" (2024) | Collapsing a group breaks selection semantics: actions apply to items hidden inside collapsed groups. | Any collapsible list with selection | Editor inspector sections do not own selection; recorded as a boundary (do not let section collapse change selection semantics). |
| NN/g, "Accordions on Desktop: When and How to Use" (2023-07) | Accordions reduce discoverability and add interaction cost; allow multiple open; provide expand/collapse all when useful; caret/plus are the best open signifiers; hide no essential information. | Website FAQ + editor sections | Keep multi-open behavior; keep the caret chevron; ensure the section manager offers show-all/collapse-all (already exists); keep the website FAQ's visible-first answer for the highest-traffic question. |
| NN/g, "Accordions on Mobile" (2015) | Long content under an accordion forces excessive scrolling to collapse; sticky headers help. | Editor inspector (long property lists) | Inspector already uses sticky section headers; verify they pin and do not overlap content. |
| Curbcut Accessibility, "Accordion Accessibility: Fix Your FAQ Section" (2026-07-03) | Page-builder accordions commonly fail four checks: real button, `aria-expanded` flips, collapsed content truly hidden, Enter+Space both work. Elementor legacy accordion still open-broken; Squarespace passes with a heading gap. | Website FAQ + all custom implementations | Native `<details>` covers button/keys/state; add the heading gap fix. |
| MDN "Overview of scroll anchoring" + CSS Scroll Anchoring L1 | `overflow-anchor` can be disabled per container; opt-out is a targeted fix for widgets that fight anchoring. | Inspector/sidebar scroll containers | Do not blanket-disable. Only apply if a rendered test shows a jump; document the reason if applied. |
| IBM Carbon spacing/typography (references cited in the master prompt) | A coherent 4/8 scale and role-based type are preferable to ad-hoc pixel values. | Disclosure spacing | Keep the existing token system; only replace disclosure literals that are already off-system. No new scale introduced. |

## 3. Decisions this session makes (recorded so later work does not regress them)

1. **One taxonomy in docs, two hosts in code.** The inspector registry sections
   are *accordion headers* (heading + button + region); the sidebar
   `SectionCollapseToggle` is a *disclosure toggle* adjacent to a heading; the
   website FAQ is a *native details accordion*. `docs/architecture/disclosure-system.md`
   records which contract each surface follows.
2. **Primitive-level focus safety.** Shared primitives move focus to the trigger
   when a collapse removes the focused element; consumers get this for free.
3. **Keyboard handled natively.** Remove the redundant manual Enter/Space
   handler in `DisclosureTrigger` — native buttons already satisfy APG and the
   duplicate path risks double toggling with assistive technology.
4. **No animation on the editor sections.** Instant open/close avoids the
   measured-height/scroll-jump class of defects; only the chevron transitions.
5. **Website FAQ keeps `<details>`**, gains `h3` question headings, print
   visibility for answers, and schema/visible parity protection. Exclusive
   `name` grouping is deliberately rejected (NN/g: users compare answers).
6. **Stale documentation is corrected, not preserved.** `AGENTS.md` claimed the
   website FAQ and compare FAQ already used the shared `Disclosure` primitive;
   they use native `<details>`. The claim is corrected rather than left to
   mislead the next session.
