/**
 * Strata semantic icon registry — the canonical API for internal UI icons.
 *
 * Feature code MUST NOT import icon components from third-party libraries or
 * reference raw third-party names. Instead it references a semantic name
 * (`Delete`, `Search`, `Union`) through `SemanticIcon` or
 * `resolveSemanticIcon`. The registry keeps the legacy Lucide and Phosphor
 * implementations for compatibility, while the canonical `huge` family is
 * rendered with the tree-shakeable Hugeicons Stroke Rounded pack.
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

import {
  AddCircleIcon,
  Alert02Icon,
  AlignSelectionIcon,
  Archive02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  BendToolIcon,
  Bookmark02Icon,
  BrushIcon,
  Calendar01Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  ChevronDown,
  ChevronUp,
  Clock01Icon,
  CodeIcon,
  ColumnInsertIcon,
  Copy01Icon,
  CropIcon,
  Cursor02Icon,
  Delete02Icon,
  Download01Icon,
  Drag01Icon,
  DropperIcon,
  EllipseSelectionIcon,
  Eraser01Icon,
  File01Icon,
  FileEditIcon,
  FilterHorizontalIcon,
  FireIcon,
  FloppyDiskIcon,
  Folder01Icon,
  FolderOpenIcon,
  FramerIcon,
  GlobalIcon,
  HandGripIcon,
  HeartAddIcon,
  Home01Icon,
  Image01Icon,
  InformationCircleIcon,
  InputCursorTextIcon,
  Layers01Icon,
  Layout01Icon,
  LayoutGridIcon,
  Link01Icon,
  ListViewIcon,
  Loading03Icon,
  LockIcon,
  Maximize02Icon,
  Menu01Icon,
  Minimize02Icon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Mouse02Icon,
  Notification01Icon,
  PaintBoardIcon,
  PaintBrush01Icon,
  PanelLeftIcon,
  PathfinderExcludeIcon,
  PathfinderIntersectIcon,
  PathfinderMinusFrontIcon,
  PathfinderUniteIcon,
  PauseIcon,
  Pen01Icon,
  PencilEdit01Icon,
  PentagonIcon,
  PlayIcon,
  PlusSignIcon,
  PrinterIcon,
  PuzzleIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
  RulerIcon,
  ScissorIcon,
  Search01Icon,
  Settings01Icon,
  Square01Icon,
  StarIcon,
  TableIcon,
  TextAlignCenterIcon,
  TextAlignJustifyLeftIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBoldIcon,
  TextIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
  Tick02Icon,
  Undo02Icon,
  Upload01Icon,
  UserGroupIcon,
  UserIcon,
  ViewIcon,
  ViewOffIcon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
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

/** Icon visual family. Hugeicons is the canonical migrated family. */
export type IconFamily = 'huge' | 'outline' | 'filled';

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
  /** Canonical implementation used by migrated product surfaces. */
  huge: IconSvgElement;
  /** Legacy implementations retained while unmigrated surfaces converge. */
  outline: IconName;
  filled: SolidIconName;
}

/**
 * Semantic → implementation registry. The legacy implementations remain
 * typed so unmigrated callers can converge incrementally; Hugeicons is the
 * canonical implementation for new and migrated surfaces.
 */
