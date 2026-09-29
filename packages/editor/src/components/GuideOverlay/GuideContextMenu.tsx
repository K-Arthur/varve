import { ContextMenu, type MenuEntry, type OverlayAnchor } from '@varve/ui';
import { useCallback } from 'react';
import './GuideContextMenu.css';

interface GuideContextMenuProps {
  anchor?: OverlayAnchor | null;
  x?: number;
  y?: number;
  guideId: string;
  isLocked: boolean;
  perspectiveGuideVisible?: boolean;
  onToggleLock: (id: string) => void;
  onTogglePerspectiveGuide?: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function GuideContextMenu({
  anchor,
  x,
  y,
  guideId,
  isLocked,
  perspectiveGuideVisible = false,
  onToggleLock,
  onTogglePerspectiveGuide,
  onRemove,
  onClose,
}: GuideContextMenuProps) {
  const handleToggleLock = useCallback(() => {
    onToggleLock(guideId);
  }, [guideId, onToggleLock]);

  const handleRemove = useCallback(() => {
    onRemove(guideId);
  }, [guideId, onRemove]);

  const handleTogglePerspectiveGuide = useCallback(() => {
    onTogglePerspectiveGuide?.();
  }, [onTogglePerspectiveGuide]);

  const items: MenuEntry[] = [
    { id: 'guide-label', label: 'Guide', type: 'label' },
    ...(onTogglePerspectiveGuide
      ? [
          {
            id: 'toggle-perspective-guide',
            label: perspectiveGuideVisible
              ? 'Hide two-point perspective guide'
              : 'Show two-point perspective guide',
            onAction: handleTogglePerspectiveGuide,
          },
        ]
      : []),
    {
      id: 'toggle-lock',
      label: isLocked ? 'Unlock' : 'Lock',
      icon: isLocked ? 'LockOpen' : 'Lock',
      onAction: handleToggleLock,
    },
    { id: 'danger-label', label: 'Danger Zone', type: 'label', danger: true },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      destructive: true,
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
      size="compact"
    />
  );
}
