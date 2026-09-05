import { ContextMenu, type MenuEntry, type OverlayAnchor } from '@varve/ui';
import { useCallback } from 'react';
import './GuideContextMenu.css';

interface GuideContextMenuProps {
  anchor?: OverlayAnchor | null;
  x?: number;
  y?: number;
  guideId: string;
  isLocked: boolean;
  onToggleLock: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function GuideContextMenu({
  anchor,
  x,
  y,
  guideId,
  isLocked,
  onToggleLock,
  onRemove,
  onClose,
}: GuideContextMenuProps) {
  const handleToggleLock = useCallback(() => {
    onToggleLock(guideId);
  }, [guideId, onToggleLock]);

  const handleRemove = useCallback(() => {
    onRemove(guideId);
  }, [guideId, onRemove]);

  const items: MenuEntry[] = [
    {
      id: 'toggle-lock',
      label: isLocked ? 'Unlock' : 'Lock',
      onAction: handleToggleLock,
    },
    { id: 'sep', separator: true },
    {
      id: 'delete',
      label: 'Delete',
      onAction: handleRemove,
    },
  ];

  return (
    <ContextMenu
      items={items}
      anchor={anchor}
      position={anchor ? undefined : x !== undefined && y !== undefined ? { x, y } : null}
      onClose={onClose}
      label="Guide context menu"
    />
  );
}
