# Comic lettering short V2

Review branch: `marketing/comic-lettering-short-v2`, based on `master`.
The edit is 1080 × 1920 at 30 fps: **30.400 seconds / 912 frames**. Audio is
the supplied Melody voice-over only; no music is included.

The renderer extends V1's Python/Pillow/FFmpeg approach from
`marketing/comic-lettering-short-v1/render.py`. The corrected toolchain does
not use Remotion. The three real app recordings were restored from
`cursor/comic-lettering-videos-04c3` under `marketing/sample-comic/video/`.
Application evidence uses recorded pixels; no synthetic application UI is used.

## Review files

- [Rendered MP4](out/comic-lettering-short-v2.mp4).
- Six evenly spaced grabs from the encoded MP4:
  [01](out/frame-01.png), [02](out/frame-02.png), [03](out/frame-03.png),
  [04](out/frame-04.png), [05](out/frame-05.png), [06](out/frame-06.png).
- [Separate mixed VO](out/voiceover.wav) and
  [per-beat normalization measurements](out/audio-normalization.json).
- [Frame-based edit plan and source crops](edit-plan.json),
  [renderer](render.py), and [original timing sheet](vo-timings.json).

Grab times are **2.533, 7.600, 12.667, 17.733, 22.800, and 27.867 seconds**
(frames 76, 228, 380, 532, 684, and 836), the centers of six equal intervals.
Layout previews made with `--preview` are separate scratch files.

## Scene timing

Frame ranges are start-inclusive and end-exclusive. Visual cuts round the
provided beat starts to the nearest 30 fps frame; audio timestamps stay absolute.

| Beat | Frames | Visual time (s) | VO start / duration (s) | Theme | Headline and treatment |
| --- | --- | --- | --- | --- | --- |
| 1 | 0–109 | 0.000–3.633 | 0.000 / 3.288 | Dark | Never **baked** into pixels. Coral accent; kicker and finished-page evidence present on frame zero. |
| 2 | 109–287 | 3.633–9.567 | 3.638 / 5.568 | Light | **Rewrite** inside the balloon. Blue accent; real text entry and a finished speech balloon. |
| 3 | 287–466 | 9.567–15.533 | 9.556 / 5.640 | Dark | Balloons that **fit themselves**. Lime accent; creation, fit-policy/padding controls, then tail movement. |
| 4 | 466–591 | 15.533–19.700 | 15.546 / 3.792 | Light | Speech. Thoughts. **Shouts.** Blue accent; quick type cuts, then the page. |
| 5 | 591–729 | 19.700–24.300 | 19.688 / 4.248 | Dark | Free. Local-first. **Yours.** Yellow accent; real app icon, $0 and varve.studio over moving footage. |
| 6 | 729–912 | 24.300–30.400 | 24.286 / 3.000 | Light, then opening dark frame | What would **YOUR** comic say? Boxed accent, hook recap badge and follow line; opening frame returns at 30.100s. |

The hook follows its 3.638s VO boundary; the other scenes last approximately
4–6 seconds. Scene transitions and source changes are hard cuts. Rounded
evidence cards occupy 85% of the width, with entry pops and a subtle zoom.
The single animated mid-video follow CTA runs from 13.300–15.300s.
Frames **903–911** repeat the opening composed frame for the replay seam.

## Source/action EDL

All sources are in `marketing/sample-comic/video/`:
**T** = `lettering-timelapse.mp4`, **V** = `lettering-vertical.mp4`,
**B** = `balloon-tail-loop.mp4`. Source out points below are exclusive,
calculated from output-frame duration and playback rate, rounded to 3 decimals.
The JSON plan retains exact frame boundaries, rates and crop rectangles.

