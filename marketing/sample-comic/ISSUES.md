# Notes from generating the sample page

## Confirmed working

- Format 2.33 + `designCanvases` loads through `DocumentCodec.decode` (the app open path).
- `createCallout` speech / thought / shout / caption recipes survive encode and render in the desktop web editor.
- Thought tails are a circle chain. Speech/shout tails are pointed paths. Captions can have tails removed.
- Frame `panel.version = 1` is accepted. `clipContent: true` clips panel art.
- File > Open (`#file-open-input`) sets the shell heading to the filename (`halloween-cookies.varve — Varve`).

## Limits (not bugs)

- No headless PNG/PDF API in the app. Exports here screenshot `canvas.editor-canvas__content-layer` after File > Open + Fit All.
- PDF/X-1a / PDF/X-4 need Tauri `export_pdfx1a` / `export_pdfx4`. This folder's `.pdf` is a raster PDF 1.4 wrap. Campaign copy must not say PDF/X unless someone exports from Print on desktop.
- Shout in 0.5.0 is a thick-stroke rounded rect, not a burst star (`burst` is a separate kind).
- Inspector "Add speech balloon" only creates speech; other kinds are a dropdown after selection (`COMIC_FEATURES_AUDIT.md`).
- Opening from Home while the editor is unmounted can load the file into a hidden session; Resume / Continue editing is required. The export script waits for a sized content canvas before opening.
