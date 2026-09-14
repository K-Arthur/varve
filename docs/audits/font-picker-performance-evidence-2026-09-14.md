# Font picker performance evidence — 2026-09-14

This is the repeatable catalog-side measurement for acceptance scenario 21. It
keeps warm picker opening and semantic search separate from cold catalog
construction, because the application constructs the catalog once and then
reuses it while the picker is open.

## Command and environment

```text
pnpm exec tsx scripts/bench/font-picker-performance.ts
```

- Commit under test: `3ceb240eb` (typed semantic snapshot-index follow-up on
  `074c7f073`).
- Runtime: Node `v22.23.2`.
- Samples: 8 warm-up runs, then 40 samples per operation.
- Corpus: deterministic synthetic Fontsource-shaped records at 1,000 and
  10,000 families. Records include static and variable families, a `wdth`
  axis, italic faces, and Latin/Vietnamese coverage metadata.
- The open operation mirrors the picker’s family deduplication, alphabetical
  sort, section header, and family-row construction before TanStack Virtualizer.
- Search uses the production `FontSemanticCatalog.search` ranking path.
- The lookup column measures catalog metadata lookup only. It is not a ready
  face load and must not be read as browser `FontFace` or preview evidence.

## Results

| Families | Cold catalog build (ms) | Warm open p95 (ms) | Warm search p95 (ms) | Metadata lookup p95 (ms) | Rows |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 64.9 | 0.8 | 11.5 | 0.03 | 1,001 |
| 10,000 | 195.5 | 9.9 | 66.1 | 0.02 | 10,001 |

The warm targets are ≤150 ms for opening and ≤100 ms for search, so both
catalog-side budgets pass for this run. The 10,000-family cold build is
reported separately at 195.5 ms; it is outside the warm interaction budget and
should remain visible in future regressions.

## Boundary and next check

This benchmark does not certify a loaded face preview, browser font decoding,
DOM layout, accessibility announcements, or native registry enumeration. The
next executable check for the remaining preview budget is a Chromium run with
real imported font bytes that records the time from selecting a family to a
ready `FontFace`, alongside the existing DPR 1/2/3 toolbar visual spec. The
acceptance matrix therefore remains **Partial** for scenario 21 until that
browser measurement and the 1,000/10,000 native-enumeration run are recorded.
