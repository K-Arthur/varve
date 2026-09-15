# Shine Border System

**Status:** Implemented, beta, governed allowlist

**Scope:** `@varve/ui`, the two approved editor integrations, browser and Tauri renderers

**Related:** [opportunity audit](../audits/shine-border-opportunity-audit-2026-08-31.md),
[design principles](../design/design-principles.md), ADR-0002 (theme tokens)

Shine Border is a decorative edge emphasis for a rare, meaningful state
transition. It is not a general Card, Button, dialog, selection, loading, or
marketing treatment. The ordinary Varve interface has no active shine
animation; an approved transition may briefly introduce one.

The default decision for every new proposal is **no shine**. A proposal must
pass the future-use checklist below and receive a repository-level semantic and
visual audit before it can increase the production allowlist.

## Production allowlist

The current production count is **two source integrations**, with at most one
animated instance expected in a normal workflow.

| State | Source | Trigger | Tone | Lifetime |
| --- | --- | --- | --- | --- |
| Background-removal preview ready for review | `packages/editor/src/components/Inspector/sections/BackgroundRemovalSection.tsx` | A new `previewSession` mounts after processing finishes | `accent` | One 1.6 s `beam` cycle; the review panel then keeps a quiet edge until Apply or Cancel unmounts it |
| Export completed with every requested file successful | `packages/editor/src/components/Export/ExportResultsList.tsx`, gated by `ExportDialog.tsx` | A non-aborted report has `totalJobs > 0`, no failures, and `successCount === totalJobs` | `success` | One 1.6 s `beam` cycle on the results section |

Export cancellation, partial success, failure, a stale previous report, and a
new or retried run clear the success gate. Background-removal processing,
failure, and the pre-preview controls have no shine. These state owners remain
the source of truth; the decorative component must not infer business success.

No app-wide registry automatically decorates surfaces. In particular,
`Shell.tsx`, `CanvasArea.tsx`, repeated rows, shared Cards and Buttons, plugin
contributions, loading UI, focus, and selection are outside the allowlist.

## Public API

`ShineBorder` is exported from `@varve/ui`.

```tsx
<ShineBorder variant="beam" tone="success" active={allSucceeded}>
  <section className="export-results" aria-label="Export results">
    {/* Existing content and semantics */}
  </section>
</ShineBorder>
```

| Prop | Type / default | Contract |
| --- | --- | --- |
| `children` | one `ReactElement` | Required class-forwarding, pseudo-element-capable host; fragments and multiple children are rejected |
| `variant` | `static \| subtle \| beam`; default `subtle` | Selects the constrained visual language described below |
| `tone` | `accent \| success`; default `accent` | Selects semantic token families; arbitrary gradients and colors are unsupported |
| `active` | `boolean`; default `true` | Gates decoration. A false-to-true transition replays `beam` |
| `disabled` | `boolean`; default `false` | Stops and hides only the decoration; disabled semantics remain the child's responsibility |
| `className` | `string`; default empty | Merged onto the existing host with the child's classes |

The component clones its child. It does not insert a DOM wrapper, move focus,
replace the child ref, or intercept the child's handlers.

## Variants, tones, and tokens

| Variant | Behavior | Production use |
| --- | --- | --- |
| `static` | Stationary 1 px semantic edge | Fallback, reduced-motion reference, and authoring fixtures |
| `subtle` | No idle animation; a 4.8 s loop only while a fine pointer hovers | Storybook and deliberate authoring references; no current production placement |
| `beam` | One 1.6 s ease-out edge sweep, ending at a quiet 0.34 opacity | Both allowlisted product transitions |

`accent` resolves through `--color-interactive-default` and
`--color-accent-primary`. `success` resolves through
`--color-feedback-success` and `--color-feedback-success-strong`, with a safe
fallback to the base success token. Motion uses `--duration-emphasis` (1600 ms),
`--duration-emphasis-loop` (4800 ms), and `--ease-out`. The token generator
sets both emphasis durations to zero in its reduced-motion block as an
additional guard.