export const SEMANTIC_ICONS = {
  // Actions
  Add: { huge: PlusSignIcon, outline: 'Plus', filled: 'Plus' },
  Delete: { huge: Delete02Icon, outline: 'Trash2', filled: 'Trash' },
  Close: { huge: Cancel01Icon, outline: 'X', filled: 'X' },
  Check: { huge: Tick02Icon, outline: 'Check', filled: 'Check' },
  Search: { huge: Search01Icon, outline: 'Search', filled: 'MagnifyingGlass' },
  Settings: { huge: Settings01Icon, outline: 'Settings', filled: 'Gear' },
  More: { huge: MoreHorizontalIcon, outline: 'Ellipsis', filled: 'DotsThree' },
  Menu: { huge: Menu01Icon, outline: 'Menu', filled: 'List' },
  Undo: { huge: Undo02Icon, outline: 'Undo2', filled: 'ArrowUUpLeft' },
  Redo: { huge: Undo02Icon, outline: 'Redo2', filled: 'ArrowUUpRight' },
  Copy: { huge: Copy01Icon, outline: 'Copy', filled: 'Copy' },
  Download: { huge: Download01Icon, outline: 'Download', filled: 'Download' },
  Upload: { huge: Upload01Icon, outline: 'Upload', filled: 'Upload' },
  Save: { huge: FloppyDiskIcon, outline: 'Save', filled: 'FloppyDisk' },
  Lock: { huge: LockIcon, outline: 'Lock', filled: 'Lock' },
  Unlock: { huge: LockIcon, outline: 'LockOpen', filled: 'LockOpen' },
  Pin: { huge: Bookmark02Icon, outline: 'Pin', filled: 'PushPin' },
  Unpin: { huge: Bookmark02Icon, outline: 'PinOff', filled: 'PushPinSlash' },
  Visible: { huge: ViewIcon, outline: 'Eye', filled: 'Eye' },
  Hidden: { huge: ViewOffIcon, outline: 'EyeOff', filled: 'EyeSlash' },
  Edit: { huge: FileEditIcon, outline: 'Pen', filled: 'PencilSimple' },
  Star: { huge: StarIcon, outline: 'Star', filled: 'Star' },
  Bookmark: { huge: Bookmark02Icon, outline: 'Bookmark', filled: 'Bookmark' },
  BookmarkFilled: { huge: Bookmark02Icon, outline: 'Bookmark', filled: 'BookmarkSimple' },
  Warning: { huge: Alert02Icon, outline: 'TriangleAlert', filled: 'Warning' },
  Success: { huge: CheckmarkCircle02Icon, outline: 'CircleCheckBig', filled: 'CheckCircle' },
  Error: { huge: CancelCircleIcon, outline: 'CircleX', filled: 'XCircle' },
  Info: { huge: InformationCircleIcon, outline: 'Info', filled: 'Info' },
  Spinner: { huge: Loading03Icon, outline: 'LoaderCircle', filled: 'CircleHalf' },
  Filter: { huge: FilterHorizontalIcon, outline: 'ListFilter', filled: 'Funnel' },
  ExternalLink: { huge: ArrowUpRight01Icon, outline: 'ExternalLink', filled: 'ArrowSquareOut' },
  Archive: { huge: Archive02Icon, outline: 'Archive', filled: 'Archive' },
  History: { huge: Clock01Icon, outline: 'ClockArrowUp', filled: 'ClockCounterClockwise' },
  // Navigation
  Home: { huge: Home01Icon, outline: 'House', filled: 'House' },
  Back: { huge: ArrowLeft01Icon, outline: 'ArrowLeft', filled: 'ArrowLeft' },
  Forward: { huge: ArrowRight01Icon, outline: 'ArrowRight', filled: 'ArrowRight' },
  Up: { huge: ChevronUp, outline: 'ChevronUp', filled: 'CaretUp' },
  Down: { huge: ChevronDown, outline: 'ChevronDown', filled: 'CaretDown' },
  Previous: { huge: ArrowLeft01Icon, outline: 'ChevronLeft', filled: 'CaretLeft' },
  Next: { huge: ArrowRight01Icon, outline: 'ChevronRight', filled: 'CaretRight' },
  Expand: { huge: Maximize02Icon, outline: 'Maximize2', filled: 'CornersOut' },
  Collapse: { huge: Minimize02Icon, outline: 'Minimize2', filled: 'CornersIn' },
  RotateLeft: { huge: RotateLeft01Icon, outline: 'RotateCcw', filled: 'ArrowCounterClockwise' },
  RotateRight: { huge: RotateRight01Icon, outline: 'RotateCw', filled: 'ArrowClockwise' },
  ZoomIn: { huge: ZoomInAreaIcon, outline: 'ZoomIn', filled: 'MagnifyingGlassPlus' },
  ZoomOut: { huge: ZoomOutAreaIcon, outline: 'ZoomOut', filled: 'MagnifyingGlassMinus' },
  // Tools
  Select: { huge: Mouse02Icon, outline: 'MousePointer2', filled: 'Cursor' },
  Frame: { huge: FramerIcon, outline: 'Frame', filled: 'FrameCorners' },
  Rectangle: { huge: Square01Icon, outline: 'Square', filled: 'Square' },
  Ellipse: { huge: EllipseSelectionIcon, outline: 'Circle', filled: 'Circle' },
  Polygon: { huge: PentagonIcon, outline: 'Pentagon', filled: 'Triangle' },
  Line: { huge: MinusSignIcon, outline: 'Minus', filled: 'Minus' },
  Pen: { huge: Pen01Icon, outline: 'Pen', filled: 'Pen' },
  Pencil: { huge: PencilEdit01Icon, outline: 'Pencil', filled: 'PencilSimple' },
  Text: { huge: TextIcon, outline: 'Type', filled: 'TextT' },
  Image: { huge: Image01Icon, outline: 'Image', filled: 'Image' },
  Hand: { huge: HandGripIcon, outline: 'Hand', filled: 'Hand' },
  Eyedropper: { huge: DropperIcon, outline: 'Pipette', filled: 'Eyedropper' },
  Eraser: { huge: Eraser01Icon, outline: 'Eraser', filled: 'Eraser' },
  Crop: { huge: CropIcon, outline: 'Crop', filled: 'Crop' },
  Paint: { huge: PaintBrush01Icon, outline: 'Brush', filled: 'PaintBrush' },
  Warp: { huge: BendToolIcon, outline: 'Grid3x3', filled: 'GridFour' },
  Transform: { huge: Maximize02Icon, outline: 'Maximize2', filled: 'ArrowsOut' },
  Scale: { huge: Maximize02Icon, outline: 'Maximize2', filled: 'ArrowsOut' },
  Rotate: { huge: RotateRight01Icon, outline: 'RotateCw', filled: 'ArrowClockwise' },
  Lasso: { huge: Cursor02Icon, outline: 'LassoSelect', filled: 'SelectionForeground' },
  Brush: { huge: BrushIcon, outline: 'Brush', filled: 'PaintBrush' },
  Slice: { huge: ScissorIcon, outline: 'Scissors', filled: 'Scissors' },
  Table: { huge: TableIcon, outline: 'Table', filled: 'Table' },
  Prototype: { huge: PlayIcon, outline: 'Play', filled: 'Play' },
  Workspace: { huge: Layout01Icon, outline: 'PanelTop', filled: 'Layout' },
  Team: { huge: UserGroupIcon, outline: 'Users', filled: 'Users' },
  User: { huge: UserIcon, outline: 'User', filled: 'User' },
  // Boolean operations
  Union: { huge: PathfinderUniteIcon, outline: 'Combine', filled: 'ArrowsOut' },
  Subtract: { huge: PathfinderMinusFrontIcon, outline: 'Diff', filled: 'Minus' },
  Intersect: { huge: PathfinderIntersectIcon, outline: 'Combine', filled: 'ArrowsIn' },
  Exclude: { huge: PathfinderExcludeIcon, outline: 'Diff', filled: 'XCircle' },
  // Text / layout
  AlignLeft: { huge: TextAlignLeftIcon, outline: 'TextAlignStart', filled: 'AlignLeft' },
  AlignCenter: {
    huge: TextAlignCenterIcon,
    outline: 'TextAlignCenter',
    filled: 'AlignCenterHorizontal',
  },
  AlignRight: { huge: TextAlignRightIcon, outline: 'TextAlignEnd', filled: 'AlignRight' },
  AlignJustify: {
    huge: TextAlignJustifyLeftIcon,
    outline: 'TextAlignJustify',
    filled: 'TextAlignJustify',
  },
  Bold: { huge: TextBoldIcon, outline: 'Bold', filled: 'TextB' },
  Italic: { huge: TextItalicIcon, outline: 'Italic', filled: 'TextItalic' },
  Underline: { huge: TextUnderlineIcon, outline: 'Underline', filled: 'TextUnderline' },
  Strikethrough: {
    huge: TextStrikethroughIcon,
    outline: 'Strikethrough',
    filled: 'TextStrikethrough',
  },
  FontSize: { huge: InputCursorTextIcon, outline: 'Type', filled: 'TextAa' },
  Grid: { huge: LayoutGridIcon, outline: 'LayoutGrid', filled: 'SquaresFour' },
  ListView: { huge: ListViewIcon, outline: 'List', filled: 'List' },
  Rows: { huge: Layout01Icon, outline: 'Rows2', filled: 'Rows' },
  Columns: { huge: ColumnInsertIcon, outline: 'Columns2', filled: 'Columns' },
  Sidebar: { huge: PanelLeftIcon, outline: 'PanelLeft', filled: 'Sidebar' },
  Layout: { huge: Layout01Icon, outline: 'PanelTop', filled: 'Layout' },
  Component: { huge: PuzzleIcon, outline: 'Component', filled: 'PuzzlePiece' },
  Layers: { huge: Layers01Icon, outline: 'Layers', filled: 'SelectionBackground' },
  // Files / objects
  FileText: { huge: File01Icon, outline: 'FileText', filled: 'FileText' },
  Folder: { huge: Folder01Icon, outline: 'Folder', filled: 'Folder' },
  FolderOpen: { huge: FolderOpenIcon, outline: 'FolderOpen', filled: 'FolderOpen' },
  Code: { huge: CodeIcon, outline: 'Code', filled: 'Code' },
  Palette: { huge: PaintBoardIcon, outline: 'Palette', filled: 'Palette' },
  Ruler: { huge: RulerIcon, outline: 'Ruler', filled: 'Ruler' },
  Printer: { huge: PrinterIcon, outline: 'Printer', filled: 'Printer' },
  Link: { huge: Link01Icon, outline: 'Link', filled: 'Link' },
  Globe: { huge: GlobalIcon, outline: 'Globe', filled: 'Globe' },
  Calendar: { huge: Calendar01Icon, outline: 'Calendar', filled: 'Calendar' },
  Bell: { huge: Notification01Icon, outline: 'Bell', filled: 'Bell' },
  Clock: { huge: Clock01Icon, outline: 'Clock', filled: 'Clock' },
  Play: { huge: PlayIcon, outline: 'Play', filled: 'Play' },
  Pause: { huge: PauseIcon, outline: 'Pause', filled: 'Pause' },
  Crosshair: { huge: AlignSelectionIcon, outline: 'Crosshair', filled: 'Crosshair' },
  Grip: { huge: Drag01Icon, outline: 'GripVertical', filled: 'DotsSixVertical' },
  Fire: { huge: FireIcon, outline: 'Flame', filled: 'Fire' },
  Sparkle: { huge: AddCircleIcon, outline: 'Sparkles', filled: 'Sparkle' },
  Heart: { huge: HeartAddIcon, outline: 'Heart', filled: 'Heart' },
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
    if (!entry.huge || !entry.outline || !entry.filled) {
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
  family: IconFamily = 'huge',
): IconName | SolidIconName | IconSvgElement {
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
  { name, family = 'huge', size = 'md', label, mirror, className, ...rest },
  ref,
) {
  const entry = SEMANTIC_ICONS[name] ?? SEMANTIC_ICONS.Add;
  if (
    !SEMANTIC_ICONS[name] &&
    typeof console !== 'undefined' &&
    process.env.NODE_ENV !== 'production'
  ) {
    console.error(`[SemanticIcon] missing icon mapping for "${name}"; using Add as fallback`);
  }
  if (mirror && !DIRECTIONAL_ICONS.has(name)) {
    if (typeof console !== 'undefined' && process.env.NODE_ENV !== 'production') {
      console.warn(`[SemanticIcon] mirror on non-directional icon "${name}" is a semantic bug`);
    }
  }
  const style = mirror ? { transform: 'scaleX(-1)', ...rest.style } : rest.style;
  const pixelSize = sizeToValue(size);
  if (family === 'huge') {
    const hugeStyle =
      typeof pixelSize === 'string' ? { ...style, width: pixelSize, height: pixelSize } : style;
    return (
      <HugeiconsIcon
        ref={ref}
        icon={entry.huge}
        size={typeof pixelSize === 'number' ? pixelSize : 16}
        color="currentColor"
        strokeWidth={1.5}
        className={`varve-semantic-icon${className ? ` ${className}` : ''}`}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable={false}
        {...rest}
        style={hugeStyle}
      />
    );
  }
  if (family === 'filled') {
    return (
      <SolidIcon
        ref={ref}
        name={entry.filled}
        size={pixelSize}
        label={label}
        className={className}
        {...rest}
        style={style}
      />
    );
  }
  return (
    <Icon
      ref={ref}
      name={entry.outline}
      size={pixelSize}
      label={label}
      className={className}
      {...rest}
      style={style}
    />
  );
});
