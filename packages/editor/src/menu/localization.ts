/**
 * Localization adapter boundary for menu labels.
 *
 * The menu model uses `labelKey` values like 'menu.file.new' that need to be
 * resolved to display strings. This module is the single resolution boundary
 * shared by the custom menubar renderer, the canvas context menu, and the
 * native-menu adapter:
 *
 * - `formatLabel(key)` — resolves a label key to a display string
 * - `formatLabelWithValues(key, values)` — resolves with interpolation
 * - `reportMissingKey(key)` — development diagnostics for missing keys
 *
 * Guarantees:
 *  - A key prefixed with `menu.` NEVER renders as the raw dotted key in
 *    production. Unknown menu keys fall back to a humanized label derived
 *    from the final path segment (e.g. `menu.view.toggleSnap` -> "Toggle
 *    Snap") and are reported in development.
 *  - Dynamic labels that are not menu keys (file names, generated labels)
 *    pass through unchanged.
 *
 * Future: swap the dictionary lookup for a real i18n framework (e.g.
 * i18next.t(key)) without touching the menu model.
 */

/** English label dictionary. Keys mirror `labelKey` values in `defs.ts`. */
export const MENU_LABELS: Readonly<Record<string, string>> = {
  // ── Top-level menus ────────────────────────────────────────────────────────
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.text': 'Text',
  'menu.view': 'View',
  'menu.object': 'Object',
  'menu.arrange': 'Arrange',
  'menu.page': 'Page',
  'menu.help': 'Help',

  // ── File ───────────────────────────────────────────────────────────────────
  'menu.file.new': 'New',
  'menu.file.newLogoProject': 'New Logo Project',
  'menu.file.createLogoConcept': 'Create Logo Concept',
  'menu.file.duplicateLogoConcept': 'Duplicate Logo Concept',
  'menu.file.createLogoVariant': 'Create Logo Variant…',
  'menu.file.createMonochromeVariant': 'Create Monochrome Variant',
  'menu.file.createReversedVariant': 'Create Reversed Variant',
  'menu.file.exportLogoPackage': 'Export Logo Package…',
  'menu.file.open': 'Open\u2026',
  'menu.file.save': 'Save',
  'menu.file.saveAs': 'Save As\u2026',
  'menu.file.closeDocument': 'Close Document',
  'menu.file.closeWindow': 'Close Window',
  'menu.file.quit': 'Quit Varve',
  'menu.file.import': 'Import\u2026',
  'menu.file.insertIcon': 'Insert Icon\u2026',
  'menu.file.exportSvg': 'Export SVG\u2026',
  'menu.file.export': 'Export\u2026',
  'menu.file.archiveBackup': 'Backup Archive\u2026',
  'menu.file.archiveRestore': 'Restore Archive\u2026',
  'menu.file.downloadSnapshot': 'Download Snapshot\u2026',
  'menu.file.restoreFromSnapshot': 'Restore from Snapshot\u2026',
  'menu.file.present': 'Present\u2026',
  'menu.file.settings': 'Settings\u2026',

  // ── Edit ───────────────────────────────────────────────────────────────────
  'menu.edit.undo': 'Undo',
  'menu.edit.redo': 'Redo',
  'menu.edit.cut': 'Cut',
  'menu.edit.copy': 'Copy',
  'menu.edit.paste': 'Paste',
  'menu.edit.duplicate': 'Duplicate',
  'menu.edit.repeatDuplicate': 'Repeat Duplicate',
  'menu.edit.selectAll': 'Select All',
  'menu.edit.selectNone': 'Select None',
  'menu.edit.invertSelection': 'Invert Selection',
  'menu.edit.selectParent': 'Select Parent',
  'menu.edit.selectChildren': 'Select Children',
  'menu.edit.delete': 'Delete',
  'menu.edit.findReplace': 'Find & Replace\u2026',
  'menu.edit.selectionHistoryBack': 'Selection History Back',
  'menu.edit.selectionHistoryForward': 'Selection History Forward',

  // ── Text ───────────────────────────────────────────────────────────────────
  'menu.text.bold': 'Bold',
  'menu.text.linkTextFrames': 'Link Text Frames',
  'menu.text.unlinkTextFrames': 'Unlink Text Frames',
  'menu.text.italic': 'Italic',
  'menu.text.underline': 'Underline',
  'menu.text.increaseSize': 'Increase Font Size',
  'menu.text.decreaseSize': 'Decrease Font Size',
  'menu.text.alignLeft': 'Align Left',
  'menu.text.alignCenter': 'Align Center',
  'menu.text.alignRight': 'Align Right',
  'menu.text.alignJustify': 'Align Justify',
  'menu.text.toOutlines': 'Convert to Outlines',

  // ── View ───────────────────────────────────────────────────────────────────
  'menu.view.zoomIn': 'Zoom In',
  'menu.view.zoomOut': 'Zoom Out',
  'menu.view.zoomReset': 'Zoom to 100%',
  'menu.view.fitActiveFrame': 'Fit to Frame',
  'menu.view.fitActivePage': 'Fit to Page',
  'menu.view.fitSpread': 'Fit Spread',
  'menu.view.fitAllPages': 'Fit All Pages',
  'menu.view.rotateViewCW': 'Rotate View Clockwise',
  'menu.view.rotateViewCCW': 'Rotate View Counter-Clockwise',
  'menu.view.resetViewRotation': 'Reset View Rotation',
  'menu.view.inspectMode': 'Inspect Mode',
  'menu.view.toggleGrid': 'Show Grid',
  'menu.view.toggleSnap': 'Snap',
  'menu.view.toggleGuides': 'Guides',
  'menu.view.lockGuides': 'Lock Guides',
  'menu.view.clearGuides': 'Clear Guides',
  'menu.view.gridOverlayBaseline': 'Baseline Grid Overlay',
  'menu.view.gridOverlayIsometric': 'Isometric Grid Overlay',
  'menu.view.rulerModeGlobal': 'Global Rulers',
  'menu.view.rulerModeArtboard': 'Artboard Rulers',
  'menu.view.toggleFacingPages': 'Facing Pages',
  'menu.view.toggleTimelinePanel': 'Timeline',
  'menu.view.toggleGraphEditor': 'Graph Editor',
  'menu.view.toggleStateMachinePanel': 'State Machine Panel',
  'menu.view.toggleLogoPanel': 'Logo Panel',
  'menu.view.distractionFree': 'Distraction-Free Mode',
  'menu.view.softProof': 'Soft Proof',
  'menu.view.beforeAfterCompare': 'Before/After Compare',
  'menu.view.colorBlindnessNone': 'No Color-Blindness Filter',
  'menu.view.colorBlindnessProtanopia': 'Protanopia',
  'menu.view.colorBlindnessDeuteranopia': 'Deuteranopia',
  'menu.view.colorBlindnessTritanopia': 'Tritanopia',
  'menu.view.canvasModeFull': 'Full Color',
  'menu.view.canvasModePreview': 'Preview',
  'menu.view.canvasModeOutline': 'Outline',
  'menu.view.themeLight': 'Light',
  'menu.view.themeDark': 'Dark',
  'menu.view.themeHighContrast': 'High Contrast',
  'menu.view.resetWorkspace': 'Reset Workspace',
  'menu.view.home': 'Home',
  'menu.view.shortcutPalette': 'Command Palette',
  'menu.view.workspaceDesign': 'Workspace: Design',
  'menu.view.workspacePrint': 'Workspace: Print',
  'menu.view.workspaceDrawing': 'Workspace: Draw',
  'menu.view.workspaceImage': 'Workspace: Photo',
  'menu.view.workspaceMotion': 'Workspace: Motion',
  'menu.view.workspaceLogo': 'Workspace: Logo',
  'menu.view.logoPreview': 'Test Logo at Small Sizes',
  'menu.object.addClearSpaceGuides': 'Generate Clear-Space Guides…',
  'menu.object.imageTrace': 'Vectorize Image (Image Trace)…',

  // ── Object ─────────────────────────────────────────────────────────────────
  'menu.object.path': 'Path',
  'menu.object.group': 'Group Selection',
  'menu.object.ungroup': 'Ungroup',
  'menu.object.warpEnvelope': 'Warp: Envelope',
  'menu.object.warpPerspective': 'Warp: Perspective',
  'menu.object.warpMesh': 'Warp: Mesh',
  'menu.object.warpBend': 'Warp: Bend',
  'menu.object.expandAppearance': 'Expand Appearance',
  'menu.object.flattenSelection': 'Flatten',
  'menu.object.mergeSelected': 'Merge Selected',
  'menu.object.rasterize': 'Rasterize',
  'menu.object.booleanUnion': 'Union',
  'menu.object.booleanSubtract': 'Subtract',
  'menu.object.booleanIntersect': 'Intersect',
  'menu.object.booleanExclude': 'Exclude Overlap',
  'menu.object.expandStroke': 'Expand Stroke to Outline',
  'menu.object.offsetPath': 'Offset Path…',
  'menu.object.roundCorners': 'Round Path Corners…',
  'menu.object.simplifyPath': 'Simplify Path…',
  'menu.object.mirrorDuplicateHorizontal': 'Mirror Duplicate — Horizontal',
  'menu.object.mirrorDuplicateVertical': 'Mirror Duplicate — Vertical',
  'menu.object.radialDuplicate': 'Radial Duplicate…',
  'menu.object.createClippingMask': 'Create Clipping Mask',
  'menu.object.releaseClippingMask': 'Release Clipping Mask',
  'menu.object.addAlphaMask': 'Add Alpha Mask',
  'menu.object.addLuminanceMask': 'Add Luminance Mask',
  'menu.object.addClipMask': 'Add Clip Mask',
  'menu.object.removeMask': 'Remove Mask',
  'menu.object.toggleMask': 'Toggle Mask',
  'menu.object.invertMask': 'Invert Mask',
  'menu.object.newAdjustmentLayer': 'New Adjustment Layer',
  'menu.object.cropImage': 'Crop Image',
  'menu.object.extractPalette': 'Extract Palette',
  'menu.object.batchBgRemove': 'Batch Background Removal',
  'menu.object.flipH': 'Flip Horizontal',
  'menu.object.flipV': 'Flip Vertical',
  'menu.object.audit': 'Audit',
  'menu.object.scanDebt': 'Scan for Debt',
  'menu.object.suggestNames': 'Suggest Names',
  'menu.object.detectDuplicates': 'Detect Duplicates',

  // ── Arrange ────────────────────────────────────────────────────────────────
  'menu.arrange.bringFront': 'Bring to Front',
  'menu.arrange.bringForward': 'Bring Forward',
  'menu.arrange.sendBackward': 'Send Backward',
  'menu.arrange.sendBack': 'Send to Back',
  'menu.arrange.align': 'Align',
  'menu.arrange.alignLeft': 'Align Left',
  'menu.arrange.alignCenterH': 'Align Horizontal Centers',
  'menu.arrange.alignRight': 'Align Right',
  'menu.arrange.alignTop': 'Align Top',
  'menu.arrange.alignCenterV': 'Align Vertical Centers',
  'menu.arrange.alignBottom': 'Align Bottom',
  'menu.arrange.distributeH': 'Distribute Horizontally',
  'menu.arrange.distributeV': 'Distribute Vertically',
  'menu.arrange.nudgeUp': 'Nudge Up',
  'menu.arrange.nudgeDown': 'Nudge Down',
  'menu.arrange.nudgeLeft': 'Nudge Left',
  'menu.arrange.nudgeRight': 'Nudge Right',
  'menu.arrange.harmonizeSpacing': 'Harmonize Spacing',
  'menu.arrange.tidyUp': 'Tidy Up',

  // ── Page ───────────────────────────────────────────────────────────────────
  'menu.page.createMaster': 'Create Master Page',
  'menu.page.applyMaster': 'Apply Master Page',
  'menu.page.applyMasterNone': 'Apply No Master',
  'menu.page.detachMaster': 'Detach Master',

  // ── Help ───────────────────────────────────────────────────────────────────
  'menu.help.contextualHelp': 'Contextual Help',
  'menu.help.helpCenter': 'Help Center',
  'menu.help.whatIsThis': "What's This?",
  'menu.help.startTour': 'Start Tour',
  'menu.help.installDesktopApp': 'Install Desktop App',
  'menu.help.about': 'About Varve',
};

