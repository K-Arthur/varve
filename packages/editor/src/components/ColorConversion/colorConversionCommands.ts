/**
 * Document color conversion commands — the action layer for the Assign vs
 * Convert workflows. Reachable from the command palette and menu surfaces.
 */

import type { ActionDef } from '../../actions/ActionRegistry';
import { getActionRegistry } from '../../actions/ActionRegistry';
import { openColorConversion } from './colorConversionBridge';

export const COLOR_CONVERSION_ACTION_IDS = {
  openDialog: 'openColorConversion',
} as const;

const ACTION_DEF: ActionDef = {
  id: COLOR_CONVERSION_ACTION_IDS.openDialog,
  label: 'Document Color Mode…',
  category: 'file',
  keywords: ['color', 'cmyk', 'convert', 'assign', 'profile', 'mode'],
};

/** Register the color-conversion command actions. */
export function registerColorConversionActions(): void {
  getActionRegistry().register(ACTION_DEF, () => {
    openColorConversion();
  });
}
