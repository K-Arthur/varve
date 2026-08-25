# Menu Item × Capability Visibility Matrix

Every item in the Varve menu system, its required capability (if any), and its
visibility in browser (`web`) vs Tauri desktop (`tauri`) vs memory/test (`mem`).

**Generated output.** The item tables are produced from
`packages/editor/src/menu/defs.ts` by `scripts/regenerate-menu-matrices.mjs`
— do not hand-edit them. Regenerate after any change to `defs.ts`.

## Legend

| Column | Meaning |
|--------|---------|
| Menu | Top-level menu (File, Edit, etc.) |
| Item | Action ID |
| Cap | Required capability — empty means always visible |
| Web | Visible in browser (`capabilities` has no `nativeMenu` / `archive` etc.) |
| Tauri | Visible in Tauri desktop |
| Mem | Visible in memory/test/SSR |
| Notes | Special conditions |

## Capability keys

| Key | Feature-detected? | Fallback |
|-----|-------------------|----------|
| `fs.read` | Always true | — |
| `fs.write` | Always true | — |
| `fs.watch` | `showOpenFilePicker` in window | `isTauri()` |
| `fs.recentPaths` | `showOpenFilePicker` in window | `isTauri()` |
| `archive` | Never in browser | `isTauri()` |
| `backup` | Always true | — |
| `nativeMenu` | Never in browser | `isTauri()` |
| `multiWindow` | Never in browser | `isTauri()` |
| `shell.open` | Always true | — |
| `fonts.local` | `queryLocalFonts` in window | false |
| `clipboard.image` | `navigator.clipboard.read` | false |
| `notifications` | `typeof Notification !== 'undefined'` | false |
| `autoUpdate` | Never in browser | `isTauri()` |

## File menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `new` | `—` | ✓ | ✓ | ✓ |  |
| `newLogoProject` | `—` | ✓ | ✓ | ✓ |  |
| `logo` | `—` | ✓ | ✓ | ✓ |  |
| `createLogoConcept` | `—` | ✓ | ✓ | ✓ |  |
| `duplicateLogoConcept` | `—` | ✓ | ✓ | ✓ |  |
| `createLogoVariant` | `—` | ✓ | ✓ | ✓ |  |
| `createMonochromeVariant` | `—` | ✓ | ✓ | ✓ |  |
| `createReversedVariant` | `—` | ✓ | ✓ | ✓ |  |
| `open` | `—` | ✓ | ✓ | ✓ |  |
| `openRecent` | `—` | ✓ | ✓ | ✓ |  |
| `reopenLast` | `—` | ✓ | ✓ | ✓ |  |
| `import` | `—` | ✓ | ✓ | ✓ |  |
| `insertIcon` | `—` | ✓ | ✓ | ✓ |  |
| `createTableFromClipboard` | `—` | ✓ | ✓ | ✓ |  |
| `tabClose` | `—` | ✓ | ✓ | ✓ |  |
| `closeWindow` | `—` | ✓ | ✓ | ✓ |  |
| `save` | `—` | ✓ | ✓ | ✓ |  |
| `saveAs` | `—` | ✓ | ✓ | ✓ |  |
| `saveCopy` | `—` | ✓ | ✓ | ✓ |  |
| `exportSvg` | `—` | ✓ | ✓ | ✓ |  |
| `export` | `—` | ✓ | ✓ | ✓ |  |
| `setFileThumbnail` | `—` | ✓ | ✓ | ✓ |  |
| `documentInfo` | `—` | ✓ | ✓ | ✓ |  |
| `archiveBackup` | `archive` | — | ✓ | — | Hidden in browser |
| `archiveRestore` | `archive` | — | ✓ | — | Hidden in browser |
| `downloadSnapshot` | `¬archive` | ✓ | — | ✓ | Visible when capability absent |
| `restoreFromSnapshot` | `¬archive` | ✓ | — | ✓ | Visible when capability absent |
| `settings` | `—` | ✓ | ✓ | ✓ |  |
| `quitApp` | `—` | ✓ | ✓ | ✓ | Hidden on macOS |

