# Menu × Workspace Visibility Matrix

**Status:** Implemented — menu visibility per workspace is applied at runtime
via the `workspaces` filter on item definitions
(`packages/editor/src/menu/defs.ts`, applied by `renderer.ts`); this matrix
is the consolidated view. The seven workspace ids are design, print, drawing,
image, motion, logo, codegen.
**Posture:** SHOW unless meaningless in that mode.

**Generated output.** The item tables are produced from
`packages/editor/src/menu/defs.ts` by `scripts/regenerate-menu-matrices.mjs`
— do not hand-edit them. Regenerate after any change to `defs.ts`.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✓ | SHOW (default) |
| – | HIDE (meaningless in this mode) |

## Menus

| Menu | design | print | drawing | image | motion | logo | codegen | Notes |
|------|--------|-------|---------|-------|--------|------|---------|-------|
| File | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Never hide file operations |
| Edit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Never hide Undo/Redo/clipboard |
| Text | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | Codegen and Logo have no text editing |
| View | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | View/zoom/navigation universal |
| Object | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Object manip universal; items filtered individually |
| Arrange | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Align/order/nudge universal |
| Page | ✓ | ✓ | – | – | – | – | – | Multi-page only meaningful in design + print |
| Help | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Never hide Help |

## Items — File

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| new | New | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| newLogoProject | New Logo Project | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| logo | Logo (submenu) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| createLogoConcept | Create Logo Concept | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| duplicateLogoConcept | Duplicate Logo Concept | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| createLogoVariant | Create Logo Variant… | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| createMonochromeVariant | Create Monochrome Variant | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| createReversedVariant | Create Reversed Variant | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| open | Open\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| openRecent | Open Recent (submenu) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| reopenLast | Reopen Last File | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| import | Import\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| insertIcon | Insert Icon\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| createTableFromClipboard | Create Table From Clipboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tabClose | Close Document | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| closeWindow | Close Window | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| save | Save | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| saveAs | Save As\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| saveCopy | Save a Copy\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| exportSvg | Export SVG\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| export | Export\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| setFileThumbnail | Set File Thumbnail… | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| documentInfo | Document Info\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| archiveBackup | Backup Archive\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| archiveRestore | Restore Archive\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| downloadSnapshot | Download Snapshot\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| restoreFromSnapshot | Restore from Snapshot\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| settings | Settings\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| quitApp | Quit Varve | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Edit

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| undo | Undo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| redo | Redo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| cut | Cut | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| copy | Copy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| paste | Paste | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| duplicate | Duplicate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| repeatDuplicate | Repeat Duplicate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectAll | Select All | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectNone | Select None | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| invertSelection | Invert Selection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectParent | Select Parent | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectChildren | Select Children | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| delete | Delete | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| findReplace | Find & Replace\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectionHistoryBack | Selection History Back | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectionHistoryForward | Selection History Forward | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Text

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| linkTextFrames | Link Text Frames | ✓ | ✓ | – | – | – | – | – |
| unlinkTextFrames | Unlink Text Frames | ✓ | ✓ | – | – | – | – | – |
| textBold | Bold | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textItalic | Italic | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textUnderline | Underline | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textIncreaseSize | Increase Font Size | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textDecreaseSize | Decrease Font Size | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignLeft | Align Left | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignCenter | Align Center | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignRight | Align Right | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignJustify | Align Justify | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textToOutlines | Convert to Outlines | ✓ | ✓ | ✓ | – | – | – | – |

