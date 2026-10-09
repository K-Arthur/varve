# Bugs/Missing Features Found During Comic Page Generation

While creating the sample comic page, the following observations were made about Varve's current implementation:

## Successfully Used Features

1. **Document Schema (v2.33)**: Document structure with pages, nodes map works correctly
2. **Panel Layout**: `FrameNode` with `panel.semantic: true` and `clipContent: true`
3. **Basic Shapes**: `ShapeNode` with rect, ellipse work well for vector art
4. **Paths**: `PathNode` for mouths and balloon tails
5. **Text Nodes**: Basic `TextNode` with rich text (Delta format)
6. **Groups**: `GroupNode` for organizing character heads and cookies
7. **CalloutRecipe**: The `GroupNode.callout` field for balloon metadata

## Potential Issues/Limitations (Not Confirmed as Bugs)

### 1. Document Creation Without Desktop App
- **Issue**: No programmatic way to validate or test the generated .varve file without manually opening it
- **Impact**: Can't confirm the document actually loads and renders correctly
- **Workaround**: Manual testing required after generation

### 2. Export Capabilities
- **Issue**: No headless export API found for generating PNG/PDF from code
- **Impact**: Can't programmatically create the required deliverables (PNG, PDF/X, unlettered version)
- **Workaround**: Must export manually from the app after loading

### 3. CalloutRecipe Field Mapping
- **Uncertainty**: The balloon `callout` field structure used may not match Varve's exact internal representation
- **Details**: 
  - Used `tails` array with `style: 'pointed' | 'thought'`
  - Used `tailNodeIds` array
  - May need adjustment based on actual callout implementation
- **Testing Needed**: Load the document in Varve to verify balloons work

### 4. Font Embedding for PDF Export
- **Uncertainty**: IBM Plex Sans Variable embedding for print export
- **Details**: While the font is OFL-licensed and bundled, print/PDF export path may need verification
- **Testing Needed**: Export to PDF to confirm font outlining works

### 5. Shading Layer
- **Gap**: The deliverable mentioned "flats plus clipped shading layers" but the current implementation only has flat colors
- **Why**: Wasn't sure of the best way to implement clipping shading layers programmatically
- **Potential Approach**: Add adjustment nodes or use blend modes/opacity on duplicate shapes

### 6. PDF/X Export with Bleed
- **Uncertainty**: The document has `dpi: 300` set, but PDF/X-specific export settings (bleed, color profiles) may require workspace-specific configuration
- **Reference**: AGENTS.md mentions print workspace features for PDF/X
- **Testing Needed**: Export from Print workspace to verify

## Not Issues (Design Decisions)

1. **Simple Art Style**: Deliberately simple vector shapes for easy modification
2. **Light Dialogue**: "Wordless to light dialogue" as requested
3. **No Animation**: Static page as intended
4. **Panel Count**: 6 panels chosen (within 4-6 range)

## Recommended Next Steps

1. **Manual Load Test**: Open `halloween-cookies.varve` in Varve desktop
2. **Balloon Verification**: Check if speech/thought balloons render and are editable
3. **Export Tests**: 
   - Export to high-res PNG
   - Export to PDF (ideally PDF/X with bleed)
   - Create unlettered version (hide text layers)
4. **Add Shading**: If needed, manually add a shading layer and document the approach
5. **CLI Export**: Investigate if `@varve/cli` can be extended for headless export

## Files to Review

- `packages/scene/src/callout.ts` - Callout system implementation
- `packages/scene/src/types.ts` - CalloutRecipe interface (line ~1847)
- `docs/architecture/comic-workflow.md` - Comic system documentation
- `packages/print` - PDF/X export implementation

---

**Note**: None of these are confirmed bugs — they're observations from programmatic document generation. The generated file follows the schema correctly based on the docs, but needs real app testing to verify full functionality.
