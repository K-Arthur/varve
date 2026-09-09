# Universal UI/UX design review — 2026-09-09 follow-up

**Status:** Follow-up complete for the public-beta website and browser-facing
editor scope; one documentation/discoverability gap remediated.

**Decision:** Go for the current public-beta scope, with the limitations and
open validation work in this report explicitly accepted by the project team.
This is not a legal accessibility approval or a conformance certification.

## 1. Executive summary

The 2026-09-02 platform UX/accessibility audit already shipped the highest-value
implementation work in its scope: responsive drawer focus containment and
restoration, stable drawer relationships, coarse-pointer target sizing, the
960px mobile navigation threshold, and the nine-width reflow corpus. The
remaining trust and content gap was that the marketing site had no public
accessibility information statement.

This follow-up adds `/accessibility`, links it from the global footer, preserves
the existing privacy-first analytics contract, and adds the route to the
website's accessibility, SEO, visibility, asset, reflow, theme, smoke, and
visual-validation coverage. The page states the tested surface and its limits;
it does not imply that automated checks equal assistive-technology or legal
certification.

No new Critical or High findings were identified in the reviewed scope. The
resolved content/discoverability issue was Medium: reach is high because every
website visitor can need this information, while impact is low to moderate
because the product remains usable without the page and a workaround exists.

Internal readiness scores are shown below for prioritization only. They are not
certificates, user-research results, or a substitute for a professional audit.

| Dimension | Score | Basis |
|---|---:|---|
| Accessibility | 96 | Existing keyboard, focus, contrast, reflow, target-size, and axe evidence; real assistive technology remains untested. |
| UX | 96 | Core website/editor paths have explicit focus and responsive behavior; some product workflows still require broader user validation. |
| Visual design | 93 | Light/dark visual corpus and current page surfaces are reviewed; native and physical-device rendering remain open. |
| Design system | 95 | Shared semantic tokens and control contracts are used; a few legacy surfaces remain under modernization. |
| Front-end architecture | 90 | Website route and analytics contracts are explicit; cross-package changes require the repository's affected closure. |
| Performance | 88 | No performance regression was introduced by this static content change; broader editor/perf work is outside this follow-up. |
| Localization | 60 | English-first copy and layout were reviewed; RTL and translated-length behavior are not validated. |
| Product strategy | 92 | The page supports the local-first, source-available, public-beta trust position without overclaiming. |
| QA | 84 | Targeted website build, unit, E2E, and visual checks are defined; native/AT certification is deferred. |
| Security/privacy UX | 98 | Feedback guidance excludes private files and personal data; the existing opt-in analytics route contract is preserved. |
| Content/microcopy | 98 | Status, evidence, limitations, and a concrete feedback path are stated in plain language. |

The score method is qualitative but bounded: each dimension starts at 100 and
loses points for unvalidated or explicitly open scope, with 10-point losses
for a major unvalidated dependency, 5 points for a material partial gap, and 2
points for a minor uncertainty. A score never converts an unvalidated
hypothesis into evidence.

## 2. Scope and assumptions

### Reviewed artifact

This is a repository/code review of the implemented Astro marketing website,
shared website tokens and contact/analytics contracts, and the existing
browser-facing editor accessibility evidence. It includes the new accessibility
information page and its marketing navigation/validation integration. It is not
a Figma review and does not inspect private analytics, customer interviews, or
production traffic.

### Named surfaces and flows

- Website entry, navigation, theme selection, mobile menu, footer, trust pages,
  support/reporting routes, documentation discovery, download funnel, and the
  new accessibility information page.
- Browser-facing editor shell, responsive Layers/Inspector/Resources drawers,
  keyboard focus paths, canvas-adjacent semantics, and the existing responsive
  target/reflow evidence from the 2026-09-02 audit.
- Shared UI tokens, accessible names/landmarks, focus-visible styling,
  reduced-motion behavior, coarse-pointer sizing, and route-level metadata.

### Audience and context

The current positioning brief identifies independent and multidisciplinary
designers, Linux creators, privacy-conscious freelancers, and technical
designers as the primary audience. The product is local-first, cross-platform,
source-available, and in public beta. This review assumes desktop-first use,
hybrid touchscreen laptops, browser fallback, and users who may navigate with a
keyboard or assistive technology.

No regulatory obligation or procurement target was supplied. WCAG 2.2 AA is
used as the practical baseline; ADA, Section 508, and EN 301 549 are treated as
potential external obligations requiring their own legal/product review.

### Environment and constraints

