# Color-Management Program — Progress

Status log for the color-management program (document profile semantics, managed
text color, Lab/LCH picker, soft proofing, spot-color authoring).

## Completed milestones

| # | Milestone | Status | Commit | Notes |
|---|---|---|---|---|
| 0 | Repository color-architecture audit + implementation map | Done | (next) | `docs/plans/color-management-implementation-map.md` |

## In progress

- M1 Canonical managed-color model.

## Affected packages

(pending)

## Schema versions

| Format | Version | Notes |
|---|---|---|
| Document | 2.12 | current; M2 will bump to 2.13 (text color migration) |

## Tests run

(pending)

## Performance results

(pending)

## Known limitations / deferred

- Monitor-profile-accurate soft proofing unavailable in browser canvases —
  documented approximation only.
- PDF spot (Separation/DeviceN) export deferred until `strata-print` supports it.
- Registration color rendering on canvas approximated as black (all plates).
