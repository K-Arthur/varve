import type { MenuBuildHelpers, MenuBuildState, MenuItem } from './types';

export function buildEditMenu(
  _state: MenuBuildState,
  helpers: MenuBuildHelpers,
): MenuItem[] {
  return [
    {
      label: 'Undo',
      shortcut: helpers.fmt('undo'),
      ariaKeyshortcut: helpers.ks('undo'),
      action: 'undo',
    },
    {
      label: 'Redo',
      shortcut: helpers.fmt('redo'),
      ariaKeyshortcut: helpers.ks('redo'),
      action: 'redo',
    },
    { label: '---' },
    {
      label: 'Cut',
      shortcut: helpers.fmt('cut'),
      ariaKeyshortcut: helpers.ks('cut'),
      action: 'cut',
      disabled: helpers.dis('cut'),
    },
    {
      label: 'Copy',
      shortcut: helpers.fmt('copy'),
      ariaKeyshortcut: helpers.ks('copy'),
      action: 'copy',
      disabled: helpers.dis('copy'),
    },
    {
      label: 'Paste',
      shortcut: helpers.fmt('paste'),
      ariaKeyshortcut: helpers.ks('paste'),
      action: 'paste',
    },
    {
      label: 'Duplicate',
      shortcut: helpers.fmt('duplicate'),
      ariaKeyshortcut: helpers.ks('duplicate'),
      action: 'duplicate',
      disabled: helpers.dis('duplicate'),
    },
    {
      label: 'Repeat Duplicate',
      shortcut: helpers.fmt('repeatDuplicate'),
      ariaKeyshortcut: helpers.ks('repeatDuplicate'),
      action: 'repeatDuplicate',
      disabled: helpers.dis('duplicate'),
    },
    { label: '---' },
    {
      label: 'Select All',
      shortcut: helpers.fmt('selectAll'),
      ariaKeyshortcut: helpers.ks('selectAll'),
      action: 'selectAll',
    },
    {
      label: 'Delete',
      shortcut: helpers.fmt('delete'),
      ariaKeyshortcut: helpers.ks('delete'),
      action: 'delete',
      disabled: helpers.dis('delete'),
    },
    { label: '---' },
    {
      label: 'Find & Replace\u2026',
      action: 'findReplace',
    },
    { label: '---' },
    {
      label: 'Selection History Back',
      shortcut: helpers.fmt('selectionHistoryBack'),
      ariaKeyshortcut: helpers.ks('selectionHistoryBack'),
      action: 'selectionHistoryBack',
      disabled: !_state.selection.length,
    },
    {
      label: 'Selection History Forward',
      shortcut: helpers.fmt('selectionHistoryForward'),
      ariaKeyshortcut: helpers.ks('selectionHistoryForward'),
      action: 'selectionHistoryForward',
      disabled: !_state.selection.length,
    },
  ];
}
