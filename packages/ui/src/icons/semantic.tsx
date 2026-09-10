/**
 * Semantic icon registry for Varve's product UI.
 *
 * Feature code asks for a concept (`Search`, `Workspace`, `Warp`, `Delete`)
 * rather than importing a vendor glyph. Outline icons use Tabler's rounded
 * 2px line family; filled legacy/document surfaces continue to use Phosphor.
 */

import { forwardRef, type SVGProps } from 'react';
import { Icon, type IconName } from './Icon';
import { SolidIcon, type SolidIconName } from './SolidIcon';
import { TablerIcon, type TablerIconName } from './TablerIcon';

export type SemanticIconName =
  | 'Add'
  | 'Delete'
  | 'Close'
  | 'Check'
  | 'Search'
  | 'Settings'
  | 'More'
  | 'Menu'
  | 'Undo'
  | 'Redo'
  | 'Copy'
  | 'Download'
  | 'Upload'
  | 'Save'
  | 'Lock'
  | 'Unlock'
  | 'Pin'
  | 'Unpin'
  | 'Visible'
  | 'Hidden'
  | 'Edit'
  | 'Star'
  | 'Bookmark'
  | 'BookmarkFilled'
  | 'Warning'
  | 'Success'
  | 'Error'
  | 'Info'
  | 'Spinner'
  | 'Filter'
  | 'ExternalLink'
  | 'Archive'
  | 'History'
  | 'Home'
  | 'Back'
  | 'Forward'
  | 'Up'
  | 'Down'
  | 'Previous'
  | 'Next'
  | 'Expand'
  | 'Collapse'
  | 'RotateLeft'
  | 'RotateRight'
  | 'ZoomIn'
  | 'ZoomOut'
  | 'Select'
  | 'Frame'
  | 'Rectangle'
  | 'Ellipse'
  | 'Polygon'
  | 'Line'
  | 'Pen'
  | 'Pencil'
  | 'Text'
  | 'Image'
  | 'Hand'
  | 'Eyedropper'
  | 'Eraser'
  | 'Crop'
  | 'Paint'
  | 'Warp'
  | 'Transform'
  | 'Scale'
  | 'Rotate'
  | 'Lasso'
  | 'Brush'
  | 'Slice'
  | 'Table'
  | 'Prototype'
  | 'Workspace'
  | 'Team'
  | 'User'
  | 'Union'
  | 'Subtract'
  | 'Intersect'
  | 'Exclude'
  | 'AlignLeft'
  | 'AlignCenter'
  | 'AlignRight'
  | 'AlignJustify'
  | 'Bold'
  | 'Italic'
  | 'Underline'
  | 'Strikethrough'
  | 'FontSize'
  | 'Grid'
  | 'ListView'
  | 'Rows'
  | 'Columns'
  | 'Sidebar'
  | 'Layout'
  | 'Component'
  | 'Layers'
  | 'FileText'
  | 'Folder'
  | 'FolderOpen'
  | 'Code'
  | 'Palette'
  | 'Ruler'
  | 'Printer'
  | 'Link'
  | 'Globe'
  | 'Calendar'
  | 'Bell'
  | 'Clock'
  | 'Play'
  | 'Pause'
  | 'Crosshair'
  | 'Grip'
  | 'Fire'
  | 'Sparkle'
  | 'Heart';

export type IconFamily = 'outline' | 'filled';
export type IconSizeToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const ICON_SIZE_TOKENS: Record<IconSizeToken, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export interface SemanticIconEntry {
  outline: IconName;
  filled: SolidIconName;
}