| Output time (s) | Source | Source in–out (s) | Rate | Recorded action / view |
| --- | --- | --- | --- | --- |
| 0.000–1.900 | T | 43.000–44.900 | 1× | Authored page in the actual app canvas. |
| 1.900–3.633 | T | 41.050–42.783 | 1× | Speech balloon closeup. |
| 3.633–6.033 | T | 2.150–4.550 | 1× | Text entry: “That morning”. |
| 6.033–8.033 | T | 15.000–17.000 | 1× | Text entry: “Perfect!”. |
| 8.033–9.567 | T | 41.000–42.533 | 1× | Finished speech balloon; creation is reserved for beat 3. |
| 9.567–11.600 | T | 17.300–19.333 | 1× | Real balloon creation closeup. |
| 11.600–13.500 | V | 18.000–19.900 | 1× | Inspector style, padding and fit-policy controls. |
| 13.500–15.533 | B | 2.000–4.033 | 1× | Live tail endpoint change. |
| 15.533–15.933 | T | 41.000–41.400 | 1× | Speech type. |
| 15.933–16.300 | T | 36.100–36.467 | 1× | Thought type. |
| 16.300–18.267 | T | 27.000–28.967 | 1× | Shout type. |
| 18.267–19.700 | T | 43.000–44.433 | 1× | Balloon types on the page. |
| 19.700–21.833 | B | 4.000–6.133 | 1× | Live app footage under icon/domain overlay. |
| 21.833–24.300 | T | 43.000–44.727 | 0.7× | Finished-page view under icon/domain overlay. |
| 24.300–26.633 | T | 43.000–44.517 | 0.65× | Hook page returns behind the engagement question. |
| 26.633–28.500 | T | 41.000–42.867 | 1× | Speech closeup and follow line. |
| 28.500–30.100 | T | 43.000–44.120 | 0.7× | Final page view. |
| 30.100–30.400 | — | Composed output frame 0 | Hold | Exact opening composition repeated for the loop. |

## Audio and evidence limits

`vo2-1.mp3` through `vo2-6.mp3` and `vo-timings.json` preserve the original
uploads (JSON whitespace is formatted; timing values are unchanged). The renderer normalizes separate beat copies for the mix, places them
at the supplied starts, and pads the VO track to the visual duration. Speech
ends at 27.286s; the remaining recap has no added sound. No music or sound
effects are mixed in.

The top-center karaoke bar uses the supplied absolute word intervals without
adding beat offsets. Those intervals are uniform estimates within each beat,
not forced-aligned speech measurements; they are preserved as provided.

The supplied recordings demonstrate balloon creation around text, fit-policy
controls, padding/style controls and live tails. They **do not demonstrate a
longer line triggering automatic balloon growth**. Beat 3 retains the supplied
headline and VO, with these related real actions as evidence. No such growth
or other application interaction has been fabricated.

## Regenerate

Requires Python 3, Pillow, FFmpeg/FFprobe and system Open Sans fonts at
`/usr/share/fonts/truetype/open-sans/` (`OpenSans-ExtraBold.ttf`,
`OpenSans-Bold.ttf`, `OpenSans-Regular.ttf`). From the repository root:

```bash
python3 marketing/comic-lettering-short-v2/render.py
```

The command writes the MP4, mixed WAV, measurements and six encoded-frame
grabs into `out/`; intermediate video stays in `../work/comic-lettering-v2/`
relative to the repository root.
Use `--preview` for six layout previews or `--frame N` for a single composed
frame in that scratch directory.

## Validation report

- Changed scope: V2 renderer, edit plan, supplied VO/timings, restored recordings,
  review documentation and rendered media.
- Validation plan: Tier 0 touched-file format/lint and emoji audit. No affected
  application package or crate; no full-suite escalation.
- Passed: `pnpm_config_verify_deps_before_run=false pnpm verify:plan` and
  `pnpm_config_verify_deps_before_run=false pnpm verify:affected` (format, lint,
  and emoji audit all passed). Six MP3 hashes match the uploads; JSON data
  matches the uploaded timing sheet.
- Render: `python3 marketing/comic-lettering-short-v2/render.py` completed.
  FFprobe verified H.264 High, yuv420p, 1080 × 1920, 30/1 fps, 912 frames,
  30.400s. AAC audio is mono, 48kHz.
- Media: full FFmpeg decode passed; blackdetect found no all-black segments.
  Encoded VO measures −16.16 LUFS integrated and −1.43 dBTP. All six PNGs
  exactly match the expected encoded frames at 152-frame intervals.
- Visual review: all six encoded grabs reviewed at phone size, plus the hook,
  CTA, inspector and replay seam. Headline sizes are 98–100px; captions are
  44px at full resolution (about 15px in a 360px-wide player). The footer
  label hides while the animated CTA is visible.
- Loop: frames 903–911 reuse the opening composition. First/last encoded-frame
  mean RGB difference is 0.577/255 (43.71dB PSNR), from H.264 quantization.
- [Media validation measurements](out/validation.json) retain inspectable results.
- Skipped as unrelated: Rust workspace tests, website E2E and the full visual
  suite, since no application code or rendering surface changed. Full suite:
  no. Escalations: none.

Review target is a PR against `master`. Do not merge before owner review.