The retained animation changes only a registered angle custom property and
opacity. It has no blur, glow, `filter`, pointer tracking, JavaScript animation
loop, or `will-change` promotion. Scan, spotlight, persistent beam, raw color
stops, intensity controls, and error tones are deliberately absent.

## Host and DOM contract

Shine Border paints through the host's reserved `::after` pseudo-element.
Adopters must satisfy all of these conditions:

1. Supply exactly one element that forwards `className` to the element whose
   edge should be decorated.
2. Keep `::after` free; Shine Border owns it while the class is present.
3. Let the host own its real dimensions, structural border, background,
   overflow, and `border-radius`. The pseudo-element uses `inset: 0`,
   `box-sizing: border-box`, and `border-radius: inherit`.
4. Account for containing-block behavior. The class makes a static host
   `position: relative`; a host with absolutely positioned descendants must
   already intentionally own their containing block.
5. Keep semantic roles, accessible names, focusability, disabled state, and
   event handlers on the child. `ShineBorder.disabled` is not a substitute for
   `disabled` or `aria-disabled`.

The pseudo-element is always `pointer-events: none`. Mouse click, right-click,
hover, keyboard focus, and context-menu behavior therefore remain host-owned.
Because there is no wrapper, direct flex/grid placement and measured width and
height are unchanged.

## State and replay contract

`active={false}` removes the active class and leaves no visible decoration.
Changing it to `true` creates the one-shot CSS animation for `beam`. State
owners must clear `active` before beginning another operation so a previous
success cannot survive into pending, cancelled, failed, or retry UI.

Focus never restarts a one-shot. While the host itself is `:focus-visible` or
contains focus, the pseudo-element becomes invisible and the original animation
timeline continues. When focus leaves, the same animation is revealed at its
current or terminal state. Native `disabled`, `aria-disabled="true"`, and the
component's disabled class stop and hide the decoration.

## Accessibility and theme behavior

- Decoration has no semantic content. Existing status text, icons, live
  regions, button labels, and workflow state remain authoritative.
- `prefers-reduced-motion: reduce` removes animation and renders one crisp,
  stationary semantic edge at 0.58 opacity.
- The explicit `data-theme="high-contrast"` theme and OS
  `prefers-contrast: more` mode render a stationary 2 px
  `--color-border-strong` edge with no mask.
- Under `forced-colors: active`, the pseudo-element is omitted. The host's
  structural border and standard focus treatment remain visible.
- Focus and focus-within hide the decorative edge so the real focus ring owns
  the interaction state. Shine never communicates focus or selection.
- Light and dark themes use their semantic token values; there are no
  theme-specific hard-coded colors.

## Rendering and fallback path

The base implementation is a normal tokenized 1 px border and is the safe
fallback. Engines that support both a conic gradient and mask composition
enhance it into a ring. Standard `mask-composite: exclude` and WebKit's
`-webkit-mask-composite: xor` are both supported. If either required capability
is missing, the border remains stationary and usable; there is no JavaScript or
canvas fallback.

| Environment | Expected path |
| --- | --- |
| Chromium / Firefox | Enhanced masked ring when capability probes pass; otherwise static edge |
| Safari / Playwright WebKit | WebKit-prefixed mask path when available |
| Tauri on Linux / WebKitGTK | Same prefixed capability path, validated independently from Playwright WebKit |
| Reduced motion / high contrast | Explicit stationary CSS path regardless of enhanced support |
| Forced colours | No decorative pseudo-element; retain structural and focus UI |

## Performance ceiling

Inactive hosts and non-hovered `subtle` hosts have zero running animations.
Only an active `beam` or a fine-pointer-hovered `subtle` fixture animates. The
5/10/20-instance stress fixture verifies 35 mounted idle hosts produce zero
shine loops and hovering one eligible host produces at most one loop.

The production ceiling remains two integration sites. Any proposal involving a
repeated collection must prove bounded simultaneous instances and idle zero
animation, but repeated rows are presumed ineligible because they destroy
visual hierarchy even when technically inexpensive.

## Validation record

The implementation was checked at unchanged geometry and at before, brightest,
mid-cycle, terminal, focus, hover, reduced-motion light/dark, high-contrast, and
5/10/20-instance stress states.

