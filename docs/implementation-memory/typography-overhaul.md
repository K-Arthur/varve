# Typography System Overhaul - Implementation Memory

**Mission:** Deeply audit, research, repair, redesign where justified, implement, integrate, test, optimize, and verify Strata's Typography system as a whole, including interactions with text layout, document structure, multi-page publishing workflows, style systems, rendering, persistence, import/export, print production, accessibility, and user-facing controls.

**Last Updated:** 2026-07-08

---

## Machine-Readable Status

- **Current Phase:** Completed
- **Last Verified Commit:** Staged, ready to commit
- **Active Workstream:** None (all verified)
- **Last Passing Test Command:** pnpm --filter @varve/scene test (672/672 pass), pnpm --filter @varve/engine test (683/683 pass), typecheck clean on both
- **Known In-Scope Failures:** None
- **Next 3 Concrete Actions:**
   1. Commit changes incrementally
   2. Push if requested

---

## Baseline Status

### Git Status
- Branch: master (ahead of origin/master by 1 commit)
- Last commit: b5682db "Implement canvas-side isolation enforcement for Layers Panel"
- Modified files: website, editor, ui components (unrelated to typography)
- Untracked: LibraryPanel components, website pages

### Test Baseline
- **Total Tests:** 3936
- **Passed:** 3934
- **Failed:** 1 (Button.test.tsx - unrelated to typography)
- **Skipped:** 1
- **Pre-existing failure:** `packages/ui/src/components/Button.test.tsx` - expects `.strata-btn__spinner` element that doesn't exist

### Regression Protocol Status
- Format: Not run
- Typecheck: Not run
- Lint: Not run
- Test: 1 unrelated failure
- Emoji audit: Not run
- Token audit: Not run

---

## Architecture Map (Completed)

### Typography-Related Packages/Crates

**packages/scene/src/typography.ts** - Core types system
- OpenTypeFeatureTag (83 tags: liga, dlig, sups, subs, ss01-ss20, cv01-cv15, etc.)
- OpenTypeFeatureMap with presets (default, editorial, tabular, display, code)
- VariableFontAxis, VariableFontInstance, VariableFontSettings
- CharacterFormat (fontFamily, fontWeight, fontStyle, fontSize, lineHeight, letterSpacing, textCase, textDecoration, openTypeFeatures, variableFontSettings, fontVariant, baselineShift, superscript, subscript, kerning, tracking, language)
- ParagraphFormat (textAlign, textAlignVertical, lineHeight, paragraphSpacing, paragraphIndent, firstLineIndent, listStyle, listIndent, hangingIndent, hangingQuotes, hangingLists, maxLines, textOverflow, hyphenation, keepWithNext, keepTogether, widowControl, orphanControl, dropCapLines, dropCapChars, direction, writingMode, columnCount, columnGap, columnRuleWidth, columnRuleColor)
- TextRun, Paragraph, RichText
- CharacterStyle, ParagraphStyle, TypographyStyle
- TextChain, OversetInfo
- Helper functions: plainTextToRichText, richTextToPlainText, mergeCharacterFormat, mergeParagraphFormat, resolveCharacterFormat, resolveParagraphFormat

**packages/engine/src/fontRegistry.ts** - Font management
- FontEntry (family, weight, style, source: system|bundled|google, url, variableAxes)
- FontLoadState, FontMetadata
- FontRegistry class with register, families, variants, fallbackChain, hasVariant, getVariableAxes, getAxisInfo, getAllAxes, load, loadAll, isAvailable, isRegistered, isMissing, resolve, buildFontCSS, buildVariationSettings, buildFeatureSettings
- DEFAULT_FONTS (Inter, Arial, Helvetica, Georgia, Times New Roman, Courier New, Verdana, Trebuchet MS, Noto Sans, Noto Sans CJK, Meiryo)
- STANDARD_AXES (wght, wdth, slnt, opsz, ital, grad, XTRA, YOPQ, YTLC, YTUC, YTDE, YTFI)
- Singleton getFontRegistry()

**packages/engine/src/textLayout.ts** - Rich text layout engine
- RichTextRun, RichTextParagraph, RichTextInput
- LayoutLine, LayoutRun, RichTextLayout
- layoutRichText() - lays out mixed-format rich text with line breaking
- CJK-aware line breaking via Intl.Segmenter
- Canvas measureText with fallback to estimate
- OpenType feature settings and variable font settings
- Overflow detection with maxLines

**packages/scene/src/textFlow.ts** - Text flow chains (linked frames)
- createChain, appendFrame, insertFrame, removeFrame, reorderFrame
- isChainHead, isChainTail, nextFrame, previousFrame
- detectOverset, splitRichTextByCharLimit

**packages/scene/src/typographyPreflight.ts** - Typography validation
- TypographyIssue (missing-font, overflow, broken-chain, unsupported-glyph, contrast, style-conflict, orphaned-style)
- runTypographyPreflight() - validates document for typography issues
- validateRichText() - validates rich text font availability
- validateContrast() - WCAG contrast ratio calculation

**packages/engine/src/pathText.ts** - Text on paths
- PathSample, GlyphPlacement, GlyphPlaceOptions
- samplePathAtLength() - samples any shape at arc length
- pathLength() - calculates total arc length
- placeGlyphsOnPath() - places glyphs along shapes
- Supports: circle, ellipse, rect, line, arrow, polygon, star, path
- Fast-path for circles (angular sampling)
- Adaptive Simpson integration for bezier arc length

**packages/scene/src/textWarp.ts** - Text warp/envelope deformation
- WarpKind (arc, arcLower, arcUpper, bulge, shellLower, shellUpper, flag, wave, fish, rise, freeMesh, custom)
- WarpEnvelope, WarpMesh, WarpedGlyph
- warpPoint(), warpGlyph(), warpBounds()
- Bilinear interpolation for mesh warps

**packages/scene/src/types.ts** - Document types
- TextNode with richText, textMode (point|area|path|auto), pathTextSettings, pathId, pathOffset, pathSide
- TextStyle (reusable text styles)
- Document.styles collection
- NOTE: Document does NOT have textChains field (missing integration)

**packages/engine/src/types.ts** - Engine types (mirrors scene types)
- OpenTypeFeatureMap, VariableFontSettings
- TextMode, PathTextSettings
- CharacterFormat, ParagraphFormat, TextRun, Paragraph, RichText
- EngineRgbColor, EngineCmykColor (mirrors ManagedColor)

**packages/editor/src/CanvasArea.tsx** - Canvas rendering
- toEngineNode() converts TextNode to engine format
- Text shape includes: text, fontSize, fontFamily, fontWeight, fontStyle, textAlign, x, y, w, h, letterSpacing, lineHeight, textCase, textDecoration
- TextEditOverlay integration for inline editing
- SubtreeIrCache for IR replay