## Edit menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `undo` | `—` | ✓ | ✓ | ✓ |  |
| `redo` | `—` | ✓ | ✓ | ✓ |  |
| `cut` | `—` | ✓ | ✓ | ✓ |  |
| `copy` | `—` | ✓ | ✓ | ✓ |  |
| `paste` | `—` | ✓ | ✓ | ✓ |  |
| `duplicate` | `—` | ✓ | ✓ | ✓ |  |
| `repeatDuplicate` | `—` | ✓ | ✓ | ✓ |  |
| `selectAll` | `—` | ✓ | ✓ | ✓ |  |
| `selectNone` | `—` | ✓ | ✓ | ✓ |  |
| `invertSelection` | `—` | ✓ | ✓ | ✓ |  |
| `pixelSelection` | `—` | ✓ | ✓ | ✓ |  |
| `toolSelectionPaint` | `—` | ✓ | ✓ | ✓ |  |
| `saveAreaSelection` | `—` | ✓ | ✓ | ✓ |  |
| `restoreLastSavedAreaSelection` | `—` | ✓ | ✓ | ✓ |  |
| `deleteLastSavedAreaSelection` | `—` | ✓ | ✓ | ✓ |  |
| `pathToSelection` | `—` | ✓ | ✓ | ✓ |  |
| `selectionToPath` | `—` | ✓ | ✓ | ✓ |  |
| `selectFromImageAlpha` | `—` | ✓ | ✓ | ✓ |  |
| `selectFromImageLuminance` | `—` | ✓ | ✓ | ✓ |  |
| `selectFromImageColorRange` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionGrow` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionShrink` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionSmooth` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionThreshold` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionNudgeUp` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionNudgeDown` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionNudgeLeft` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionNudgeRight` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionScaleUp` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionScaleDown` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionRotateCW` | `—` | ✓ | ✓ | ✓ |  |
| `areaSelectionRotateCCW` | `—` | ✓ | ✓ | ✓ |  |
| `selectParent` | `—` | ✓ | ✓ | ✓ |  |
| `selectChildren` | `—` | ✓ | ✓ | ✓ |  |
| `delete` | `—` | ✓ | ✓ | ✓ |  |
| `findReplace` | `—` | ✓ | ✓ | ✓ |  |
| `selectionHistoryBack` | `—` | ✓ | ✓ | ✓ |  |
| `selectionHistoryForward` | `—` | ✓ | ✓ | ✓ |  |

## Text menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `linkTextFrames` | `—` | ✓ | ✓ | ✓ |  |
| `unlinkTextFrames` | `—` | ✓ | ✓ | ✓ |  |
| `textBold` | `—` | ✓ | ✓ | ✓ |  |
| `textItalic` | `—` | ✓ | ✓ | ✓ |  |
| `textUnderline` | `—` | ✓ | ✓ | ✓ |  |
| `textIncreaseSize` | `—` | ✓ | ✓ | ✓ |  |
| `textDecreaseSize` | `—` | ✓ | ✓ | ✓ |  |
| `textAlignLeft` | `—` | ✓ | ✓ | ✓ |  |
| `textAlignCenter` | `—` | ✓ | ✓ | ✓ |  |
| `textAlignRight` | `—` | ✓ | ✓ | ✓ |  |
| `textAlignJustify` | `—` | ✓ | ✓ | ✓ |  |
| `textToOutlines` | `—` | ✓ | ✓ | ✓ |  |

## View menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `theme:light` | `—` | ✓ | ✓ | ✓ |  |
| `theme:dark` | `—` | ✓ | ✓ | ✓ |  |
| `theme:high-contrast` | `—` | ✓ | ✓ | ✓ |  |
| `zoomReset` | `—` | ✓ | ✓ | ✓ |  |
| `zoomIn` | `—` | ✓ | ✓ | ✓ |  |
| `zoomOut` | `—` | ✓ | ✓ | ✓ |  |
| `canvasModeFull` | `—` | ✓ | ✓ | ✓ |  |
| `canvasModeOutline` | `—` | ✓ | ✓ | ✓ |  |
| `canvasModePreview` | `—` | ✓ | ✓ | ✓ |  |
| `inspectMode` | `—` | ✓ | ✓ | ✓ |  |
| `present` | `—` | ✓ | ✓ | ✓ |  |
| `fitActivePage` | `—` | ✓ | ✓ | ✓ |  |
| `fitSpread` | `—` | ✓ | ✓ | ✓ |  |
| `fitAllPages` | `—` | ✓ | ✓ | ✓ |  |
| `fitActiveFrame` | `—` | ✓ | ✓ | ✓ |  |
| `resetViewRotation` | `—` | ✓ | ✓ | ✓ |  |
| `rotateViewCW` | `—` | ✓ | ✓ | ✓ |  |
| `rotateViewCCW` | `—` | ✓ | ✓ | ✓ |  |
| `rulerModeArtboard` | `—` | ✓ | ✓ | ✓ |  |
| `rulerModeGlobal` | `—` | ✓ | ✓ | ✓ |  |
| `toggleGrid` | `—` | ✓ | ✓ | ✓ |  |
| `gridOverlayBaseline` | `—` | ✓ | ✓ | ✓ |  |
| `gridOverlayIsometric` | `—` | ✓ | ✓ | ✓ |  |
| `toggleSnap` | `—` | ✓ | ✓ | ✓ |  |
| `toggleGuides` | `—` | ✓ | ✓ | ✓ |  |
| `lockGuides` | `—` | ✓ | ✓ | ✓ |  |
| `clearGuides` | `—` | ✓ | ✓ | ✓ |  |
| `toggleFacingPages` | `—` | ✓ | ✓ | ✓ |  |
| `toggleBleedGuides` | `—` | ✓ | ✓ | ✓ |  |
| `softProof` | `—` | ✓ | ✓ | ✓ |  |
| `toggleTimelinePanel` | `—` | ✓ | ✓ | ✓ |  |
| `toggleGraphEditor` | `—` | ✓ | ✓ | ✓ |  |
| `toggleStateMachinePanel` | `—` | ✓ | ✓ | ✓ |  |
| `toggleLogoPanel` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceDesign` | `—` | ✓ | ✓ | ✓ |  |
| `workspacePrint` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceDrawing` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceImage` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceMotion` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceLogo` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceEmail` | `—` | ✓ | ✓ | ✓ |  |
| `workspaceCodegen` | `—` | ✓ | ✓ | ✓ |  |
| `resetWorkspace` | `—` | ✓ | ✓ | ✓ |  |
| `logoPreview` | `—` | ✓ | ✓ | ✓ |  |
| `exportLogoPackage` | `—` | ✓ | ✓ | ✓ |  |
| `toggleDistractionFree` | `—` | ✓ | ✓ | ✓ |  |
| `toggleBeforeAfterCompare` | `—` | ✓ | ✓ | ✓ |  |
| `colorBlindnessNone` | `—` | ✓ | ✓ | ✓ |  |
| `colorBlindnessProtanopia` | `—` | ✓ | ✓ | ✓ |  |
| `colorBlindnessDeuteranopia` | `—` | ✓ | ✓ | ✓ |  |
| `colorBlindnessTritanopia` | `—` | ✓ | ✓ | ✓ |  |
| `shortcutPalette` | `—` | ✓ | ✓ | ✓ |  |
| `home` | `—` | ✓ | ✓ | ✓ |  |

## Object menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `group` | `—` | ✓ | ✓ | ✓ |  |
| `ungroup` | `—` | ✓ | ✓ | ✓ |  |
| `flipH` | `—` | ✓ | ✓ | ✓ |  |
| `flipV` | `—` | ✓ | ✓ | ✓ |  |
| `repeatTransform` | `—` | ✓ | ✓ | ✓ |  |
| `resizeImage` | `—` | ✓ | ✓ | ✓ |  |
| `bakeWarp` | `—` | ✓ | ✓ | ✓ |  |
| `newAdjustmentLayer` | `—` | ✓ | ✓ | ✓ |  |
| `createClippingMask` | `—` | ✓ | ✓ | ✓ |  |
| `releaseClippingMask` | `—` | ✓ | ✓ | ✓ |  |
| `batchBgRemove` | `—` | ✓ | ✓ | ✓ |  |
| `imageTrace` | `—` | ✓ | ✓ | ✓ |  |
| `attachTextToPath` | `—` | ✓ | ✓ | ✓ |  |
| `detachTextFromPath` | `—` | ✓ | ✓ | ✓ |  |
| `toolCrop` | `—` | ✓ | ✓ | ✓ |  |
| `toolPerspective` | `—` | ✓ | ✓ | ✓ |  |
| `extractPalette` | `—` | ✓ | ✓ | ✓ |  |
| `addAlphaMask` | `—` | ✓ | ✓ | ✓ |  |
| `createMaskFromSelection` | `—` | ✓ | ✓ | ✓ |  |
| `loadMaskAsSelection` | `—` | ✓ | ✓ | ✓ |  |
| `addClipMask` | `—` | ✓ | ✓ | ✓ |  |
| `addLuminanceMask` | `—` | ✓ | ✓ | ✓ |  |
| `removeMask` | `—` | ✓ | ✓ | ✓ |  |
| `toggleMask` | `—` | ✓ | ✓ | ✓ |  |
| `invertMask` | `—` | ✓ | ✓ | ✓ |  |
| `flattenSelection` | `—` | ✓ | ✓ | ✓ |  |
| `rasterizeSelection` | `—` | ✓ | ✓ | ✓ |  |
| `mergeSelected` | `—` | ✓ | ✓ | ✓ |  |
| `addClearSpaceGuides` | `—` | ✓ | ✓ | ✓ |  |
| `booleanUnion` | `—` | ✓ | ✓ | ✓ |  |
| `booleanSubtract` | `—` | ✓ | ✓ | ✓ |  |
| `booleanIntersect` | `—` | ✓ | ✓ | ✓ |  |
| `booleanExclude` | `—` | ✓ | ✓ | ✓ |  |
| `path` | `—` | ✓ | ✓ | ✓ |  |
| `expandStroke` | `—` | ✓ | ✓ | ✓ |  |
| `offsetPath` | `—` | ✓ | ✓ | ✓ |  |
| `roundCorners` | `—` | ✓ | ✓ | ✓ |  |
| `simplifyPath` | `—` | ✓ | ✓ | ✓ |  |
| `mirrorDuplicateHorizontal` | `—` | ✓ | ✓ | ✓ |  |
| `mirrorDuplicateVertical` | `—` | ✓ | ✓ | ✓ |  |
| `radialDuplicate` | `—` | ✓ | ✓ | ✓ |  |
| `audit` | `—` | ✓ | ✓ | ✓ |  |
| `auditSelection` | `—` | ✓ | ✓ | ✓ |  |
| `auditPage` | `—` | ✓ | ✓ | ✓ |  |
| `auditDocument` | `—` | ✓ | ✓ | ✓ |  |
| `scanDebt` | `—` | ✓ | ✓ | ✓ |  |
| `suggestNames` | `—` | ✓ | ✓ | ✓ |  |
| `detectDuplicates` | `—` | ✓ | ✓ | ✓ |  |

## Arrange menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `bringFront` | `—` | ✓ | ✓ | ✓ |  |
| `bringForward` | `—` | ✓ | ✓ | ✓ |  |
| `sendBackward` | `—` | ✓ | ✓ | ✓ |  |
| `sendBack` | `—` | ✓ | ✓ | ✓ |  |
| `align` | `—` | ✓ | ✓ | ✓ |  |
| `alignLeft` | `—` | ✓ | ✓ | ✓ |  |
| `alignCenterH` | `—` | ✓ | ✓ | ✓ |  |
| `alignRight` | `—` | ✓ | ✓ | ✓ |  |
| `alignTop` | `—` | ✓ | ✓ | ✓ |  |
| `alignCenterV` | `—` | ✓ | ✓ | ✓ |  |
| `alignBottom` | `—` | ✓ | ✓ | ✓ |  |
| `distributeHorizontal` | `—` | ✓ | ✓ | ✓ |  |
| `distributeVertical` | `—` | ✓ | ✓ | ✓ |  |
| `tidySelected` | `—` | ✓ | ✓ | ✓ |  |
| `harmonizeSpacing` | `—` | ✓ | ✓ | ✓ |  |
| `nudgeLeft` | `—` | ✓ | ✓ | ✓ |  |
| `nudgeRight` | `—` | ✓ | ✓ | ✓ |  |
| `nudgeUp` | `—` | ✓ | ✓ | ✓ |  |
| `nudgeDown` | `—` | ✓ | ✓ | ✓ |  |

## Page menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `createMaster` | `—` | ✓ | ✓ | ✓ |  |
| `applyMaster` | `—` | ✓ | ✓ | ✓ |  |
| `detachMaster` | `—` | ✓ | ✓ | ✓ |  |

## Help menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `openHelp` | `—` | ✓ | ✓ | ✓ |  |
| `openHelpCenter` | `—` | ✓ | ✓ | ✓ |  |
| `contactSupport` | `—` | ✓ | ✓ | ✓ |  |
| `sendFeedback` | `—` | ✓ | ✓ | ✓ |  |
| `reportSecurity` | `—` | ✓ | ✓ | ✓ |  |
| `openPrivacy` | `—` | ✓ | ✓ | ✓ |  |
| `whatIsThis` | `—` | ✓ | ✓ | ✓ |  |
| `startTour` | `—` | ✓ | ✓ | ✓ |  |
| `about` | `—` | ✓ | ✓ | ✓ |  |
| `installDesktopApp` | `¬nativeMenu` | ✓ | — | ✓ | Visible when capability absent |
