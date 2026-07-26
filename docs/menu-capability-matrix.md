# Menu Item × Capability Visibility Matrix

Every item in the Strata menu system, its required capability (if any), and its
visibility in browser (`web`) vs Tauri desktop (`tauri`) vs memory/test (`mem`).

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
| `new` | — | ✓ | ✓ | ✓ | |
| `open` | — | ✓ | ✓ | ✓ | |
| `save` | — | ✓ | ✓ | ✓ | |
| `saveAs` | — | ✓ | ✓ | ✓ | |
| `import` | — | ✓ | ✓ | ✓ | |
| `exportSvg` | — | ✓ | ✓ | ✓ | |
| `export` | — | ✓ | ✓ | ✓ | |
| `archiveBackup` | `archive` | — | ✓ | — | Hidden in browser |
| `archiveRestore` | `archive` | — | ✓ | — | Hidden in browser |
| `downloadSnapshot` | ¬`archive` | ✓ | — | ✓ | Browser equivalent of archive |
| `restoreFromSnapshot` | ¬`archive` | ✓ | — | ✓ | Browser equivalent of restore |
| `present` | — | ✓ | ✓ | ✓ | |
| `settings` | — | ✓ | ✓ | ✓ | |

## Edit menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `undo` | — | ✓ | ✓ | ✓ | |
| `redo` | — | ✓ | ✓ | ✓ | |
| `cut` | — | ✓ | ✓ | ✓ | |
| `copy` | — | ✓ | ✓ | ✓ | |
| `paste` | — | ✓ | ✓ | ✓ | |
| `duplicate` | — | ✓ | ✓ | ✓ | |
| `repeatDuplicate` | — | ✓ | ✓ | ✓ | |
| `selectAll` | — | ✓ | ✓ | ✓ | |
| `delete` | — | ✓ | ✓ | ✓ | |
| `findReplace` | — | ✓ | ✓ | ✓ | |
| `selectionHistoryBack` | — | ✓ | ✓ | ✓ | |
| `selectionHistoryForward` | — | ✓ | ✓ | ✓ | |

## Text menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `textBold` | — | ✓ | ✓ | ✓ | |
| `textItalic` | — | ✓ | ✓ | ✓ | |
| `textUnderline` | — | ✓ | ✓ | ✓ | |
| `textIncreaseSize` | — | ✓ | ✓ | ✓ | |
| `textDecreaseSize` | — | ✓ | ✓ | ✓ | |
| `textAlignLeft` | — | ✓ | ✓ | ✓ | |
| `textAlignCenter` | — | ✓ | ✓ | ✓ | |
| `textAlignRight` | — | ✓ | ✓ | ✓ | |
| `textAlignJustify` | — | ✓ | ✓ | ✓ | |
| `textToOutlines` | — | ✓ | ✓ | ✓ | |

## View menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `theme:*` | — | ✓ | ✓ | ✓ | |
| `zoomReset` | — | ✓ | ✓ | ✓ | |
| `zoomIn` | — | ✓ | ✓ | ✓ | |
| `zoomOut` | — | ✓ | ✓ | ✓ | |
| `canvasModeFull` | — | ✓ | ✓ | ✓ | |
| `canvasModeOutline` | — | ✓ | ✓ | ✓ | |
| `canvasModePreview` | — | ✓ | ✓ | ✓ | |
| `inspectMode` | — | ✓ | ✓ | ✓ | |
| `fitActivePage` | — | ✓ | ✓ | ✓ | |
| `fitActiveFrame` | — | ✓ | ✓ | ✓ | |
| `resetViewRotation` | — | ✓ | ✓ | ✓ | |
| `rotateViewCW` | — | ✓ | ✓ | ✓ | |
| `rotateViewCCW` | — | ✓ | ✓ | ✓ | |
| `rulerModeArtboard` | — | ✓ | ✓ | ✓ | |
| `rulerModeGlobal` | — | ✓ | ✓ | ✓ | |
| `gridOverlayBaseline` | — | ✓ | ✓ | ✓ | |
| `gridOverlayIsometric` | — | ✓ | ✓ | ✓ | |
| `toggleSnap` | — | ✓ | ✓ | ✓ | |
| `toggleGuides` | — | ✓ | ✓ | ✓ | |
| `lockGuides` | — | ✓ | ✓ | ✓ | |
| `clearGuides` | — | ✓ | ✓ | ✓ | |
| `toggleFacingPages` | — | ✓ | ✓ | ✓ | |
| `softProof` | — | ✓ | ✓ | ✓ | |
| `toggleTimelinePanel` | — | ✓ | ✓ | ✓ | |
| `toggleGraphEditor` | — | ✓ | ✓ | ✓ | |
| `toggleStateMachinePanel` | — | ✓ | ✓ | ✓ | |
| `workspaceDesign` | — | ✓ | ✓ | ✓ | |
| `workspacePrint` | — | ✓ | ✓ | ✓ | |
| `workspaceDrawing` | — | ✓ | ✓ | ✓ | |
| `workspaceImage` | — | ✓ | ✓ | ✓ | |
| `workspaceMotion` | — | ✓ | ✓ | ✓ | |
| `resetWorkspace` | — | ✓ | ✓ | ✓ | |
| `toggleDistractionFree` | — | ✓ | ✓ | ✓ | |
| `toggleBeforeAfterCompare` | — | ✓ | ✓ | ✓ | |
| `colorBlindnessNone` | — | ✓ | ✓ | ✓ | |
| `colorBlindnessProtanopia` | — | ✓ | ✓ | ✓ | |
| `colorBlindnessDeuteranopia` | — | ✓ | ✓ | ✓ | |
| `colorBlindnessTritanopia` | — | ✓ | ✓ | ✓ | |
| `shortcutPalette` | — | ✓ | ✓ | ✓ | |
| `home` | — | ✓ | ✓ | ✓ | |

