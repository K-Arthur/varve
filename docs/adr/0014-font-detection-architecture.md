# ADR-0014: Font detection architecture

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Users need to identify fonts from imported images, screenshots, and canvas regions. The existing `font-classify` model (EfficientNet B3, 3473 Google Fonts classes) was registered in the inference worker and catalog but had no UI entry point, no class-index-to-family mapping, no confidence calibration, and no local matching fallback.

## Decision

Implement font detection as a hybrid system with three modes:

1. **Classifier mode** — Uses the `font-classify` ONNX model (EfficientNet B3, storia/font-classify-onnx, MIT license) to predict font families from image crops. Returns top-k candidates.
2. **Local-match mode** — Renders recognized text using installed/project fonts and compares visual structures (silhouette overlap, stroke width, x-height, character width). Works without any model download.
3. **Hybrid mode** — Classifier top-k → render-and-compare refinement. Best accuracy but requires the model.

### Honesty-first confidence

All results are tagged with a confidence category (`likely-match`, `plausible-match`, `similar-candidate`, `low-confidence`, `out-of-catalogue`, `insufficient-quality`) — never raw percentages. The system uses temperature scaling, margin analysis, entropy checks, and crop-quality gating to avoid false precision.

### Local-first, privacy-preserving

All inference runs locally in a web worker. No user images leave the device. The classifier model (~64 MB) is an optional one-time download.

## Architecture

```
FontDetectSection (UI)
  → detectFont() (pipeline orchestration)
    → estimateCropQuality() + generateQualityWarnings()
    → estimateTypographyFeatures() (serif, monospace, weight, italic, etc.)
    → [if classifier available] runClassifierDetection()
      → inferenceWorker (font-classify ONNX)
      → decodeFontClassifyOutput() → resolveClassIndex()
      → calibrateConfidence()
    → [if local-match] runLocalMatch()
      → renderAndCompare() (silhouette, stroke width, x-height, char width)
      → calibrateConfidence()
    → rankCandidates() → FontDetectionResult
```

### Key files

| Module | Purpose |
|--------|---------|
| `fontDetectionPipeline.ts` | Orchestration entry point |
| `fontConfidence.ts` | Calibration, temperature scaling, entropy |
| `fontClassLabels.ts` | Class index → family name mapping |
| `fontRenderCompare.ts` | Render-and-compare fallback |
| `typographyEstimation.ts` | Serif/monospace/weight/italic estimation |
| `fontDetectionTypes.ts` | Shared types |
| `FontDetectSection.tsx` | Inspector UI |

## Constraints

- The full 3473-class label map is too large to embed. An embedded subset (~150 families) covers common cases; the full map can be loaded from a bundled JSON.
- Model download is optional — the system degrades gracefully to local matching.
- No new imports added to `Shell.tsx` or `CanvasArea.tsx` (hub file stability).

## Rejected alternatives

- **Pure classifier**: Fails when the font isn't in the 3473-class catalogue; no fallback.
- **Pure render-and-compare**: Slow for large font libraries; no top-k narrowing.
- **Raw confidence percentages**: Misleading for a fixed-catalogue classifier; replaced with calibrated categories.
