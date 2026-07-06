/**
 * @strata/ui/icons — typed `<Icon>` + curated icon maps.
 *
 * The `Icon` primitive is the only graphics path for UI affordances (Strata
 * plan §4.4: zero emoji, SVG via Lucide only). Curated maps group icons by
 * surface so toolbars/menus get a stable, reviewable name set.
 */

export type { IconName, IconProps } from './Icon';
export { Icon } from './Icon';
export type { StrataLogoProps } from './StrataLogo';
export { StrataLogo } from './StrataLogo';

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
  group: 'Group',
  union: 'Combine',
  subtract: 'Diff',
  slice: 'Scissors',
  hand: 'Hand',
  zoomIn: 'ZoomIn',
  zoom: 'ZoomIn',
  arrow: 'ArrowRight',
  nodeEdit: 'Pointer',
  scale: 'Maximize2',
  eyedropper: 'Pipette',
  booleanUnion: 'Combine',
  booleanSubtract: 'Diff',
  booleanIntersect: 'Combine',
  booleanExclude: 'Diff',
  inspect: 'SearchCode',
  cloneStamp: 'Stamp',
  healBrush: 'Bandage',
  spotHeal: 'Wand',
  patch: 'SquareStack',
  refineMask: 'Paintbrush',
  trimapEdit: 'Paintbrush',
  adjustment: 'SlidersHorizontal',
} as const satisfies Record<string, IconName>;

/** General chrome icons. */
export const CHROME_ICONS = {
  menu: 'Menu',
  close: 'X',
  chevronDown: 'ChevronDown',
  chevronUp: 'ChevronUp',
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
  clock: 'Clock',
  history: 'History',
  pin: 'Pin',
  pinOff: 'PinOff',
  fileText: 'FileText',
  folder: 'Folder',
  folderOpen: 'FolderOpen',
  filter: 'Filter',
  layoutGrid: 'LayoutGrid',
  list: 'List',
  ellipsis: 'Ellipsis',
  rotateCcw: 'RotateCcw',
  upload: 'Upload',
  download: 'Download',
  star: 'Star',
  archive: 'Archive',
  copy: 'Copy',
  externalLink: 'ExternalLink',
  inspect: 'SearchCode',
  ruler: 'Ruler',
  code: 'Code',
  palette: 'Palette',
  maximize: 'Maximize',
  crosshair: 'Crosshair',
  gripVertical: 'GripVertical',
  undo: 'Undo2',
  redo: 'Redo2',
  home: 'House',
  collapseAll: 'ChevronsUpDown',
} as const satisfies Record<string, IconName>;