/** Tabler outline + Phosphor filled implementations for each concept. */
export const SEMANTIC_ICONS = {
  Add: { outline: 'Plus', filled: 'Plus' },
  Delete: { outline: 'Trash2', filled: 'Trash' },
  Close: { outline: 'X', filled: 'X' },
  Check: { outline: 'Check', filled: 'Check' },
  Search: { outline: 'Search', filled: 'MagnifyingGlass' },
  Settings: { outline: 'Settings', filled: 'Gear' },
  More: { outline: 'Ellipsis', filled: 'DotsThree' },
  Menu: { outline: 'Menu', filled: 'List' },
  Undo: { outline: 'Undo2', filled: 'ArrowUUpLeft' },
  Redo: { outline: 'Redo2', filled: 'ArrowUUpRight' },
  Copy: { outline: 'Copy', filled: 'Copy' },
  Download: { outline: 'Download', filled: 'Download' },
  Upload: { outline: 'Upload', filled: 'Upload' },
  Save: { outline: 'Save', filled: 'FloppyDisk' },
  Lock: { outline: 'Lock', filled: 'Lock' },
  Unlock: { outline: 'LockOpen', filled: 'LockOpen' },
  Pin: { outline: 'Pin', filled: 'PushPin' },
  Unpin: { outline: 'PinOff', filled: 'PushPinSlash' },
  Visible: { outline: 'Eye', filled: 'Eye' },
  Hidden: { outline: 'EyeOff', filled: 'EyeSlash' },
  Edit: { outline: 'Pen', filled: 'PencilSimple' },
  Star: { outline: 'Star', filled: 'Star' },
  Bookmark: { outline: 'Bookmark', filled: 'Bookmark' },
  BookmarkFilled: { outline: 'Bookmark', filled: 'BookmarkSimple' },
  Warning: { outline: 'TriangleAlert', filled: 'Warning' },
  Success: { outline: 'CircleCheckBig', filled: 'CheckCircle' },
  Error: { outline: 'CircleX', filled: 'XCircle' },
  Info: { outline: 'Info', filled: 'Info' },
  Spinner: { outline: 'LoaderCircle', filled: 'CircleHalf' },
  Filter: { outline: 'ListFilter', filled: 'Funnel' },
  ExternalLink: { outline: 'ExternalLink', filled: 'ArrowSquareOut' },
  Archive: { outline: 'Archive', filled: 'Archive' },
  History: { outline: 'ClockArrowUp', filled: 'ClockCounterClockwise' },
  Home: { outline: 'House', filled: 'House' },
  Back: { outline: 'ArrowLeft', filled: 'ArrowLeft' },
  Forward: { outline: 'ArrowRight', filled: 'ArrowRight' },
  Up: { outline: 'ChevronUp', filled: 'CaretUp' },
  Down: { outline: 'ChevronDown', filled: 'CaretDown' },
  Previous: { outline: 'ChevronLeft', filled: 'CaretLeft' },
  Next: { outline: 'ChevronRight', filled: 'CaretRight' },
  Expand: { outline: 'Maximize2', filled: 'CornersOut' },
  Collapse: { outline: 'Minimize2', filled: 'CornersIn' },
  RotateLeft: { outline: 'RotateCcw', filled: 'ArrowCounterClockwise' },
  RotateRight: { outline: 'RotateCw', filled: 'ArrowClockwise' },
  ZoomIn: { outline: 'ZoomIn', filled: 'MagnifyingGlassPlus' },
  ZoomOut: { outline: 'ZoomOut', filled: 'MagnifyingGlassMinus' },
  Select: { outline: 'MousePointer2', filled: 'Cursor' },
  Frame: { outline: 'Frame', filled: 'FrameCorners' },
  Rectangle: { outline: 'Square', filled: 'Square' },
  Ellipse: { outline: 'Circle', filled: 'Circle' },
  Polygon: { outline: 'Pentagon', filled: 'Triangle' },
  Line: { outline: 'Minus', filled: 'Minus' },
  Pen: { outline: 'Pen', filled: 'Pen' },
  Pencil: { outline: 'Pencil', filled: 'PencilSimple' },
  Text: { outline: 'Type', filled: 'TextT' },
  Image: { outline: 'Image', filled: 'Image' },
  Hand: { outline: 'Hand', filled: 'Hand' },
  Eyedropper: { outline: 'Pipette', filled: 'Eyedropper' },
  Eraser: { outline: 'Eraser', filled: 'Eraser' },
  Crop: { outline: 'Crop', filled: 'Crop' },
  Paint: { outline: 'Brush', filled: 'PaintBrush' },
  Warp: { outline: 'Spline', filled: 'GridFour' },
  Transform: { outline: 'Maximize2', filled: 'ArrowsOut' },
  Scale: { outline: 'Maximize2', filled: 'ArrowsOut' },
  Rotate: { outline: 'RotateCw', filled: 'ArrowClockwise' },
  Lasso: { outline: 'LassoSelect', filled: 'SelectionForeground' },
  Brush: { outline: 'Brush', filled: 'PaintBrush' },
  Slice: { outline: 'Scissors', filled: 'Scissors' },
  Table: { outline: 'Table', filled: 'Table' },
  Prototype: { outline: 'Play', filled: 'Play' },
  Workspace: { outline: 'PanelsTopLeft', filled: 'Layout' },
  Team: { outline: 'Users', filled: 'Users' },
  User: { outline: 'User', filled: 'User' },
  Union: { outline: 'Combine', filled: 'ArrowsOut' },
  Subtract: { outline: 'Diff', filled: 'Minus' },
  Intersect: { outline: 'Blend', filled: 'ArrowsIn' },
  Exclude: { outline: 'CircleX', filled: 'XCircle' },
  AlignLeft: { outline: 'TextAlignStart', filled: 'AlignLeft' },
  AlignCenter: { outline: 'TextAlignCenter', filled: 'AlignCenterHorizontal' },
  AlignRight: { outline: 'TextAlignEnd', filled: 'AlignRight' },
  AlignJustify: { outline: 'TextAlignJustify', filled: 'TextAlignJustify' },
  Bold: { outline: 'Bold', filled: 'TextB' },
  Italic: { outline: 'Italic', filled: 'TextItalic' },
  Underline: { outline: 'Underline', filled: 'TextUnderline' },
  Strikethrough: { outline: 'Strikethrough', filled: 'TextStrikethrough' },
  FontSize: { outline: 'Type', filled: 'TextAa' },
  Grid: { outline: 'LayoutGrid', filled: 'SquaresFour' },
  ListView: { outline: 'List', filled: 'List' },
  Rows: { outline: 'Rows2', filled: 'Rows' },
  Columns: { outline: 'Columns2', filled: 'Columns' },
  Sidebar: { outline: 'PanelLeft', filled: 'Sidebar' },
  Layout: { outline: 'PanelTop', filled: 'Layout' },
  Component: { outline: 'Component', filled: 'PuzzlePiece' },
  Layers: { outline: 'Layers', filled: 'SelectionBackground' },
  FileText: { outline: 'FileText', filled: 'FileText' },
  Folder: { outline: 'Folder', filled: 'Folder' },
  FolderOpen: { outline: 'FolderOpen', filled: 'FolderOpen' },
  Code: { outline: 'Code', filled: 'Code' },
  Palette: { outline: 'Palette', filled: 'Palette' },
  Ruler: { outline: 'Ruler', filled: 'Ruler' },
  Printer: { outline: 'Printer', filled: 'Printer' },
  Link: { outline: 'Link', filled: 'Link' },
  Globe: { outline: 'Globe', filled: 'Globe' },
  Calendar: { outline: 'Calendar', filled: 'Calendar' },
  Bell: { outline: 'Bell', filled: 'Bell' },
  Clock: { outline: 'Clock', filled: 'Clock' },
  Play: { outline: 'Play', filled: 'Play' },
  Pause: { outline: 'Pause', filled: 'Pause' },
  Crosshair: { outline: 'Crosshair', filled: 'Crosshair' },
  Grip: { outline: 'GripVertical', filled: 'DotsSixVertical' },
  Fire: { outline: 'Flame', filled: 'Fire' },
  Sparkle: { outline: 'Sparkles', filled: 'Sparkle' },
  Heart: { outline: 'Heart', filled: 'Heart' },
} as const satisfies Record<SemanticIconName, SemanticIconEntry>;

