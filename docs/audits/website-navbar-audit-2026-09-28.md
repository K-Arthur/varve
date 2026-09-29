# Varve marketing navbar audit — 2026-09-28

## Scope and decision

This audit covers the shared Astro marketing header, its mobile navigation,
theme controls, search handoff, download/demo actions, footer discovery links,
and public claims that depend on those actions. The approved order is
**Product → Features → Docs → Learn → Support**, with Download as the primary
action. Phones keep the brand, Download, and Menu in the header; theme choice,
search, and **Try in browser** are available inside the menu.

The implementation uses one typed route model for wide and narrow layouts.
Top-level destinations remain normal links where they lead to a page; section
panels use native disclosure semantics and ordinary links. The mobile sheet is
a labelled native modal dialog placed outside the sticky header. Its own
scrolling region remains available on short or landscape screens, while the
browser provides modal focus containment and inert background behavior.
JavaScript adds Escape, backdrop/outside dismissal, close-on-focus-exit for
desktop disclosures, scroll restoration, and focus handoff. Without JavaScript,
the mobile header exposes a native `<details>` link fallback.

## Baseline findings

The pre-change browser inspection found the mobile menu collapsed to about
**50 px** after the page had scrolled. Its links were hidden by the sticky
header's containing/clipping behavior while page scrolling remained locked.
This was the highest-impact discovery failure: users could open the menu but
could not reach its destinations. The before state was inspected in the
browser at 390 × 844 after scrolling; the measured panel height was
approximately 49.7 CSS px.

The old desktop and mobile trees offered different destinations. Desktop
disclosures used inconsistent label typography, and a nested route could make
both the parent and the exact child appear current. A disclosure stayed open
after keyboard focus moved elsewhere. The old translucent/grid header also
made its text and icon contrast depend on whatever page artwork passed behind
it. These observations motivated one route source, exact-page semantics, a
solid semantic surface, and explicit focus/scroll behavior.

## Research: successful patterns and reported failures

The W3C disclosure-navigation example uses disclosure buttons and ordinary
lists of links rather than assigning application-menu roles to normal site
navigation. It also documents Escape-to-close, close-on-focus-exit, semantic
list hierarchy, and a visible disclosure indicator that survives forced
colors. This implementation follows those conventions while using native
`<details>` disclosures and a native `<dialog>` for the mobile sheet. W3C
explicitly cautions that its example is illustrative and must be tested with
assistive technologies before production use; our browser checks do not replace
that cross-AT testing. [W3C APG disclosure navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)

