# Hollowpine Coffee Roasters — v7 render report

## Deliverables

- `v7.mp4` — H.264/AAC, 1080×1920, 30 fps, 34.60 s, 58,664,289 bytes (56.0 MiB), below the 90 MB limit.
- Six v7 review stills, `v7-01-opening.png` through `v7-06-document.png`.

## Source and bug exclusions

- V7 uses Hollowpine Coffee Roasters “Ember Ridge” store shots and their measured targets from `shots-store/bboxes.json`.
- The mobile preview was never shown. Preview/output captures with the documented duplicate email, text alignment, CTA-label, plain-text URL, or preflight defects were not used. The compatibility scene uses only a crop of the “Compatibility” heading within the measured preflight panel, excluding its warning rows and mismatched counts.
- The narration and word timing are unchanged from v6. Captions retain the existing wording, use 90 px bold text with a dark backing and blue keyword boxes, and move to a clear position above or below the UI.

## Frame-by-frame checks

- All 1,038 frames were checked against the projected screenshot-card bounds and focused-item/label-chip bounds. Caption intersections: **0 with UI cards; 0 with selection boxes or chips**. A 12 px clearance margin was included when choosing caption positions.
- Caption safe-zone failures: **0**. Every caption stays within y=290–1440 and x=150–930, centered at x=540. Maximum caption-centre error: 0 px.
- Screenshot cards remain horizontally centred; maximum measured centre error: less than 0.001 px.
- Focus targets use store-shot bounding boxes transformed through each animated crop and camera scale. Hold frames were reviewed from the final encoded video:

| Voice cue | Focus target | Reviewed frame |
| --- | --- | ---: |
| “workspace” | Email block in the workspace | 4.55 s |
| “email” | Email workspace button | 5.75 s |
| “blocks” | Email content layer list | 7.50 s |
| “logo” | Hollowpine header logo | 8.36 s |
| “hero” | Ember Ridge hero image | 8.80 s |
| “heading” | Email heading | 9.30 s |
| “button” | “Shop the blend” CTA button | 9.75 s |
| “Preview” | Email Preview tab | 10.65 s |
| “email” | Finished Hollowpine email | 11.50 s |
| “compatibility” | Compatibility heading | 14.10 s |
| “export” | Export HTML, text, and manifest button | 16.00 s |
| “HTML” | Export HTML, text, and manifest button | 17.40 s |
| “plain-text” | Export HTML, text, and manifest button | 18.80 s |
| “block” | Email content layer list | 20.95 s |
| “document” | Varve document overview | 22.75 s |
| “local” | Email block in the workspace | 25.00 s |

## Audio and decode

- The existing AAC stream was copied without re-encoding; its compressed-stream MD5 matches v6 (`c86c32bb162ee36d49ad13bd55447f1e`).
- FFmpeg `ebur128` measured integrated loudness **−14.0 LUFS**, true peak **−3.5 dBFS**.
- Full decode passed: **1,038 frames**, 34.60 s, 1080×1920 at 30 fps.
