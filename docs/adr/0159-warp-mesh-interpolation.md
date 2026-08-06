# ADR-0159: Mesh warp interpolation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Mesh warps need deterministic interpolation that renders, exports, and hit
tests identically on every backend.

## Decision

D1 — v1 implements **bilinear** per-cell interpolation over a regular
(row+1)×(columns+1) normalized grid, with clamping of the sampling position
to [0,1] (documented; matches the existing `meshWarp.warpPosition`).

D2 — `interpolation: 'bicubic'` is validated and serialized but **not
evaluated** in this version: the schema accepts it, validation preserves it,
and the evaluator degrades to bilinear with a documented warning. Bicubic
will ship only after continuity/boundary verification, per the task
requirement.

D3 — Mesh dimension limits: 1..32 cells per axis; point count capped
(33×33 max). Topology ops (add/remove row/column) are Inspector-only in v1;
undo, collaboration ops, and validation for topology edits are defined
before any command-surface expansion.

## Alternatives

- Free-form triangle mesh: rejected — regular grid gives stable undo,
  validation, and predictable subdivision.
