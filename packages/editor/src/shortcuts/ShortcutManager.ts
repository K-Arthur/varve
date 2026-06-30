import type { ShortcutBinding, ShortcutDef } from './types';

export const SHORTCUT_DEFS = {
  undo: { binding: { key: 'z', ctrl: true }, label: 'Undo', category: 'Edit' },
  redo: { binding: { key: 'z', ctrl: true, shift: true }, label: 'Redo', category: 'Edit' },
  delete: { binding: { key: 'Backspace' }, label: 'Delete', category: 'Edit' },
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
  zoomReset: { binding: { key: '0', ctrl: true }, label: 'Zoom to 100%', category: 'View' },
  zoom50: { binding: { key: '1' }, label: 'Zoom to 50%', category: 'View' },
  zoom75: { binding: { key: '2' }, label: 'Zoom to 75%', category: 'View' },
  zoom100: { binding: { key: '3' }, label: 'Zoom to 100%', category: 'View' },
  zoom150: { binding: { key: '4' }, label: 'Zoom to 150%', category: 'View' },
  zoom200: { binding: { key: '5' }, label: 'Zoom to 200%', category: 'View' },
  zoom400: { binding: { key: '6' }, label: 'Zoom to 400%', category: 'View' },
  selectAll: { binding: { key: 'a', ctrl: true }, label: 'Select All', category: 'Edit' },
  group: { binding: { key: 'g', ctrl: true }, label: 'Group', category: 'Object' },
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
  toolPen: { binding: { key: 'p' }, label: 'Pen tool', category: 'Tools' },
  toolText: { binding: { key: 't' }, label: 'Text tool', category: 'Tools' },
  toolHand: { binding: { key: 'h' }, label: 'Hand tool', category: 'Tools' },
  toolZoom: { binding: { key: 'z' }, label: 'Zoom tool', category: 'Tools' },
  toolInspect: { binding: { key: 'i' }, label: 'Inspect mode', category: 'Tools' },
} satisfies Record<string, ShortcutDef>;

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
