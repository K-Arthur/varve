# Research-to-decision ledger — design-system overhaul (2026-09-17)

This pass executed the remaining slices of the precision-first design-system
overhaul mandate after the density, input-surface, toolbar/HUD, and
Inspector-composition slices landed through their own passes (see
`docs/agents/interface-density-2026-09-17-ownership.md`,
`docs/agents/inspector-input-surface-system-2026-09-16-ownership.md`,
`docs/agents/inspector-systems-redesign-2026-09-17-ownership.md`,
`docs/audits/toolbar-review-2026-09-15.md` +
`docs/audits/toolbar-surface-review-2026-09-17.md`). This ledger records
what external evidence was refreshed, what the repo audit found, and which
decisions followed.

## External sources — refresh status

| Ref | Source | Status | Effect on decisions |
|---|---|---|---|
| R1 | Google Design, "Expressive design: Google's UX research" | **Refreshed 2026-09-17** (fetched). 46 studies, 18k+ participants; expressive designs spotted key elements up to 4× faster; erasure of age effects; but removing text labels decreased usability and unstructured novelty hurt usability scores | Justified keeping the fixed, labelled, restrained shell; the document-accent mode is emphasis within proven patterns, not decoration; no label removals proposed |
| R2 | Figma, "Our approach to designing UI3" (2024-10-01) | **Refreshed 2026-09-17** (fetched). Floating panels reversed after they slowed users and cramped canvases; clip-content dropdown reverted to a checkbox; hidden blend-mode state replaced by inline control | Reinforced docked/flush panel defaults, visible-state rules for blend/opacity badges in Layers, and the "state must not need a tooltip" rule used in prior slices |
| R3 | Adobe Community, contextual task bar (2023) | Carried from the provided starting research; not re-fetched this pass. Prior slices already implemented the response (placement persistence, hide/show, non-chasing quick bars) | No new decision |
| R4–R9, R10–R14, R15, R16 | W3C CSS Color 4; WCAG 2.2 Target Size, Dragging, Contrast, Non-text Contrast, Focus Not Obscured; APG Spinbutton/Combobox/Tree patterns; C39 reduced motion; Resize Text | Stable specifications. The repo already enforces: target-size floors (toolbar slices), dragging alternatives (NumberField/scrub contract), contrast (`audit:tokens`), tree/treegrid semantics (Layers), reduced-motion reset (tokens.css global + this pass's token migration), UI font-size scaling (density pass). This pass's canvas pairs + runtime accent validation apply R7/R8 directly | Canvas token pairs (1.4.11), accent AA re-validation (1.4.3), duration-token migration (C39), font-size tokenization (1.4.4) |

Honesty notes: R3 was not re-verified first-hand this pass; the two fetched
summaries are the model's reading of the pages, not verbatim transcripts.
No prevalence claims were invented; competitor behavior cited in this
pass's decisions is limited to what prior passes verified.

## Repo audit findings (2026-09-17, read-only inventories)

1. **Canvas marks had no token identity.** Selection/handles/guides drew
   with `--color-interactive-default` / `--color-accent-primary` /
   `--color-surface-overlay` — aliasing the interface accent family.
   Consequence: any accent-family theming (including the mandate's
   document-derived accent) could recolor or hide the marks users steer by.
   → Decision: dedicated canvas tokens first (M1), accent mode second (M2).
2. **Light-theme guides failed 1.4.11.** Bright accent T(6) on the board
   measured 1.78:1; surfaced only when canvas pairs entered
   `CONTRAST_PAIRS`. → Repaired to the selection step (3:1+).
3. **Stale token names rendered hex fallbacks.** 93 undefined token names in
   editor CSS; the accent/warning/danger/error/success class rendered
   theme-blind hexes in ~13 files. → Canonical-name repairs (M3); ambiguous
   remainder documented as debt.
4. **Raw durations escaped reduced motion.** 5 transitions with hardcoded
   ms values bypassed the global `--duration-*` reset. → Tokenized (M3).
5. **Raw 10/11px labels bypassed user text scaling** (1.4.4). → Tokenized
   to the type scale at equal rendered size (M3); size floors remain
   unchanged (deliberate; recorded).
6. **No document-derived accent existed.** `paletteExtractor` was
   artwork-facing only. → Implemented as the gated M2 feature on the
   existing worker + thumbnail pipeline (no new render path, no readbacks
   beyond a 64×64 decode of the canonical preview).

## Decision gates

- **Why token-split-first, accent-second:** the mandate's non-negotiable is
  that a dominant artwork color must never make handles disappear or
  repurpose semantic color. Shipping accent mode before the split would
  have made selection color depend on extraction quality. Verified in the
  E2E: with a saturated red page in document mode, canvas handles stay
  teal and identifiable against same-hue artwork
  (`accent-03-document-mode.png`).
- **Why hue-rotate-only ramps:** reusing the audited TEAL ladder's L/C per
  step keeps every previously validated contrast relationship valid by
  construction; runtime re-validation is a guard, not a license. A
  free-lightness ramp would have required re-deriving and re-auditing all
  interactive pairs at runtime.
- **Why no auto-recolor:** R1's familiarity findings + the mandate's
  stability rules; the mode is explicit, resettable, and off by default.
  No productivity claim is made for it.
