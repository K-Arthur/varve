import type { NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { FloatingPortal, pointAnchor, SOLID_TOOL_ICONS, SolidIcon, viewportPoint } from '@varve/ui';
import { useMemo } from 'react';
import './selectionBreadcrumb.css';

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
        className="varve-menu varve-menu--default varve-ctxmenu"
        role="menu"
        aria-label="Select nested object"
      >
        {candidates.map((candidate) => {
          const node = candidate.node;
          const isCont = isContainer(node);
          return (
            <button
              key={candidate.nodeId}
              type="button"
              className="varve-menu__item"
              role="menuitem"
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
              <span className="varve-menu__leading">
                <SolidIcon
                  name={kindIcon(node) as import('@varve/ui').SolidIconName}
                  size={16}
                  aria-hidden
                />
              </span>
              <span className="varve-menu__item-content">
                <span className="varve-menu__item-label">{node.name || kindLabel(node)}</span>
              </span>
              {isCont && (
                <span className="varve-menu__trailing">
                  <span style={{ fontSize: '0.75em', color: 'var(--color-text-muted)' }}>
                    frame
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </FloatingPortal>
  );
}
