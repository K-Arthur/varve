# Comic-lettering short V3: voice/font/sync/pacing fixes

V3 is a delta rebuild of [V2 / PR #113](https://github.com/K-Arthur/varve/pull/113).
Branch `marketing/comic-lettering-short-v3` starts at V2 commit
`94d076e4c0759e9ebccae2522199b005ce7e4e04`, not master. V2's Python/Pillow/FFmpeg
renderer, real app footage, palette, scene order, script, layout and headline
positions are reused. No application code changes.

## Review assets

- [MP4](out/comic-lettering-short-v3.mp4): **36.000s, 1080×1920, 30fps**, H.264/yuv420p,
  AAC mono 48kHz. Vanessa VO only; no music or sound effects.
- Six evenly spaced encoded grabs: [01](out/frame-01.png), [02](out/frame-02.png),
  [03](out/frame-03.png), [04](out/frame-04.png), [05](out/frame-05.png), [06](out/frame-06.png).
  Frames 90, 270, 450, 630, 810, 990: **3, 9, 15, 21, 27, 33 seconds**.
- [VO-only WAV](out/voiceover.wav), [normalization](out/audio-normalization.json),
  [validation measurements](out/validation.json), [edit plan](edit-plan.json).

## Four fixes

1. The six supplied Vanessa MP3s replace Melody. Audio starts retain the exact
   supplied absolute times, rounded only to the nearest 48kHz sample.
   The timing sheet's `duration` trims the low-level trailing audio; originals remain intact.
2. Karaoke uses `words[].start <= T < words[].end` verbatim. No beat offset is
   added, no equal-duration interpolation, no speed change. Encoded video samples
   the intervals at 30fps, so a boundary appears on the first frame at or after it
   (less than 33.334ms quantization). No highlight before speech intervals or in gaps.
3. Headlines use the uploaded Archivo Black; secondary type uses uploaded Inter
   Tight ExtraBold. V2's 100px starting size, fit-to-width rule and positions remain.
   Font licenses accompany the supplied fonts.
4. Scenes last 4.4–8.267s. Retained evidence cards hold 1.933–3.5s, with fewer cuts;
   speech/thought/shout each hold about 1.93–2s instead of V2's 0.4/0.367/1.967s.
   Entrances settle over 0.6s with 1.2% scale travel and a 1.2% eased zoom.
   The single follow CTA is retimed to 16.8–19.0s. The final 0.3s repeats frame zero.

## Scene timing

Visual ranges are start-inclusive/end-exclusive; audio/word values stay absolute.

| Beat | Frames | Visual time | Duration | VO start / duration | Headline |
| --- | --- | --- | --- | --- | --- |
| 1 | 0–132 | 0.000–4.400s | 4.400s | 0.000 / 3.990s | Never baked into pixels. |
| 2 | 132–333 | 4.400–11.100s | 6.700s | 4.390 / 6.313s | Rewrite inside the balloon. |
| 3 | 333–581 | 11.100–19.367s | 8.267s | 11.103 / 7.855s | Balloons that fit themselves. |
| 4 | 581–757 | 19.367–25.233s | 5.867s | 19.358 / 5.463s | Speech. Thoughts. Shouts. |
| 5 | 757–924 | 25.233–30.800s | 5.567s | 25.221 / 5.186s | Free. Local-first. Yours. |
| 6 | 924–1080 | 30.800–36.000s | 5.200s | 30.807 / 3.881s | What would YOUR comic say? |

## Source/action EDL

All evidence comes from V2's restored recordings under `marketing/sample-comic/video/`.
Playback is slowed to retain the recorded actions while extending reading time.
Source end times are exclusive; the final loop copies the composed opening frame.

| Shot | Output time | Source | Source in–out | Rate | Evidence |
| --- | --- | --- | --- | --- | --- |
| hook-page | 0.000–2.400s | lettering-timelapse.mp4 | 43.000–44.560s | 0.65× | Full authored page in actual app canvas |
| hook-punch | 2.400–4.400s | lettering-timelapse.mp4 | 41.050–42.350s | 0.65× | Speech balloon closeup |
| type-first-line | 4.400–7.900s | lettering-timelapse.mp4 | 2.150–4.775s | 0.75× | Actual text entry: That morning |
| rewrite-detail | 7.900–11.100s | lettering-timelapse.mp4 | 15.000–17.080s | 0.65× | Actual text entry: Perfect! |
| balloon-fit | 11.100–14.000s | lettering-timelapse.mp4 | 17.300–19.475s | 0.75× | Real balloon creation; no fabricated text growth |
| fit-controls | 14.000–16.700s | lettering-vertical.mp4 | 18.000–19.890s | 0.7× | Actual style, padding and fit-policy controls |
| live-tail | 16.700–19.367s | balloon-tail-loop.mp4 | 2.000–4.000s | 0.75× | Live tail endpoint change |
| type-speech | 19.367–21.300s | lettering-timelapse.mp4 | 41.000–42.160s | 0.6× | Speech type |
| type-thought | 21.300–23.233s | lettering-timelapse.mp4 | 36.100–37.260s | 0.6× | Thought type |
| type-shout | 23.233–25.233s | lettering-timelapse.mp4 | 27.000–28.400s | 0.7× | Shout type |
| local-live | 25.233–27.900s | balloon-tail-loop.mp4 | 4.000–5.867s | 0.7× | Actual app with animated icon/domain overlay |
| local-page | 27.900–30.800s | lettering-timelapse.mp4 | 43.000–44.740s | 0.6× | Moving finished-page view under icon/domain |
| recap-page | 30.800–33.300s | lettering-timelapse.mp4 | 43.000–44.250s | 0.5× | Hook page visual returns behind engagement question |
| recap-voice | 33.300–35.700s | lettering-timelapse.mp4 | 41.000–42.560s | 0.65× | Speech closeup and follow line |
| loop | 35.700–36.000s | lettering-timelapse.mp4 | 43.000–43.300s | 1× | Exact copy of opening output frame |

## Regenerate and validate

Requires Python 3, Pillow, FFmpeg/FFprobe; fonts are local uploads.

```sh
python3 marketing/comic-lettering-short-v3/render.py
python3 marketing/comic-lettering-short-v3/validate.py
```

`--preview` makes a six-scene sheet; `--frame N` previews one output frame.
Intermediate assets go to `../work/comic-lettering-v3/`, outside the repository.

## Validation and limits

- Every one of 1,080 encoded frames checked against absolute word intervals:
  **zero highlight mismatches**, all 72 words represented. Every MP3's strongest
  waveform correlation occurs at the exact scheduled sample offset (zero lag
  on a ±5ms search at 0.25ms spacing). Dynamic loudness limiting changes gain;
  normalized correlations are 0.959–0.999.
- All six PNGs exactly match their encoded frame. Full FFmpeg decode passed;
  blackdetect found no all-black segments. Encoded audio: **−15.90 LUFS,
  −1.41 dBTP**. Six encoded grabs and the six-scene preview were visually reviewed.
- MP3s and TTFs are byte-identical to the uploads. Timing JSON whitespace was
  formatted for repository checks; every data value is unchanged.
- These checks establish supplied timing → highlighted pixels and original
  audio → scheduled output. They do **not** independently establish phonetic
  accuracy of the uploaded energy-segmented word labels; listening review of
  that correspondence remains outstanding. No alternative word times were invented.
- V2's evidence limitation remains: recordings show balloon creation, fit-policy
  controls and live tails, but do not show longer text causing automatic balloon
  growth. Script is retained; no application interaction was fabricated.

Changed scope: V3 marketing renderer, validation helper, edit plan, supplied assets,
font licenses, review documentation and rendered media. Plan selects Tier 0
format/lint/emoji; no affected application package or crate. `pnpm verify:plan`
and `pnpm verify:affected` run with `pnpm_config_verify_deps_before_run=false`.
Rust workspace tests, website E2E and full visual suite are unrelated and skipped.
Full suite: no; escalation: none. Commit and exact outgoing push checkpoints apply.

PR target: `master`. **Do not merge; await owner review.**
