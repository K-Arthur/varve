# Design-system completion — baseline and coverage ledger (2026-09-24)

This is the active evidence ledger for the completion pass on `master`.
Starting HEAD: `c8d3b3dd1` (two local commits ahead of `origin/master`).
The checkout already contains another workstream's staged E2E files,
unstaged documentation and website edits, and untracked diagnostics. This
pass owns only explicitly listed files in its commits and does not push.

## Inventory denominator and status

The inventory is **eight editor workspace modes**, Home, shared settings,
menus/overlays, detached-window chrome, and **105 Astro page files** in the
website source. A page-file count is not a count of unique deployed URLs;
the website route families below are reviewed by their actual built URLs.
No completion percentage is reported while runtime coverage is incomplete.

| Surface | Current status | Evidence or next check |
|---|---|---|
| Design, Print, Draw, Photo, Motion, Logo, Email, Codegen | In progress | Existing workspace and layers E2E cover selected controls; capture and inspect each mode's panel/toolbar state in this pass. |
| Home search | Repaired; affected gate pending | Results route to file opening, project navigation, or persisted template creation. The template gallery receives the loaded inventory. Focused unit and Chromium checks pass. |
| Shared settings and theme/density lifecycle | In progress | Existing lifecycle specs and 315/315 token contrast pairs pass; repeat switches and reopen with real UI. |
| Menus, overlays, Guide Layouts | Repaired; broader visual matrix pending | Guide Layouts now uses the shared modal and controls; browser screenshots show a dim backdrop and centered desktop/narrow layout. Nested select, focus restoration, no-target gating, and Escape passed focused Chromium tests. |
| Detached-window chrome | In progress | Existing theme lifecycle coverage; run integration smoke if changed. |
| Website home/product/features/docs/support/learn/download/legal | In progress | Site source contains 105 Astro page files. The homepage golden predates its latest copy; the Guide Layouts product screenshot shows editor chrome crossing the dialog. Review both base paths and current product claims. |

## Findings and acceptance

| ID | Severity | Evidence and cause | Acceptance |
|---|---|---|---|
| DS-01 | High | `pnpm audit:radius` fails on nine raw radii: five in Guide Layouts, four in Inspector preset controls. Token audit passes 315 pairs and usage. | Replace only with intent-matched semantic radius roles; radius and affected validation pass; inspect changed surfaces before/after. |
| DS-02 | High | Guide Layouts uses a non-modal `<dialog open>` with a `::backdrop` rule that cannot paint a modal backdrop. Existing full-window captures are stored with this audit. | `:modal` is true, foreground controls are unobscured and actionable at 1280/390px, focus is contained and restored, Escape/Cancel abort preview, Apply remains one undo step. |
| DS-03 | High | Home search renders project and template matches but sends their IDs to `onOpenFile`; HomeShell only resolves file IDs. | Pointer and keyboard results open the selected project or create from the selected template; close returns focus appropriately; no silent action. |
| DS-04 | Medium | Quick Actions changes `aria-selected` while focus stays in search input, without `aria-activedescendant`. | Arrow navigation exposes the active option to assistive technology; Enter invokes it and empty results remain stable. |
| DS-05 | Medium | Homepage snapshot contains pre-correction competitor copy; `visual.spec.ts` allows a 2% pixel difference that can miss a small text change. | Inspect and approve current desktop/mobile light/dark captures; assert critical product copy semantically and update only changed baselines. |
| DS-06 | Medium | Screenshot validator allows a captured website PNG without its canonical docs copy; `comic-lettering-light.png` is one such case. | Validator checks both copies and matching content hashes for captured scenes; repair the missing copy through the review/sync pipeline. |
| DS-07 | Medium | Real Home capture: a `Brand Starter` template query initially highlighted the shorter `Brand` project above it; Enter would navigate away from the requested template. | An exact name match is active ahead of earlier partial matches; ARIA state and Enter agree. |

## Foundation repair evidence

The Guide Layouts host now uses the shared `Dialog`, `Button`, and `Select`
components. This puts the dialog in the browser top layer, gives its footer
the shared action sizing, and keeps the two choice controls consistent with
other editor forms. The five raw radii in that host and four in Inspector
frame presets now use their semantic control or pill tokens. The small
Inspector preset actions use the shared extra-small control height. No token
palette or authored artwork colors changed.

The focused Chromium grid-system run passed **2/2** after the repair. A later
two-spec run passed **2/2**, covering `:modal`, internal focus, a nested select
choice, 390px geometry, no-target and invalid-input gating, Escape cancellation,
focus return, and the Inspector preset filter. The four Guide Layouts
before/after screenshots and the Inspector screenshot below were opened and
inspected. The repaired dialog has a backdrop, centered placement, visible
labels, and no clipped fields at either width. The Inspector category and
favorite hit areas settle at 24 CSS pixels. The first geometry assertion
sampled 23.67px during the shared floating layer's `scale(0.97)` entrance;
the winning `min-height` declaration resolves to the 24px token after that
animation. This was a transient measurement, so the regression test polls
for the settled state. Affected validation is still pending.

- `docs/screenshots/2026-09-24-design-system/guide-layouts-after-desktop.png`
- `docs/screenshots/2026-09-24-design-system/guide-layouts-after-narrow.png`
- `docs/screenshots/2026-09-24-design-system/frame-presets-after.png`

## Home workflow repair evidence

The command palette previously sent every result ID to a file-only callback;
project and template selections closed the palette without an action. It now
dispatches each result kind to its owning HomeShell path. Project navigation
uses the existing persisted view state, while both template entry points await
`platform.upsertFile` before opening the new document and report storage
failure. The gallery now receives the already loaded template inventory and
shows its count. The Home heading follows the selected project, and dismissing
search returns focus to its invoker or Home main content. The active result
now prefers an exact name match; a screenshot exposed the `Brand Starter`
template versus `Brand` project ambiguity before that repair. The matching
option is also exposed through `aria-activedescendant` while focus stays in
the search field. Focused Home units passed **20/20**, the exact-match unit
rerun passed **12/12**, and the lease-wrapped Chromium workflow passed **2/2**
after the final change. Both retained Home screenshots were opened and
inspected: the project result is visibly active, and the exact template is
active below the partial project match. Project navigation moves focus to
Home main content; Escape returns it to the invoker.

- `docs/screenshots/2026-09-24-design-system/home-search-project.png`
- `docs/screenshots/2026-09-24-design-system/home-search-template.png`

`pnpm audit:spacing:report` reports 333 raw declarations in 259 buckets,
and `pnpm audit:sizing:report` reports 69 ratcheted declarations in 54
buckets. They are debt inventories, not evidence that all consumers should be
rewritten. The Inspector CSS audit passes its enforced rules and reports
remaining warning-only debt.

## Visual baseline

The existing Chromium Guide Layouts interaction spec passed **1/1** on the
starting code state. Its 1280px and 390px screenshots were opened and
inspected. The dialog has no dimmed or inert background; its header sits at
the top viewport edge, and the narrow layout remains inside the viewport.
The website's committed Guide Layouts product image shows an editor strip
crossing the dialog's upper controls, which requires a fresh frame-based
reproduction before claiming that exact overlap is current.

- `docs/screenshots/2026-09-24-design-system/guide-layouts-before-desktop.png`
- `docs/screenshots/2026-09-24-design-system/guide-layouts-before-narrow.png`

Research-to-decision details are appended to
`docs/research/design-system-overhaul-2026-09-17.md`. Subsequent milestone
commits will update this ledger with dispositions, screenshots, checks, and
remaining platform limits.
