# Menu × Workspace Visibility Matrix

**Status:** Implemented — menu visibility per workspace is applied at runtime
via the `workspaces` filter on item definitions
(`packages/editor/src/menu/defs.ts`, applied by `renderer.ts`); this matrix
is the consolidated view. `workspaceLogo` (Ctrl+Shift+6) is included in the
Logo column; the seven workspace ids are design, print, drawing, image,
motion, logo, codegen.  
**Posture:** SHOW unless meaningless in that mode.

## Legend

| Symbol | Meaning |
|--------|---------|
| ✓ | SHOW (default) |
| – | HIDE (meaningless in this mode) |
| ~ | SHOW but DISABLED (context-dependent, e.g. no selection) |

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
|----|-------|--------|-------|---------|-------|------|---------|-------|
| new | New | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| open | Open | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| save | Save | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| saveAs | Save As | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| openRecent | Open Recent | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| reopenLast | Reopen Last | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| import | Import | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| exportSvg | Export SVG | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| export | Export | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| archiveBackup | Backup Archive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| archiveRestore | Restore Archive | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| downloadSnapshot | Download Snapshot | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| restoreFromSnapshot | Restore From Snapshot | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| present | Present | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| settings | Settings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Edit

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| undo | Undo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| redo | Redo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| cut | Cut | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| copy | Copy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| paste | Paste | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| duplicate | Duplicate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| repeatDuplicate | Repeat Duplicate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectAll | Select All | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| delete | Delete | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| findReplace | Find & Replace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectionHistoryBack | Selection History Back | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| selectionHistoryForward | Selection History Forward | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Text

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| textBold | Bold | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textItalic | Italic | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textUnderline | Underline | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textIncreaseSize | Increase Size | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textDecreaseSize | Decrease Size | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignLeft | Align Left | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignCenter | Align Center | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignRight | Align Right | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textAlignJustify | Justify | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| textToOutlines | Convert to Outlines | ✓ | ✓ | ✓ | – | – | – | – |

## Items — View

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| theme:light | Light Theme | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| theme:dark | Dark Theme | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| theme:high-contrast | High Contrast | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| zoomReset | Zoom Reset | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| zoomIn | Zoom In | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| zoomOut | Zoom Out | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| canvasModeFull | Full Canvas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| canvasModeOutline | Outline Canvas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| canvasModePreview | Preview Canvas | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| inspectMode | Inspect Mode | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| fitActivePage | Fit Page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| fitActiveFrame | Fit Frame | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| resetViewRotation | Reset Rotation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rotateViewCW | Rotate CW | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rotateViewCCW | Rotate CCW | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rulerModeArtboard | Rulers: Artboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| rulerModeGlobal | Rulers: Global | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| gridOverlayBaseline | Baseline Grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| gridOverlayIsometric | Isometric Grid | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleSnap | Toggle Snap | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleGuides | Toggle Guides | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| lockGuides | Lock Guides | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| clearGuides | Clear Guides | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleFacingPages | Facing Pages | – | ✓ | – | – | – | – | – |
| softProof | Soft Proof | – | ✓ | – | ✓ | – | – | – |
| toggleTimelinePanel | Timeline | ✓ | – | – | – | ✓ | – | – |
| toggleGraphEditor | Graph Editor | ✓ | – | – | – | ✓ | – | – |
| toggleStateMachinePanel | State Machine | ✓ | – | – | – | ✓ | – | – |
| workspaceDesign/Print/… | Workspace switcher | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| workspaceLogo | Workspace: Logo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| resetWorkspace | Reset Workspace | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleDistractionFree | Distraction-free | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| toggleBeforeAfterCompare | Before/After | ✓ | ✓ | ✓ | ✓ | – | – | – |
| colorBlindnessNone/… | Color Blindness | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| shortcutPalette | Shortcut Palette | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| home | Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Object

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| group | Group | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| ungroup | Ungroup | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| flipH | Flip H | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| flipV | Flip V | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| newAdjustmentLayer | Adjustment Layer | ✓ | ✓ | – | ✓ | – | – | – |
| createClippingMask | Clipping Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| releaseClippingMask | Release Clipping Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| batchBgRemove | Batch BG Remove | ✓ | – | – | ✓ | – | – | – |
| toolCrop | Crop Image | ✓ | ✓ | – | ✓ | – | – | – |
| extractPalette | Extract Palette | ✓ | – | ✓ | ✓ | – | – | – |
| addAlphaMask | Alpha Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| addClipMask | Clip Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| addLuminanceMask | Luminance Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| removeMask | Remove Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| toggleMask | Toggle Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| invertMask | Invert Mask | ✓ | ✓ | ✓ | ✓ | – | – | – |
| flattenSelection | Flatten | ✓ | ✓ | ✓ | ✓ | – | – | – |
| rasterizeSelection | Rasterize | ✓ | ✓ | ✓ | ✓ | – | – | – |
| mergeSelected | Merge Selected | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| booleanUnion | Boolean Union | ✓ | ✓ | ✓ | – | – | – | – |
| booleanSubtract | Boolean Subtract | ✓ | ✓ | ✓ | – | – | – | – |
| booleanIntersect | Boolean Intersect | ✓ | ✓ | ✓ | – | – | – | – |
| booleanExclude | Boolean Exclude | ✓ | ✓ | ✓ | – | – | – | – |
| audit | Audit (submenu) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| scanDebt | Scan for Debt | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| suggestNames | Suggest Names | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| detectDuplicates | Detect Duplicates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Arrange

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| bringFront | Bring to Front | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| bringForward | Bring Forward | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sendBackward | Send Backward | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| sendBack | Send to Back | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| align (submenu) | Align | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| harmonizeSpacing | Harmonize Spacing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| nudgeLeft/Right/Up/Down | Nudge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Items — Page

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| createMaster | Create Master | ✓ | ✓ | – | – | – | – | – |
| applyMaster | Apply Master | ✓ | ✓ | – | – | – | – | – |
| detachMaster | Detach Master | ✓ | ✓ | – | – | – | – | – |

## Items — Help

| ID | Label | design | print | drawing | image | motion | logo | codegen |
|----|-------|--------|-------|---------|-------|------|---------|-------|
| openHelp | Contextual Help | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| openHelpCenter | Help Center | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| whatIsThis | What's This? | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| startTour | Take a Tour | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| about | About Varve | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| installDesktopApp | Install Desktop App | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Edge Cases

- **"Show all menu items" preference** (default off): bypasses all workspace filtering, restoring the full menu tree. For power users who find workspace filtering disorienting.
- **Shortcut invocation for hidden items**: When a keyboard shortcut is pressed for a hidden item, the action runs normally (preferred). Hidden items keep their accelerator registration.
- **Command palette**: Shows all items regardless of workspace filter, with a workspace-mode tag appended (e.g. "Toggle Facing Pages [Print]").
- **Empty menus**: If workspace filtering empties a top-level menu entirely, that menu is removed from the menubar. The menubar reflows but uses `visibility: hidden` on removed entries briefly during transition to prevent jarring layout shifts.
- **Switching workspaces while a menu is open**: The open menu is closed immediately on workspace switch, preventing mutation under cursor.