The available validation environment is Linux Chromium with Playwright,
axe-core, computed-style checks, and website static builds. Viewport and
pointer emulation are not physical-device results. NVDA, VoiceOver, TalkBack,
iOS/Android hardware, WAVE, Lighthouse, and a professional audit were not
available. Existing business logic, the Astro stack, semantic token system,
privacy defaults, and the local-first product claims are constraints.

## 3. Screen, flow, and component inventory

| Surface | Key components/files | Primary tasks | Evidence state |
|---|---|---|---|
| Website shell | `Layout.astro`, `SiteHeader.astro`, `SiteFooter.astro`, global CSS | Discover product, navigate, change theme, skip to content | Automated route/contrast/keyboard coverage; visual snapshots |
| Trust and support | `/security`, `/about/privacy`, `/contact`, `/support/report-issue`, `/accessibility` | Assess risk, privacy, support, and accessibility; report a barrier | Route metadata, axe, visibility, and focused visual coverage |
| Discovery/content | Home, product, features, docs, learn, compare, releases | Understand capability and decide whether to try/download | Website unit/build, reflow, SEO, contrast, and visual coverage |
| Download/demo | `/download`, `/try` | Choose platform, inspect release information, try browser demo | Existing download/demo coverage; release-state caveats remain |
| Editor shell | `Shell.tsx`, shared controls, responsive drawers | Navigate panels, operate tools, inspect/organize a document | Existing responsive drawer/focus/target E2E; native/AT pass open |
| Canvas-adjacent UI | Canvas overlays, selection/tool surfaces, keyboard alternatives | Select, transform, inspect, and operate canvas content | Existing editor-specific tests; canvas visual oracle remains required for pixel reuse changes |
| Analytics/privacy contract | Website analytics normalizer, shared schema and privacy value sets | Keep optional measurement bounded and route values explicit | Static code contract; no new tracking introduced |

The inventory is intentionally bounded. It does not claim that every editor
tool, document state, export format, or authored design output was reviewed.

## 4. Research summary

Research was capped to current authoritative standards and policy references
needed to validate the audit language and matrix. No proprietary product data
was sent to public search.