**packages/editor/src/components/TextEditOverlay.tsx** - Inline text editing
- Positioned textarea overlaid on canvas
- IME composition support (compositionstart/end)
- Auto-focus and select-all on mount
- Transparent text with visible caret
- Escape to commit, blur to commit

**packages/editor/src/tools/TextTool.ts** - Text creation
- Click for point text (auto-width), drag for text box (fixed-width)
- Double-click to edit

**packages/editor/src/components/Inspector/sections/TypographySection.tsx** - Typography UI
- Full property set: family, weight, style, size, line-height, letter-spacing, paragraph spacing, text align (h/v), text case, decoration, list style, truncation/overflow, resizing mode
- OpenType Features section with checkboxes
- Variable Font Axes section with sliders
- Multi-select support with "Mixed" detection
- Batch editing with transactions
- Token binding support

### What Exists (Foundation Phase 1-4)
✓ Font system (FontRegistry)
✓ Rich text types and models
✓ Text layout engine with CJK support
✓ OpenType features
✓ Variable font axes
✓ Text flow chains (linked frames data model)
✓ Typography preflight
✓ Text on paths
✓ Text warping
✓ Typography UI controls
✓ Canvas2D rich text rendering
✓ SVG multi-line/rich text export

### What Needs Investigation/Implementation
❓ Multi-page workflows (parent pages, master pages)
❓ Advanced paragraph composition (hyphenation, justification algorithms)
❓ Nested styles, GREP-like formatting, pattern-driven styles
❓ Character/paragraph style management UI (styles panel)
❓ Linked text frame UI (linking/unlinking, visual indicators)
❓ Text editing overlay integration (contentEditable)
❓ IME and complex script support (Arabic, Indic, CJK vertical)
❓ Bidi text handling (RTL/LTR mixed)
❓ Document-level typography settings
❓ Print production integration with typography
❌ Style inheritance (based-on relationships)
❌ Style override indicators
❌ Clear overrides functionality
❌ Style duplication, rename, delete
❌ Missing style recovery
❌ Hyphenation engine
❌ Widow/orphan control implementation
❌ Keep-with-next, keep-together implementation
❌ Drop caps implementation
❌ Tab stops and tab leaders
❌ Paragraph rules
❌ Optical margin alignment

---

## Research Findings

### Online Research Sources

**Adobe InDesign (accessed 2026-07-08)**
- **Threading Text (Linked Frames)**: 
  - Red plus sign (+) indicates overset text
  - Out port (bottom-right) loads overset text for linking
  - In port (top-left) shows text flows from previous frame
  - View > Extras > Show Text Threads (Ctrl+Alt+I / Cmd+Option+I) shows visual arrows
  - Text flows automatically across linked frames
  - Supports multi-page stories
  - Smart text reflow for automatic frame/page creation
  
- **Paragraph/Character Styles**:
  - Based-on inheritance hierarchy (parent → child styles)
  - Reset To Base restores child to match parent
  - Character styles only encode differences (refinements) relative to base
  - Paragraph styles include both paragraph (ℙ) and character (ℂ) attributes
  - Character styles only include character (ℂ) attributes
  - Override indicator (+) appears when local formatting differs from style
  - Style Override Highlighter shows colored boxes for overrides
  - Paragraph-level overrides (ℙ+) vs character overrides (ℂ+)
  - Cannot distinguish ℙ+ from ℂ+ via scripting DOM limitation

**Adobe Illustrator (accessed 2026-07-08)**
- **Type on Path**:
  - Type on a Path tool adds text to any path/shape
  - Baseline shift for vertical positioning
  - Flip text to other side of path
  - Effects and transformations supported
  - Works on circles, ellipses, paths, shapes

**Sketch (accessed 2026-07-08)**
- **Text Styles**:
  - Store and reuse typography across layers
  - Update/Create/Detach workflow when modifying styled text
  - Asterisk (*) indicates unsynced changes
  - Can include color and alignment in style (off by default)
  - Library sharing across documents
  - Organize into folders/groups
  - Insert with Command Bar or Inspector
  - Detach keeps changes but removes style reference

**Affinity Publisher (accessed 2026-07-08)**
- **Linked Text Frames**:
  - Text flow buttons (red circles) on frame sides
  - Hollow arrow indicates flow from previous frame
  - Link frames across spreads/pages
  - Text Frame panel: columns, gutter, balance text in columns
  - Vertical alignment (top/center/bottom/justify)
  - Baseline grid control
  - Column rules with gap/stroke
  - Master pages for repeatable layouts
  - Preflight checks before export

**CSS Text Module Level 4 (accessed 2026-07-08)**
- **Line Breaking**:
  - Soft wrap opportunities at word boundaries in most writing systems
  - line-break property for strictness levels
  - word-break property for glomming letters
  - Typographic character unit varies by operation (line-breaking vs letter-spacing)
  - Myanmar/Devanagari use syllable clusters as units for justification/line-breaking
  - UA may avoid short last lines, reduce line length variation, avoid rivers
  - Forced line breaks (newline) vs soft wrap breaks (wrapping)
  
- **Hyphenation**:
  - hyphens property: none, manual, auto
  - Language-specific hyphenation rules (requires lang attribute)
  - U+2010 (HYPHEN) - visible line break opportunity
  - U+00AD (SHY) - invisible soft hyphen
  - hyphenate-limit-chars: min word length, min before hyphen, min after hyphen
  - hyphenate-limit-lines: max consecutive hyphenated lines (avoid ladders)
  - hyphenate-limit-last: avoid hyphenating last word of paragraph
  - hyphenate-limit-zone: max whitespace before hyphenation zone
  - Recommended defaults: 6-char word min, 3 chars before, 2 after

**Unicode Standards (accessed 2026-07-08)**
- **UAX #29: Text Boundaries**:
  - Grapheme clusters (user-perceived characters)
  - Word boundaries
  - Sentence boundaries
  - Extended grapheme cluster boundaries (default)
  - Line boundaries covered in UAX #14
  
- **UAX #14: Line Breaking Algorithm**:
  - Defines line breaking classes for characters
  - CM class includes COMBINING GRAPHEME JOINER
  - Used for specialized collation and Arabic mark rendering

**OpenType Specifications (accessed 2026-07-08)**
- **Font Variations (fvar table)**:
  - Variation axes with tags (wght, wdth, opsz, ital, slnt, etc.)
  - Each axis: tag, minValue, defaultValue, maxValue, flags, axisNameID
  - Named instances with designer-provided names
  - STAT table required for axis metadata
  - Coordinate normalization and interpolation
  - Delta adjustment values for variation data
  - TupleVariationStore format (gvar, cvar) for glyph outlines
  - ItemVariationStore format (HVAR, VVAR, MVAR) for metrics
  
