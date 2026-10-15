# Comic-lettering short V5

[Review MP4](out/comic-lettering-short-v5.mp4): 36 seconds, 1080 × 1920, 30 fps,
Vanessa VO only, with no music. Branch `marketing/comic-lettering-short-v5`
starts directly at V4 `b22d21140281661780cd29da8513306bd9cc2ce1`.
Review target: `master`. Do not merge before owner review.

V5 replaces the static dialogue/type demonstrations with new recordings of
the actual app: rewrite an existing balloon, append a longer line, fit the
balloon, then change that same text between speech, thought and shout.
It retains V4's navy gradient, centered floating UI, restrained blue spotlights,
dark label chips, top captions and exact corrected karaoke intervals.
The finished comic stays on screen for the question and animated follow CTA.

**Brief exception requiring review:** the V4 app does not automatically resize
an existing balloon during typing. Its `fit-balloon` policy is stored metadata;
the existing **Fit balloon to text** command performs the geometry change.
V5 visibly records that real command at approximately 13.57 seconds, then holds
the larger balloon. It does not simulate automatic growth. The required Vanessa
VO is unchanged, including “fits itself.” Achieving literal automatic growth
would require an application change outside this media edit. No application
code was changed.

## Timing and actions

The complete frame EDL is [edit-plan.json](edit-plan.json). Frame intervals are
start-inclusive/end-exclusive. Source crops and spotlights use source-pixel
`[left, top, right, bottom]` coordinates, transformed together. Every cut or new
focus occurs within three seconds; the continuous growth sequence spans three
framings so the actual action stays legible.

| Beat | Output time | Live action / treatment |
| --- | --- | --- |
| 1 | 0.000–4.400 | Finished comic → punch-in at 0.400s → open the existing balloon's text editor. The 0.23s zoom establishes the hook before 3s. |
| 2 | 4.400–11.100 | Type “Perfect cookies!” in the original text node. Cut closer at 6.700s, then reveal the committed rewrite. |
| 3 | 11.100–19.367 | Append “With a little extra magic flour.”; show the real Fit command around 13.57s; hold the expanded balloon through 15.500s. Spotlight the Inspector's Comic balloon controls with “Balloon controls,” then show live tail movement. |
| 4 | 19.367–25.233 | Change the same balloon/text between Speech, Thought and Shout, aligned to the spoken list; return to the full page. Small animated follow nudge at 22.500–24.800s. |
| 5 | 25.233–30.800 | Clean fully-lettered page and small Varve identity; cut to the real document context at 27.800s. |
| 6 | 30.800–36.000 | Finished page under the complete “What would your comic say?” question. Reframe at 33.200s; “Follow for the next drop” slides in on its VO, with a drawing underline and directional arrow. Return to the exact opening composition at 35.500s. |

The question remains visible during the pause before “Follow.” No extra word
highlight is added during that hold. No giant headlines, pills, stamps or bullet
recap card are used.

## Footage and reference

- [rewrite.mp4](source/rewrite.mp4), [grow-and-fit.mp4](source/grow-and-fit.mp4)
  and [types.mp4](source/types.mp4) are fresh recordings of the existing V4 app,
  loaded with the existing `halloween-cookies.varve` document. Actual keyboard,
  Layers, quick-bar and Inspector interactions drive the app. The original
  group `n6_hc0005` and text `n8_hc0007` are retained throughout.
- [capture.cjs](source/capture.cjs) records Chromium screencast frames and their
  real time spacing; [capture-events.json](source/capture-events.json) records
  action positions within each source. Screen recordings contain no audio.
  Re-capturing requires the repository's Playwright Chromium install and a Vite
  dev server at port 5173. Run the capture through the heavy-task lease. Camera
  crops must be remeasured if re-capturing with different fonts or viewport state.
- The required [vertical footage](../sample-comic/video/lettering-vertical.mp4)
  matches `cursor/comic-lettering-videos-04c3` byte-for-byte: SHA-256
  `9e78d7907c3f9d3372b0556aa814830f0d0f216c4e52a65cfeb98e5e5d2522f2`.
  Its live Inspector footage is used at 15.500–17.600s. The inherited real tail
  recording and finished-page timelapse provide the tail/page views.