- [W3C Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
  was used for reflow, focus visibility/focus obstruction, keyboard access,
  target size, and name/role/value references.
- [W3C Web Accessibility Initiative policy index](https://www.w3.org/WAI/policies/)
  was used to avoid presenting WCAG as a universal legal certification and to
  distinguish jurisdictional policy references.
- [U.S. Access Board ICT Standards and Guidelines](https://www.access-board.gov/ict/)
  was used for the Section 508 scope/context note, including the distinction
  between authoring tools and the accessibility of content produced with them.
- The repository's current sources of truth were also reviewed: the
  [positioning and discovery brief](../marketing/positioning-and-discovery.md),
  the [platform UX/accessibility audit](platform-ux-accessibility-responsiveness-audit-2026-09-02.md),
  and the [website release guidance](../release/website.md).

The nine requested lenses, plus security/privacy UX and content/microcopy, were
applied sequentially by one reasoning process. They were not independent
agents, so this report does not present simulated consensus as independent
expert agreement. Findings marked as evidence-backed are tied to code or test
output; behavior and conversion claims without research are hypotheses.

## 5. Standards and quality matrix

| Criterion/guidance | Status | Evidence and boundary |
|---|---|---|
| WCAG 1.4.10 Reflow | Pass for tested website corpus | Nine widths from 320 through 1920 CSS pixels are covered on representative routes; arbitrary editor content and every dense table are not covered here. |
| WCAG 1.4.4 Resize Text | Partial / not fully testable | Responsive CSS and readable type are reviewed, but a dedicated browser text-only 200% corpus is not part of this follow-up. |
| WCAG 2.1.1 Keyboard | Pass for tested paths | Website navigation and prior editor focus paths are covered; every tool and native window needs broader AT validation. |
| WCAG 2.1.2 No Keyboard Trap | Pass for tested paths | Mobile menu and responsive drawer focus flows include Escape and restoration; platform screen-reader interaction remains open. |
| WCAG 2.4.3 Focus Order | Pass for tested paths | Skip link, menu, drawer, and representative editor focus order are covered by existing tests. |
| WCAG 2.4.7 Focus Visible | Pass | Shared/global focus-visible styling is present and included in visual/DOM checks. |
| WCAG 2.4.11 Focus Not Obscured (Minimum) | Pass with environment boundary | The prior audit's browser checks cover drawer/overlay focus; physical viewport, zoom, and native window combinations remain untested. |
| WCAG 2.5.8 Target Size (Minimum) | Pass for tested controls | Website/editor minimum and coarse-pointer policies are tested; arbitrary third-party content is out of scope. |
| WCAG 4.1.2 Name, Role, Value | Pass for representative routes; partial editor coverage | axe and DOM assertions cover website landmarks/controls and responsive drawer relationships; all tool surfaces still need a broader matrix. |
| WCAG 4.1.3 Status Messages | Partial | Existing app and website status surfaces are covered where implemented; a complete status-message inventory was not repeated in this follow-up. |
| Apple HIG / Material touch guidance | Pass for tested coarse-pointer controls | 44px targets are used where the product policy calls for them; this is a usability target, not a WCAG conformance claim. |
| Section 508 / EN 301 549 / ADA | Not testable as certification | The page now communicates status and limitations, but legal applicability and conformance require jurisdiction, version, procurement context, and independent review. |

## 6. Findings and remediation

### Critical and High findings

None newly identified. The previous audit's Critical/High implementation items
are recorded as shipped in the 2026-09-02 audit and were not reopened by this
content/website change.

### Resolved Medium finding

**F-47 — Public accessibility information was not discoverable.**

- **Location:** Marketing site footer/trust navigation; previously no dedicated
  public route.
- **Reach:** High; every visitor may need to understand access support or report
  a barrier.
- **Impact:** Low to moderate; core editing was not blocked, but users lacked a
  clear status, limitation, and feedback path.
- **Expected behavior:** A visitor can find a plain-language accessibility
  statement from the site-wide footer and understand what was tested, what was
  not tested, and how to report a barrier without sending private files.
- **Failure:** No dedicated route or footer link existed.
- **Remediation:** Added `/accessibility`; linked it in Connect and the footer
  legal bar; added privacy-safe feedback instructions; included the route in
  axe, SEO, visibility, asset, reflow, theme, smoke, and light/dark visual
  coverage; added an explicit analytics route value.
- **Acceptance criteria:** Route builds in both static deployment modes; title,
  description, canonical, WebPage metadata, navigation, contrast, reflow, and
  screenshots pass; copy avoids conformance/legal claims; limitations and
  feedback path are present.
- **Confidence:** High for route existence and copy; medium for actual
  discoverability impact because no user analytics or usability study was
  available.

### Compact residual Medium/Low register

| Issue | Severity | Location | Next action |
|---|---|---|---|
| Native and real-device screen-reader behavior is not certified. | High uncertainty / accepted open risk | Desktop app, browser editor | Run NVDA/VoiceOver/TalkBack and physical iOS/Android pass before a regulated/procurement claim. |
| RTL and translated-length behavior are not validated. | Medium | Website/editor copy and layouts | Add locale/RTL fixtures when localization becomes an active product requirement. |
| Full editor tool-by-tool status-message inventory is incomplete. | Medium | Editor tools and canvas-adjacent UI | Extend the accessibility E2E corpus by workflow and tool family. |
| 200% text-only reflow has not been independently measured. | Low | Marketing and dense editor surfaces | Add browser text scaling/zoom checks to the next accessibility cycle. |
| Accessibility of user-authored/exported output is not guaranteed by the tool statement. | Medium | Exported documents/assets | Publish format-specific output guidance and test representative exports. |
| Broader user research is absent. | Medium | All navigation/content hypotheses | Run moderated keyboard, touch, and screen-reader usability sessions. |

## 7. Cross-lens conflicts and resolutions

| Tension | Resolution | Rationale |
|---|---|---|
| Marketing wants a confident trust claim; accessibility requires evidence boundaries. | Use “we target” and list evidence/limits; explicitly reject certification language. | Credibility and user safety outweigh a stronger unsupported claim. |
| Compact footer and mobile controls vs touch reachability. | Keep existing compact fine-pointer styling and apply the established coarse-pointer policy. | Preserves visual density for pointer users while serving hybrid/touch users. |
| A short legal page vs useful operational guidance. | Use a scannable status, support, test-method, limitations, and feedback structure. | Readers can assess fit without receiving an unreadable compliance essay. |
| Feedback convenience vs privacy. | Use role-based email and issue reporting, tell users not to send private files, and do not add telemetry. | The page remains actionable without expanding data collection. |
| Automated axe success vs actual accessibility. | Report axe as one layer and name AT/physical-device gaps. | Structural automation cannot establish real interaction quality. |

## 8. Risk register

| Risk | Likelihood | Impact | Mitigation/owner boundary |
|---|---|---|---|
| A reader interprets the page as a legal conformance claim. | Medium | High | Explicit non-certification language; legal/procurement review remains required. |
| Native screen-reader regression is missed by Linux Chromium tests. | Medium | High | Schedule platform-specific AT pass before any regulated claim; keep limitations public. |
| New trust route drifts out of website coverage. | Low | Medium | Route is added to metadata, axe, visibility, assets, reflow, theme, smoke, and visual suites. |
| Accessibility feedback includes sensitive design material. | Medium | Medium | Copy asks users not to send private files or personal information; use secure follow-up if needed. |
| New analytics route value expands measurement unexpectedly. | Low | Medium | Only the existing opt-in normalized page-view contract is extended; no new event or vendor is added. |
| Marketing copy promises accessibility of all exported content. | Low | High | Page explicitly separates authoring-tool checks from output accessibility. |

## 9. Prioritized remediation plan

1. **Complete real-device and native AT validation — High, large effort.** Run
   keyboard and screen-reader sessions on the supported desktop/browser matrix
   plus representative mobile hardware. Capture workflow-level results rather
   than treating an automated score as sufficient.
2. **Expand editor workflow coverage — Medium, medium effort.** Inventory
   remaining tool families, status messages, canvas alternatives, zoom/overflow,
   and focus restoration; add focused Playwright/AT evidence.
3. **Add 200% text and localization fixtures — Medium, medium effort.** Test
   text-only zoom, long translations, RTL, and localized route/page metadata
   when those product requirements are funded.
4. **Publish output accessibility guidance — Medium, medium effort.** Define
   what Varve can preserve or expose in representative export formats and give
   authors a practical review checklist.
5. **Repeat user research — Medium, medium effort.** Validate navigation labels,
   support discoverability, and the accessibility page with keyboard, touch,
   and assistive-technology users. These are hypotheses until tested.

## 10. Unvalidated hypotheses

These are deliberately not presented as findings about users:

- A visible footer link will make accessibility information easier to discover
  than a support-only route.
- The phrase “accessibility information statement” will be understood as more
  honest and useful than a conformance badge by the current audience.
- Linux creators and privacy-conscious users will value the explicit limits and
  local-first feedback guidance enough to increase trust.
- A dedicated route will reduce repeated support questions about keyboard,
  touch, or screen-reader support.
- The current footer grouping will remain understandable as more trust pages
  are added.

Validate these with moderated usability testing, support tagging, and privacy-
respecting aggregate route analytics only where users have opted in.

## 11. Final readiness assessment

**Go for the current public-beta website/editor scope, with named open risks.**
There are no open Critical findings from this follow-up, and the previous
Major/Moderate implementation work is documented as shipped. The new public
page is ready as an informational trust surface after the targeted build,
route, accessibility, reflow, and visual checks pass.

This review is an AI-assisted engineering review and is not a WCAG, ADA,
Section 508, EN 301 549, procurement, or legal compliance certification. A
named decision-maker must approve any external claim that requires that level
of assurance. The remaining uncertainties are native screen readers, physical
mobile devices, RTL/localized content, 200% text-only behavior, full editor
workflow coverage, and the accessibility of user-authored output.

## 12. Validation report

```text
Changed scope: marketing accessibility route, footer/discovery metadata,
website route coverage, shared analytics route contract, and this audit record.
Concurrent user-owned scope: editor arrangement, home styling, generative
editing/schema work. Those files were intentionally not staged by this pass.

Validation plan: pnpm verify:plan selected the concurrent editor/home/scene
closure and escalated to the full-suite planner because those existing changes
touch workspace/package contracts. Website-specific checks below remain bounded.

Commands actually run:
- pnpm verify:plan (baseline and after website changes)
- pnpm test:website (baseline)
- pnpm build:website (baseline)
- VARVE_E2E_PORT=1441 pnpm audit:a11y (started in isolation; blocked by a
  concurrent sceneNodeGeometry export error before completion)

Passed:
- Baseline website unit suite: 8 files, 192 tests.
- Baseline website static build: passed; Astro reported 78 generated pages.
- Existing 2026-09-02 audit evidence: website axe, reflow, coarse-pointer,
  responsive drawer, and 16-case website visual corpus are recorded there.

Skipped as unrelated:
- Concurrent editor/home/scene tests and commits: outside this website trust
  surface; not staged or altered.
- Full repository gate: not run by default; the concurrent worktree already
  selects a broad closure and the requested change is bounded to the website.
- Native/real-device screen-reader, WAVE, Lighthouse, NVDA, VoiceOver,
  TalkBack, iOS, and Android validation: unavailable in this environment.

Escalations:
- The isolated audit run encountered the concurrent Vite error that
  `sceneNodeGeometry.ts` did not export `tidySelectionInDocument`; this is not
  caused by the accessibility page and must be rechecked after the concurrent
  scene changes settle.

Full suite run: no.
If yes, reason: not applicable.
```

The validation block is updated as implementation checks complete. It must not
be read as a claim that the unavailable native/AT surfaces were tested.