const MENU_KEY_PREFIX = 'menu.';

/** Humanize a dotted key's final segment: 'toggleSnap' -> 'Toggle Snap'. */
function humanizeKeyPart(part: string): string {
  const withSpaces = part.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

const MISSING_KEYS = new Set<string>();

/** Whether a key is a namespaced menu key (not a dynamic display label). */
export function isMenuLabelKey(key: string): boolean {
  return key.startsWith(MENU_KEY_PREFIX);
}

/**
 * Resolve a label key to a display string.
 *
 * Resolution order:
 *  1. Dictionary lookup.
 *  2. Humanized fallback for unknown `menu.*` keys (never leaks the raw key).
 *  3. Pass-through for dynamic labels that are not menu keys.
 */
export function formatLabel(key: string): string {
  const resolved = MENU_LABELS[key as keyof typeof MENU_LABELS];
  if (resolved !== undefined) return resolved;
  if (isMenuLabelKey(key)) {
    reportMissingKey(key);
    const segments = key.split('.');
    const last = segments[segments.length - 1] ?? key;
    return humanizeKeyPart(last);
  }
  return key;
}

/**
 * Resolve a label key with interpolated values.
 *
 * Example: formatLabelWithValues('menu.edit.undoN', { n: 3 }) -> 'Undo 3'
 */
export function formatLabelWithValues(
  key: string,
  values: Record<string, string | number>,
): string {
  let result = formatLabel(key);
  for (const [k, v] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return result;
}

/**
 * Report a missing key for development diagnostics.
 * In development, logs a warning once per missing key.
 */
export function reportMissingKey(key: string): void {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
    if (!MISSING_KEYS.has(key)) {
      MISSING_KEYS.add(key);
      console.warn(`[i18n] Missing label key: ${key}`);
    }
  }
}

/** Get the set of missing keys encountered (for tests). */
export function getMissingKeys(): Set<string> {
  return new Set(MISSING_KEYS);
}

/** Clear missing key tracking (for tests). */
export function clearMissingKeys(): void {
  MISSING_KEYS.clear();
}
