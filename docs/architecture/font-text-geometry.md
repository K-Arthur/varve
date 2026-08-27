# Font Readiness and Text Geometry

Varve treats browser font readiness as derived presentation state. CSS-loaded
faces, bundled or downloaded faces loaded through `FontRegistry`, and restored
faces all converge on the registry revision. The editor subscribes to that
revision and schedules an authoritative canvas redraw; this never changes the
document, selection, or history.

The browser `FontFaceSet` is important because `@fontsource` CSS can start and
finish a load without calling `FontRegistry.load()`. `loadingdone` and
`loadingerror` therefore advance the same revision stream as registry loads.
The revision belongs in font-dependent layout/cache identities so a fallback
measurement cannot remain valid after the requested face becomes usable.

Text geometry has distinct meanings:

- Container bounds: explicit `w`/`h` for area and fixed text.
- Layout bounds: line boxes after explicit breaks and soft wrapping.
- Ink bounds: visible glyph extents, including shaping and font metrics.
- Selection/edit bounds: the interaction rectangle selected by the node mode.

Point and auto-width text use content layout dimensions. Auto-height text keeps
its width constraint and derives height from wrapped lines. Fixed area text
keeps its container dimensions and applies its overflow policy. Editing and
floating-toolbar overlays consume the scene bounds rather than character-count
estimates. Empty paragraphs and trailing breaks retain line boxes, so renderer,
selection, hit testing, and editing do not silently disagree about line count.

This is a derived-layout change only: font completion does not create an undo
entry, mark the document dirty, or serialize measured dimensions.
