import type { KeymapExport, ShortcutBinding, ShortcutDef } from './types';

const STORAGE_KEY = 'strata-shortcut-overrides';

export const SHORTCUT_DEFS = {
  undo: { binding: { key: 'z', ctrl: true }, label: 'Undo', category: 'Edit' },
  redo: { binding: { key: 'z', ctrl: true, shift: true }, label: 'Redo', category: 'Edit' },
  delete: { binding: { key: 'Backspace' }, label: 'Delete', category: 'Edit' },
  copy: { binding: { key: 'c', ctrl: true }, label: 'Copy', category: 'Edit' },
  cut: { binding: { key: 'x', ctrl: true }, label: 'Cut', category: 'Edit' },
  paste: { binding: { key: 'v', ctrl: true }, label: 'Paste', category: 'Edit' },
  duplicate: { binding: { key: 'd', ctrl: true }, label: 'Duplicate', category: 'Edit' },
  flipH: { binding: { key: 'h', shift: true }, label: 'Flip Horizontal', category: 'Object' },
  flipV: { binding: { key: 'v', shift: true }, label: 'Flip Vertical', category: 'Object' },
  newDocument: { binding: { key: 'n', ctrl: true }, label: 'New', category: 'File' },
  open: { binding: { key: 'o', ctrl: true }, label: 'Open\u2026', category: 'File' },
  save: { binding: { key: 's', ctrl: true }, label: 'Save', category: 'File' },
  saveAs: {
    binding: { key: 's', ctrl: true, shift: true },
    label: 'Save As\u2026',
    category: 'File',
  },
  exportSvg: {
    binding: { key: 'e', ctrl: true, alt: true },
    label: 'Export SVG\u2026',
    category: 'File',
  },
  export: {
    binding: { key: 'e', ctrl: true, shift: true },
    label: 'Export\u2026',
    category: 'File',
  },
  zoomReset: { binding: { key: '0', ctrl: true }, label: 'Zoom to 100%', category: 'View' },
  zoomIn: { binding: { key: '=', ctrl: true }, label: 'Zoom In', category: 'View' },
  zoomOut: { binding: { key: '-', ctrl: true }, label: 'Zoom Out', category: 'View' },
  fitAll: { binding: { key: '1', shift: true }, label: 'Fit All', category: 'View' },
  fitSelection: { binding: { key: '2', shift: true }, label: 'Fit Selection', category: 'View' },
  fitActivePage: { binding: { key: '3', shift: true }, label: 'Fit Active Page', category: 'View' },
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
  zoom50: { binding: { key: '1' }, label: 'Zoom to 50%', category: 'View' },
  zoom75: { binding: { key: '2' }, label: 'Zoom to 75%', category: 'View' },
  zoom100: { binding: { key: '3' }, label: 'Zoom to 100%', category: 'View' },
  zoom150: { binding: { key: '4' }, label: 'Zoom to 150%', category: 'View' },
  zoom200: { binding: { key: '5' }, label: 'Zoom to 200%', category: 'View' },
  zoom400: { binding: { key: '6' }, label: 'Zoom to 400%', category: 'View' },
  selectAll: { binding: { key: 'a', ctrl: true }, label: 'Select All', category: 'Edit' },
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
  tabNew: { binding: { key: 't', ctrl: true }, label: 'New tab', category: 'File' },
  tabClose: { binding: { key: 'w', ctrl: true }, label: 'Close tab', category: 'File' },
  tabNext: { binding: { key: 'Tab', ctrl: true }, label: 'Next tab', category: 'View' },
  tabPrev: {
    binding: { key: 'Tab', ctrl: true, shift: true },
    label: 'Previous tab',
    category: 'View',
  },
  toolSelect: { binding: { key: 'v' }, label: 'Select tool', category: 'Tools' },
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
  toolInspect: { binding: { key: 'i' }, label: 'Inspect mode', category: 'Tools' },
  toolPaint: { binding: { key: 'b' }, label: 'Paint brush', category: 'Tools' },
  toolEraser: { binding: { key: 'e' }, label: 'Eraser', category: 'Tools' },
  settings: { binding: { key: ',', ctrl: true }, label: 'Settings\u2026', category: 'File' },
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
  toggleTimelinePanel: {
    binding: { key: 't', ctrl: true, alt: true },
    label: 'Toggle Timeline Panel',
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
  quickActions: {
    binding: { key: ';', ctrl: true },
    label: 'Quick Actions',
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
    binding: { key: 'Escape' },
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
  colorBlindnessTritanopia: {
    // 't' collides with toggleTimelinePanel (Ctrl+Alt+T, documented in
    // AGENTS.md as the canonical timeline shortcut) — use '3' to keep the
    // numeric pattern started by colorBlindnessNone's '0' instead of
    // reassigning the more established timeline binding.
    binding: { key: '3', ctrl: true, alt: true },
    label: 'Color Blindness: Tritanopia',
    category: 'View',
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
  const key = e.key;

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
  return navigator.platform?.toLowerCase().includes('mac') ?? false;
}

export function shortcutFromEvent(e: KeyboardEvent): {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  const key = e.key === 'Backspace' || e.key === 'Delete' ? 'Backspace' : e.key.toLowerCase();
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

/** True when a keydown on `target` should be left for the widget to handle, not treated as a tool/app shortcut. */
export function shouldIgnoreShortcutTarget(target: Element | null): boolean {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  if (target.closest?.(SHORTCUT_IGNORE_SELECTOR)) return true;
  if (target.closest?.('[data-shortcut-ignore]')) return true;
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
