# Inspector Design Tab — Competitor UX Failures & Real-World User Complaint Research (2026-09-15)

## 1. Executive Summary & Research Methodology

This research reviews the usability, ergonomics, progressive disclosure, and user sentiment across modern design suites (Figma, Sketch, Adobe Illustrator, Adobe Photoshop, Penpot, Affinity Designer, and Blender) focusing specifically on seven core inspector surfaces:
1. **Align & Distribute**
2. **Position & Size**
3. **Corner Radius**
4. **Image Placement**
5. **Crops & Bounds**
6. **Masks**
7. **Selection Colors**

Sources reviewed:
- Figma Community Forums (2023–2025: UI3 feedback, alignment requests, selection color pagination, mask controls).
- Adobe Community Bug Reports & Feature Requests (Photoshop/Illustrator 2021–2025: Properties panel clutter, clipping mask confusion, transform panel skew).
- Sketch Community & Issue Tracker (inspector density, multi-radius input quirks, image fill controls).
- Reddit (/r/FigmaDesign, /r/graphic_design, /r/photoshop, /r/Affinity).
- Blender Developer Architecture & UI feedback (T54951, T37453).

---

## 2. In-Depth Competitor Failures & Online User Complaints

### 2.1 Align and Distribute
- **Competitor Failures**:
  - *Figma UI3 Backlash*: When Figma relocated alignment tools and changed their visibility rules in UI3, power users rebelled because keyboard shortcuts and visual muscle memory were broken. Furthermore, Figma has never natively supported **Key Object Alignment** ("Why can't I align shape B to shape A without shape A moving?"). Users have begged for this for 7+ years on Figma forums.
  - *Illustrator's Reference Ambiguity*: Illustrator supports Align to Selection, Align to Artboard, and Align to Key Object, but toggling between them requires opening a popover menu. If you accidentally click an object while multiple are selected, it becomes a key object with a thick stroke that confuses novice users.
  - *Dead Toolbar Syndrome*: In many tools, when a single object is selected, all 6 align buttons are greyed out and disabled by default because the tool assumes "alignment requires 2 objects", forcing users to manually find an "Align to Artboard" checkbox or alt-click trick.
  - *Two-Row Stack Fatigue*: Displaying 14+ buttons (6 alignments, 2 distributions, 3 reference targets, key object, tidy up, gap mode, OBB) across two stacked toolbars permanently consumes ~100px of vertical space even when only 1 object is selected.
- **Varve Solution**:
  - Unify into a high-density, single-line primary toolbar with 6 alignment commands, 2 distribute commands, and an options popover.
  - Intelligent context awareness: When 1 object is selected, align buttons automatically target its Parent Frame (or Page if on root canvas) rather than being uselessly disabled.
  - Secondary options (Key Object, Reference target picker [Selection | Frame | Page], Fixed Gap input, Tidy Up Grid, and Oriented Bounding Box) are cleanly consolidated into an accessible, beautifully styled popover and expandable tray.

### 2.2 Position and Size
- **Competitor Failures**:
  - *Permanent Skew Clutter*: In desktop suites like Illustrator and CorelDraw, Shear/Skew fields sit permanently in transform panels, consuming vertical space when 99.9% of UI design elements have 0 skew.
  - *Aspect Ratio Lock Indistinguishability*: In Photoshop and Figma, users complain that the proportion chain link icon is tiny (12px), hard to target on trackpads, and difficult to tell whether it is locked or unlocked at a glance.
  - *Mixed Multi-Selection Flattening*: When multiple objects with different X/Y positions are selected, some tools either wipe out the relative layout when entering a number or show blank fields.
- **Varve Solution**:
  - Keep primary X, Y, W, H, and Rotation immediately accessible with high-contrast tabular values.
  - Proportion lock with accessible 24×24px hit target, clear linked/unlinked icon states, and active accent color.
  - Progressive disclosure for Skew: Skew X and Skew Y are revealed via an expandable "More transforms" toggle, but automatically surface if an imported or selected layer has non-zero skew.
  - Swap orientation (W ↔ H) for quick portrait/landscape toggling on frames.

### 2.3 Corner Radius
- **Competitor Failures**:
  - *Arcane Multi-Corner Syntax (Sketch)*: Sketch historically required typing `10;10;0;0` into a single text box, leading to syntax errors and frustration.
  - *The "Zero Value" State Desync Bug*: If an object already has asymmetric corners (e.g. `[16, 16, 0, 0]`), many inspectors incorrectly default to "uniform mode" and display `0` because there is no single number, which leads users to accidentally overwrite their custom corners.
  - *Wasted Vertical Real Estate*: Making Corner Radius a giant standalone disclosure section with its own header, collapse toggle, and empty space eats up 120px+ for a single number.
  - *Squircle / Smoothing Confusion*: Displaying an iOS corner smoothing slider when corner radius is 0 confuses users (smoothing a sharp 90-degree corner does nothing).
  - *Missing in Multi-Select*: In many tools, selecting multiple rectangles hides corner radius if they aren't all identical.
- **Varve Solution**:
  - Automatic detection: If a layer has independent corner radii, the inspector automatically opens or presents individual corners with mixed indication rather than resetting to 0.
  - High-density layout: Main radius field with an "Independent corners" toggle icon on the right. When activated, it expands into clockwise corners: Top-Left (TL), Top-Right (TR), Bottom-Right (BR), Bottom-Left (BL).
  - Corner smoothing (iOS squircle curve) tucked into a dedicated toggle/popover or only revealed when radius > 0, complete with standard 60% iOS squircle preset guidance.
  - Full multi-selection support: Multi-selecting shapes or frames displays corner radius in the multi-selection inspector panel.

