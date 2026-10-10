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
- `../video/lettering-vertical.mp4` — real 9:16 viewport (1080x1920). Layers and
  Inspector are hidden so the canvas and toolbar fit without clipping.
- `../video/balloon-tail-loop.mp4` — one speech balloon + tail drag. Art and the
  panel frame are locked so the drag moves only the tail.

`--probe` letters only the speech balloon, dumps wrap/bind JSON, and writes
screenshots under `.tmp/`.