/** Tabler coverage for the current homepage and workspace chrome migration. */
const TABLER_SEMANTIC_ICONS: Partial<Record<SemanticIconName, TablerIconName>> = {
  Add: 'Plus',
  Delete: 'Trash',
  Close: 'X',
  Check: 'Check',
  Search: 'Search',
  Settings: 'Settings',
  More: 'Dots',
  Menu: 'Menu',
  Back: 'ArrowLeft',
  Up: 'ChevronUp',
  Down: 'ChevronDown',
  Edit: 'Edit',
  Star: 'Star',
  Filter: 'Filter',
  Image: 'Image',
  Workspace: 'Workspace',
  Team: 'Users',
  User: 'User',
  FileText: 'FileText',
  Folder: 'Folder',
  Grid: 'LayoutGrid',
  Layout: 'LayoutDashboard',
  Paint: 'Brush',
  Brush: 'Brush',
  Printer: 'Printer',
  Code: 'Code',
  Play: 'Play',
};

export const DIRECTIONAL_ICONS: ReadonlySet<SemanticIconName> = new Set([
  'Back',
  'Forward',
  'Undo',
  'Redo',
  'Previous',
  'Next',
  'RotateLeft',
  'RotateRight',
]);

const BANNED_SUFFIX_PATTERNS: RegExp[] = [/Alt$/i, /\d+$/i];
const BANNED_NAMES: ReadonlySet<string> = new Set(['Arrow', 'Action', 'New', 'Generic']);

