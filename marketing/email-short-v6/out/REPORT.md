# Hollowpine Coffee Roasters — v7 render report

## Deliverables

- `v7.mp4` — H.264/AAC, 1080×1920, 30 fps, 34.602 s, 58,487,578 bytes (55.8 MiB), below the 90 MB limit.
- Six v7 review stills: `v7-01-opening.png` through `v7-06-document.png`.

## Source and visual corrections

- V7 uses Hollowpine Coffee Roasters “Ember Ridge” store shots and measured targets from `shots-store/bboxes.json`.
- The logo, hero, heading, and CTA each use a separate crop aligned to the spoken cue. The logo frame shows only the Hollowpine header logo with its selection box; the hero crop begins on the “hero” cue.
- The Preview beat selects the Preview tab in the editor chrome. It has no floating label chip over the canvas or email design.
- Selection outlines are crisp, solid blue with corner handles; there is no glow or feathering. The existing narration and caption wording/timing are unchanged. Captions use 90 px bold text, a dark backing and outline, and blue keyword emphasis.
- No mobile preview is shown. Preview/output captures with documented duplicate email, alignment, CTA label, plain-text URL, or preflight defects are excluded. The compatibility scene uses only a crop of its heading, outside the warning rows and mismatched status counts.

## Frame-by-frame checks

- All 1,038 frames were checked against projected screenshot-card bounds and focused-item/label-chip bounds. Caption intersections: **0 with UI cards; 0 with selection boxes or chips**. Caption placement failures: **0**.
- Caption safe-zone failures: **0**. Every caption stays within y=290–1440 and x=150–930, centered at x=540. Maximum caption-centre error: 0 px.
- Screenshot cards remain horizontally centred; maximum measured centre error: less than 0.001 px.
- Store-shot bboxes were transformed through the animated crop and camera. Hold frames were reviewed in the final encoded video:

| Voice cue | Focus target | Reviewed frame |
| --- | --- | ---: |
| “workspace” | Email block in the workspace | 4.55 s |
| “email” | Email workspace button | 5.75 s |
| “blocks” | Email content layer list | 7.50 s |
| “logo” | Hollowpine header logo only | 8.30 s |
| “hero” | Ember Ridge hero image | 8.80 s |
| “heading” | Email heading | 9.30 s |
| “button” | “Shop the blend” CTA button | 9.75 s |
| “Preview” | Preview tab in editor chrome; no label chip | 10.80 s |
| “email” | Finished Hollowpine email | 11.50 s |
| “compatibility” | Compatibility heading | 14.10 s |
| “export” | Export HTML, text, and manifest button | 16.00 s |
| “HTML” | Export HTML, text, and manifest button | 17.40 s |
| “plain-text” | Export HTML, text, and manifest button | 18.80 s |
| “block” | Email content layer list | 20.95 s |
| “document” | Varve document overview | 22.75 s |
| “local” | Email block in the workspace | 25.00 s |

## Audio and decode

- The original AAC narration track was copied unchanged; compressed-stream MD5 matches v6 (`c86c32bb162ee36d49ad13bd55447f1e`).
- FFmpeg `ebur128` measured integrated loudness **−14.0 LUFS**, true peak **−3.5 dBFS**.
- Full decode passed: **1,038 frames**, 1080×1920 at 30 fps, 34.602 s.
