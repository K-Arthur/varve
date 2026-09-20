# Inspector spacing and density audit (2026-09-19)

Status: implementation evidence record. This document is updated with the
captured baseline, reviewed screenshots, and validation output after the
Inspector density pass.

## Acceptance matrix

| Axis | Required coverage |
|---|---|
| Selection | None, rectangle, frame, text, image, mixed |
| Rail | 240px, 320px, 640px; 1120px narrow viewport |
| Density | Default Pro / Compact Pro |
| Theme | Light, dark, high contrast |
| Disclosure | Collapsed, default, fully expanded |
| Text scale | 100%, 150%, 200% |
| States | Hover, focus, error/validation, density switch |

## Measured contract

- Default Pro resolves Inspector rows to 34px; Compact Pro resolves them to
  28px; coarse-pointer targets promote to at least 44px.
- Section separation is greater than body row spacing in both modes.
- Inspector and section bodies have no horizontal overflow at the required
  rail widths.
- Density changes preserve selection and do not create document/history state.

## Visual evidence

The committed E2E lane writes before/after captures to Playwright's output
directory. Marketing scenes are captured to a review directory and synchronized
only after direct inspection. Approved paths and any caption/alt-text changes
are recorded here once the screenshot pipeline completes.

## Agent Validation Report

```text
Changed scope: Inspector spacing aliases, Inspector control consumers, density E2E coverage, design-system/research/audit docs, reviewed website evidence
Validation plan: pending final implementation run
Commands actually run: pending final implementation run
Passed: pending final implementation run
Skipped as unrelated: pre-existing dirty worktree changes outside this scope
Escalations: full-gate status attributed separately from task-owned failures
Full suite run: pending final implementation run
If yes, reason: Inspector density spacing contract, visual baselines, and website evidence
```
