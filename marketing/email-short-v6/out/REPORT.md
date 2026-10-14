# Varve email workspace Short v6 — render report

## Deliverables

- `varve-email-short-v6.mp4` — H.264 video and AAC audio, 1080×1920, 30 fps, 34.60 s, 68,755,598 bytes (65.6 MiB), below the 90 MB limit.
- Six 1080×1920 RGB stills, `01-opening.png` through `06-plain-text.png`.

## Render checks

- The revised highlight pass uses a crisp 3 px blue rounded selection box, four small white corner handles, and a dark blue label chip. The screenshot outside the measured target is dimmed; no glow or feathered outline is used.
- All 15 focus holds below were reviewed from the final encoded video. The logo at 8.36 s and CTA button at 9.86 s were inspected enlarged; both land on the named item with the box, handles, and chip visible.
- Every focus box was checked against its source bbox after applying the scene crop and scale. Targets are fully visible at their hold frames; the full email-preview iframe is 99.8% visible because the source capture clips two pixels at its lower edge.
- Camera moves use eased interpolation, generally 0.4–0.6 s, with focus holds around 0.8–1.2 s. The visual changes follow the voiceover's short feature beats.
- Caption and callout layout is horizontally centred. Caption overlays stay within the specified x≤930, y=290–1440 safe area. The desktop preview is used; the mobile preview is never opened.
- The original AAC audio stream was copied without re-encoding; its compressed-stream MD5 matches the prior render. FFmpeg `ebur128` measured integrated loudness **−14.0 LUFS**, true peak **−3.5 dBFS**. Music remains mixed quietly under the voice and fades at the end.
- Full decode completed successfully: 1,038 video frames, 34.60 s.

## Focus-to-voice review

| Voice cue | Focused item | Hold check |
| --- | --- | ---: |
| “workspace” | Email workspace card | 4.38 s |
| “email” | Email workspace button | 5.60 s |
| “blocks” | Email block | 7.48 s |
| “logo” | Header logo | 8.36 s |
| “hero” | Hero image | 8.94 s |
| “heading” | Heading | 9.44 s |
| “button” | CTA button | 9.86 s |
| “Preview” | Email Preview tab | 10.76 s |
| “email” | Finished email preview | 11.50 s |
| “compatibility” | Preflight compatibility panel | 14.04 s |
| “export” | Export HTML control | 15.85 s |
| “HTML” | HTML output editor | 17.58 s |
| “plain-text” | Plain-text output | 18.82 s |
| “block” | Email layers list | 21.06 s |
| “document” | Document overview | 22.82 s |