## Object menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `group` | — | ✓ | ✓ | ✓ | |
| `ungroup` | — | ✓ | ✓ | ✓ | |
| `flipH` | — | ✓ | ✓ | ✓ | |
| `flipV` | — | ✓ | ✓ | ✓ | |
| `newAdjustmentLayer` | — | ✓ | ✓ | ✓ | |
| `createClippingMask` | — | ✓ | ✓ | ✓ | |
| `releaseClippingMask` | — | ✓ | ✓ | ✓ | |
| `batchBgRemove` | — | ✓ | ✓ | ✓ | |
| `toolCrop` | — | ✓ | ✓ | ✓ | |
| `extractPalette` | — | ✓ | ✓ | ✓ | |
| `addAlphaMask` | — | ✓ | ✓ | ✓ | |
| `addClipMask` | — | ✓ | ✓ | ✓ | |
| `addLuminanceMask` | — | ✓ | ✓ | ✓ | |
| `removeMask` | — | ✓ | ✓ | ✓ | |
| `toggleMask` | — | ✓ | ✓ | ✓ | |
| `invertMask` | — | ✓ | ✓ | ✓ | |
| `flattenSelection` | — | ✓ | ✓ | ✓ | |
| `rasterizeSelection` | — | ✓ | ✓ | ✓ | |
| `mergeSelected` | — | ✓ | ✓ | ✓ | |
| `booleanUnion` | — | ✓ | ✓ | ✓ | |
| `booleanSubtract` | — | ✓ | ✓ | ✓ | |
| `booleanIntersect` | — | ✓ | ✓ | ✓ | |
| `booleanExclude` | — | ✓ | ✓ | ✓ | |
| `runAudit` | — | ✓ | ✓ | ✓ | |
| `scanDebt` | — | ✓ | ✓ | ✓ | |
| `suggestNames` | — | ✓ | ✓ | ✓ | |
| `detectDuplicates` | — | ✓ | ✓ | ✓ | |

## Arrange menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `bringFront` | — | ✓ | ✓ | ✓ | |
| `bringForward` | — | ✓ | ✓ | ✓ | |
| `sendBackward` | — | ✓ | ✓ | ✓ | |
| `sendBack` | — | ✓ | ✓ | ✓ | |
| `alignLeft` | — | ✓ | ✓ | ✓ | |
| `alignCenterH` | — | ✓ | ✓ | ✓ | |
| `alignRight` | — | ✓ | ✓ | ✓ | |
| `alignTop` | — | ✓ | ✓ | ✓ | |
| `alignCenterV` | — | ✓ | ✓ | ✓ | |
| `alignBottom` | — | ✓ | ✓ | ✓ | |
| `distributeHorizontal` | — | ✓ | ✓ | ✓ | |
| `distributeVertical` | — | ✓ | ✓ | ✓ | |
| `harmonizeSpacing` | — | ✓ | ✓ | ✓ | |
| `nudgeLeft` | — | ✓ | ✓ | ✓ | |
| `nudgeRight` | — | ✓ | ✓ | ✓ | |
| `nudgeUp` | — | ✓ | ✓ | ✓ | |
| `nudgeDown` | — | ✓ | ✓ | ✓ | |

## Page menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `createMaster` | — | ✓ | ✓ | ✓ | |
| `applyMaster` | — | ✓ | ✓ | ✓ | |
| `detachMaster` | — | ✓ | ✓ | ✓ | |

## Help menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `openHelp` | — | ✓ | ✓ | ✓ | |
| `openHelpCenter` | — | ✓ | ✓ | ✓ | |
| `whatIsThis` | — | ✓ | ✓ | ✓ | |
| `startTour` | — | ✓ | ✓ | ✓ | |
| `about` | — | ✓ | ✓ | ✓ | |
| `installDesktopApp` | ¬`nativeMenu` | ✓ | — | ✓ | Also hidden if dismissed (localStorage) or in iframe |

## Canvas context menu

| Item | Cap | Web | Tauri | Mem | Notes |
|------|-----|-----|-------|-----|-------|
| `ctx-cut` | — | ✓ | ✓ | ✓ | |
| `ctx-copy` | — | ✓ | ✓ | ✓ | |
| `ctx-paste` | — | ✓ | ✓ | ✓ | |
| `ctx-duplicate` | — | ✓ | ✓ | ✓ | |
| `ctx-delete` | — | ✓ | ✓ | ✓ | |
| `ctx-group` | — | ✓ | ✓ | ✓ | |
| `ctx-ungroup` | — | ✓ | ✓ | ✓ | |
| `ctx-selectAll` | — | ✓ | ✓ | ✓ | |

## Summary

| Status | Count |
|--------|-------|
| Always visible | 94 items |
| Tauri-only (`archive`) | 2 items |
| Browser-only (¬`archive`) | 2 items |
| Browser-only (¬`nativeMenu`) | 1 item (installDesktopApp) |
| **Total** | **99 items** |

No menu item currently requires `fs.watch`, `fs.recentPaths`, `multiWindow`,
`fonts.local`, `clipboard.image`, `notifications`, or `autoUpdate` — these
capabilities are reserved for future use.
