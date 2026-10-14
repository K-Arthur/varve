# Varve email Short v8

V8 starts from the owner-approved v6 renderer at `fba9f89b4869212140870003dee461bf4edbe79a`. It does not use the rejected v7 renderer.

## Deliverables

- `varve-email-short-v8-review.mp4`: H.264/AAC, 1080x1920, 30 fps, 1,038 video frames, 34.600 s video / 34.602 s container, 9,259,780 bytes (9.26 MB), under the 9.5 MB review limit. AAC is encoded at 160k.
- The 67,886,785-byte full-size master is retained locally outside the repository; it is not included in this commit.
- Six encoded-frame stills: `v8-01-opening.png` through `v8-06-plain-text.png`.
- Reproduction: render a temporary master with `python3 marketing/email-short-v6/verify8.py /tmp/varve-email-short-v8-master.mp4`, then use the two-pass review encoding commands below. Requires FFmpeg, Pillow, NumPy, and DejaVu Sans fonts.

## Changes

1. Captions use the actual DejaVu Sans Bold font. V6 requested a variable weight on a static regular font, so its weight setting did not make the captions bold. The word reveals, spring animation, keyword rectangles, wording and durations remain unchanged.
2. Caption origins move only where necessary to avoid important UI and focus labels. Width fitting includes the keyword rectangles and shadow. The `just for email.` caption fits at 76 px nominal size; the other captions retain v6's nominal 84 px size and existing width-fitting behavior. Every caption remains within y=290-1440 and x<=930.
3. The sample email is Hollowpine Coffee Roasters' Ember Ridge store email. Every supplied file in `shots-store/` matches the archive at `bc9adfc71e781d9b4eb83dc114469f4867416635` byte for byte. Highlight boxes use its `bboxes.json`, including the canvas, logo, hero, heading, CTA, desktop preview, preflight, HTML, plain text, layers and document overview. Crop origins and focal centers are remapped to the store layout. The narrower canvas crop uses real adjacent canvas pixels from the supplied full workspace shot to preserve v6's card dimensions and zoom widths.

V6's 19-shot order, shot intervals, 15 focus cues, visible highlight envelopes, viewport-keyframe times and widths, transition formulas, camera motion, blue selection-box style, white corner handles, label chips, cursor, existing graphic effects and audio are preserved. The original Varve brand graphics remain in the closing shots. No new visual effects or overlays are added. The captured preview remains desktop; no personal name is visible.

## Verification

- Baseline: `render6.py`, `helpers6.py`, and the approved v6 MP4 match `fba9f89` byte for byte. V8 uses the unchanged v6 helper. AST comparisons confirm the production frame/camera/effect code and viewport easing/render methods are unchanged.
- Timeline: exact equality of v6/v8 shots, caption timings, focus cues, sound-effect event times, click time, duration and fps. Card dimensions and every viewport-keyframe timestamp and zoom width match v6.
- All 1,038 frames: zero caption safe-zone failures; zero overlaps with the email content, other important UI, selection boxes or focus label chips. Canvas rulers and empty canvas margins are context, not protected email content.
- All 1,038 frames: visible highlight envelopes and the highlight-driven zoom response match v6 exactly. Two additional sub-0.01 focus values arise from changed source geometry; the helper draws no highlight at those values and the maximum zoom response is identical.
- Encoded-frame review: all shot types, every focus hold, the caption placements at transitions, store-email content and unchanged closing graphics were reviewed. No mobile preview or personal name appears.
- Master audio: the compressed AAC stream MD5 is `c86c32bb162ee36d49ad13bd55447f1e` in both v6 and the full-size v8 master. The review copy uses the requested AAC 160k encoding of that same mix and timing. A 0.1 dB gain compensates for the loudness change from AAC recompression. Final review `ebur128` measurement: -14.0 LUFS integrated, -3.1 dBFS true peak.
- Full video/audio decode passed: 1,038 video frames, no duplicated or dropped frames, ending at 34.600 s.

## Review encoding and checks

The review uses a two-pass libx264 encode with the `veryslow` preset and 1,950 kbit/s video target, retaining the exact resolution, frame sequence and timing. No scaling, frame-rate conversion, denoising, sharpening, overlays or other image filters were applied. The six frame PNGs remain unchanged from the full-size master.

```sh
python3 marketing/email-short-v6/verify8.py /tmp/varve-email-short-v8-master.mp4
ffmpeg -y -i /tmp/varve-email-short-v8-master.mp4 -map 0:v:0 -c:v libx264 -preset veryslow -b:v 1950k -pix_fmt yuv420p -pass 1 -passlogfile /tmp/email-review8 -an -f null /dev/null
ffmpeg -y -i /tmp/varve-email-short-v8-master.mp4 -map 0:v:0 -map 0:a:0 -c:v libx264 -preset veryslow -b:v 1950k -pix_fmt yuv420p -pass 2 -passlogfile /tmp/email-review8 -af volume=0.1dB -c:a aac -b:a 160k -movflags +faststart marketing/email-short-v6/out/varve-email-short-v8-review.mp4
```

- FFprobe confirmed H.264, 1080x1920, 30/1 fps, 1,038 video frames, and AAC at approximately 160 kbit/s. Final size: 9,259,780 bytes, below 9,500,000 bytes.
- Full final review decode passed without errors. No dropped or duplicated video frames.
- Encoded samples cover every shot type and focus hold. Native-pixel side-by-side comparisons of captions, the Hollowpine logo, the heading and the plain-text UI showed no obvious degradation in those elements. This is a lossy review encode, not a pixel-identical master.
- Caption and highlight timing/layout are inherited from the verified master; the render source and PNGs have not changed.

## Agent Validation Report

Changed scope: v8 renderer, render verifier, MP4, six stills and this report under `marketing/email-short-v6/` only.

Validation plan: Tier 0 format/lint on touched supported files and emoji audit; no package/crate affected and no full-suite escalation.

Commands actually run:

- `pnpm_config_verify_deps_before_run=false pnpm verify:plan`
- `pnpm_config_verify_deps_before_run=false pnpm verify:affected`
- `python3 -m py_compile marketing/email-short-v6/render8.py marketing/email-short-v6/verify8.py`
- `python3 marketing/email-short-v6/verify8.py marketing/email-short-v6/out/varve-email-short-v8.mp4`
- `python3 marketing/email-short-v6/verify8.py --verify-existing /workspace/work/email-v8/frames.json`
- FFprobe output inspection; FFmpeg full decode, `ebur128=peak=true`, and AAC MD5 comparison.
- Repository pre-commit and pre-push checkpoints execute via their normal hooks.

Passed: the selected affected checks and all render, timeline, geometry, audio and decode checks above. Python/media files have no Biome-compatible formatting/lint lane.

Skipped as unrelated: app unit/E2E tests, website E2E, native/Rust tests, and the global visual suite, because no app, website, package or crate changed.

Delivery: amended the v8 commit to replace the oversized master with the review MP4. Every added binary is below the repository's 10 MiB binary-addition limit; each retained frame PNG is below 2.3 MB. Source code and frame PNGs are unchanged from the original v8 commit. No hook or policy is bypassed.

Escalations: none. Full suite run: no.
