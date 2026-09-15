# ADR-0158: Four-edge Bézier envelope representation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

A four-sided curved envelope needs a representation that is exact at the
boundary, deterministic in the interior, and safe to serialize.

## Decision

D1 — Envelope = 4 shared corners + 4 cubic edges (two interior control
points each), stored normalized. Corners are shared between adjacent edges,
so edge endpoints can never drift apart.

D2 — Interior interpolation is a Coons patch:

```
P(u,v) = (1-v)·top(u) + v·bottom(u) + (1-u)·left(v) + u·right(v)
         − bilinear corner blend
```

Corners match exactly by construction; boundary agreement holds for source
points on the bound line (verified by tests). Evaluation is allocation-free
(scalar cubic math, precomputed control points).

D3 — Self-crossing or degenerate envelopes are not special-cased in storage;
they produce foldover warnings via Jacobian analysis and the configured
foldover policy (prevent = drag revert, warn, allow).

## Alternatives

- Full 16-point free-form cage: rejected — duplicated corners drift.
- Bilinear-only envelope: rejected — cannot represent curved edges.
