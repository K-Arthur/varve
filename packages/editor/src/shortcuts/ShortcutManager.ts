import { isMac as isMacPlatform } from '@varve/platform';
import { canonicalShortcutKey, physicalKeyFromEvent } from '../input/physicalKey';
import type { KeymapExport, ShortcutBinding, ShortcutDef } from './types';

const STORAGE_KEY = 'strata-shortcut-overrides';

export const SHORTCUT_DEFS = {
  undo: { binding: { key: 'z', ctrl: true }, label: 'Undo', category: 'Edit' },
  redo: { binding: { key: 'z', ctrl: true, shift: true }, label: 'Redo', category: 'Edit' },
  delete: { binding: { key: 'Backspace' }, label: 'Delete', category: 'Edit' },
  copy: { binding: { key: 'c', ctrl: true }, label: 'Copy', category: 'Edit' },
  cut: { binding: { key: 'x', ctrl: true }, label: 'Cut', category: 'Edit' },
  paste: { binding: { key: 'v', ctrl: true }, label: 'Paste', category: 'Edit' },
  copyProperties: {
    binding: { key: 'c', ctrl: true, shift: true },
    label: 'Copy Properties',
    category: 'Edit',
  },
  pasteProperties: {
    binding: { key: 'v', ctrl: true, shift: true },
    label: 'Paste Properties',
    category: 'Edit',
  },
  duplicate: { binding: { key: 'd', ctrl: true }, label: 'Duplicate', category: 'Edit' },
  repeatDuplicate: {
    binding: { key: 'd', ctrl: true, shift: true },
    label: 'Repeat Duplicate',
    category: 'Edit',
  },
  flipH: { binding: { key: 'h', shift: true }, label: 'Flip Horizontal', category: 'Object' },
  flipV: { binding: { key: 'v', shift: true }, label: 'Flip Vertical', category: 'Object' },
  upscaleImage: {
    binding: { key: 'u', ctrl: true, shift: true },
    label: 'Enhance Image…',
    category: 'Object',
  },
  imageTrace: {
    binding: { key: 't', ctrl: true, alt: true, shift: true },
    label: 'Vectorize Image (Image Trace)',
    category: 'Object',
  },
  newDocument: { binding: { key: 'n', ctrl: true }, label: 'New', category: 'File' },
  open: { binding: { key: 'o', ctrl: true }, label: 'Open\u2026', category: 'File' },
  save: { binding: { key: 's', ctrl: true }, label: 'Save', category: 'File' },
  saveAs: {
    binding: { key: 's', ctrl: true, shift: true },
    label: 'Save As\u2026',
    category: 'File',
  },
  exportSvg: {
    binding: { key: 'e', ctrl: true, shift: true },
    label: 'Export SVG\u2026',
    category: 'File',
  },
  export: {
    binding: { key: 'e', ctrl: true },
    label: 'Export\u2026',
    category: 'File',
  },
  zoomReset: { binding: { key: '0', ctrl: true }, label: 'Zoom to 100%', category: 'View' },
  zoomIn: { binding: { key: '=', ctrl: true }, label: 'Zoom In', category: 'View' },
  zoomOut: { binding: { key: '-', ctrl: true }, label: 'Zoom Out', category: 'View' },
  fitAll: { binding: { key: '1', shift: true }, label: 'Fit All', category: 'View' },
  fitSelection: { binding: { key: '2', shift: true }, label: 'Fit Selection', category: 'View' },
  fitActivePage: { binding: { key: '3', shift: true }, label: 'Fit Active Page', category: 'View' },
  fitSpread: { binding: { key: '5', shift: true }, label: 'Fit Spread', category: 'View' },
  fitAllPages: { binding: { key: '6', shift: true }, label: 'Fit All Pages', category: 'View' },
  fitActiveFrame: {
    binding: { key: '4', shift: true },
    label: 'Fit Active Frame',
    category: 'View',
  },
  resetViewRotation: {
    binding: { key: 'r', shift: true },
    label: 'Reset View Rotation',
    category: 'View',
  },
  rotateViewCW: {
    binding: { key: ']', alt: true },
    label: 'Rotate View Clockwise',
    category: 'View',
  },
  rotateViewCCW: {
    binding: { key: '[', alt: true },
    label: 'Rotate View Counter-clockwise',
    category: 'View',
  },
  toggleRulerMode: {
    binding: { key: ';', alt: true },
    label: 'Toggle Ruler Mode',
    category: 'View',
  },
  toggleGrid: {
    binding: { key: 'g', alt: true, shift: true },
    label: 'Toggle Grid',
    category: 'View',
  },
  gridOverlayBaseline: {
    binding: { key: 'b', alt: true, shift: true },
    label: 'Baseline Grid Overlay',
    category: 'View',
  },
  gridOverlayIsometric: {
    binding: { key: 'i', alt: true, shift: true },
    label: 'Isometric Grid Overlay',
    category: 'View',
  },
  togglePixelGrid: {
    binding: { key: 'p', alt: true, shift: true },
    label: 'Toggle Pixel Grid',
    category: 'View',
  },
  zoom50: { binding: { key: '1' }, label: 'Zoom to 50%', category: 'View' },
  zoom75: { binding: { key: '2' }, label: 'Zoom to 75%', category: 'View' },
  zoom100: { binding: { key: '3' }, label: 'Zoom to 100%', category: 'View' },
  zoom150: { binding: { key: '4' }, label: 'Zoom to 150%', category: 'View' },
  zoom200: { binding: { key: '5' }, label: 'Zoom to 200%', category: 'View' },
  zoom400: { binding: { key: '6' }, label: 'Zoom to 400%', category: 'View' },
  selectAll: { binding: { key: 'a', ctrl: true }, label: 'Select All', category: 'Edit' },
  selectNone: {
    binding: { key: 'a', ctrl: true, shift: true },
    label: 'Select None',
    category: 'Edit',
  },
  invertSelection: {
    binding: { key: 'i', ctrl: true, shift: true },
    label: 'Invert Selection',
    category: 'Edit',
  },
  selectParent: {
    binding: { key: 'ArrowUp', alt: true },
    label: 'Select Parent',
    category: 'Edit',
  },
  selectChildren: {
    binding: { key: 'ArrowDown', alt: true },
    label: 'Select Children',
    category: 'Edit',
  },
  selectNextSibling: {
    binding: { key: 'ArrowRight', shift: true },
    label: 'Select Next Sibling',
    category: 'Edit',
  },
  selectPreviousSibling: {
    binding: { key: 'ArrowLeft', shift: true },
    label: 'Select Previous Sibling',
    category: 'Edit',
  },
  selectionHistoryBack: {
    binding: { key: 'ArrowLeft', alt: true },
    label: 'Selection History Back',
    category: 'Edit',
  },
  selectionHistoryForward: {
    binding: { key: 'ArrowRight', alt: true },
    label: 'Selection History Forward',
    category: 'Edit',
  },
  group: { binding: { key: 'g', ctrl: true }, label: 'Group', category: 'Object' },
  ungroup: { binding: { key: 'g', ctrl: true, shift: true }, label: 'Ungroup', category: 'Object' },
  createClippingMask: {
    binding: { key: '7', ctrl: true },
    label: 'Create Clipping Mask',
    category: 'Object',
  },
  releaseClippingMask: {
    binding: { key: '7', ctrl: true, alt: true },
    label: 'Release Clipping Mask',
    category: 'Object',
  },
  bringFront: {
    binding: { key: ']', ctrl: true, shift: true },
    label: 'Bring to Front',
    category: 'Arrange',
  },
  sendBack: {
    binding: { key: '[', ctrl: true, shift: true },
    label: 'Send to Back',
    category: 'Arrange',
  },
  bringForward: { binding: { key: ']', ctrl: true }, label: 'Bring Forward', category: 'Arrange' },
  sendBackward: { binding: { key: '[', ctrl: true }, label: 'Send Backward', category: 'Arrange' },
  flattenSelection: {
    binding: { key: 'f', ctrl: true, shift: true },
    label: 'Flatten Selection',
    category: 'Object',
  },
  alignLeft: {
    binding: { key: 'ArrowLeft', ctrl: true, shift: true },
    label: 'Align left',
    category: 'Object',
  },
  alignCenterH: {
    binding: { key: 'Home', ctrl: true, shift: true },
    label: 'Align horizontal center',
    category: 'Object',
  },
  alignRight: {
    binding: { key: 'ArrowRight', ctrl: true, shift: true },
    label: 'Align right',
    category: 'Object',
  },
  alignTop: {
    binding: { key: 'ArrowUp', ctrl: true, shift: true },
    label: 'Align top',
    category: 'Object',
  },
  alignCenterV: {
    binding: { key: 'PageUp', ctrl: true, shift: true },
    label: 'Align vertical center',
    category: 'Object',
  },
  alignBottom: {
    binding: { key: 'ArrowDown', ctrl: true, shift: true },
    label: 'Align bottom',
    category: 'Object',
  },
  distributeHorizontal: {
    binding: { key: 'h', ctrl: true, alt: true },
    label: 'Distribute horizontally',
    category: 'Object',
  },
  distributeVertical: {
    binding: { key: 'v', ctrl: true, alt: true },
    label: 'Distribute vertically',
    category: 'Object',
  },
  bindField: { binding: { key: '=' }, label: 'Bind field', category: 'Object' },
  shortcutPalette: {
    binding: { key: '/', ctrl: true },
    label: 'Command Palette',
    category: 'View',
  },
  reopenLast: {
    binding: { key: 't', ctrl: true, shift: true },
    label: 'Reopen Last Closed File',
    category: 'File',
  },
  tabNew: { binding: { key: 't', ctrl: true }, label: 'New tab', category: 'File' },
  tabClose: { binding: { key: 'w', ctrl: true }, label: 'Close Document', category: 'File' },
  closeWindow: {
    binding: { key: 'w', ctrl: true, shift: true },
    label: 'Close Window',
    category: 'File',
  },
  quitApp: { binding: { key: 'q', ctrl: true }, label: 'Quit Varve', category: 'File' },
  tabNext: { binding: { key: 'Tab', ctrl: true }, label: 'Next tab', category: 'View' },
  tabPrev: {
    binding: { key: 'Tab', ctrl: true, shift: true },
    label: 'Previous tab',
    category: 'View',
  },
  toolSelect: { binding: { key: 'v' }, label: 'Select tool', category: 'Tools' },
  toolLasso: { binding: { key: 'l', shift: true }, label: 'Lasso tool', category: 'Tools' },
  toolFrame: { binding: { key: 'f' }, label: 'Frame tool', category: 'Tools' },
  toolRect: { binding: { key: 'r' }, label: 'Rectangle tool', category: 'Tools' },
  toolEllipse: { binding: { key: 'o' }, label: 'Ellipse tool', category: 'Tools' },
  toolLine: { binding: { key: 'l' }, label: 'Line tool', category: 'Tools' },
  toolArrow: { binding: { key: 'a' }, label: 'Arrow tool', category: 'Tools' },
  toolPen: { binding: { key: 'p' }, label: 'Pen tool', category: 'Tools' },
  toolPencil: { binding: { key: 'p', shift: true }, label: 'Pencil tool', category: 'Tools' },
  toolText: { binding: { key: 't' }, label: 'Text tool', category: 'Tools' },
  toolHand: { binding: { key: 'h' }, label: 'Hand tool', category: 'Tools' },
  toolZoom: { binding: { key: 'z' }, label: 'Zoom tool', category: 'Tools' },
  toolCrop: { binding: { key: 'c' }, label: 'Crop tool', category: 'Tools' },
  toolPerspective: { binding: { key: 'p' }, label: 'Perspective tool', category: 'Tools' },
  toolInspect: { binding: { key: 'i' }, label: 'Inspect mode', category: 'Tools' },
  toolPaint: { binding: { key: 'b' }, label: 'Paint brush', category: 'Tools' },
  toolEraser: { binding: { key: 'e' }, label: 'Eraser', category: 'Tools' },
  toolSmudge: { binding: { key: 'u' }, label: 'Smudge tool', category: 'Tools' },
  toolScale: { binding: { key: 's' }, label: 'Scale tool', category: 'Tools' },
  toolSlice: { binding: { key: 'k' }, label: 'Slice tool', category: 'Tools' },
  toolCloneStamp: { binding: { key: 'j' }, label: 'Clone Stamp tool', category: 'Tools' },
  toolSam2Segment: { binding: { key: 'm' }, label: 'Select Subject tool', category: 'Tools' },
  toolPage: { binding: { key: 'q' }, label: 'Page tool', category: 'Tools' },
  linkTextFrames: {
    binding: { key: 'k', ctrl: true, shift: true },
    label: 'Link Text Frames',
    category: 'Text',
  },
  unlinkTextFrames: {
    binding: { key: 'k', ctrl: true, alt: true, shift: true },
    label: 'Unlink Text Frames',
    category: 'Text',
  },
  settings: { binding: { key: ',', ctrl: true }, label: 'Settings\u2026', category: 'File' },
  import: { binding: { key: 'i', ctrl: true }, label: 'Import\u2026', category: 'File' },
  toggleSnap: { binding: { key: ',' }, label: 'Toggle Snap', category: 'View' },
  toggleGuidesVisible: {
    binding: { key: ';', ctrl: true },
    label: 'Show/Hide Guides',
    category: 'View',
  },
  lockAllGuides: {
    binding: { key: ';', ctrl: true, alt: true },
    label: 'Lock/Unlock All Guides',
    category: 'View',
  },
  toggleLeftPanel: {
    binding: { key: 'b', ctrl: true },
    label: 'Toggle Layers Panel',
    category: 'View',
  },
  toggleRightPanel: {
    binding: { key: 'b', ctrl: true, shift: true },
    label: 'Toggle Inspector Panel',
    category: 'View',
  },
  toggleLibraryPanel: {
    binding: { key: 'l', ctrl: true, alt: true },
    label: 'Toggle Library Panel',
    category: 'View',
  },
  toggleCodegenPanel: {
    binding: { key: 'j', ctrl: true, shift: true },
    label: 'Toggle Codegen Panel',
    category: 'View',
  },
  insertIcon: {
    binding: { key: 'i', ctrl: true, alt: true, shift: true },
    label: 'Insert Icon\u2026',
    category: 'Insert',
  },
  toggleLogoPanel: {
    binding: { key: 'l', ctrl: true, alt: true, shift: true },
    label: 'Toggle Logo Panel',
    category: 'View',
  },
  toggleTimelinePanel: {
    binding: { key: 't', ctrl: true, alt: true },
    label: 'Toggle Timeline Panel',
    category: 'View',
  },
  toggleHistoryPanel: {
    binding: { key: 'y', ctrl: true, alt: true },
    label: 'Toggle History Panel',
    category: 'View',
  },
  toggleGraphEditor: {
    binding: { key: 'g' },
    label: 'Toggle Graph Editor',
    category: 'View',
  },
  toggleStateMachinePanel: {
    binding: { key: 'k', ctrl: true, alt: true },
    label: 'Toggle State Machine Panel',
    category: 'View',
  },
  motionWorkspace: {
    binding: { key: 'm', ctrl: true, alt: true },
    label: 'Switch to Motion Workspace',
    category: 'View',
  },
  booleanUnion: {
    binding: { key: 'u', ctrl: true, alt: true },
    label: 'Boolean Union',
    category: 'Object',
  },
  booleanSubtract: {
    binding: { key: 's', ctrl: true, alt: true },
    label: 'Boolean Subtract',
    category: 'Object',
  },
  booleanIntersect: {
    binding: { key: 'i', ctrl: true, alt: true },
    label: 'Boolean Intersect',
    category: 'Object',
  },
  booleanExclude: {
    binding: { key: 'x', ctrl: true, alt: true },
    label: 'Boolean Exclude',
    category: 'Object',
  },
  expandStroke: {
    binding: { key: 'e', ctrl: true, alt: true },
    label: 'Expand Stroke to Outline',
    category: 'Object',
  },
  offsetPath: {
    binding: { key: 'o', ctrl: true, alt: true },
    label: 'Offset Path',
    category: 'Object',
  },
  roundCorners: {
    binding: { key: 'c', ctrl: true, alt: true },
    label: 'Round Path Corners',
    category: 'Object',
  },
  simplifyPath: {
    binding: { key: 'w', ctrl: true, alt: true },
    label: 'Simplify Path',
    category: 'Object',
  },
  mirrorDuplicateHorizontal: {
    binding: { key: 'h', ctrl: true, alt: true, shift: true },
    label: 'Mirror Duplicate Horizontal',
    category: 'Object',
  },
  mirrorDuplicateVertical: {
    binding: { key: 'v', ctrl: true, alt: true, shift: true },
    label: 'Mirror Duplicate Vertical',
    category: 'Object',
  },
  radialDuplicate: {
    binding: { key: 'r', ctrl: true, alt: true },
    label: 'Radial Duplicate',
    category: 'Object',
  },
  newLogoProject: {
    binding: { key: 'n', ctrl: true, alt: true },
    label: 'New Logo Project',
    category: 'File',
  },
  createLogoConcept: {
    binding: { key: '1', ctrl: true, alt: true },
    label: 'Create Logo Concept',
    category: 'File',
  },
  duplicateLogoConcept: {
    binding: { key: '2', ctrl: true, alt: true },
    label: 'Duplicate Logo Concept',
    category: 'File',
  },
  createMonochromeVariant: {
    binding: { key: 'm', ctrl: true, alt: true, shift: true },
    label: 'Create Monochrome Variant',
    category: 'File',
  },
  createReversedVariant: {
    binding: { key: 'q', ctrl: true, alt: true },
    label: 'Create Reversed Variant',
    category: 'File',
  },
  logoPreview: {
    binding: { key: 'p', ctrl: true, alt: true, shift: true },
    label: 'Test Logo at Small Sizes',
    category: 'View',
  },
  quickActions: {
    binding: { key: ';', ctrl: true, shift: true },
    label: 'Quick Actions',
    category: 'View',
  },
  openFontsPanel: {
    binding: { key: 'f', ctrl: true, alt: true },
    label: 'Open Fonts Panel',
    category: 'View',
  },
  home: {
    binding: { key: 'h', ctrl: true, shift: true },
    label: 'Home',
    category: 'View',
  },
  present: {
    binding: { key: 'p', ctrl: true, shift: true },
    label: 'Present',
    category: 'View',
  },
  softProof: {
    binding: { key: 'y', ctrl: true, shift: true },
    label: 'Toggle Soft Proofing',
    category: 'View',
  },
  canvasModeOutline: {
    binding: { key: 'o', ctrl: true, shift: true },
    label: 'Outline Mode',
    category: 'View',
  },
  canvasModePreview: {
    binding: { key: 'r', ctrl: true, shift: true },
    label: 'Preview Mode',
    category: 'View',
  },
  canvasModeFull: {
    binding: { key: 'Escape', ctrl: true, shift: true },
    label: 'Full Render Mode',
    category: 'View',
  },
  openHelp: {
    binding: { key: 'F1' },
    label: 'Contextual Help',
    category: 'View',
  },
  openHelpCenter: {
    binding: { key: 'F1', ctrl: true, shift: true },
    label: 'Help Center',
    category: 'View',
  },
  // Workspace mode switching
  workspaceDesign: {
    binding: { key: '1', ctrl: true, shift: true },
    label: 'Workspace: Design',
    category: 'View',
  },
  workspacePrint: {
    binding: { key: '2', ctrl: true, shift: true },
    label: 'Workspace: Print',
    category: 'View',
  },
  workspaceDrawing: {
    binding: { key: '3', ctrl: true, shift: true },
    label: 'Workspace: Draw',
    category: 'View',
  },
  workspaceImage: {
    binding: { key: '4', ctrl: true, shift: true },
    label: 'Workspace: Photo',
    category: 'View',
  },
  workspaceMotion: {
    binding: { key: '5', ctrl: true, shift: true },
    label: 'Workspace: Motion',
    category: 'View',
  },
  workspaceCodegen: {
    binding: { key: '9', ctrl: true, shift: true },
    label: 'Workspace: Codegen',
    category: 'View',
  },
  workspaceLogo: {
    binding: { key: '6', ctrl: true, shift: true },
    label: 'Workspace: Logo',
    category: 'View',
  },
  workspaceEmail: {
    binding: { key: '7', ctrl: true, shift: true },
    label: 'Workspace: Email',
    category: 'View',
  },
  toggleDistractionFree: {
    // Shift+. produces e.key '>' — bindingMatchesEvent compares e.key, so a
    // '.' key with shift:true could never fire.
    binding: { key: '>', ctrl: true, shift: true },
    label: 'Toggle Distraction-Free Mode',
    category: 'View',
  },
  toggleBeforeAfterCompare: {
    binding: { key: '\\' },
    label: 'Compare Before/After',
    category: 'View',
  },
  colorBlindnessNone: {
    binding: { key: '0', ctrl: true, alt: true },
    label: 'Color Blindness: None',
    category: 'View',
  },
  colorBlindnessProtanopia: {
    binding: { key: 'p', ctrl: true, alt: true },
    label: 'Color Blindness: Protanopia',
    category: 'View',
  },
  colorBlindnessDeuteranopia: {
    binding: { key: 'd', ctrl: true, alt: true },
    label: 'Color Blindness: Deuteranopia',
    category: 'View',
  },
  harmonizeSpacing: {
    binding: { key: ' ', ctrl: true, shift: true },
    label: 'Harmonize Spacing',
    category: 'Arrange',
  },
  colorBlindnessTritanopia: {
    // 't' collides with toggleTimelinePanel (Ctrl+Alt+T, documented in
    // AGENTS.md as the canonical timeline shortcut) — use '3' to keep the
    // numeric pattern started by colorBlindnessNone's '0' instead of
    // reassigning the more established timeline binding.
    binding: { key: '3', ctrl: true, alt: true },
    label: 'Color Blindness: Tritanopia',
    category: 'View',
  },

  // ── Motion Mode shortcuts ─────────────────────────────────────────────
  // Note: single-letter shortcuts (o/p/r/s/e) collide with established tool
  // shortcuts (ellipse/pen/rect/eraser). Use Alt+letter to avoid collisions
  // in the global shortcut space.
  toggleOnionSkin: {
    binding: { key: 'o', alt: true },
    label: 'Toggle Onion Skinning',
    category: 'Motion',
  },
  addPositionKeyframe: {
    binding: { key: 'p', alt: true },
    label: 'Add Position Keyframe',
    category: 'Motion',
  },
  addRotationKeyframe: {
    binding: { key: 'r', alt: true },
    label: 'Add Rotation Keyframe',
    category: 'Motion',
  },
  addScaleKeyframe: {
    binding: { key: 's', alt: true },
    label: 'Add Scale Keyframe',
    category: 'Motion',
  },
  addOpacityKeyframe: {
    binding: { key: 'e', alt: true },
    label: 'Add Opacity Keyframe',
    category: 'Motion',
  },
  toggleAutoKeyframe: {
    binding: { key: 'k', alt: true },
    label: 'Toggle Auto-Keyframe',
    category: 'Motion',
  },
  playPause: {
    binding: { key: ' ' },
    label: 'Play/Pause Timeline',
    category: 'Motion',
  },
  stopTimeline: {
    binding: { key: '.', ctrl: true },
    label: 'Stop Timeline',
    category: 'Motion',
  },
  stepForward: {
    binding: { key: 'ArrowRight', ctrl: true },
    label: 'Step Forward',
    category: 'Motion',
  },
  stepBackward: {
    binding: { key: 'ArrowLeft', ctrl: true },
    label: 'Step Backward',
    category: 'Motion',
  },
  addKeyframe: {
    binding: { key: 'i', shift: true },
    label: 'Add Keyframe at Playhead',
    category: 'Motion',
  },
  newAdjustmentLayer: {
    binding: { key: 'n', alt: true },
    label: 'New Adjustment Layer',
    category: 'Object',
  },
  archiveBackup: {
    binding: { key: 'n', ctrl: true, shift: true },
    label: 'Backup Archive\u2026',
    category: 'File',
  },
  archiveRestore: {
    binding: { key: 'l', ctrl: true, shift: true },
    label: 'Restore Archive\u2026',
    category: 'File',
  },

  // ── Nudge (canvas-context: dispatched by the tool layer, not globally) ──
  nudgeUp: {
    binding: { key: 'ArrowUp' },
    label: 'Nudge Up',
    category: 'Arrange',
    context: 'canvas',
  },
  nudgeDown: {
    binding: { key: 'ArrowDown' },
    label: 'Nudge Down',
    category: 'Arrange',
    context: 'canvas',
  },
  nudgeLeft: {
    binding: { key: 'ArrowLeft' },
    label: 'Nudge Left',
    category: 'Arrange',
    context: 'canvas',
  },
  nudgeRight: {
    binding: { key: 'ArrowRight' },
    label: 'Nudge Right',
    category: 'Arrange',
    context: 'canvas',
  },
} satisfies Record<string, ShortcutDef>;

