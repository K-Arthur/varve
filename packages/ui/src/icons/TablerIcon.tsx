import {
  IconArrowLeft,
  IconBadge,
  IconBrush,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconDots,
  IconDotsVertical,
  IconEdit,
  IconFileText,
  IconFilter,
  IconFolder,
  IconImageInPicture,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconMenu2,
  IconPaint,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconPrinter,
  IconSearch,
  IconSettings,
  IconStar,
  IconTrash,
  IconUser,
  IconUsers,
  IconX,
  type TablerIcon as TablerIconComponent,
} from '@tabler/icons-react';
import { forwardRef, type SVGProps } from 'react';

export type TablerIconName =
  | 'ArrowLeft'
  | 'Badge'
  | 'Brush'
  | 'Check'
  | 'ChevronDown'
  | 'ChevronUp'
  | 'Code'
  | 'Dots'
  | 'DotsVertical'
  | 'Edit'
  | 'FileText'
  | 'Filter'
  | 'Folder'
  | 'Image'
  | 'LayoutDashboard'
  | 'LayoutGrid'
  | 'Menu'
  | 'Paint'
  | 'Photo'
  | 'Play'
  | 'Plus'
  | 'Printer'
  | 'Search'
  | 'Settings'
  | 'Star'
  | 'Trash'
  | 'User'
  | 'Users'
  | 'Workspace'
  | 'X';

const TABLER_ICONS: Record<TablerIconName, TablerIconComponent> = {
  ArrowLeft: IconArrowLeft,
  Badge: IconBadge,
  Brush: IconBrush,
  Check: IconCheck,
  ChevronDown: IconChevronDown,
  ChevronUp: IconChevronUp,
  Code: IconCode,
  Dots: IconDots,
  DotsVertical: IconDotsVertical,
  Edit: IconEdit,
  FileText: IconFileText,
  Filter: IconFilter,
  Folder: IconFolder,
  Image: IconPhoto,
  LayoutDashboard: IconLayoutDashboard,
  LayoutGrid: IconLayoutGrid,
  Menu: IconMenu2,
  Paint: IconPaint,
  Photo: IconImageInPicture,
  Play: IconPlayerPlay,
  Plus: IconPlus,
  Printer: IconPrinter,
  Search: IconSearch,
  Settings: IconSettings,
  Star: IconStar,
  Trash: IconTrash,
  User: IconUser,
  Users: IconUsers,
  Workspace: IconLayoutDashboard,
  X: IconX,
};

export interface TablerIconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'size'> {
  name: TablerIconName;
  size?: number | string;
  label?: string;
  strokeWidth?: number | string;
}

/** Tabler's rounded 2px outline family with Varve's accessible icon contract. */
export const TablerIcon = forwardRef<SVGSVGElement, TablerIconProps>(function TablerIcon(
  { name, size = 16, label, strokeWidth = 2, className, ...rest },
  ref,
) {
  const Component = TABLER_ICONS[name];
  return (
    <Component
      {...rest}
      ref={ref}
      size={size}
      strokeWidth={strokeWidth}
      color="currentColor"
      className={`varve-tabler-icon${className ? ` ${className}` : ''}`}
      data-icon-family="tabler"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
    />
  );
});
