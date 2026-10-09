# Halloween Cookies — status

## Verified

- The committed `halloween-cookies.varve` is format **2.33** with `designCanvases` / `activeDesignCanvasId`, matching a file saved by the Varve 0.5.0 desktop app.
- `DocumentCodec.decode` (the app open path: parse + `migrateDocumentDetailed` + shape/cycle validation) succeeds with no error warnings.
- Decode → `DocumentCodec.encode` → decode round-trips with no errors.
- Six semantic panels (`panel.version === 1`).
- Five callouts from `createCallout`: caption, speech, caption, shout, thought. Speech/shout have pointed tails; thought has a bubble chain; captions have tails removed.
- Clipped shading groups (`mask.type === 'clip'`) on characters, cookies, and counters.
- Text nodes are plain strings, IBM Plex Sans Variable (OFL, bundled).
- The file was opened in the **desktop web app** via `#file-open-input` (same File > Open path as the editor). Heading became `halloween-cookies.varve — Varve`. The page rendered on `canvas.editor-canvas__content-layer`.
- Exports were captured from that canvas and cropped to the page board:
  - `halloween-cookies.png` (930×1296)
  - `halloween-cookies-unlettered.png` (callout groups `visible: false`)
  - `halloween-cookies.pdf` — **ordinary PDF 1.4 raster wrap of the PNG**, not PDF/X. The PDF/X-1a/X-4 path is Tauri `export_pdfx1a` / `export_pdfx4` and was not driven here.

Commands that passed:

```
pnpm exec vitest run packages/scene/src/__tests__/sample-comic.test.ts packages/scene/src/__tests__/comic-document-load.test.ts
node marketing/sample-comic/export.mjs
```

## Not claimed

- Opening the Linux AppImage / native Tauri GUI (this environment used the Vite desktop web build).
- PDF/X with bleed or ICC. Say "raster PDF" in campaign copy unless someone exports from Print workspace on desktop.
- Fine-art illustration. The page is clean geometric flat-colour vector so it stays editable and original.

## Regenerate

```
node marketing/sample-comic/generate.mjs
node marketing/sample-comic/export.mjs
```