// ── Collision detection ───────────────────────────────────────────────

export function detectCollisions(): Array<{ id1: string; id2: string; binding: string }> {
  const seen = new Map<string, string>();
  const collisions: Array<{ id1: string; id2: string; binding: string }> = [];

  for (const [id, def] of Object.entries(SHORTCUT_DEFS)) {
    const b: ShortcutBinding = def.binding;
    const key = `${b.ctrl ? 'C+' : ''}${b.shift ? 'S+' : ''}${b.alt ? 'A+' : ''}${(b.key ?? '').toLowerCase()}`;
    const existing = seen.get(key);
    if (existing) {
      collisions.push({ id1: existing, id2: id, binding: key });
    } else {
      seen.set(key, id);
    }
  }

  if (collisions.length > 0) {
    if (typeof console !== 'undefined') {
      console.warn(
        '[Strata] ShortcutManager: detected shortcut collisions:',
        collisions.map((c) => `${c.id1} <-> ${c.id2} (${c.binding})`).join(', '),
      );
    }
  }

  return collisions;
}

// Run collision detection once at module init
detectCollisions();

// ── Persistence ────────────────────────────────────────────────────────

export function getOverrides(): Record<string, ShortcutBinding> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ShortcutBinding>) : {};
  } catch {
    return {};
  }
}