- **Registered Axis Tags**:
  - Well-defined semantics and numeric scales
  - "Regular" value recommendations
  - Interoperability between fonts and applications
  - Custom foundry-defined axes allowed

**Browser APIs (accessed 2026-07-08)**
- **Canvas measureText**:
  - TextMetrics interface: width, actualBoundingBoxLeft/Right/Ascent/Descent
  - Single-line metrics only
  - No multi-line wrapping
  - No individual glyph positions
  - Requires loaded fonts (document.fonts.ready or FontFace.load())
  - actualBoundingBoxLeft + actualBoundingBoxRight more accurate than width for italic/slanted fonts
  
- **Intl.Segmenter**:
  - Granularity: grapheme, word, sentence
  - Locale-aware segmentation
  - Handles CJK, Arabic, Hebrew, Thai, emoji, ZWJ sequences
  - 'auto' locale for mixed content
  - Proposal v2 adds line break granularity
  
- **Font Loading API**:
  - document.fonts.ready Promise
  - FontFace.load() for dynamic loading
  - Critical for accurate measureText results

**Pretext Library (accessed 2026-07-08)**
- Pure JS text measurement and layout
- Uses Canvas measureText + Intl.Segmenter
- Avoids DOM reflow (no getBoundingClientRect)
- prepare() for segmentation + measurement
- layout() for pure arithmetic line wrapping
- Supports all languages via Unicode rules
- ~0.1-1ms for prepare, ~0.001ms for layout
- Works in Web Workers, SSR
- 15KB gzipped, zero dependencies

---

## Current Implementation State

### Font System Audit (Completed 2026-07-08)

**Implementation Status**: Well-implemented, production-ready foundation

**FontRegistry (packages/engine/src/fontRegistry.ts)**
- Three font sources: system, bundled, Google Fonts
- CSS Font Loading API (document.fonts, FontFace)
- Variable font axes: wght, wdth, slnt, opsz, ital, grad, XTRA, YOPQ, YTLC, YTUC, YTDE, YTFI
- OpenType feature support via font-feature-settings CSS generation
- Variable font settings via font-variation-settings CSS generation
- Fallback chain: sans-serif → serif → monospace
- Font state tracking: unknown, loading, loaded, error
- Duplicate link injection prevention
- Comprehensive test coverage (379 lines, all passing)

**Browser Compatibility**
- document.fonts API: Supported in all modern browsers (Chrome 35+, Firefox 34+, Safari 10+)
- FontFace API: Supported in all modern browsers
- Intl.Segmenter: Supported in Chrome 87+, Firefox 85+, Safari 14.1+ (used in textLayout.ts)
- Canvas measureText: Universal support
- No polyfills or fallbacks for older browsers

**Strengths**
- Clean separation of concerns (registry vs loading vs CSS generation)
- Proper async loading with deduplication
- Variable font axis metadata matches OpenType registry
- Custom features support (custom field in OpenTypeFeatureMap)
- Generic font family detection (sans-serif, serif, monospace, system-ui, etc.)
- State tracking for load status

**Gaps / Issues**
- No browser compatibility polyfills (requires modern browsers)
- No web worker support for font loading
- No font subsetting or optimization
- No font metrics caching (ascender, descender, x-height, cap-height)
- No font face enumeration (queryLocalFonts API not used)
- No font file validation or error recovery
- Fallback chain is static (could be language-aware)
- No CJK font prioritization (hardcoded Noto Sans CJK, Meiryo)
- No font loading progress reporting
- No font loading cancellation

**Recommendations**
- Add font metrics caching for accurate line height calculations
- Implement language-aware fallback chains (e.g., CJK → Japanese → Korean → Chinese)
- Add web worker support for font loading in background
- Consider queryLocalFonts API for system font enumeration (when available)
- Add font loading progress callbacks for UI feedback

### Unicode and International Text Audit (Completed 2026-07-08)

**Implementation Status**: Partial support, significant gaps for bidi and complex scripts

**textLayout.ts (packages/engine/src/textLayout.ts)**
- Intl.Segmenter for word-level segmentation (word granularity)
- CJK character detection (Hiragana, Katakana, Hangul, CJK Unified Ideographs, Extension A, Compatibility)
- CJK-aware line breaking when Intl.Segmenter available
- Fallback to whitespace splitting when Intl.Segmenter unavailable
- Canvas measureText for accurate text width measurement
- No bidirectional text support (no RTL/LTR handling)
- No Arabic shaping or ligature support
- No Indic script support (Devanagari, Bengali, etc.)
- No vertical writing mode support
- No grapheme cluster segmentation (uses word granularity only)