| Layer | Result |
| --- | --- |
| Component contract | Unit coverage verifies zero wrapper, semantics, ref/click preservation, class merging, active/disabled separation, and invalid-child rejection |
| Production lifecycle | Editor tests verify background-review activation and export success, cancellation, failure, partial, retry, and stale-state gates |
| Chromium | The shared visual/interaction fixture plus both production workflows passed |
| Firefox | The shared visual/interaction fixture passed, including the capability-dependent fine-hover branch |
| Playwright WebKit package | Host launch is unavailable on the Arch development machine because the downloaded Ubuntu-targeted browser requires absent ICU/XML/Flite compatibility libraries; this is a harness-host limitation, not a product fallback result |
| Native Tauri / WebKitGTK | The native WDIO fixture exercises enhanced-or-static capability selection, geometry, pointer transparency, inherited radius, high contrast, focus continuity, and native screenshots |
| Storybook | Static build and the reference gallery cover variants, tones, radii, themes, replay, disabled state, and 5/10/20 idle instances |

The first run against the real Tauri/WebKitGTK surface selected the enhanced
animation path and passed its geometry, pointer-transparency, and correct
radius-inheritance assertions. It then exposed a test-fixture error: the explicit
high-contrast theme had been placed on the decorated host rather than an
ancestor, contrary to Varve's theme contract. The fixture was corrected to use
theme ancestors; this was not a product CSS failure. The final isolated run
against the corrected WebDriver-enabled desktop binary passed 1/1 under
WebKitGTK 605.1.15. Its midpoint and focused captures are retained in
`artifacts/desktop/shine-border/`; under Xvfb, DOM focus ownership and animation
continuity were verified while the browser matrix remains authoritative for the
strict `:focus-within` paint cascade.

Direct screenshot review retained both production placements. The
background-removal cue is a narrow accent segment that improves discovery of
the review actions without moving the panel; the export cue is a short success
arc at the result boundary. Light mode did not wash out, dark mode did not
glare, radii stayed aligned, structural borders did not double visually, and
the focus ring clearly won during keyboard interaction. No approved placement
was removed after review.

The browser fixture lives in `tests/e2e/ui/shine-border.spec.ts`, production
coverage in `tests/e2e/canvas/background-removal.spec.ts` and
`tests/e2e/spec/export-workspace.spec.ts`, and the native fixture in
`tests/wdio/shine-border.e2e.ts`.

## Marketing website decision

`apps/website` has no Shine Border component, class, selector, markup, copy,
SEO claim, or promotional screenshot. The header, hero, Product Showcase,
shared CTAs, download choices, closing CTA, and browser-demo callout already
have sufficient hierarchy; adding animated trim would be ornamental and would
misrepresent an interface feedback primitive as a product feature.

The site imports the shared token sheet, so the two emphasis-duration custom
properties are available but intentionally unused. This does not create CSS
animations or runtime work. A future website proposal requires its own
time-bounded campaign audit; it must not add React hydration or duplicate
colors and timings merely to reproduce this effect.

## Future-use checklist

Before adding or moving a production integration, answer every item with
evidence:

1. Is the state rare, important, newly reached, and associated with a useful
   next action?
2. Does existing hierarchy fail to make that transition noticeable?
3. Can the treatment be one-shot, with zero idle animation and at most one
   ordinary-workflow instance?
4. Is it unambiguously different from focus, selection, loading, warning,
   consent, or error?
5. Does the state owner provide an explicit fresh lifecycle gate, including
   cancellation, failure, retry, and stale-state clearing?
6. Does the host satisfy the class-forwarding, `::after`, containing-block,
   radius, focus, and pointer contracts?
7. Do before/after captures at identical geometry improve hierarchy in light,
   dark, reduced-motion, high-contrast, focus, hover, and terminal states?
8. Do Chromium, Firefox, the WebKit capability/fallback path, and the actual
   desktop renderer behave correctly?
9. Do 5/10/20-instance checks retain zero idle animations and acceptable
   interaction behavior?
10. Has the opportunity audit, this allowlist, production count, tests, and
    relevant product/website documentation been updated?

If any answer is no or merely speculative, do not add the placement.
