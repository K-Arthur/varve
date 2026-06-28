/**
 * @strata/ui/icons — typed `<Icon>` + curated icon maps.
 *
 * The `Icon` primitive is the only graphics path for UI affordances (Strata
 * plan §4.4: zero emoji, SVG via Lucide only). Curated maps group icons by
 * surface so toolbars/menus get a stable, reviewable name set.
 */

export type { IconName, IconProps } from './Icon';
export { Icon } from './Icon';

import type { IconName } from './Icon';

/** Toolbar / tool set (Strata plan §5.3). */
export const TOOL_ICONS = {
  select: 'MousePointer2',
  frame: 'Frame',
  rect: 'Square',
  ellipse: 'Circle',
  polygon: 'Pentagon',
  star: 'Star',
  line: 'Minus',
  pen: 'Pen',
  pencil: 'Pencil',
  text: 'Type',
  image: 'Image',
  component: 'Component',
  union: 'Combine',
  subtract: 'Diff',
  slice: 'Scissors',
  hand: 'Hand',
  zoomIn: 'ZoomIn',
} as const satisfies Record<string, IconName>;

/** General chrome icons. */
export const CHROME_ICONS = {
  menu: 'Menu',
  close: 'X',
  chevronDown: 'ChevronDown',
  chevronRight: 'ChevronRight',
  check: 'Check',
  visibility: 'Eye',
  visibilityOff: 'EyeOff',
  lock: 'Lock',
  unlock: 'LockOpen',
  search: 'Search',
  settings: 'Settings',
  plus: 'Plus',
  trash: 'Trash2',
  spinner: 'LoaderCircle',
} as const satisfies Record<string, IconName>;