export interface SemanticIconViolation {
  name: string;
  reason: string;
}

export function validateSemanticIconNames(): SemanticIconViolation[] {
  const violations: SemanticIconViolation[] = [];
  const names = Object.keys(SEMANTIC_ICONS) as SemanticIconName[];
  if (new Set(names).size !== names.length) {
    violations.push({ name: '<registry>', reason: 'duplicate semantic names' });
  }
  for (const name of names) {
    if (!/^[A-Z][A-Za-z]*$/.test(name)) {
      violations.push({ name, reason: 'must be PascalCase letters only' });
    }
    if (BANNED_SUFFIX_PATTERNS.some((re) => re.test(name))) {
      violations.push({ name, reason: 'ambiguous suffix (Alt / numeric) is banned' });
    }
    if (BANNED_NAMES.has(name)) {
      violations.push({ name, reason: 'generic name is banned' });
    }
  }
  return violations;
}

export function resolveSemanticIcon(
  name: SemanticIconName,
  family: IconFamily = 'outline',
): IconName | SolidIconName {
  return SEMANTIC_ICONS[name][family];
}

export function isDirectionalIcon(name: SemanticIconName): boolean {
  return DIRECTIONAL_ICONS.has(name);
}

export interface SemanticIconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'size'> {
  name: SemanticIconName;
  family?: IconFamily;
  size?: number | string | IconSizeToken;
  label?: string;
  mirror?: boolean;
}

function sizeToValue(size: number | string | IconSizeToken): number | string {
  return typeof size === 'string' && size in ICON_SIZE_TOKENS
    ? ICON_SIZE_TOKENS[size as IconSizeToken]
    : size;
}

/** Semantic icon primitive backed by Tabler outline icons by default. */
export const SemanticIcon = forwardRef<SVGSVGElement, SemanticIconProps>(function SemanticIcon(
  { name, family = 'outline', size = 'md', label, mirror, className, strokeWidth, style, ...rest },
  ref,
) {
  const entry = SEMANTIC_ICONS[name] ?? SEMANTIC_ICONS.Add;
  const pixelSize = sizeToValue(size);
  const mirroredStyle = mirror ? { transform: 'scaleX(-1)', ...style } : style;
  const common = {
    ref,
    label,
    className: `varve-semantic-icon${className ? ` ${className}` : ''}`,
    style: mirroredStyle,
    ...rest,
  };
  if (family === 'filled') {
    return <SolidIcon {...common} name={entry.filled} size={pixelSize} />;
  }
  const tablerName = TABLER_SEMANTIC_ICONS[name];
  if (tablerName) {
    return (
      <TablerIcon {...common} name={tablerName} size={pixelSize} strokeWidth={strokeWidth ?? 2} />
    );
  }
  return <Icon {...common} name={entry.outline} size={pixelSize} strokeWidth={strokeWidth ?? 2} />;
});
