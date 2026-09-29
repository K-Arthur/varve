# Tonal workflow visual review — 2026-09-28

These are actual opened artifacts, not mockups. The Chromium editor captures
use isolated ports and a new browser profile. All screenshots 01–07 were
opened at overview/detail scale. The photo is the repository's existing
generated photo-style fixture ([provenance](../../testing/real-image-validation-corpus.md));
the 512×384 neutral cast/ramp/primary-color fixture is authored
for this task. Synthetic references are not photo quality certification.

The two website illustrations are registered as `tonal-curves` and
`tonal-split-tone` in the screenshot manifest. After opening a completed
capture run, sync only these scenes with:

```bash
node scripts/screenshots/sync-tonal-scenes.mjs docs/screenshots/tonal-workflows
node scripts/screenshots/validate.mjs
```

The sync checks PNG dimensions and hashes, copies the reviewed bytes to the
canonical `docs/screenshots/product/` and website directories, and retains
other scenes. `lastValidatedAgainst` remains null because the capture used
a dirty master candidate. The manifest supplies website alt text and captions.

| Capture | Opened finding |
| --- | --- |
| 01 Curves | Photograph, retained channel selection, upstream histogram and precise point values fit the inspector. |
| 02 Mixer | Independent output row controls retain values; compact visible labels avoid truncating accessible names. |
| 03 White Balance | A known gray cast becomes neutral; the diagnostic remains visibly upstream as labelled. |
| 04 Split Toning | Smooth cool shadows/warm highlights on the reference; independent swatches/values remain accessible by scrolling. |
| 05 Channel selection | Source preview and saved coverage are distinct; inspection returns to Composite after context remount. |
| 06 Sharpen detail | Filter input and output crops show controlled edge contrast and halos at one document pixel per CSS pixel. This is before the layer mask/opacity. |
| 07 Dark/high contrast, DPR 2 | Actual curve graph and selected point are visible; the repaired one-column Input/Output fields show both complete labels and fractional values. |
| kernel-sharpen-reference | Flat patches stay flat, edge contrast increases, alpha feathering has no dark contamination, no tile seam is visible. Independent numerical tests validate domains and tile boundaries. |
| curve-01–05 recording frames | Successive frames from the saved curve interaction video show a point crossing another, Undo and a second drag. Real E2E assertions separately verify stable identity and Escape rollback. |
| 08 PNG, SVG embedded image and PDF render | All three were opened after repair. Flat cast, ramp and primary patches agree; the PDF no longer has RGB stride stripes. Visible local sharpening halos are intentional authored contrast. |
| 08 Object Filter stack | The original source remains editable with all five treatments in authored order. |
| 09 browser demo | The actual account-free try route exposes all five controls with stored values. |
| website mobile top captures | 390px light/dark viewports show readable heading/body/navigation without horizontal overflow. Root and /varve routes are independently tested. |
| website forced colors | The native forced-colors capture was opened; content/images/links remain present. This is browser emulation, not a physical assistive-technology certificate. |

The videos are retained locally under `reports/ui-review/tonal-workflows/`
(`curve-interaction.webm`, `sharpen-reopen.webm`). Frames were extracted at
four-second intervals beginning at second 35. They are not a frame-rate or
physical touch/pen certificate. Apparent dramatic color changes while dragging
an inverted/nonmonotonic curve are authored transfers, not unexplained gamut
or alpha changes.

The visual review caught cramped repeated numeric labels and the curve's
two-column Input/Output row. Both were repaired and the captures reopened.
Screenshots from failed startup or mismatched diagnostic regions are not
called passes. Export and native artifacts have separate result records in
the audit, with pending physical-device checks kept explicit.

Opening the first PDF caught packed-RGB corruption despite a successful
header check. The committed `08-pdf-render.png` is the corrected rerun, with
independent interior patch comparisons against PNG (component tolerance 2).
Both exported PNG and SVG's embedded PNG were reopened at pixel detail. The
opaque export fixture does not itself prove partial-alpha export; the PDF
soft-mask byte test covers that separate contract.

The actual corrected exports are retained as
[PNG](08-tonal-object.png), [SVG](08-tonal-object.svg) and
[PDF](08-tonal-object.pdf), alongside the opened Poppler render. They contain
only the self-authored tonal reference, not private artwork.

Reproduce with the exact commands and fixture descriptions in the
[audit](../../audits/tonal-workflows-2026-09-28.md). See the practical website
guide at `apps/website/src/pages/docs/tools/tonal-adjustments.astro`.
