# Sample comic page — Halloween Cookies

Six-panel gag for the "Letter it in Varve" campaign. Original flat-colour vector, no generative imagery, OFL font only.

## Story

1. Baker in the kitchen with cookie cutters. Caption: *That morning...*
2. Overhead: hands decorating a ghost cookie and a pumpkin cookie.
3. Baker: **Perfect!** (speech balloon + pointed tail)
4. Empty kitchen, door ajar. Caption: *Later that night...*
5. Cookies glow and wake up. **WE'RE ALIVE!** (shout balloon + pointed tail)
6. Baker returns. *Did I use magic flour...?* (thought balloon + bubble chain)

## Files

| File | What |
| --- | --- |
| `halloween-cookies.varve` | Editable 2.33 design-canvas document |
| `halloween-cookies.png` | Page crop from the web editor canvas |
| `halloween-cookies-unlettered.png` | Same page with callouts hidden |
| `halloween-cookies.pdf` | Raster PDF 1.4 of the lettered PNG (not PDF/X) |
| `generate.ts` | Canonical generator (`createDocument` + `createDesignCanvas` + `createCallout`) |
| `generate.mjs` | tsx wrapper |
| `export.mjs` | Opens the file in the desktop Vite app and writes the rasters |

```
node marketing/sample-comic/generate.mjs
node marketing/sample-comic/export.mjs
```

## Lettering

Balloons are real `GroupNode.callout` recipes (scene `createCallout`). 0.5.0 can switch kind in the Inspector after a balloon exists. This page ships speech, thought, shout, and caption so the campaign can show those types without claiming a dedicated "add thought balloon" button.

See `COMIC_FEATURES_AUDIT.md` and `STATUS.md`.
