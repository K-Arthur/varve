/**
 * Strata semantic icon registry — the canonical API for internal UI icons.
 *
 * Feature code MUST NOT import icon components from third-party libraries or
 * reference raw third-party names. Instead it references a semantic name
 * (`Delete`, `Search`, `Union`) through `SemanticIcon` or
 * `resolveSemanticIcon`. The registry maps each semantic name to an outline
 * (Lucide) and filled (Phosphor) implementation; swapping the visual
 * representation of a concept updates exactly one table entry.
 *
 * Naming rules (enforced by `validateSemanticIconNames`):
 * - Action/concept names, not visual descriptions: `Delete`, not
 *   `TrashCanOutlineIcon`.
 * - No ambiguous suffixes: `Alt`, numeric disambiguators (`Add2`), or
 *   generic names (`Arrow`, `IconNew`, `GenericAction`).
 * - PascalCase; unique across the registry.
 *
 * Directional icons that should flip in RTL must be marked via the
 * `DIRECTIONAL_ICONS` set and rendered with `mirror` by directional
 * containers. Icons whose meaning is not directional must NOT be mirrored.
 */

import { forwardRef, type SVGProps } from 'react';
import { Icon, type IconName } from './Icon';
import { SolidIcon, type SolidIconName } from './SolidIcon';

// ---------------------------------------------------------------------------
// Semantic names
// ---------------------------------------------------------------------------

export type SemanticIconName =
  // Actions
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
  // Navigation
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
  // Tools
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
  // Boolean operations
  | 'Union'
  | 'Subtract'
  | 'Intersect'
  | 'Exclude'
  // Text / layout
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
  // Files / objects
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

/** Icon visual family. 'outline' (Lucide) is the default. */
export type IconFamily = 'outline' | 'filled';

/** Semantic size tokens — avoid scattered pixel values in feature code. */
export type IconSizeToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Token → pixel mapping. `md` (16) is the standard UI icon size. */
export const ICON_SIZE_TOKENS: Record<IconSizeToken, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** One registry entry: the implementation names for both visual families. */
export interface SemanticIconEntry {
  outline: IconName;
  filled: SolidIconName;
}

/**
 * Semantic → implementation registry. Every entry must provide both a Lucide
 * (outline) and a Phosphor (filled) implementation; TypeScript enforces that
 * both names exist in the underlying libraries.
 */
export const SEMANTIC_ICONS = {
  // Actions
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
  // Navigation
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
  // Tools
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
  // Boolean operations
  Union: { outline: 'Combine', filled: 'ArrowsOut' },
  Subtract: { outline: 'Diff', filled: 'Minus' },
  Intersect: { outline: 'Combine', filled: 'ArrowsIn' },
  Exclude: { outline: 'Diff', filled: 'XCircle' },
  // Text / layout
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
  // Files / objects
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

/**
 * Directional icons that flip horizontally in RTL contexts (via `mirror`).
 * Only icons whose *meaning* is directional belong here — e.g. `Back`
 * (physical direction), `Undo`/`Redo` (reading direction). Icons like
 * `Warning` or `Star` must never be mirrored.
 */
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Names that read as visual descriptions or are ambiguous. */
const BANNED_SUFFIX_PATTERNS: RegExp[] = [/Alt$/i, /\d+$/i];

/** Generic names that do not convey a concept. */
const BANNED_NAMES: ReadonlySet<string> = new Set(['Arrow', 'Action', 'New', 'Generic']);

export interface SemanticIconViolation {
  name: string;
  reason: string;
}

/**
 * Validate the registry invariants: every semantic name resolves in both
 * families, names are PascalCase, unique, and free of ambiguous suffixes.
 * Used by tests and dev-time assertions — never in production render paths.
 */
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
    const entry = SEMANTIC_ICONS[name];
    if (!entry.outline || !entry.filled) {
      violations.push({ name, reason: 'missing implementation in one family' });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Resolution helpers
// ---------------------------------------------------------------------------

/** Resolve a semantic name to its implementation name for a family. */
export function resolveSemanticIcon(
  name: SemanticIconName,
  family: IconFamily = 'outline',
): IconName | SolidIconName {
  return SEMANTIC_ICONS[name][family];
}

/** True if the semantic name is in the directional set (RTL mirrors it). */
export function isDirectionalIcon(name: SemanticIconName): boolean {
  return DIRECTIONAL_ICONS.has(name);
}

// ---------------------------------------------------------------------------
// SemanticIcon component
// ---------------------------------------------------------------------------

export interface SemanticIconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'size'> {
  /** Semantic concept name — the only name feature code should use. */
  name: SemanticIconName;
  /** Visual family. Defaults to 'outline' (Lucide). */
  family?: IconFamily;
  /** Pixel size, CSS size, or a semantic size token (default 'md' = 16px). */
  size?: number | string | IconSizeToken;
  /**
   * Accessible name. If provided the icon is exposed as `role="img"` with an
   * `aria-label`. If omitted the icon is marked `aria-hidden` (decorative).
   */
  label?: string;
  /**
   * Flip horizontally for RTL. Only valid for directional icons — using it
   * on a non-directional icon is a semantic bug and is ignored in
   * production while warned in dev.
   */
  mirror?: boolean;
}

function sizeToValue(size: number | string | IconSizeToken): number | string {
  if (size in ICON_SIZE_TOKENS) {
    return ICON_SIZE_TOKENS[size as IconSizeToken];
  }
  return size;
}

/**
 * The single icon component for internal UI. Feature code should prefer this
 * over `<Icon>`/`<SolidIcon>` so that the concept, not the glyph, is what
 * travels through the codebase.
 */
export const SemanticIcon = forwardRef<SVGSVGElement, SemanticIconProps>(function SemanticIcon(
  { name, family = 'outline', size = 'md', label, mirror, ...rest },
  ref,
) {
  const entry = SEMANTIC_ICONS[name];
  if (mirror && !DIRECTIONAL_ICONS.has(name)) {
    if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.warn(`[SemanticIcon] mirror on non-directional icon "${name}" is a semantic bug`);
    }
  }
  const style = mirror ? { transform: 'scaleX(-1)', ...rest.style } : rest.style;
  const pixelSize = sizeToValue(size);
  if (family === 'filled') {
    return (
      <SolidIcon
        ref={ref}
        name={entry.filled}
        size={pixelSize}
        label={label}
        {...rest}
        style={style}
      />
    );
  }
  return (
    <Icon ref={ref} name={entry.outline} size={pixelSize} label={label} {...rest} style={style} />
  );
});
