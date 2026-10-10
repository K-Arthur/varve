# Comic lettering marketing recordings

Playwright drives the real `@varve/desktop` Vite app and letters the Halloween
Cookies page live. No mocked UI, no text overlays, no audio.

```bash
node marketing/sample-comic/recording/record-lettering.mjs
node marketing/sample-comic/recording/record-lettering.mjs --probe
node marketing/sample-comic/recording/record-lettering.mjs --full
node marketing/sample-comic/recording/record-lettering.mjs --loop
node marketing/sample-comic/recording/record-lettering.mjs --vertical
```

Writes:

- `../video/lettering-timelapse.mp4` — 16:9 full lettering pass (1920x1080)
- `../video/lettering-vertical.mp4` — Playwright viewport and window are
  1080x1920 at record time (never a landscape crop). Side panels stay
  collapsed except when a control is needed. Letters caption + speech only
  so each step can read. Target 35-45s at real time, not a sped-up crop.
- `../video/balloon-tail-loop.mp4` — opens the already-lettered comic. The
  tail is scrubbed out and back on the open page so the first and last
  frames match (10-12s).

Cursor paths are eased beziers at human speed. Typing is 8-12 characters
per second. Camera zooms and pans with the wheel and Space-hand instead
of jumping to Fit selection.

`--probe` letters only the speech balloon, dumps wrap/bind JSON, and writes
screenshots under `.tmp/`.