- The email-v6 reference is [out/v7.mp4](https://github.com/K-Arthur/varve/blob/marketing/email-short-v6/marketing/email-short-v6/out/v7.mp4),
  with [reference notes](https://github.com/K-Arthur/varve/blob/marketing/email-short-v6/marketing/email-short-v6/ref/REF-NOTES.md).
  The owner's five-Short energy bar supplied in this task guides the early hook,
  frequent focus changes, live actions, mid-video nudge and page-based loop ending.

## Voice and captions

All six `vo3-*.mp3` files, `vo3-timings.json` and `caption-timings.json` are
byte-identical to V4. Complete MP3s retain their original absolute beat offsets
and final consonants. The mix is the same independently normalized six-voice
sum used by V4. Source video audio is discarded; no music or effects are mixed.

Every blue word evaluates exactly
`words.start <= output_frame / 30 < words.end`, using corrected
[caption-timings.json](caption-timings.json). There is no anticipation, lag or
gap filling. Beat 6 groups the full question into one two-line caption;
the underlying word times remain unchanged. Added text stays inside
x 150–930, y 290–1440.

## Nine encoded frame grabs

| Time | Frame | Review image |
| --- | ---: | --- |
| 1.500s | 45 | [Hook / editable balloon](out/frame-01.png) |
| 8.333s | 250 | [Live rewrite](out/frame-02.png) |
| 12.667s | 380 | [Longer line being typed](out/frame-03.png) |
| 14.767s | 443 | [Expanded fitted balloon](out/frame-04.png) |
| 16.833s | 505 | [Comic balloon controls](out/frame-05.png) |
| 22.000s | 660 | [Same text, shout style](out/frame-06.png) |
| 27.333s | 820 | [Complete comic page](out/frame-07.png) |
| 32.000s | 960 | [Engagement question](out/frame-08.png) |
| 34.333s | 1030 | [Page and animated follow CTA](out/frame-09.png) |

## Reproduce and validate

Requires Python 3, Pillow, NumPy, SciPy, FFmpeg/FFprobe and system DejaVu Sans.
The committed recordings are sufficient; the app need not run for rendering.

```sh
python3 marketing/comic-lettering-short-v5/render.py --preview
python3 marketing/comic-lettering-short-v5/render.py
python3 marketing/comic-lettering-short-v5/validate.py
```

Scratch previews and the silent intermediate stay under
`work/comic-lettering-v5/`. Final media and evidence are in `out/`.
The validator checks the delivered encoded media: full decode, dimensions,
duration/frame count, source hashes, branch ancestry, all 1,080 caption frames
against all 72 exact corrected word intervals, safe bounds, independently
reconstructed VO-only audio, original clip alignment/final consonants, loudness,
frame grabs and the first/last-frame replay seam.

The final render and encoded-media validator passed. The nine PNGs were also
visually reviewed at phone size, including the growth result, type switch,
Inspector, question and CTA. [validation.json](out/validation.json) records:

| Check | Measured result |
| --- | --- |
| Media | 36.000s, 1,080 frames, 1080 × 1920, exact 30 fps, H.264/yuv420p + mono AAC; 5,994,056 bytes |
| Decode | Entire video and audio decode without errors; no detected black intervals |
| Captions | All 1,080 encoded frames and 72 corrected word intervals pass; zero highlight mismatches; safe bounds pass |
| Audio | Independent six-VO mix correlation 0.999994; AAC residual −49.00 dB; all six clips have strongest correlation at zero lag; final consonants preserved |
| Loudness | −15.98 LUFS integrated, −1.42 dBTP |
| Edit | 20 shots; maximum interval 3.000s; continuous source time through the growth/Fit sequence; all source endpoints valid |
| Grabs and loop | All nine PNGs exactly match encoded frames; first/last mean absolute pixel difference 0.686/255, 99th percentile 5/255 |
| Provenance | V4 base ancestry passes; all eight VO/timing files remain byte-identical to V4; required vertical footage hash matches |

```text
Changed scope: marketing/comic-lettering-short-v5/ only; media, render/validation/capture scripts and review documentation
Validation plan: Tier 0 only — touched formatting/lint and emoji; no application packages/crates affected
Commands actually run:
  node scripts/quality/heavy-lease.mjs 'V5 final live action capture' -- node marketing/comic-lettering-short-v5/source/capture.cjs
  node --check marketing/comic-lettering-short-v5/source/capture.cjs
  python3 -m py_compile marketing/comic-lettering-short-v5/{render,validate}.py
  python3 marketing/comic-lettering-short-v5/render.py --preview
  python3 marketing/comic-lettering-short-v5/render.py
  python3 marketing/comic-lettering-short-v5/validate.py
  pnpm_config_verify_deps_before_run=false pnpm exec biome format --write marketing/comic-lettering-short-v5
  pnpm_config_verify_deps_before_run=false pnpm verify:plan --staged
  pnpm_config_verify_deps_before_run=false pnpm verify:affected --staged
Passed: live capture; script syntax; final render; all seven media validation stages; formatting/lint/emoji
Skipped as unrelated: application unit/E2E/Rust suites; website and full visual suites; no application code changed
Escalations: none
Full suite run: no
```
