# ADR-0223: Automated palette extraction as derived, versioned analysis

- **Status:** Accepted
- Date: 2026-08-13

## Context

Importing an image should lead to a useful design palette without blocking the
editor or silently mutating the document. Naive RGB-space clustering is not
perceptually meaningful, and a machine-learning palette model would need
provenance, license, runtime, size, memory, and quality justification before
shipment. The editor needs a deterministic baseline that is fast, local,
cancellable, cacheable, and honest about what it is and is not.

## Decision

1. **Palette extraction is a derived analysis, never persistent document
   state.** No palette blob is added to the document schema. The only
   persisted results are explicit user saves (document swatches or colour
   variables), which reuse the existing immutable document update path and
   remain undoable. Old documents are unaffected; no migration exists or is
   needed.

2. **Deterministic perceptual baseline.** Seeded K-Means++ clustering in
   Oklab over a bounded sample (maximum 4096 weighted points, editor preview
   capped at 256 × 256), with per-cell high-chroma salience sampling so small
   saturated accents survive large neutral backgrounds. The seed is derived
   from the sampled bytes and bounded configuration: equal input and
   configuration produce equal output, suitable for tests, cache keys, and
   reproducible UI review.

3. **Versioned algorithm identity.** `PALETTE_ANALYSIS_VERSION` participates
   in cache identity and bumps when output semantics change. Cache keys are
   `version + asset identity/content hash + dimensions + crop + requested
   colour count`; different crops of one asset are distinct analyses.

4. **Crop-aware, user-explicit source.** When an image has a visible crop,
   the Inspector defaults to analysing the visible crop and offers a Full
   image choice. The choice is part of the analysis configuration and cache
   identity.

5. **Worker boundary with cancellation.** Analysis runs in a module worker
   when available, with job ids, `AbortSignal` cancellation, stale-response
   rejection, and a bounded main-thread fallback for restricted WebViews.
   A stale worker response can never overwrite the palette UI for a
   different asset.

6. **Roles, harmonies, and contrast are suggestions.** Role candidates
   (dominant/accent/neutral/…) are heuristics; derived harmonies are generated
   in OKLCH, gamut-mapped, and marked `origin: "derived"`; contrast pairs use
   the shared WCAG 2.1 relative-luminance helpers and report named thresholds
   (3:1 large-text AA, 4.5:1 body-text AA, and the corresponding AAA values).
   No extracted colour is silently adjusted to manufacture accessibility
   compliance; when no useful opaque pair exists, a warning is surfaced.

7. **No ML dependency for the baseline.** A vision/semantic stage may later
   inform foreground salience weighting or accent promotion only if it is
   local, licensed, benchmarked against this baseline, and measurably better.
   Until then the deterministic pipeline is the shipped source of truth.

8. **Honest colour-management boundary.** The browser decode boundary is
   RGBA8 and browser canvas colour management remains the display authority.
   ICC metadata is carried into the analysis descriptor for provenance;
   profile-aware raster decode is not pretended where the browser does not
   provide it. Native colour-management work stays governed by
   `adr/0217-raster-colour-management.md`.

## Consequences

- Analysis never degrades ordinary image import: it is triggered only by
  selecting an image in the Inspector, is bounded and cancellable, and
  failures surface in the Palette section without affecting the document.
- The numeric pipeline is reproducible across machines and reloads, which
  makes regression testing and cache correctness tractable.
- Users must take explicit action to persist results; the Inspector provides
  name-collision-safe swatch and token saves that never silently replace
  existing document colours.
- The absence of a palette blob in the schema keeps save/reload, autosave,
  and version migration unchanged.

## Follow-up gates

- WCAG 2.2: adopt when the project upgrades its accessibility standard; the
  contrast pair contract only needs the threshold constants and criterion
  label updated.
- Vision salience stage: only with a licensed local model that beats the
  per-cell chroma sampling on the accent-retention corpus (see
  `packages/engine/src/intelligence/paletteExtractor.test.ts` and
  `packages/engine/src/bench/paletteExtraction.bench.test.ts`).
