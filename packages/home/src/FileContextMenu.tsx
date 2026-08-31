import type { FileEntry, Project } from '@varve/platform';
import { ContextMenu, type MenuEntry, type OverlayAnchor, type ViewportPoint } from '@varve/ui';

export type FileMenuAction =
  | 'open'
  | 'rename'
  | 'duplicate'
  | 'favorite'
  | 'trash'
  | 'restore'
  | 'purge'
  | 'pin'
  | 'reveal'
  | 'export'
  | 'locate'
  | 'remove'
  | 'versions'
  | 'hide'
  | 'unhide'
  | 'move-earlier'
  | 'move-later';

export interface FileContextMenuProps {
  file: FileEntry;
  /** Explicit element/viewport anchor. `position` remains for old embedders. */
  anchor?: OverlayAnchor | null;
  position?: ViewportPoint | { x: number; y: number };
  onAction: (action: FileMenuAction) => void;
  onMoveToProject: (projectId: string | null) => void;
  onClose: () => void;
  projects: Project[];
  isTrash?: boolean;
  isMissing?: boolean;
  /** True when the file is hidden from the Recent view. */
  isHidden?: boolean;
  /**
   * Non-drag alternative for manual ("ordering") sort (WCAG 2.2 SC 2.5.7
   * Dragging Movements): whether this file has a neighbor in that direction
   * to swap with. Both default true so callers that don't track adjacency
   * (e.g. trash/missing views, where these items aren't offered) are unaffected.
   */
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
}

export function FileContextMenu({
  file,
  anchor,
  position,
  onAction,
  onMoveToProject,
  onClose,
  projects,
  isTrash = false,
  isMissing = false,
  isHidden = false,
  canMoveEarlier = true,
  canMoveLater = true,
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
      focusTransfer: 'dialog',
    });
  } else {
    items.push({ id: 'open', label: 'Open', onAction: () => onAction('open') });
    items.push({ id: 'sep1', separator: true });
    items.push({
      id: 'rename',
      label: 'Rename',
      onAction: () => onAction('rename'),
      dialog: true,
      focusTransfer: 'dialog',
    });
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
    items.push({ id: 'sep2b', separator: true });
    items.push({
      id: 'move-earlier',
      label: 'Move earlier in order',
      onAction: () => onAction('move-earlier'),
      disabled: !canMoveEarlier,
    });
    items.push({
      id: 'move-later',
      label: 'Move later in order',
      onAction: () => onAction('move-later'),
      disabled: !canMoveLater,
    });
    items.push({ id: 'sep3', separator: true });
    items.push({
      id: 'favorite',
      label:
        file.favoritedAt && file.favoritedAt > 0 ? 'Remove from Favorites' : 'Add to Favorites',
      onAction: () => onAction('favorite'),
    });
    items.push({
      id: 'pin',
      label: file.pinned ? 'Unpin' : 'Pin',
      onAction: () => onAction('pin'),
    });
    items.push({
      id: 'hide',
      label: isHidden ? 'Show in Recent' : 'Hide from Recent',
      onAction: () => onAction('hide'),
    });
    items.push({ id: 'sep4', separator: true });
    items.push({
      id: 'versions',
      label: 'Version History...',
      onAction: () => onAction('versions'),
    });
    items.push({ id: 'sep5', separator: true });
    items.push({
      id: 'reveal',
      label: 'Show in Folder',
      onAction: () => onAction('reveal'),
    });
    items.push({
      id: 'trash',
      label: 'Move to Trash',
      onAction: () => onAction('trash'),
      dialog: true,
      focusTransfer: 'dialog',
    });
  }

  return (
    <ContextMenu
      items={items}
      anchor={anchor}
      position={position}
      onClose={onClose}
      label={`File actions for ${file.name}`}
    />
  );
}
