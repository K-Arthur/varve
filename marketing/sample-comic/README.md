# Sample Comic Page for "Letter it in Varve" Marketing Campaign

This directory contains a sample comic page created programmatically using Varve's document format and comic lettering tools.

## Contents

- **halloween-cookies.varve** - The main editable document (JSON format)
- **generate.mjs** - The Node.js script that created the document
- **generate-comic-page.ts** - Original TypeScript version (reference)

## The Story

A gentle Halloween gag told in 6 panels:

1. **Panel 1**: Baker in kitchen with ghost and pumpkin cookie cutters on the counter
2. **Panel 2**: Close-up of hands decorating the cookies
3. **Panel 3**: Happy baker steps back, says "Perfect!" (speech balloon)
4. **Panel 4**: Baker leaves through doorway, cookies alone on counter
5. **Panel 5**: Cookies start to glow and come alive with eyes!
6. **Panel 6**: Baker returns surprised, thinks "Did I use magic flour...?" (thought balloon)

## Features Demonstrated

### Comic Lettering System
- **Speech balloon** (Panel 3): "Perfect!" with pointed tail
- **Thought balloon** (Panel 6): "Did I use magic flour...?" with bubble chain
- Both balloons are editable groups with Varve's `CalloutRecipe` system
- Text remains fully editable, never rasterized

### Page Layout
- 2×3 panel grid (6 panels total)
- Standard gutter spacing (20px)
- Page margins (40px)
- Each panel is a semantic `FrameNode` with `panel.semantic: true`
- Total page dimensions: 780px × 1100px

### Vector Art
- All artwork is clean vector shapes (ellipses, rectangles, paths)
- No raster images or generative AI content
- Simple, appealing flat-color style
- Black stroke outlines (2.5-3px weight)

### Color Palette
All colors are RGB values suitable for both screen and print:
- Character skin tones
- Kitchen environment (counter, walls)
- Cookie colors (white frosting, orange pumpkin, green stem)
- Spooky glow effect (semi-transparent orange)

### Font Usage
- **IBM Plex Sans Variable** (OFL licensed, bundled with Varve)
- Used for all dialogue and thought text
- No proprietary or non-embeddable fonts

## Document Structure

The `.varve` file is a JSON document following Varve's schema (v2.33):

```json
{
  "formatVersion": "2.33",
  "name": "Halloween Cookies",
  "pages": [{ ... }],
  "nodes": { ... },
  "documentUnit": "px",
  "physicalWidth": 780,
  "physicalHeight": 1100,
  "dpi": 300
}
```

### Key Node Types Used

- **FrameNode**: Panels with clipping
- **GroupNode**: Character heads, cookies, and balloon groups
- **ShapeNode**: Circles, ellipses, rectangles (heads, eyes, bodies, counter, etc.)
- **PathNode**: Mouths, balloon tails
- **TextNode**: Dialogue and thoughts (with rich text)

### Callout System

Speech and thought balloons use `GroupNode.callout`:

```json
{
  "callout": {
    "version": 1,
    "kind": "speech" | "thought",
    "bodyNodeId": "...",
    "textNodeId": "...",
    "tailNodeIds": ["..."],
    "padding": 12,
    "parametric": true,
    "tails": [{ "style": "pointed" | "thought", ... }]
  }
}
```

This keeps the body, tail, and text as independent editable nodes while maintaining their semantic relationship.

## How to Open and Edit

### In Varve Desktop

1. Launch Varve
2. File → Open
3. Navigate to `halloween-cookies.varve`
4. The page opens with all 6 panels visible
5. Click any text balloon to edit the dialogue
6. Select shapes/paths to change colors or outlines
7. Use the Inspector to modify balloon styles (speech → thought, etc.)

### In Varve Web (try build)

1. Build the try demo: `cd apps/desktop && pnpm build:try`
2. Serve: `npx serve dist/try`
3. Open in browser, load the .varve file
4. Edit in the browser

## Regeneration

To regenerate the document with modifications:

```bash
node marketing/sample-comic/generate.mjs
```

The script uses:
- **No external dependencies** (only Node.js built-ins)
- **Direct JSON generation** (no need for TypeScript compilation)
- **Deterministic structure** (same panel layout every time)

## Export Capabilities

From Varve, this page can be exported as:

- **PNG** (high-res raster, for web/social media)
- **PDF** (vector, for print - Note: PDF/X export with bleed requires print workspace features)
- **SVG** (per-panel or full-page vector)
- **Unlettered version** (hide text layers for "letter a page" demo)

## Notes for Marketing Use

This page demonstrates:

1. **Clean vector workflow**: Everything is shapes and paths, fully editable
2. **Professional lettering**: Speech and thought balloons stay editable
3. **No AI or stock content**: Original art built from code
4. **Print-ready**: 300 DPI setting, vector output, OFL fonts only
5. **Approachable style**: Simple but appealing art anyone can modify

Perfect for:
- "Letter it in Varve" tutorial videos
- Feature showcase (balloon tools, panel layout)
- Demo files in the app
- Marketing screenshots showing real comic workflow

## License

This sample file is provided as a marketing asset for Varve. The document itself and its generator script are part of the Varve project and follow the project's license.

**Font**: IBM Plex Sans Variable is licensed under the SIL Open Font License 1.1.

## Technical Details

- **Generated**: 2026-10-09
- **Schema version**: 2.33
- **Total nodes**: 82
- **Panels**: 6 (semantic frames)
- **Balloons**: 2 (1 speech, 1 thought)
- **Lines of dialogue**: 2
- **Generator script**: ~800 lines of JavaScript
- **Document size**: ~140KB JSON (uncompressed)

---

**For questions or modifications**, see the generator script or the Varve documentation on comic workflow and lettering (`docs/architecture/comic-workflow.md`).
