# Email workspace: store-email capture, findings

Email concept: **Hollowpine Coffee Roasters** (a fictional roaster) launching **Ember Ridge**, its limited winter blend.
- Subject: "Ember Ridge is here: our winter blend"
- Preheader: "Cocoa, toasted pecan and orange peel. Small-batch, roasted every Monday."
- Blocks: Header logo, Hero image, Heading, Body, CTA button + CTA label ("Shop the blend" → https://hollowpine.example/shop/ember-ridge), Shelf heading ("Also on the shelf"), a 3-product grid (Ember Ridge, Hearth, Frostline) with captions and prices, and a dark Footer with footer text.
- Every image is original: drawn with PIL in `source-images/gen.py`.

Build: master `ee50609`, /workspace/varve-dogfood, `VITE_DEMO=1` on port 5199. Playwright Chromium ran at 1920x1200, DPR 2. Scripts are in `scripts/` (copies of /tmp/store/*).
Asset base URL is `http://127.0.0.1:5301`. `scripts/cdn2.py` serves the generated PNGs by node id. The old 5300 server is hard-wired to the Varve logo and hero, so it was left alone.
Every bbox was checked by drawing outlines on copies (`scripts/verify.py`) and viewing them.

## Known bugs avoided in framing
- Duplicated email (A): the preview shots show only the first copy. 17 is scrolled so the first copy's footer sits at the iframe bottom. 19 is clipped so only the first copy of the plain text shows.
- Broken preview images (B): the Asset base URL is set, and all 5 images load (`imagesLoaded` in bboxes.json).
- 'Click' button label (C) and the new label loss (F below): the CTA frame is tagged `section`, and the link sits on the frame.
- Mobile preview (D): not captured.

## New bugs

### F. Auto-detected button drops its label, even on `auto`, HIGH
A filled, rounded frame with one text child and no explicit semantic is inferred as `button` (design role). `emitButton` (`packages/codegen/src/email-html.ts:547`) then emits `node.content?.text ?? 'Click'`. The frame's content text is `''`, so the CTA becomes an **empty** green bar (`<span></span>`). The duplicated copy shows "Click". Plain text still has the label (`email-plain-text.ts` uses `textFromNode`), so HTML and text disagree.
This also hit the previous Varve run: /tmp/final.html from that run contains no "Download Varve". The old workaround ("leave frame on auto, link the text") does not work.
Workaround: set the frame's Semantic type to `section` and put the link on the frame.

### G. Linked text loses its colour, MEDIUM
With the link on the CTA label text, the output is `<p style="color:#fff"><a href=… style="text-decoration: none;">Shop the blend</a></p>`. The `<a>` gets no colour, so clients show link-blue on the dark green button. Fix: copy the text colour onto the `<a>`.

### H. Left-aligned text renders centred, MEDIUM
Heading, body, shelf heading and footer copy are left-aligned on the canvas. `<h2>`/`<p>` are emitted without `text-align`, so they inherit `<td align="center">` from the outer wrapper and render centred in the preview (visible in 16/17). Fix: always emit `text-align` (default `left`) on text blocks.

### I. Equal-width captions get unequal columns, LOW–MEDIUM
The three captions are 150 px wide at x = 45/225/405, under a product row that emits as 200/200/200. The caption row is emitted with column widths 228/168/204, so captions drift off-centre from their images. In an earlier variant with longer captions ("Hearth Espresso · $17"), the band split 2+1: two columns (272/328) plus a stray paragraph. `email-layout.ts` `resolveColumnWidths` uses each child's measured geometry width. Auto-sized text widths seem to leak in instead of the set W.

### J. Preflight noise and mismatch, LOW
- Image-fill rectangles each get "will be rasterized for email compatibility". They are already bitmaps, so that is 5 warnings of noise for a normal image-led email.
- The status bar says "Preflight: 1 errors, 10 warnings" while Email preflight shows 5 warnings. This is still the known mismatch.

### K. Container link URL missing from plain text, LOW
When the link sits on the CTA frame (`section`), the plain text shows "Shop the blend" with no URL. Text-level links include `(url)`.

### L. Text tool "New text" defaults popover swallows the next drag, LOW (UX/automation)
Picking the Text tool while it is already active opens the writing-mode/"New text" popover over the canvas. The next drag then creates nothing. Workaround in scripts: click Select first.

## Notes
- 02-canvas-crop.png is 692x1252. The 600x1110 email fits the canvas at about 51% zoom, the same approach as the previous set. Use 01 or the selected-* shots at 3840x2400 to zoom in.
- 04-layers-panel.png: the last row (Header logo) is partly under the Selection sets bar. Its bbox is recorded as-is.
