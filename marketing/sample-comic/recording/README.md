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

Cursor paths use Bezier curves with independent random control-point
offsets, overshoot and correction on longer moves, small jitter, and a
per-move irregular speed profile (not one shared cubic ease). The
recorder waits 0.4-1.5s before clicks, after a panel opens, and between
tasks. Typing uses 60-220ms per key with longer pauses at word
boundaries. Compact 9:16 keeps the inspector hidden until a callout
group has settled, then Fits the balloon and, for speech, resizes it
the way a person would (wrap leaves top-aligned text in the ellipse
crown; that is an app bug, not papered over in product code). The tail
loop restores the exact starting Tail X/Y and parks the cursor on Tail
X so the first and last frames match.

`--probe` letters only the speech balloon, dumps wrap/bind JSON, and writes
screenshots under `.tmp/`.