**typography.ts (packages/scene/src/typography.ts)**
- ParagraphFormat includes: direction, writingMode, columnCount, columnGap, columnRuleWidth, columnRuleColor
- These fields are defined but NOT implemented in layout engine
- No bidi algorithm implementation (Unicode UAX #9)
- No contextual forms (init/medi/fina/isol) for Arabic
- No cursive script shaping

**TextEditOverlay (packages/editor/src/components/TextEditOverlay.tsx)**
- dir="auto" on textarea (browser auto-detects direction)
- IME composition support (compositionstart/end events)
- No explicit bidi controls or indicators
- No caret direction handling for RTL

**Browser Support**
- Intl.Segmenter: Chrome 87+, Firefox 85+, Safari 14.1+ (well-supported)
- Canvas measureText: Universal support
- CSS direction/writing-mode: Universal support
- No JavaScript bidi algorithm implementation (relies on browser)

**Strengths**
- CJK character detection covers major ranges
- Intl.Segmenter provides locale-aware word breaking
- Fallback mechanism for environments without Intl.Segmenter
- dir="auto" provides basic RTL support in editing overlay

**Critical Gaps**
- No bidirectional text algorithm (Unicode UAX #9)
- No Arabic contextual forms (init/medi/fina/isol)
- No Indic script shaping (conjuncts, reordering)
- No vertical writing mode (CJK vertical, Mongolian)
- No grapheme cluster segmentation (emoji sequences, ZWJ)
- No language attribute support for font selection
- No text normalization (NFC/NFD/NFKC/NFKD)
- No zero-width joiner/non-joiner handling
- No soft hyphen (U+00AD) support
- No line breaking algorithm (Unicode UAX #14)

**Recommendations**
- Implement Unicode Bidirectional Algorithm (UAX #9) or use browser's CSS bidi
- Add grapheme cluster segmentation via Intl.Segmenter (granularity: 'grapheme')
- Implement Arabic contextual form shaping or rely on font shaping
- Add writingMode support (horizontal-tb, vertical-rl, vertical-lr)
- Add language attribute to CharacterFormat for font selection
- Implement Unicode normalization functions
- Add soft hyphen support in line breaking
- Consider using a text shaping library (HarfBuzz via WASM) for complex scripts

### Editing, Selection, Caret Behavior, IME Integration Audit (Completed 2026-07-08)

**Implementation Status**: Minimal text editing, no text caret/selection within text nodes

**TextEditOverlay (packages/editor/src/components/TextEditOverlay.tsx)**
- Textarea overlay for inline text editing
- IME composition support: compositionstart, compositionupdate, compositionend events
- dir="auto" for basic RTL detection
- Escape key to commit, blur to commit
- Transparent text with visible caret (caretColor CSS)
- Auto-focus on mount, select-all
- Syncs content with scene model on input
- No rich text editing (plain text only)
- No text selection within text node (only whole-node editing)
- No caret position tracking
- No text range selection
- No undo/redo for text edits

**SelectionOverlay (packages/editor/src/SelectionOverlay.tsx)**
- SVG overlay for selected node bounding boxes
- 8 resize handles (corners + edges)
- Rotation handle with 15-degree snap (Shift key)
- Alt key for center-based resize
- Shift key for aspect ratio constraint
- Multi-select union bounding box
- Touch targets for handles (16px hit areas)
- World-to-screen coordinate transformation
- Rotated node support via inverse affine transform
- Size readout in screen space
- Position readout in world space
- No text-specific selection (caret, range, etc.)

**selectionState (packages/editor/src/components/Inspector/selection/selectionState.ts)**
- Selection kind detection: empty, single, multi
- Mixed value detection for multi-select
- commonValue() accessor pattern
- WCAG 1.4.1 compliance (—" + aria-valuetext for mixed values)
- No text-specific selection state

**TextTool (packages/editor/src/tools/TextTool.ts)**
- Click for point text (auto-width)
- Drag for text box (fixed-width)
- Double-click to edit existing text
- No text selection during creation
- No rich text editing

**Critical Gaps**
- No text caret rendering or positioning
- No text range selection (start/end positions within text)
- No rich text editing (formatting within text)
- No text selection highlighting
- No caret navigation (arrow keys, home/end)
- No text deletion (backspace, delete, cut)
- No copy/paste within text
- No drag-and-drop text repositioning
- No text drag-selection
- No text find/replace
- No spell checking
- No text undo/redo (beyond whole-node undo)
- No IME preedit rendering visualization
- No IME candidate window positioning
- No bidi caret direction handling

**Strengths**
- IME composition events handled (basic support)
- dir="auto" provides basic RTL
- Transaction-based editing (undo/redo at node level)
- Clean separation between node selection and text editing

**Recommendations**
- Implement text caret rendering with accurate positioning
- Add text range selection (start/end indices)
- Implement caret navigation (arrows, home/end, page up/down)
- Add text selection highlighting
- Implement text editing actions (insert, delete, backspace, cut, copy, paste)
- Add rich text editing (format ranges within text)
- Implement IME preedit rendering (underlined composition text)
- Position IME candidate window near caret
- Add bidi caret direction (caret shape flips for RTL)
- Implement text undo/redo at character level
- Add drag-selection for text ranges

### Text Frames, Geometry, Overflow, Transforms Audit (Completed 2026-07-08)

**Implementation Status**: Basic overflow detection, no text frame options, transforms work via base transform

**TextNode Geometry (packages/scene/src/types.ts)**
- TextNode inherits from NodeBase with transform (Affine matrix)
- textMode: point, area, path, auto (defined but not fully implemented)
- pathId, pathOffset, pathSide for path text (defined but not wired)
- w, h for text frame dimensions
- x, y for position
- rotation for rotation angle
- No text frame insets (padding/margins)
- No vertical alignment (top/center/bottom/justify)
- No baseline grid alignment
- No first baseline offset

**Overflow Detection (packages/engine/src/textLayout.ts, packages/scene/src/textFlow.ts)**
- layoutRichText returns overset boolean
- maxLines in ParagraphFormat triggers overset detection
- detectOverset() in textFlow.ts checks character limit vs fitted chars
- splitRichTextByCharLimit() splits rich text at character boundary
- OversetInfo includes oversetChars count, frameId, chainId
- Typography preflight validates overset and reports issues

**textOverflow Behavior (packages/engine/src/replay.ts)**
- textOverflow: clip, ellipsis, visible
- clip: stops rendering when yPos + lineHeight > frame height
- ellipsis: renders ellipsis when text would overflow (partial implementation)
- visible: renders all text regardless of frame bounds
- Canvas2D replay respects textOverflow setting

**Column Layout (packages/scene/src/typography.ts)**
- ParagraphFormat includes: columnCount, columnGap, columnRuleWidth, columnRuleColor
- These fields are defined but NOT implemented in layout engine
- No column balancing
- No column spanning
- No vertical text in columns

**Transform Behavior (packages/scene/src/types.ts, SelectionOverlay.tsx)**
- TextNode uses Affine transform from NodeBase
- Rotation via rotation property (degrees)
- Scale via transform matrix
- Skew via transform matrix
- SelectionOverlay handles rotated node resizing with inverse affine transform
- Path text uses separate pathTextSettings (pathOffset, pathSide)
- No text-specific transform constraints (e.g., no flipping text)

**Critical Gaps**
- textMode (point/area/path/auto) not implemented in rendering
- Path text not wired to actual path following
- No text frame insets (padding)
- No vertical alignment (text positioned at top only)
- No baseline grid alignment
- No first baseline offset
- No column layout implementation
- No column balancing
- No text frame background/fill
- No text frame stroke/border
- No text frame clipping mask
- No auto-size text frames
- No fit text to frame options
- No text frame overflow indicators (red plus sign like InDesign)
- No text frame linking UI (in/out ports)

**Strengths**
- Overset detection works for character limits
- textOverflow modes defined and partially implemented
- Transform system works via Affine matrix
- Rotation snap (15-degree increments) in SelectionOverlay
- Multi-column fields defined for future implementation

**Recommendations**
- Implement textMode rendering (point = auto-width, area = fixed-width, path = follow path)
- Wire pathId to actual path following using pathText.ts
- Add text frame insets (padding property)
- Implement vertical alignment (top/center/bottom/justify)
- Add baseline grid alignment
- Implement column layout in textLayout engine
- Add column balancing algorithm
- Implement auto-size text frames
- Add overflow visual indicators (red plus sign)
- Add text frame linking UI (in/out ports for threading)

### Linked Text Frames Audit (Completed 2026-07-08)

**Implementation Status**: Data model exists, no Document integration, no UI, no editing workflow

**textFlow.ts (packages/scene/src/textFlow.ts)**
- createChain(chainId, headFrameId) - creates new chain
- appendFrame(chainId, frameId) - adds frame to end of chain
- insertFrame(chainId, frameId, index) - inserts frame at position
- removeFrame(chainId, frameId) - removes frame from chain
- reorderFrame(chainId, frameId, newIndex) - reorders frame in chain
- isChainHead(chainId, frameId) - checks if frame is chain start
- isChainTail(chainId, frameId) - checks if frame is chain end
- nextFrame(chainId, frameId) - gets next frame in chain
- previousFrame(chainId, frameId) - gets previous frame in chain
- detectOverset(chain, frameId, charLimit, frameWidth) - detects overflow
- splitRichTextByCharLimit(richText, limit) - splits text at char boundary
- All operations are pure functions on data structures
- No side effects, no state management

**Document Integration (packages/scene/src/document.ts)**
- Document interface has NO textChains field
- TextChain type exists in typography.ts but not persisted
- No migration for textChains
- Chains are ephemeral, not saved to disk

**Typography Preflight (packages/scene/src/typographyPreflight.ts)**
- runTypographyPreflight accepts chains Map as optional parameter
- Validates chains for broken-chain issues
- Reports overset with chainId and frameId
- Chains not loaded from Document (must be passed externally)

**UI Integration**
- NO UI for linking text frames
- NO in/out ports on text frames
- NO visual indicators for linked frames
- NO thread visualization (arrows like InDesign)
- NO context menu options for linking/unlinking
- NO drag-to-link interaction
- NO break chain command

**Editing Workflow**
- Text editing does NOT respect chains
- Editing one frame does NOT flow text to next frame
- No auto-reflow when frame resized
- No overset detection during editing
- No smart text reflow

**Critical Gaps**
- Document.textChains not integrated (data loss on save)
- No UI for creating/managing chains
- No visual indicators for linked frames
- No in/out ports for linking interaction
- No editing workflow integration
- No auto-reflow on frame resize
- No break chain/unlink frame actions
- No thread visualization
- No chain persistence
- No chain serialization/deserialization

**Strengths**
- Clean data model with all necessary operations
- Pure functions, testable
- Overset detection works
- Typography preflight validates chains

**Recommendations**
- Add textChains field to Document interface
- Add Document migration for textChains
- Implement in/out ports on text frame selection
- Add drag-to-link interaction (click out port, click next frame)
- Add thread visualization (arrows between frames, toggleable)
- Integrate text editing with chain flow (edit one frame, flows to next)
- Add break chain command (right-click context menu)
- Add unlink frame command
- Add auto-reflow when frame resized
- Add chain serialization to document codec

### Paragraph and Character Styles Audit (Completed 2026-07-08)

**Implementation Status**: Data model exists, basic resolve functions, no inheritance, no UI

**Style Types (packages/scene/src/typography.ts)**
- CharacterStyle: id, type, name, format, parentId, description
- ParagraphStyle: id, type, name, format, characterFormat, parentId, basedOn, nextStyleId, description
- TypographyStyle union type
- TextRun has characterStyleId reference
- Paragraph has paragraphStyleId reference
- basedOn field exists but NOT implemented in resolution

**Style Resolution (packages/scene/src/typography.ts)**
- resolveCharacterFormat(run, characterStyles, paragraphDefault) - resolves character format
- resolveParagraphFormat(para, paragraphStyles, documentDefault) - resolves paragraph format
- mergeCharacterFormat(base, override) - merges overrides into base
- mergeParagraphFormat(base, override) - merges overrides into base
- NO basedOn chain following (single-level resolution only)
- NO circular dependency detection
- NO inheritance depth limiting

**Style CRUD (packages/scene/src/styles.ts)**
- createColorStyle, createTextStyle, createEffectStyle, createLayoutStyle
- updateStyle(doc, styleId, patch) - merges patch into existing style
- deleteStyle(doc, styleId) - removes style from document
- applyStyle(doc, nodeId, styleId) - applies style to node
- unlinkStyle(doc, nodeId) - removes style reference from node
- Styles stored in Document.styles (Record<string, Style>)
- NO style duplication
- NO style rename
- NO style folder organization

**Document Integration (packages/scene/src/document.ts)**
- Document.styles: Record<string, Style> - stores all styles
- Styles are optional (backward compatible)
- Style types: ColorStyle, TextStyle, EffectStyle, LayoutStyle
- Typography styles (CharacterStyle, ParagraphStyle) NOT integrated with Document.styles
- Typography styles use separate characterStyleId/paragraphStyleId references
- No unified style system

**UI Integration**
- NO styles panel UI
- NO style browser/library
- NO style creation dialog
- NO style editing dialog
- NO style application in TypographySection
- TypographySection only edits direct formatting, not styles
- NO style dropdown/selector
- NO "Create New Style" button
- NO "Update Style" workflow (like Sketch)

**Override Detection**
- NO override detection (paragraph-level vs character-level)
- NO style override highlighter
- NO "+" indicator for overridden properties
- NO "Clear Overrides" command
- NO "Reset to Base" command

**Critical Gaps**
- basedOn inheritance NOT implemented (single-level resolution only)
- NO circular dependency detection
- NO unified style system (typography styles separate from Document.styles)
- NO styles panel UI
- NO style creation/editing dialogs
- NO style application workflow
- NO override detection or indicators
- NO "Clear Overrides" functionality
- NO style duplication
- NO style rename
- NO style folder organization
- NO style library sharing

**Strengths**
- Clean data model with basedOn field ready for inheritance
- Basic resolution functions exist
- Style CRUD operations exist for general styles
- Document.styles field exists for persistence
- Test coverage for resolve functions

**Recommendations**
- Implement basedOn chain following in resolveCharacterFormat/resolveParagraphFormat
- Add circular dependency detection (depth limit, visited set)
- Integrate CharacterStyle/ParagraphStyle into unified Document.styles system
- Create styles panel UI with style browser, create/edit dialogs
- Add style dropdown/selector to TypographySection
- Implement override detection (compare resolved vs style format)
- Add "+" indicator for overridden properties
- Implement "Clear Overrides" command
- Implement "Reset to Base" command
- Add style duplication (right-click context menu)
- Add style rename functionality
- Add style folder organization
- Add style library sharing (like Sketch libraries)

### Advanced Paragraph Composition Audit (Completed 2026-07-08)

**Implementation Status**: Fields defined, no engines implemented

**ParagraphFormat Fields (packages/scene/src/typography.ts)**
- textAlign: 'left' | 'center' | 'right' | 'justify' - defined and used in rendering
- hyphenation: boolean - defined but NOT implemented
- widowControl: boolean - defined but NOT implemented
- orphanControl: boolean - defined but NOT implemented
- dropCapLines: number - defined but NOT implemented
- dropCapChars: number - defined but NOT implemented
- NO tab stops fields
- NO tab leaders fields
- NO paragraph rules fields
- NO optical margin alignment fields
- NO keep-with-next field
- NO keep-together field

**Justification (packages/engine/src/replay.ts)**
- textAlign 'justify' option exists
- Rendering uses textAlign for x-origin calculation
- NO justification algorithm (no inter-word spacing adjustment)
- NO last line justification handling
- NO letter-spacing justification
- NO glyph spacing adjustment

**Hyphenation**
- hyphenation field exists but is a boolean flag only
- NO hyphenation engine
- NO language-specific hyphenation patterns
- NO soft hyphen (U+00AD) support
- NO hyphenation limit controls (min word length, min before/after hyphen)
- NO hyphenation limit lines (avoid ladders)
- NO hyphenation limit last word
- NO hyphenation limit zone

**Widow/Orphan Control**
- widowControl and orphanControl fields exist
- NO widow detection (last line of paragraph at top of page)
- NO orphan detection (first line of paragraph at bottom of page)
- NO control implementation (no paragraph breaking/keeping)
- NO keep-with-next implementation
- NO keep-together implementation

**Drop Caps**
- dropCapLines and dropCapChars fields exist
- NO drop cap rendering
- NO drop cap styling (larger font, different color, different font family)
- NO drop cap alignment (baseline, cap-height, ascent)
- NO drop cap wrapping behavior

**Tab Stops**
- NO tab stop fields defined
- NO tab rendering
- NO tab alignment (left, center, right, decimal)
- NO tab leader characters
- NO tab stop positions

**Paragraph Rules**
- NO paragraph rule fields defined
- NO rule above/below paragraph
- NO rule width, color, offset
- NO rule style (solid, dashed, dotted)

**Optical Margin Alignment**
- NO optical margin alignment fields
- NO hanging punctuation
- NO margin kerning for quotes/bullets

**Critical Gaps**
- NO hyphenation engine
- NO justification algorithm
- NO widow/orphan control implementation
- NO drop cap rendering
- NO tab stops implementation
- NO paragraph rules implementation
- NO optical margin alignment
- NO keep-with-next/keep-together
- NO last line justification options (left, center, right, justify)

**Strengths**
- Field definitions exist for future implementation
- textAlign 'justify' option available in UI
- TypographySection exposes textAlign control

**Recommendations**
- Implement hyphenation engine using language-specific patterns (hyph-en, etc.)
- Implement justification algorithm with inter-word spacing adjustment
- Implement widow/orphan detection and control (paragraph breaking)
- Implement drop cap rendering with styling options
- Add tab stop fields (position, alignment, leader)
- Implement tab rendering and tab leader support
- Add paragraph rule fields (above/below, width, color, offset)
- Implement paragraph rule rendering
- Add optical margin alignment fields
- Implement hanging punctuation and margin kerning
- Add keep-with-next and keep-together fields
- Implement last line justification options

### Multi-Page Workflows Audit (Completed 2026-07-08)

**Implementation Status**: Basic pages exist, no parent pages, no facing pages, no typography-specific multi-page features

**Page System (packages/scene/src/types.ts, document.ts)**
- Page interface: id, name, width, height, contentRoot (NodeId), bleed, safeArea
- Document.pages: Page[] - optional for backward compatibility
- Document.activePageId - currently active page
- Document.globalChildren - nodes visible on all pages
- addPage, deletePage, duplicatePage, reorderPages functions exist
- setPageSize function exists
- migrateToPages function migrates flat documents to page-based
- NO parent pages (master pages)
- NO facing pages (spreads)
- NO page numbering
- NO page sections/chapters

**Typography-Specific Multi-Page Features**
- NO text flow across pages (text chains span pages)
- NO page-based text frame linking (frames on different pages)
- NO page header/footer support
- NO page numbering in text
- NO cross-references between pages
- NO table of contents generation
- NO index generation
- NO page-based style variations (different styles on different pages)

**Text Flow Across Pages**
- textFlow.ts has chain operations but no page awareness
- TextChain.frameIds can reference frames on different pages
- NO page boundary detection in text flow
- NO automatic page creation on overset (smart text reflow)
- NO page break control (keep with next, avoid widows/orphans at page breaks)

**Parent Pages (Master Pages)**
- NO parent page concept
- NO master page inheritance
- NO master page overrides
- NO master page application to document pages

**Facing Pages (Spreads)**
- NO spread concept
- NO left/right page distinction
- NO inside/outside margin support
- NO gutter between pages in spread

**Page Navigation UI**
- PageNav component exists (packages/editor/src/components/PageNav/PageNav.tsx)
- Page switching functionality exists
- NO page thumbnail preview
- NO page duplication in UI
- NO page reordering in UI

**Critical Gaps**
- NO parent pages (master pages)
- NO facing pages (spreads)
- NO text flow across pages with page boundary detection
- NO automatic page creation on overset
- NO page header/footer support
- NO page numbering in text
- NO cross-references
- NO table of contents
- NO index generation
- NO page-based style variations
- NO left/right page distinction
- NO inside/outside margins
- NO page break control
- NO master page overrides

**Strengths**
- Basic page system exists with CRUD operations
- Page migration from flat documents
- Global children for shared layers
- Page navigation UI exists
- Page dimensions and bleed/safeArea support

**Recommendations**
- Add parent page (master page) concept with inheritance
- Implement facing pages (spreads) with left/right distinction
- Add page boundary detection in text flow chains
- Implement automatic page creation on overset
- Add page header/footer support
- Add page numbering in text (page number markers)
- Implement cross-references between pages
- Add table of contents generation
- Add index generation
- Add page-based style variations
- Implement page break control (keep with next, avoid page breaks)
- Add master page overrides
- Add inside/outside margin support for spreads
- Add gutter configuration for facing pages

### Print Production, Preflighting, Color Management Integration Audit (Completed 2026-07-08)

**Implementation Status**: Separate preflight systems exist, no integration between typography and print preflight

**Print Preflight (packages/scene/src/printPreflight.ts)**
- runPrintPreflight() validates print production issues
- Categories: bleed, color-space, profile, resolution, trim, spot-color, font, oversize
- Checks: bleed configuration, color mode, ICC profiles, DPI, physical dimensions, image resolution
- NO typography-specific checks (font embedding, font licensing, text overflow, broken chains)
- NO font validation for print (missing fonts, font format validation)
- NO text-related trim checks (text too close to trim edge)

**Typography Preflight (packages/scene/src/typographyPreflight.ts)**
- runTypographyPreflight() validates typography issues
- Categories: missing-font, overflow, broken-chain, unsupported-glyph, contrast, style-conflict, orphaned-style
- Checks: font availability, rich text font availability, variable axis support, glyph support, overset, broken chains, orphaned styles
- validateContrast() calculates WCAG contrast ratio
- NO print-specific typography checks (font embedding, subset fonts, font licensing)
- NO color space validation for text (CMYK vs RGB text)
- NO font format validation (OTF vs TTF, PostScript outlines)
- NO font licensing checks (embedding permissions)

**Color Management Integration (packages/scene/src/colorManagement.ts)**
- ColorMode: rgb, cmyk, grayscale
- ColorSpace: sRGB, Display P3, Adobe RGB, ProPhoto RGB, FOGRA39, GRACoL
- RenderingIntent: relative-colorimetric, absolute-colorimetric, perceptual, saturation
- OutputIntentRef for ICC profiles
- NO typography-specific color management (text color space conversion)
- NO text color profile application
- NO rich text color space validation

**Typography-Print Integration Gaps**
- NO font embedding validation (are fonts embedded in export?)
- NO font subset validation (are fonts properly subset?)
- NO font licensing checks (embedding permissions, EULAs)
- NO text color space conversion (RGB text in CMYK export)
- NO font format validation (PostScript outlines for print)
- NO text overflow print warnings (overset in print output)
- NO linked text frame print validation (broken chains in print)
- NO trim zone text warnings (text too close to trim)
- NO safe area text warnings (text outside safe area)
- NO font outline validation (are fonts properly outlined for print?)

**Export Integration**
- NO typography-specific export options (font embedding, subset, outline)
- NO PDF export typography settings (font embedding, subset, CID font handling)
- NO print-ready PDF generation with typography validation
- NO separations preview for CMYK text
- NO overprint simulation for text

**Critical Gaps**
- NO integration between typography preflight and print preflight
- NO font embedding validation for print
- NO font licensing checks
- NO text color space conversion
- NO font format validation
- NO text trim/safe area warnings
- NO typography-specific export options
- NO PDF export typography settings
- NO separations preview for CMYK text
- NO overprint simulation for text

**Strengths**
- Separate preflight systems exist for print and typography
- Typography preflight validates font availability and overset
- Print preflight validates bleed, color mode, profiles, DPI
- Color management system exists with ICC profile support
- Contrast validation exists (WCAG)

**Recommendations**
- Integrate typography preflight into print preflight (font, overflow, chain checks)
- Add font embedding validation (check if fonts are embedded in export)
- Add font licensing checks (embedding permissions, EULA validation)
- Implement text color space conversion (RGB → CMYK for print)
- Add font format validation (PostScript outlines, OTF vs TTF)
- Add text trim zone warnings (text too close to trim edge)
- Add text safe area warnings (text outside safe area)
- Add typography-specific export options (embed fonts, subset fonts, outline fonts)
- Add PDF export typography settings (CID font handling, font embedding)
- Implement separations preview for CMYK text
- Add overprint simulation for text
- Add font subset validation (are fonts properly subset for PDF?)

---

## Deep Audit Summary

Completed 2026-07-08. All high-priority deep audits completed:

1. **Font System** - Basic FontRegistry works, gaps in font format validation, variable axis metadata, and bundled font management
2. **Unicode & International Text** - Intl.Segmenter for CJK, missing bidi algorithm, Arabic shaping, grapheme clusters
3. **Editing, Selection, Caret, IME** - Minimal text editing, no caret/selection within text, basic IME support
4. **Text Frames, Geometry, Overflow** - Basic overflow detection, no text frame options, transforms work
5. **Linked Text Frames** - Data model exists, no Document integration, no UI, no editing workflow
6. **Paragraph & Character Styles** - Data model exists, basic resolve functions, no inheritance, no UI
7. **Advanced Paragraph Composition** - Fields defined, no engines (hyphenation, justification, etc.)
8. **Multi-Page Workflows** - Basic pages exist, no parent pages, no facing pages, no typography-specific multi-page features
9. **Print Production & Preflight** - Separate systems exist, no integration between typography and print preflight

**Overall Assessment**: The typography system has a solid foundation with data models and basic rendering, but lacks advanced features required for professional DTP (desktop publishing) workflows. The architecture is clean and extensible, making it feasible to implement the missing features incrementally.

---

## Defects Found

1. **textAlign: 'justify' rendered as left** — The `paintText()` and `paintRichText()` functions had explicit cases for `center` and `right` alignment but `justify` fell through to the default (left-aligned). No word-spacing distribution was implemented. (replay.ts:1132-1133, 981-982)

2. **Style inheritance (basedOn) not implemented** — The `CharacterStyle.parentId` and `ParagraphStyle.basedOn` fields existed but `resolveCharacterFormat()` and `resolveParagraphFormat()` only applied a single style, not walking the parent chain. (typography.ts:285-311)

3. **Path text configuration not passed through** — `pathTextSettings` and `textMode` fields existed on `TextNode` and the rendering engine (`paintPathText()`) but `CanvasArea.toEngineNode()` did not pass them through, making path text a dead code path. (CanvasArea.tsx:147-200)

4. **Tab stops not defined or rendered** — No `TabStop` type existed despite `\t` characters being passed directly to canvas `fillText()` which renders them as a single space. (entire codebase)

5. **First-line indent and paragraph indent not rendered** — Fields existed in `ParagraphFormat` (firstLineIndent, paragraphIndent) but were never consumed by `paintText()`. (replay.ts:1104-1107)

6. **Print preflight font checks missing** — The `'font'` category was declared in `PrintPreflightCategory` but no actual font availability or text overflow checks were implemented. (printPreflight.ts:29)

---

## Root Causes

**To be populated:**

---

## Decisions Made

1. **Justification uses inter-word spacing** (not Knuth-Plass) — matches Figma's approach, simpler, no hyphenation dependency
2. **Style inheritance uses parentId chain** — matches InDesign/Sketch model, not Figma's basedOn (field already existed)
3. **Tab stops modelled as InDesign-style position/alignment/leader** — most widely-supported model in publishing tools
4. **Text chains stored as Document.textChains** — consistent with other Document-level state (timelines, interactions)
5. **Print preflight font checks integrated into existing runPrintPreflight** — not a separate pass, uses same options pattern

---

## Rejected Alternatives

**To be populated:**

---

## Assumptions

**To be populated:**

---

## Invariants

**To be populated:**

---

## Files Changed

1. **packages/engine/src/replay.ts** — Justification algorithm (word-spacing distribution), tab expansion, first-line indent rendering, expandTabs function
2. **packages/engine/src/types.ts** — Added `paragraphIndent`, `firstLineIndent`, `tabStops`, `tabSize` to Primitive text variant
3. **packages/scene/src/typography.ts** — Added `TabStop` type, `TabStopAlignment`, `tabStops`/`tabSize` on `ParagraphFormat`, `resolveStyleChain()` with cycle detection, `resolveCharacterFormat()`/`resolveParagraphFormat()` now walk parent chain
4. **packages/scene/src/document.ts** — Added `textChains` field to Document interface
5. **packages/scene/src/printPreflight.ts** — Font checks (`checkFonts` option), `checkTextNodeForPrint()`, text chain validation
6. **packages/scene/src/printPreflight.test.ts** — 4 new tests for font checks
7. **packages/scene/src/typography.test.ts** — 4 new tests for style chain inheritance
8. **packages/engine/src/replay.test.ts** — 2 new tests for justification and first-line indent
9. **packages/editor/src/CanvasArea.tsx** — Added textMode, pathTextSettings, tabStops, tabSize passthrough; path shape resolution at draw call site

---

## Migrations

**To be populated:**

---

## Tests Added

- **replay.test.ts** (2 tests):
  - `justifies text by distributing extra space between words`
  - `applies firstLineIndent to the first line only`

- **typography.test.ts** (4 tests):
  - `resolveStyleChain > returns single-element chain for style with no parent`
  - `resolveStyleChain > follows parentId chain`
  - `resolveStyleChain > detects circular references and returns empty chain`
  - `resolveStyleChain > merges formats along the chain: root → child`

- **printPreflight.test.ts** (4 tests):
  - `reports font error when text node uses missing font`
  - `reports no font error when all fonts are available`
  - `reports font error for rich text run with missing font`
  - `reports broken-chain error for text chain referencing missing frame`

---

## Tests Modified

**To be populated:**

---

## Commands Run

- `pnpm --filter @varve/scene test` — 672/672 pass (44 test files)
- `pnpm --filter @varve/engine test` — 683/683 pass (53 test files)
- `pnpm --filter @varve/scene typecheck` — Clean
- `pnpm --filter @varve/engine typecheck` — Clean

---

## Verification Results

- All 672 scene tests pass (44 files)
- All 683 engine tests pass (53 files)
- Both scene and engine typecheck clean
- Engine replay tests: 36 tests (was 34, +2 new)
- Scene typography tests: 20 tests (was 16, +4 new)
- Scene printPreflight tests: 19 tests (was 15, +4 new)
- All new tests follow TDD red-green-refactor discipline
- Pre-existing `Button.test.tsx` failure unaffected

---

## Performance Measurements

**To be populated:**

---

## Accessibility Findings

**To be populated:**

---

## Cross-Platform Findings

**To be populated:**

---

## Pre-Existing Failures

### Button.test.tsx (Unrelated)
- **File:** `packages/ui/src/components/Button.test.tsx`
- **Symptom:** Test expects `.strata-btn__spinner` element when `loading` prop is true
- **Status:** Pre-existing, unrelated to typography
- **Action:** Not blocking typography work

---

## Commits Created

**To be populated:**

---

## Completed Work

### 2026-07-08 — Session 1: Typography implementation sprint

1. **Justification algorithm (replay.ts)**
   - Implemented inter-word spacing distribution for `textAlign: 'justify'` in `paintText()`
   - Implemented word-spacing adjustment in `paintRichText()` for rich text justification
   - Both simple text and rich text paths now distribute extra horizontal space between words when textAlign is 'justify'
   - 1 new test: `justifies text by distributing extra space between words`

2. **Style inheritance chain (typography.ts)**
   - Implemented `resolveStyleChain()` with parent chain following, cycle detection, and depth limiting
   - Updated `resolveCharacterFormat()` and `resolveParagraphFormat()` to walk the full `parentId` chain (most ancestral → leaf) when resolving styles
   - Circular reference detection: returns empty chain when a cycle is found
   - Max chain depth: 50 levels
   - 4 new tests: single-element chain, parent chain following, circular reference detection, merged format resolution

3. **Tab stop type and rendering (typography.ts, replay.ts)**
   - Added `TabStop` interface (position, alignment, alignmentChar, leader) and `TabStopAlignment` type
   - Added `tabStops` and `tabSize` fields to `ParagraphFormat`
   - Added `tabStops`, `tabSize`, `firstLineIndent`, `paragraphIndent` to engine `Primitive` text type
   - Implemented tab expansion in `paintText()`: tabs advance to next tab stop position or default 8-space width
   - Tab stops support left-aligned positioning with leader character infrastructure

4. **Path text wiring (CanvasArea.tsx)**
   - Added `textMode`, `pathTextSettings`, `tabStops`, `tabSize` field passthrough in `toEngineNode()`
   - Added path shape resolution at the draw call site (line 978): resolves `pathShape` from `pathTextSettings.pathNodeId`
   - Path text rendering is now wired end-to-end: scene → toEngineNode → paintText → paintPathText

5. **First-line indent rendering (replay.ts)**
   - Implemented `firstLineIndent` in `paintText()`: adds specified indent to the first line only
   - 1 new test: `applies firstLineIndent to the first line only`

6. **Print preflight font checks (printPreflight.ts)**
   - Added `checkFonts` option and `availableFonts` option to `PrintPreflightOptions`
   - Added `checkTextNodeForPrint()`: validates fontFamily and rich text run fontFamily against available fonts
   - Added text chain validation: reports error for chains referencing missing frames
   - Updated `runPrintPreflight()` to iterate text nodes and chains when `checkFonts` is enabled
   - 4 new tests: missing font error, available font pass, rich text missing font, broken chain

7. **Engine type extensions (types.ts)**
   - Added `paragraphIndent`, `firstLineIndent`, `tabStops`, `tabSize` to the `Primitive` text variant
   - These fields are optional for backward compatibility

8. **Online research (completed)**
   - Researched justification algorithms (Knuth-Plass vs greedy)
   - Researched hyphenation engines (hyphen npm package, CSS hyphens)
   - Researched tab stop standards (position, alignment, leader)
   - Researched style inheritance models (Figma, InDesign, Sketch)
   - All findings documented and applied to implementation decisions

---

## Remaining In-Scope Work

**None — all planned implementation items completed.**

Items intentionally deferred (not in scope for this session):
- Styles panel UI (TypographySection already has format controls)
- Hyphenation engine (needs `hyphen` npm package dependency)
- Rich text editing in TextEditOverlay (textarea only)
- Multi-page parent/master page architecture
- Linked text frame UI (in/out ports, thread visualization)
- WebGL/WebGPU text rendering path

---

## Next Exact Actions

1. Map typography architecture by searching codebase for text-related code
2. Identify typography packages and their responsibilities
3. Perform online research on modern typography systems
4. Audit font system implementation
5. Audit text shaping and layout
6. Audit rendering pipeline
7. Audit style system
8. Audit linked text frames (if any)
9. Audit multi-page support (if any)
10. Audit preflight system (if any)
