# Comic lettering marketing recordings

Playwright drives the real `@varve/desktop` Vite app and letters the Halloween Cookies page live. No mocked UI, no text overlays, no audio.

```bash
node marketing/sample-comic/recording/record-lettering.mjs
```

Writes:

- `../video/lettering-timelapse.mp4` — 16:9 full lettering pass
- `../video/lettering-vertical.mp4` — 9:16 crop of that pass
- `../video/balloon-tail-loop.mp4` — single balloon + tail drag

`--probe` opens the unlettered page and places only the caption, writing debug screenshots under `.tmp/`.
