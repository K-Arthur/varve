# Shine Border Opportunity Audit — 2026-08-31

## Decision

Varve should ship a Shine Border capability, but production use is restricted
to two short, state-driven moments:

1. a new background-removal preview becoming ready for review;
2. an export finishing with every requested file successful.

Both treatments are one-shot and decorative. Neither may run continuously.
The normal editor should show zero animated shine borders; during either
approved transition it may briefly show one. No marketing-site placement is
approved: Shine Border is interface feedback, not a customer-facing product
capability, and Varve's existing marketing hierarchy does not have an unmet
need that the effect solves.

This audit was completed before production implementation. Both approved
placements were subsequently implemented and retained after direct before/after
visual review. No rejected placement was added.

## Final retention result

The production count is **2/2 approved source integrations** and the expected
ordinary-workflow maximum is one animated instance. No approved placement was
removed after visual review.

| Placement | Final lifecycle gate | Visual verdict | Result |
| --- | --- | --- | --- |
| Background-removal preview ready | A newly mounted `previewSession`; processing and failure have no decoration; Apply or Cancel unmounts the review | The narrow accent segment improves noticeability of the review actions without changing panel dimensions, doubling the structural border, or competing with the canvas; focus hides it | Retained |
| All-success export results | Non-aborted report, `totalJobs > 0`, `failureCount === 0`, and `successCount === totalJobs`; open, new run, retry, failure, partial result, and cancellation clear the gate | The short success arc reinforces completion without washing out in light mode or glaring in dark mode; partial and cancelled results stay quiet | Retained |

Direct review also found no radius mismatch, layout shift, pointer obstruction,
or focus/selection ambiguity. Reduced motion uses a stationary 1 px edge;
high-contrast modes use a stationary 2 px edge. The full durable contract and
renderer validation record are in
[`shine-border-system.md`](../architecture/shine-border-system.md).

## Audit scope

The review covered:

- Home, recent files, first-document empty states, New Design, templates, and
  the browser-demo entry path.
- Welcome, guided tour, checklist, micro-hints, tips, and new-feature badges.
- Background removal, Object Selection, AI/model download, image trace,
  upscaling, content-aware fill, smart filters, and Effect Studio.
- Export, print/preflight, import results, recovery, backup, restore, and
  update flows.
- Settings, performance diagnostics, panels, assets, resources, effects,
  prototype, motion, plugin contributions, dialogs, and canvas empty states.
- The desktop/browser shell and the Astro marketing site: header, hero,
  Product Showcase, shared download/closing CTAs, download recommendations,
  and the browser-demo callout.

The audit evaluated rarity, importance, desired action, lifetime, genuine
newness, existing hierarchy, editor distraction, pointer risk, performance,
and overuse. The default decision was no shine.

## Ranked candidates

Scores are directional, not telemetry. Positive factors are rarity,
importance, a meaningful state transition, and an action the user should
notice. Negative factors are existing visual strength, repetition,
canvas proximity, ambiguity with focus/selection, and runtime cost.

| Rank | Candidate | Evidence and frequency | Existing hierarchy / risk | Score | Decision |
| --- | --- | --- | --- | ---: | --- |
| 1 | All-success export result | `packages/editor/src/components/Export/ExportResultsList.tsx`; episodic completion of a high-value workflow | Summary and success icons are clear, but a brief completion cue reinforces the state without competing with canvas work; one modal instance | +8 | Retained: one `success` beam cycle only when every file succeeded; never animate partial failure, cancellation, or retry |
| 2 | Background-removal preview ready | `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx`; temporary review state after processing | Apply/Cancel requires attention; inspector is canvas-adjacent, so continuous or pointer-reactive motion would distract | +7 | Retained: one restrained accent cycle when a new preview session appears; static accent under reduced motion |
| 3 | First-document Home empty state | `packages/home/src/EmptyStates.tsx`; rare, temporary, and actionable | Centered illustration, explanatory copy, and primary CTA already provide strong hierarchy; the component also serves many unrelated empty states | +3 | Reject for production; no blanket empty-state treatment |
| 4 | Update available action block | update state in `packages/editor/src/updates/UpdateContext.tsx`; rare and important | Status copy and primary action are already clear, and Settings must already be open | +2 | Defer; shine would not solve discovery |
| 5 | Effect Studio/new-feature launcher | inspector and Effect Studio leaf components; potentially temporary | No release-owned newness metadata or persisted seen state proves that it should be promoted | 0 | Defer until an explicit labelled campaign exists |
| 6 | Download-page browser-demo callout | `apps/website/src/pages/download.astro`; singular marketing CTA | Existing accent surface and filled button already win the local hierarchy; adding motion would be ornamental | -1 | Reject; retain current border and CTA |

## Explicit rejects