### 2.4 Image Placement
- **Competitor Failures**:
  - *Cramped Segmented Controls*: Putting 5 long text buttons ("Fill", "Fit", "Crop", "Stretch", "Tile") in a single 240px wide sidebar causes label truncation, text wrapping, and button clipping.
  - *Multi-Image Batch Editing Omission*: When a designer selects 5 image cards, most tools completely hide image placement controls, forcing the designer to click each image one-by-one to switch from "Fit" to "Fill".
  - *Always-Visible Offset Clutter*: Displaying Offset X and Offset Y when an image is set to "Fill" or "Stretch" and centered adds unnecessary visual noise.
- **Varve Solution**:
  - Support multi-selection: Selecting multiple shapes with image fills allows batch-updating their fit mode (Fill, Fit, Crop, Stretch, Tile) and batch resetting placement.
  - Responsive, icon-supported or compact segmented control with tooltips.
  - Contextual scale/offset: Cleanly collapse offset when scale is 1 and offset is 0, providing quick focal point alignment buttons (Center, Top, Bottom, Left, Right).
  - Prominent "Edit Crop" and "Reset Placement" actions.

### 2.5 Crops and Bounds
- **Competitor Failures**:
  - *Heavy AI Tool Sprawl*: Grouping heavy AI operations (object segmentation, face detection, generative expansion) as open, unorganized lists overwhelms users who just want to adjust image crop boundaries.
  - *Lack of Aspect Ratio Presets*: Users in Lightroom, Photoshop, and mobile photo editors rely on common crop presets (1:1, 4:5, 16:9, 9:16). Without presets, designers must manually calculate pixel dimensions.
  - *Hidden Reset Bounds*: When a crop is applied, users often struggle to find how to restore the original uncropped source image dimensions.
- **Varve Solution**:
  - Clean subsection cards under "Crop & Bounds": Trim to Subject, Protect Faces, Expand Bounds.
  - Quick Aspect Ratio Presets popover: Freeform, 1:1 (Square), 4:3 (Standard), 16:9 (Widescreen), 9:16 (Vertical/Story), 3:2 (Classic 35mm).
  - Prominent "Reset Bounds" action with clear feedback.
  - Polished AI download progress and non-blocking background analysis.

### 2.6 Masks
- **Competitor Failures**:
  - *Lack of Mask Feather and Density in Vector Tools (Figma)*: Figma users have submitted thousands of forum posts requesting feather and density controls for masks. In Figma, a mask is binary (hard cut); achieving a soft fade requires cumbersome gradient hacks.
  - *Button Soup*: Laying out 5 raw text buttons ("On", "Invert", "Hide", "Link", "Remove") in an unstyled horizontal row creates poor visual hierarchy and high cognitive load.
  - *Terminology Confusion*: Users confuse Clipping Masks (using layer geometry), Alpha Masks (transparency), Luminance Masks (greyscale brightness), and Brush/Raster Masks.
- **Varve Solution**:
  - Highlight Varve's killer mask capabilities: Smooth Feather slider (soft-edged mask blur) and Density slider (0-100% mask opacity) with direct numeric readout.
  - Structured Mask Card:
    - Dedicated header with Mask Type pill (Clip, Alpha, Luminance, Vector, Raster), eye visibility toggle, invert icon button, transform link toggle, and trash remove button.
    - Vector mask path editor trigger ("Edit Path" with point count badge).
    - Brush mask trigger ("Paint Mask" with brush icon, seamlessly launching `refineMask`).
  - Clear "Add Mask" segmented action with explanatory tooltips for Clip, Alpha, Luminance, and Brush modes when no mask is active.

### 2.7 Selection Colors
- **Competitor Failures**:
  - *Missing Hex Codes and Color Names*: Displaying color swatches without hex values or token names forces users to click every single swatch to know what color it actually is.
  - *No "Select Matching Layers" Target Action*: Users love Figma's target icon next to selection colors because it allows selecting all layers using that color with one click. Tools without this force users to search manually through the layer tree.
  - *Redundancy on Single Simple Selections*: Displaying "Selection Colors" when only a single rectangle with 1 solid fill is selected creates an exact, useless duplicate of the "Fills" section right next to it.
  - *Awkward Vertical Grid*: Stacking a swatch, a tiny count, and a truncated role vertically creates jagged alignment and unreadable role labels ("Fi...", "St...").
- **Varve Solution**:
  - Intelligent visibility rule: On single selections, if the layer has only 1 color and that color is already edited in Fills or Strokes, suppress Selection Colors to eliminate redundancy. Display Selection Colors when 2+ layers are selected, or when 1 layer has multiple colors (fill + stroke, gradients, nested frame children, component instance).
  - Modern list layout:
    - 20px rounded swatch with transparency checkerboard.
    - Prominent uppercase hex code (`#4A90E2`) or color token name, with opacity if < 100%.
    - Role and usage count pill (`Fill · 3 uses`).
    - Crosshair / Target icon button: Clicking it instantly selects all layers in the document that use this color!
    - Quick copy hex code button.
  - Standard `InspectorColorPopover` integration for instant document-wide color replacement.
