import type { MenuBuildHelpers, MenuBuildState, MenuItem } from './types';

export function buildTextMenu(
  _state: MenuBuildState,
  helpers: MenuBuildHelpers,
): MenuItem[] {
  const hasSelection = _state.selection.length > 0;

  return [
    {
      label: 'Bold',
      shortcut: helpers.fmtBinding({ key: 'b', ctrl: true, shift: true }),
      ariaKeyshortcut: helpers.ariaShortcutBinding({ key: 'b', ctrl: true, shift: true }),
      action: 'textBold',
      disabled: !hasSelection,
    },
    {
      label: 'Italic',
      shortcut: helpers.fmtBinding({ key: 'i', ctrl: true, shift: true }),
      ariaKeyshortcut: helpers.ariaShortcutBinding({ key: 'i', ctrl: true, shift: true }),
      action: 'textItalic',
      disabled: !hasSelection,
    },
    {
      label: 'Underline',
      shortcut: helpers.fmtBinding({ key: 'u', ctrl: true, shift: true }),
      ariaKeyshortcut: helpers.ariaShortcutBinding({ key: 'u', ctrl: true, shift: true }),
      action: 'textUnderline',
      disabled: !hasSelection,
    },
    { label: '---' },
    {
      label: 'Increase Font Size',
      shortcut: helpers.fmtBinding({ key: '=', ctrl: true, shift: true }),
      ariaKeyshortcut: helpers.ariaShortcutBinding({ key: '=', ctrl: true, shift: true }),
      action: 'textIncreaseSize',
      disabled: !hasSelection,
    },
    {
      label: 'Decrease Font Size',
      shortcut: helpers.fmtBinding({ key: '-', ctrl: true, shift: true }),
      ariaKeyshortcut: helpers.ariaShortcutBinding({ key: '-', ctrl: true, shift: true }),
      action: 'textDecreaseSize',
      disabled: !hasSelection,
    },
    { label: '---' },
    {
      label: 'Align Left',
      action: 'textAlignLeft',
      disabled: !hasSelection,
    },
    {
      label: 'Align Center',
      action: 'textAlignCenter',
      disabled: !hasSelection,
    },
    {
      label: 'Align Right',
      action: 'textAlignRight',
      disabled: !hasSelection,
    },
    {
      label: 'Align Justify',
      action: 'textAlignJustify',
      disabled: !hasSelection,
    },
    { label: '---' },
    {
      label: 'Convert to Outlines',
      action: 'textToOutlines',
      disabled: !hasSelection,
    },
  ];
}