## Items — View

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| theme:light | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| theme:dark | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| theme:high-contrast | High Contrast | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| zoomReset | Zoom to 100% | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| zoomIn | Zoom In | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| zoomOut | Zoom Out | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| canvasModeFull | Full Color | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| canvasModeOutline | Outline | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| canvasModePreview | Preview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| inspectMode | Inspect Mode | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| present | Present\u2026 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| fitActivePage | Fit to Page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| fitSpread | Fit Spread | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| fitAllPages | Fit All Pages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| fitActiveFrame | Fit to Frame | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| resetViewRotation | Reset View Rotation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rotateViewCW | Rotate View Clockwise | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rotateViewCCW | Rotate View Counter-Clockwise | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rulerModeArtboard | Artboard Rulers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rulerModeGlobal | Global Rulers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleGrid | Show Grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| gridOverlayBaseline | Baseline Grid Overlay | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| gridOverlayIsometric | Isometric Grid Overlay | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleSnap | Snap | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleGuides | Guides | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| lockGuides | Lock Guides | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| clearGuides | Clear Guides | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleFacingPages | Facing Pages | – | ✓ | – | – | – | – | – |
| softProof | Soft Proof | – | ✓ | – | ✓ | – | – | – |
| toggleTimelinePanel | Timeline | ✓ | – | – | – | ✓ | – | – |
| toggleGraphEditor | Graph Editor | ✓ | – | – | – | ✓ | – | – |
| toggleStateMachinePanel | State Machine Panel | ✓ | – | – | – | ✓ | – | – |
| toggleLogoPanel | Logo Panel | – | – | – | – | – | ✓ | – |
| workspaceDesign | Workspace: Design | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspacePrint | Workspace: Print | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspaceDrawing | Workspace: Draw | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspaceImage | Workspace: Photo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspaceMotion | Workspace: Motion | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspaceLogo | Workspace: Logo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspaceCodegen | Workspace: Codegen | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| resetWorkspace | Reset Workspace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| logoPreview | Test Logo at Small Sizes | ✓ | ✓ | ✓ | – | – | ✓ | – |
| exportLogoPackage | Export Logo Package… | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleDistractionFree | Distraction-Free Mode | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleBeforeAfterCompare | Before/After Compare | ✓ | ✓ | ✓ | ✓ | – | – | – |
| colorBlindnessNone | No Color-Blindness Filter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| colorBlindnessProtanopia | Protanopia | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| colorBlindnessDeuteranopia | Deuteranopia | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| colorBlindnessTritanopia | Tritanopia | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| shortcutPalette | Command Palette | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| home | Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Object

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| group | Group Selection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ungroup | Ungroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| flipH | Flip Horizontal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| flipV | Flip Vertical | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| newAdjustmentLayer | New Adjustment Layer | ✓ | ✓ | – | ✓ | – | – | – |
| createClippingMask | Create Clipping Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| releaseClippingMask | Release Clipping Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| batchBgRemove | Batch Background Removal | ✓ | – | – | ✓ | – | – | – |
| imageTrace | Vectorize Image (Image Trace)… | ✓ | – | ✓ | ✓ | – | – | – |
| toolCrop | Crop Image | ✓ | ✓ | – | ✓ | – | – | – |
| extractPalette | Extract Palette | ✓ | – | ✓ | ✓ | – | – | – |
| addAlphaMask | Add Alpha Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| addClipMask | Add Clip Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| addLuminanceMask | Add Luminance Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| removeMask | Remove Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| toggleMask | Toggle Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| invertMask | Invert Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| flattenSelection | Flatten | ✓ | ✓ | ✓ | ✓ | – | – | – |
| rasterizeSelection | Rasterize | ✓ | ✓ | ✓ | ✓ | – | – | – |
| mergeSelected | Merge Selected | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| addClearSpaceGuides | Generate Clear-Space Guides… | ✓ | ✓ | ✓ | – | – | ✓ | – |
| booleanUnion | Union | ✓ | ✓ | ✓ | – | – | – | – |
| booleanSubtract | Subtract | ✓ | ✓ | ✓ | – | – | – | – |
| booleanIntersect | Intersect | ✓ | ✓ | ✓ | – | – | – | – |
| booleanExclude | Exclude Overlap | ✓ | ✓ | ✓ | – | – | – | – |
| path | Path (submenu) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| expandStroke | Expand Stroke to Outline | ✓ | ✓ | ✓ | – | – | ✓ | – |
| offsetPath | Offset Path… | ✓ | ✓ | ✓ | – | – | ✓ | – |
| roundCorners | Round Path Corners… | ✓ | ✓ | ✓ | – | – | ✓ | – |
| simplifyPath | Simplify Path… | ✓ | ✓ | ✓ | – | – | ✓ | – |
| mirrorDuplicateHorizontal | Mirror Duplicate — Horizontal | ✓ | ✓ | ✓ | – | – | ✓ | – |
| mirrorDuplicateVertical | Mirror Duplicate — Vertical | ✓ | ✓ | ✓ | – | – | ✓ | – |
| radialDuplicate | Radial Duplicate… | ✓ | ✓ | ✓ | – | – | ✓ | – |
| audit | Audit (submenu) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| auditSelection | Audit Selection | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| auditPage | Audit Page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| auditDocument | Audit Document | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| scanDebt | Scan for Debt | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| suggestNames | Suggest Names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| detectDuplicates | Detect Duplicates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Arrange

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| bringFront | Bring to Front | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bringForward | Bring Forward | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sendBackward | Send Backward | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sendBack | Send to Back | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| align | Align (submenu) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| alignLeft | Align Left | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| alignCenterH | Align Horizontal Centers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| alignRight | Align Right | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| alignTop | Align Top | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| alignCenterV | Align Vertical Centers | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| alignBottom | Align Bottom | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| distributeHorizontal | Distribute Horizontally | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| distributeVertical | Distribute Vertically | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tidySelected | Tidy Up | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| harmonizeSpacing | Harmonize Spacing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| nudgeLeft | Nudge Left | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| nudgeRight | Nudge Right | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| nudgeUp | Nudge Up | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| nudgeDown | Nudge Down | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Page

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| createMaster | Create Master Page | ✓ | ✓ | – | – | – | – | – |
| applyMaster | Apply Master Page (submenu) | ✓ | ✓ | – | – | – | – | – |
| detachMaster | Detach Master | ✓ | ✓ | – | – | – | – | – |

## Items — Help

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|--------|------|---------|
| openHelp | Contextual Help | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| openHelpCenter | Help Center | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| whatIsThis | What Is This | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| startTour | Start Tour | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| about | About Varve | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| installDesktopApp | Install Desktop App | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Edge Cases

- **"Show all menu items" preference** (default off): bypasses all workspace
  filtering, restoring the full menu tree. For power users who find workspace
  filtering disorienting.
- **Shortcut invocation for hidden items**: When a keyboard shortcut is
  pressed for a hidden item, the action runs normally (preferred). Hidden
  items keep their accelerator registration.
- **Command palette**: Shows all items regardless of workspace filter, with a
  workspace-mode tag appended (e.g. "Toggle Facing Pages [Print]").
- **Empty menus**: If workspace filtering empties a top-level menu entirely,
  that menu is removed from the menubar. The menubar reflows but uses
  `visibility: hidden` on removed entries briefly during transition to
  prevent jarring layout shifts.
- **Switching workspaces while a menu is open**: The open menu is closed
  immediately on workspace switch, preventing mutation under cursor.
