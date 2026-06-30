import type { FileEntry, Project } from '@strata/platform';
import { ContextMenu, type MenuEntry } from '@strata/ui';

export type FileMenuAction =
  | 'open'
  | 'rename'
  | 'duplicate'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'pin'
  | 'reveal'
  | 'export'
  | 'locate'
  | 'remove';

export interface FileContextMenuProps {
  file: FileEntry;
  position: { x: number; y: number };
  onAction: (action: FileMenuAction) => void;
  onMoveToProject: (projectId: string | null) => void;
  onClose: () => void;
  projects: Project[];
  isTrash?: boolean;
  isMissing?: boolean;
}

export function FileContextMenu({
  file,
  position,
  onAction,
  onMoveToProject,
  onClose,
  projects,
  isTrash = false,
  isMissing = false,
}: FileContextMenuProps) {
  const items: MenuEntry[] = [];

  if (isMissing) {
    items.push({ id: 'locate', label: 'Locate file...', onAction: () => onAction('locate') });
    items.push({ id: 'sep1', separator: true });
    items.push({
      id: 'remove',
      label: 'Remove from recents',
      onAction: () => onAction('remove'),
    });
  } else if (isTrash) {
    items.push({ id: 'restore', label: 'Restore', onAction: () => onAction('restore') });
    items.push({ id: 'sep1', separator: true });
    items.push({
      id: 'purge',
      label: 'Delete permanently',
      onAction: () => onAction('purge'),
      dialog: true,
    });
  } else {
    items.push({ id: 'open', label: 'Open', onAction: () => onAction('open') });
    items.push({ id: 'sep1', separator: true });
    items.push({ id: 'rename', label: 'Rename', onAction: () => onAction('rename'), dialog: true });
    items.push({ id: 'duplicate', label: 'Duplicate', onAction: () => onAction('duplicate') });
    if (projects.length > 0) {
      items.push({ id: 'sep2', separator: true });
      for (const proj of projects) {
        items.push({
          id: `move-${proj.id}`,
          label: proj.name,
          onAction: () => onMoveToProject(proj.id),
        });
      }
      items.push({
        id: 'move-none',
        label: 'Unfiled',
        onAction: () => onMoveToProject(null),
      });
    }
    items.push({ id: 'sep3', separator: true });
    items.push({
      id: 'pin',
      label: file.pinned ? 'Unpin' : 'Pin',
      onAction: () => onAction('pin'),
    });
    items.push({ id: 'sep4', separator: true });
    items.push({
      id: 'trash',
      label: 'Move to Trash',
      onAction: () => onAction('trash'),
      dialog: true,
    });
  }

  return (
    <ContextMenu
      items={items}
      position={position}
      onClose={onClose}
      label={`File actions for ${file.name}`}
    />
  );
}
