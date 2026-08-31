import type { NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { FloatingPortal, pointAnchor, SOLID_TOOL_ICONS, SolidIcon, viewportPoint } from '@varve/ui';
import { useMemo } from 'react';

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
  contextElement?: HTMLElement;
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
  contextElement,
  onSelect,
  onEnterContainer,
  onClose,
}: TouchCandidateMenuProps) {
  const menuWidth = 220;
  const ownerDocument = contextElement?.ownerDocument ?? document;
  const anchor = useMemo(
    () => pointAnchor(viewportPoint(screenX, screenY), ownerDocument, contextElement),
    [contextElement, ownerDocument, screenX, screenY],
  );

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
    <FloatingPortal
      anchor={anchor}
      open
      kind="context-menu"
      placement="bottom-start"
      fallbackPlacements={['top-start', 'bottom-end', 'top-end']}
      offsetDistance={0}
      maxHeight={240}
      onClose={onClose}
      dismissOnEscape
      className="varve-floating-layer"
    >
      <div
        className="touch-candidate-menu"
        role="menu"
        aria-label="Select nested object"
        style={{
          position: 'static',
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
    </FloatingPortal>
  );
}