export function setOverride(id: string, binding: ShortcutBinding): void {
  const overrides = getOverrides();
  overrides[id] = binding;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function clearOverride(id: string): void {
  const overrides = getOverrides();
  delete overrides[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function clearAllOverrides(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getEffectiveBinding(id: string): ShortcutBinding {
  const overrides = getOverrides();
  if (overrides[id]) return overrides[id];
  const def = SHORTCUT_DEFS[id as keyof typeof SHORTCUT_DEFS];
  return def?.binding ?? { key: '' };
}

// ── Key capture ────────────────────────────────────────────────────────

export function captureKeyCombo(e: KeyboardEvent): ShortcutBinding | null {
  const key = physicalKeyFromEvent(e);

  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
    return null;
  }
  if (key === 'Dead' || key === 'Unidentified') {
    return null;
  }
  if (key === 'Escape') {
    return null;
  }

  return {
    key: key === 'Backspace' || key === 'Delete' ? 'Backspace' : key.toLowerCase(),
    ctrl: isMac() ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

// ── Export / Import ─────────────────────────────────────────────────────

export function exportKeymap(): KeymapExport {
  const overrides = getOverrides();
  const shortcuts: KeymapExport['shortcuts'] = {};
  for (const [id, def] of Object.entries(SHORTCUT_DEFS)) {
    shortcuts[id] = {
      binding: overrides[id] ?? def.binding,
      label: def.label,
    };
  }
  return {
    version: 1,
    generated: new Date().toISOString(),
    shortcuts,
  };
}

export function importKeymap(data: KeymapExport): number {
  let count = 0;
  if (!data.shortcuts || typeof data.shortcuts !== 'object') return 0;
  for (const [id, entry] of Object.entries(data.shortcuts)) {
    if (entry && typeof entry === 'object' && 'binding' in entry) {
      setOverride(id, entry.binding as ShortcutBinding);
      count++;
    }
  }
  return count;
}

export function isMac(): boolean {
  return isMacPlatform();
}

export function shortcutFromEvent(e: KeyboardEvent): {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  // Resolve digits/numpad from the physical `code` so `Shift+1` (key `!` on a
  // US layout) still matches a binding declared against `1`, and numpad keys
  // work regardless of NumLock. Non-digit keys fall back to `e.key`.
  const physicalKey = physicalKeyFromEvent(e);
  const key =
    physicalKey === 'Backspace' || physicalKey === 'Delete'
      ? 'Backspace'
      : canonicalShortcutKey(physicalKey.toLowerCase());
  return {
    key,
    ctrl: isMac() ? e.metaKey : e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/**
 * Selectors for widgets that legitimately consume printable keys for typing
 * or type-ahead (comboboxes, spinbuttons, sliders). `role="tree"` /
 * `role="listbox"` are deliberately excluded: they're selectable lists (e.g.
 * the Layers panel), not typing contexts, and blocking shortcuts there broke
 * "select a layer, press a tool key" — the most common canvas workflow.
 * Elements that DO need to swallow keys within a tree/listbox (a rename
 * `<input>`) are already caught by the tag/isContentEditable checks below.
 */
const SHORTCUT_IGNORE_SELECTOR =
  '[role="combobox"],[role="listbox"],[role="spinbutton"],[role="textbox"],[role="slider"]';

/**
 * Returns true if a keydown event on `target` should be handled by the widget
 * rather than treated as a global tool/app shortcut.
 *
 * The function walks up the DOM tree checking, in order:
 * 1. Native form controls (input, textarea, select)
 * 2. ContentEditable elements
 * 3. ARIA roles that consume keyboard input (combobox, textbox, spinbutton, slider)
 * 4. Elements opted out via `data-shortcut-ignore`
 * 5. During IME composition
 */
export function shouldIgnoreShortcutTarget(target: Element | null): boolean {
  if (!target) return false;

  // Fast-path tag check
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((target as HTMLElement).isContentEditable) return true;

  // IME composition: if the element has an active composition, ignore shortcuts
  const activeEl = document.activeElement;
  if (activeEl && isIMEComposing(activeEl)) return true;

  // Walk up to nearest widget that signals keyboard-input ownership
  const widget = target.closest?.(`${SHORTCUT_IGNORE_SELECTOR},[data-shortcut-ignore]`);
  if (widget) return true;

  return false;
}

/**
 * Check if the active element is in IME composition mode.
 * On some platforms (especially Linux/IBus), the composition event fires
 * but isComposing may not be set. We also check for a visible composition
 * range as a fallback.
 */
function isIMEComposing(el: Element): boolean {
  if ((el as HTMLInputElement).matches?.(':disabled')) return false;

  // Standard check
  if ((el as HTMLInputElement).isContentEditable) {
    const sel = document.getSelection();
    if (sel && sel.anchorNode?.nodeType === Node.TEXT_NODE) return true;
  }

  // Check for aria-activedescendant combobox with input
  const role = el.getAttribute('role');
  if (role === 'combobox' || role === 'textbox') return true;

  return false;
}

export function bindingMatchesEvent(e: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (e.repeat && binding.key !== 'Backspace') return false;
  const ev = shortcutFromEvent(e);
  if (ev.key !== binding.key.toLocaleLowerCase()) return false;
  if (Boolean(ev.ctrl) !== Boolean(binding.ctrl)) return false;
  if (Boolean(ev.shift) !== Boolean(binding.shift)) return false;
  if (Boolean(ev.alt) !== Boolean(binding.alt)) return false;
  return true;
}

export function formatShortcut(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (isMac()) {
    if (binding.ctrl) parts.push('\u2318');
    if (binding.shift) parts.push('\u21E7');
    if (binding.alt) parts.push('\u2325');
  } else {
    if (binding.ctrl) parts.push('Ctrl+');
    if (binding.shift) parts.push('Shift+');
    if (binding.alt) parts.push('Alt+');
  }
  const key =
    binding.key.length === 1
      ? binding.key.toUpperCase()
      : binding.key === 'Backspace'
        ? '\u232B'
        : binding.key === 'Delete'
          ? 'Del'
          : binding.key;
  parts.push(key);
  return parts.join(isMac() ? '' : '');
}
