import type { NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { SOLID_TOOL_ICONS, SolidIcon } from '@varve/ui';
import { useCallback, useEffect, useRef } from 'react';

interface Candidate {
  nodeId: NodeId;
  node: SceneNode;
  depth: number;
}

interface TouchCandidateMenuProps {
  worldX: number;
  worldY: number;
  screenX: number;
  screenY: number;
  candidates: Candidate[];
  onSelect: (nodeId: NodeId) => void;
  onEnterContainer: (nodeId: NodeId) => void;
  onClose: () => void;
}

export function TouchCandidateMenu({
  worldX: _worldX,
  worldY: _worldY,
  screenX,
  screenY,
  candidates,
  onSelect,
  onEnterContainer,
  onClose,
}: TouchCandidateMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleBackdropClick = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleBackdropClick);
    document.addEventListener('touchstart', handleBackdropClick);
    return () => {
      document.removeEventListener('mousedown', handleBackdropClick);
      document.removeEventListener('touchstart', handleBackdropClick);
    };
  }, [handleBackdropClick]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Clamp position to viewport
  const menuWidth = 220;
  const menuHeight = Math.min(candidates.length * 32 + 8, 240);
  const clampedX = Math.max(8, Math.min(screenX, window.innerWidth - menuWidth - 8));
  const clampedY = Math.max(8, Math.min(screenY, window.innerHeight - menuHeight - 8));

  const kindIcon = (node: SceneNode): string => {
    if (node.kind === 'shape' && node.shape?.kind) {
      return (
        SOLID_TOOL_ICONS[node.shape.kind as keyof typeof SOLID_TOOL_ICONS] || SOLID_TOOL_ICONS.rect
      );
    }
    return SOLID_TOOL_ICONS[node.kind as keyof typeof SOLID_TOOL_ICONS] || SOLID_TOOL_ICONS.rect;
  };

  const kindLabel = (node: SceneNode): string => node.kind;

  return (
    <div
      className="touch-candidate-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: 'transparent',
      }}
    >
      <div
        ref={menuRef}
        className="touch-candidate-menu"
        role="menu"
        aria-label="Select nested object"
        style={{
          position: 'fixed',
          left: clampedX,
          top: clampedY,
          width: menuWidth,
          maxHeight: 240,
          overflowY: 'auto',
          background: 'var(--elevation-surface-default)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--space-1)',
        }}
      >
        {candidates.map((candidate) => {
          const node = candidate.node;
          const isCont = isContainer(node);
          return (
            <button
              key={candidate.nodeId}
              type="button"
              className="touch-candidate-item"
              role="menuitem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                width: '100%',
                padding: '6px 8px',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-xs)',
                textAlign: 'left',
                minHeight: 32,
              }}
              onClick={() => {
                if (isCont) {
                  onEnterContainer(candidate.nodeId);
                } else {
                  onSelect(candidate.nodeId);
                }
                onClose();
              }}
              aria-label={`${kindLabel(node)}: ${node.name}${isCont ? '. Tap to enter container.' : ''}`}
            >
              <SolidIcon
                name={kindIcon(node) as import('@varve/ui').SolidIconName}
                size={16}
                aria-hidden
              />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {node.name || kindLabel(node)}
              </span>
              {isCont && (
                <span
                  style={{
                    fontSize: '0.75em',
                    color: 'var(--color-text-muted)',
                    flexShrink: 0,
                  }}
                >
                  frame
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