| Surface | Representative files | Reason |
| --- | --- | --- |
| Welcome and guided onboarding | `packages/editor/src/components/Onboarding/WelcomeDialog.tsx`, `packages/editor/src/components/Onboarding/SpotlightOverlay.tsx`, `packages/editor/src/onboard/OnboardingChecklist/` | Existing modal, spotlight, checklist, and primary-action hierarchy is already strong; more motion would compete with the editor |
| Generic feature badges | `packages/editor/src/onboard/NewFeatureBadge/` | Version entries do not prove current release newness, and several badges could appear together |
| New Design | `packages/home/src/NewDesignDialog.tsx` | Dense intentional choice surface with a clear Create action and no exceptional recommended option |
| Recent files, templates, assets, resources | Home file/grid/list and asset browser components; editor resource/icon/library panels | Repeated pointer-heavy items; many simultaneous borders would collapse hierarchy |
| Generic empty states | `packages/home/src/EmptyStates.tsx`, editor canvas empty hint | Shared across search, trash, templates, projects, and collections; canvas motion would distract |
| Model download and management | `BackgroundRemoval/ModelDownloadDialog.tsx`, Settings model tabs | Consent, progress, and status already communicate the workflow; animation could pressure a download decision |
| Other AI and smart tools | AI panel, Vectorize, Upscale, Content-Aware Fill, Lens Blur, smart filters | Already-invoked, dense workflows with previews, warnings, and primary actions; no discovery problem is solved |
| Smart quick actions | Selection quick bar and canvas-adjacent tool launchers | Precision controls near the canvas; shine could read as hover, focus, selection, or processing |
| Print/preflight | `Export/PreflightFindingsPanel.tsx` and print panels | Warning/error iconography must remain unambiguous; there is no live scan state that warrants a scan animation |
| Recovery, restore, and backup | `RecoveryDialog.tsx`, `Backup/RestoreBrowser.tsx`, crash recovery surfaces | Serious and sometimes destructive decisions; celebratory or urgent motion is inappropriate |
| Settings and diagnostics | Settings tabs, interaction trace, AI/performance diagnostics | Persistent, dense, or live-updating information with no temporary discovery need |
| Consent | Update, privacy, and analytics consent surfaces | Animated emphasis would be coercive |
| Effects/treatment galleries | Effect Studio and smart-filter cards | Repeated rich previews already compete for attention and can be visible in quantity |
| Prototype and motion | Prototype panels/player and timeline/state-machine surfaces | Persistent, state-rich, and often already animated; shine would obscure selection/playback semantics |
| Plugins | contributed inspector/plugin sections | The host must not auto-promote arbitrary contributed UI |
| Premium treatment | account plan badge | No supported premium hierarchy; Varve is currently free during beta |
| Browser-demo banner in the app | `apps/desktop/src/demo/DemoBanner.tsx` | Persistent limitations disclosure above the canvas must stay honest and quiet |
| Generic Cards, Buttons, Panels, Dialogs, rows | shared UI primitives | Component type is not semantic importance; global application would destroy rarity |

## Approved visual language

The shared primitive may expose only the variants required by the audit:

- `static`: nonanimated accent fallback and reference treatment;
- `subtle`: calm, low-contrast hover/fine-pointer enhancement for authoring
  fixtures, not a persistent production loop;
- `beam`: one state-triggered cycle for the two approved production moments.

The semantic tones are `accent` and `success`. Raw gradients, arbitrary color
stops, intensity controls, scan, pointer-following spotlight, glow/blur, error
animation, and an always-on production mode are rejected. The default remains
quiet and animation stays opt-in through the selected variant plus `active`
state.

The implementation must decorate the existing element rather than insert a
layout wrapper. This preserves direct flex/grid placement, dimensions, radius,
semantics, focus order, and pointer behavior. A masked 1 px pseudo-element may
paint over the host edge; it must be pointer-transparent, use semantic tokens,
avoid filters, preserve the real focus ring, and fall back to a static border
when masks or conic gradients are unavailable.

## Marketing website decision

The Astro site was reviewed independently because it does not consume React
components. The following remain explicit no-shine surfaces:

- `SiteHeader.astro` and `DownloadCTA.astro`: persistent and reused site-wide;
- `Hero.astro`: already contains floating cards and pointer parallax;
- `ProductShowcase.astro`: already visually dominant and non-actionable;
- `ClosingCTA.astro`: repeated across many pages;
- download recommendation cards: trust-heavy choices with existing chips and
  selected styling;
- `.try-browser-banner`: the only plausible single-use experiment, but its
  accent surface and filled link already communicate priority.

No marketing copy, SEO claim, navigation entry, promotional screenshot, or
website Shine Border is justified. If a future release creates a genuine,
time-bounded campaign card, it may consume the framework-neutral shared CSS
contract with a static or hover-only treatment. The website must not add React
hydration or duplicate colors/timings for this effect.

## Verification gates

The current integrations were retained against these gates. The same gates
remain mandatory before any production placement is added or moved:

1. Capture the unchanged surface and the decorated surface at identical size.
2. Inspect idle, mid-cycle, brightest, terminal/static, focus, light, dark,
   high-contrast, and reduced-motion states.
3. Verify clicks, keyboard focus, scrolling, resize, and pointer pass-through.
4. Confirm partial failure/error states have no animation.
5. Confirm normal editor screens show zero active animations and the approved
   transition shows at most one.
6. Stress 5, 10, and 20 authoring-fixture instances; idle instances must have
   no running animations.
7. Exercise Chromium and Playwright WebKit, and separately inspect the native
   Linux WebKitGTK/Tauri surface because Playwright WebKit is not equivalent.
8. Remove any placement that resembles focus/selection, washes out in light
   mode, glares in dark mode, or does not improve noticeability.

## Production ceiling

The approved ceiling is two integration sites in source and one animated
instance at a time. The current count is at that ceiling: background-removal
review and all-success export results. Adding or replacing a site requires a
fresh semantic audit and before/after visual evidence; importing `ShineBorder`
into `Shell.tsx`, `CanvasArea.tsx`, a repeated-row component, or a shared
Card/Button default is not allowed.