Current design-tool references support grouping by user intent: Figma groups
product destinations and separates learning/help resources; Sketch groups
Product, Explore, and Support, with documentation, help, contact, and community
under discoverable headings; Penpot's guide groups its product and learning
resources and organizes learning material by workflow. Varve uses a shorter,
explicit set of jobs—Product, Features, Docs, Learn, Support—because it needs
to distinguish the product overview, the feature index, documentation,
learning material, and support actions at first
glance. This is a navigation choice for Varve, not a claim that competitor
labels are universally better. [Figma](https://www.figma.com/),
[Sketch](https://www.sketch.com/), [Sketch documentation](https://www.sketch.com/docs/),
[Penpot public feature resources](https://penpot.app/features),
[Penpot Learning Center](https://penpot.app/learning-center)

The following public reports are treated as concrete failure scenarios to
prevent, not as evidence that every current build of those products is broken:

| Reported failure | Varve acceptance check |
|---|---|
| Adobe Portfolio users reported that a mobile menu icon could remain black against a dark background. | Check the menu control and icon in both theme palettes, including forced colors; use explicit semantic control colors. [Adobe Community report](https://community.adobe.com/questions-606/adobe-portfolio-background-black-menu-item-is-also-black-on-mobile-how-can-this-be-changed-into-white-575332) |
| Starlight users reported an unreadable dark-theme selector state in Windows Firefox. | Check selected theme text and indicator against the selected surface in both themes, with a computed contrast assertion. [Starlight issue #3426](https://github.com/withastro/starlight/issues/3426) |
| A Webflow user reported that a hamburger menu was clipped in mobile landscape and asked how to make it scroll. | Open the menu after scrolling at 667 × 375, reach the last support link through the menu's own scroll region, and verify the dialog still covers the viewport. [Webflow user report](https://www.reddit.com/r/webflow/comments/xx5f81/) |

## Before / after evidence

| Scenario | Before | After and evidence |
|---|---|---|
| Phone menu after page scroll | Sticky header constrained the menu to approximately 49.7 px and its links could not be reached. | A viewport-sized `<dialog>` remains outside the sticky header. Playwright opens it after scrolling at 390 × 620, checks exact viewport bounds, scrolls to Contact inside `.mobile-nav-scroll`, and confirms the page's scroll position and overflow state are restored at close. See the phone screenshots below. |
| Desktop/mobile destinations | Different link sets required users to learn two navigation systems. | One typed model drives both layouts; the test compares each destination in the same order in `/varve` and `/` deployment projects. |
| Nested routes and keyboard | Parent/child routes could both claim the current page; focus could leave an open panel without closing it. | Exact matches alone receive `aria-current="page"`; section ancestry has its own visible marker. Keyboard tests cover Enter, Escape/focus return, focus exit, and outside dismissal. |
| Surface and themes | Header material and menu controls had no reliable opaque theme-matched base. | Header, dropdown, dialog, theme selector, and primary CTA use semantic light/dark surfaces. Screenshots and computed contrast assertions cover both themes and responsive breakpoints. |
| Short landscape and no script | A clipped menu could hide destinations; JavaScript owned mobile-menu visibility. | The 667 × 375 landscape check scrolls to Contact inside the modal. With JavaScript disabled, native `<details>` keeps destinations available and CSS follows the OS dark preference. |

Visual evidence is captured by
[`navbar-visual.spec.ts`](../../apps/website/tests/e2e/navbar-visual.spec.ts)
at 320, 390, 767, 768, 1024, 1279, 1280, and 1440 px in light and dark,
including open menus, 667 × 375 landscape, and 150% enlarged root text. Reviewed
captures include a light/dark header and open menu at each of 320, 390, 768,
1024, 1280, and 1440 px, plus the dark landscape menu (25 PNGs total), and are
stored under
[`docs/screenshots/website-navbar-2026-09-28/`](../screenshots/website-navbar-2026-09-28/).
Representative captures: [320 px light header](../screenshots/website-navbar-2026-09-28/light-320-header.png),
[1440 px light header](../screenshots/website-navbar-2026-09-28/light-1440-header.png),
[390 px light menu](../screenshots/website-navbar-2026-09-28/light-390-open-menu.png),
[390 px dark menu](../screenshots/website-navbar-2026-09-28/dark-390-open-menu.png),
[768 px light header and disclosure](../screenshots/website-navbar-2026-09-28/light-768-open-menu.png),
[1024 px dark header and disclosure](../screenshots/website-navbar-2026-09-28/dark-1024-open-menu.png),
[1280 px dark Learn disclosure](../screenshots/website-navbar-2026-09-28/dark-1280-open-menu.png),
and [667 × 375 dark landscape menu](../screenshots/website-navbar-2026-09-28/dark-667x375-landscape-open-menu.png).
The former baseline is recorded above as an inspection measurement because
the original transient browser view was not saved as a repository screenshot.

## Contrast measurements

The project computes WCAG relative luminance from the browser's computed
foreground and effective surface colors. Acceptance is **4.5:1** for normal
text and **3:1** for meaningful boundaries and focus indicators; coarse-pointer
navigation controls target 44 × 44 CSS px. The added browser regression measures
the current-page link, a dropdown description, the menu-link focus ring, the
selected theme control, and the Download action in light and dark modes. Exact
ratios from the completed browser run are recorded below.

| Element / state | Light | Dark | Minimum |
|---|---:|---:|---:|
| Current-page navigation text | 14.46:1 | 17.00:1 | 4.5:1 |
| Dropdown description text | 18.77:1 | 10.31:1 | 4.5:1 |
| Menu-link keyboard focus ring | 12.30:1 | 6.53:1 | 3:1 |
| Selected theme label | 19.44:1 | 17.61:1 | 4.5:1 |
| Download CTA label | 17.90:1 | 8.37:1 | 4.5:1 |

## Implementation and marketing decisions

- The desktop menu uses Product, Features, Docs as page links and Learn and
  Support as disclosures. Its visual sequence is shared with the mobile
  destination list.
- A compact navigation is used from 48rem; full desktop links appear from
  80rem; below 48rem the row contains only the brand, Download, and Menu.
- Learn contains the learning hub, tutorials, examples, and community.
  Support contains the support home, FAQ, troubleshooting, known issues, issue
  reporting, and contact. Contribution destinations remain in the footer.
- `aria-current="page"` is only set on an exact route. A parent may receive a
  separate visual section marker without claiming to be the current page.
- The modal navigation supports internal scrolling, safe-area insets, inert
  background content, focus containment/return, page-scroll restoration, Escape,
  close control, backdrop dismissal, and mobile search handoff.
- Theme choice stays available in the menu on narrow screens. A persisted
  explicit selection overrides the OS; first visits follow live OS preference;
  blocked storage keeps an explicit selection for the current page session; and
  CSS reproduces the dark palette before JavaScript or without JavaScript.
- The header CTA uses the shared website Button. It reads “Download” when a
  release exists, and “Beta status” while it does not. “Try in browser” keeps
  the bounded demo route and existing analytics event, states that it opens a
  new tab, and does not present the browser edition as the full desktop suite.

## Validation record

```text
Changed scope: shared website navigation model/header and CTA/search handoff; theme bootstrap and no-JS palette; footer discovery copy; website theme, release, positioning, and audit docs; focused navigation/theme/visual Playwright coverage and reviewed screenshots.
Validation plan: task-only `pnpm verify:plan --staged` on an isolated index of 43 task files selected website formatting/lint, emoji/radius/docs audits, website unit/typecheck, website unit tests, and website E2E. FULL-SUITE ESCALATION: NO. The whole-checkout plan requests a full gate because unrelated editor, engine, workspace, and validation-infrastructure changes are present in the shared tree.
Commands actually run: `pnpm --filter @varve/website build`; `pnpm build:website:pages`; `pnpm --filter @varve/website typecheck`; `pnpm audit:docs`; `pnpm audit:emoji`; `pnpm audit:tokens`; `pnpm verify:affected --staged` with the task-only index; focused Playwright navigation/visual/theme targets and the complete `pnpm test:website:e2e` website closure through `scripts/quality/heavy-lease.mjs` at one worker across `/` and `/varve` projects.
Passed: website Astro check (164 files, zero diagnostics) and both static builds (112 routes); docs audit (1,105 documents, 707 links, 177 ADRs); emoji audit (5,134 files); all 303 token contrast pairs across three themes and token-usage checks; website typecheck; focused navbar/visual/navigation group (45 passed) and theme group (64 passed); the complete website E2E run passed 584 tests, including all navbar, theme, axe, route-wide contrast, touch-target, and no-overflow cases. The final 25-image navbar evidence set covers both themes, 320–1440 px, compact/full breakpoint boundaries, enlarged text, open menus, and 667 × 375 landscape; its six-width recapture test passed.
Skipped as unrelated: Rust/native and editor/canvas checks and the full monorepo suite. The initial shared-tree `typecheck:e2e` attempt reports a type error in `packages/engine/src/liveEffects/effectPreviewRunner.ts`, outside the website scope.
Failures and attribution: `pnpm verify:affected --staged` passed Tier 0 but stopped in `js-unit:@varve/website` at 238/239 tests. The sole failure is the pre-existing screenshot-manifest assertion for `/screenshots/performance-settings-dark.png`, which conflicts with other already-staged screenshot removals in the shared checkout. Website typecheck and E2E were then completed separately. The full website closure reports 38 failures among 622 completed tests: documentation-copy spacing (`assets.spec.ts`), unrelated feature-page layout/copy and screenshot checks (background removal, canvas fluidity, corner radius, depth-aware effects, generative editing, object selection, and press), and 18 existing page-golden mismatches in `visual.spec.ts`. These are outside the navbar/theme surface; page and snapshot edits from other in-progress work remain untouched. Navbar's dedicated visual captures and interaction tests pass in both deployment modes.
Escalations: none for this website task. The initial whole-checkout planner requested a full suite only because of unrelated work. The task-only plan explicitly reports no full-suite escalation.
Full suite run: no monorepo full suite. The required affected website E2E closure (`pnpm test:website:e2e`) did run through both base-path projects and touch-target coverage; its result is 584 passed and 38 failed. An earlier malformed forwarding attempt was interrupted after 30 tests when it selected the broad suite; the completed closure above supersedes it for website validation.
If yes, reason: n/a
```

The browser matrix covers both `/varve` and `/` builds for destination,
route-state, interaction, theme, contrast, no-JavaScript, and touch checks.
Navbar screenshots at all six requested widths in both themes were visually
inspected and committed as review evidence.
Unrelated whole-page screenshot baselines were not updated because their
captured page content and snapshot-manifest state overlap independent edits in
the shared checkout; the dedicated navbar visual spec provides current,
reviewed evidence without absorbing those changes.
