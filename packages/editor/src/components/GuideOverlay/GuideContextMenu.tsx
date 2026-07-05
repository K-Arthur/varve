import { ContextMenu, type MenuEntry } from '@strata/ui';
import { useCallback } from 'react';
import './GuideContextMenu.css';

interface GuideContextMenuProps {
  x: number;
  y: number;
  guideId: string;
  isLocked: boolean;
  onToggleLock: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function GuideContextMenu({
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
    <ContextMenu items={items} position={{ x, y }} onClose={onClose} label="Guide context menu" />
  );
}
