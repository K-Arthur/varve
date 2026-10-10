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
  collapsed except when a control is needed. Text is clamped to a fixed box
  before wrap so every line stays inside its balloon group.
- `../video/balloon-tail-loop.mp4` — opens the already-lettered comic. Only
  the parametric tail moves out and back so the first and last frames match.

`--probe` letters only the speech balloon, dumps wrap/bind JSON, and writes
screenshots under `.tmp/`.
