import { type RefObject, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { isFeatureEnabled } from '../../features';
import { AuditOverlayRenderer } from './renderer';
import { useFindingsOverlay } from './useFindingsOverlay';

interface AuditOverlayHostProps {
  canvasRef: RefObject<HTMLDivElement | null>;
}

export function AuditOverlayHost({ canvasRef }: AuditOverlayHostProps) {
  const editor = useEditor();
  const [canvasRect, setCanvasRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const updateCanvasRect = () => {
      const rect = element.getBoundingClientRect();
      setCanvasRect((current) => {
        if (
          current.x === rect.left &&
          current.y === rect.top &&
          current.width === rect.width &&
          current.height === rect.height
        ) {
          return current;
        }
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      });
    };

    updateCanvasRect();
    const observer = new ResizeObserver(updateCanvasRect);
    observer.observe(element);
    window.addEventListener('resize', updateCanvasRect);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCanvasRect);
    };
  }, [canvasRef]);

  const viewport = useMemo(
    () => ({ width: canvasRect.width, height: canvasRect.height }),
    [canvasRect.width, canvasRect.height],
  );

  const { registry, overlayContext } = useFindingsOverlay(viewport);

  const handleFindingClick = useCallback(
    (findingId: string) => {
      const nodeId = resolveNodeIdFromFinding(findingId, overlayContext.document);
      if (nodeId) {
        if (editor.layerNavigation) {
          editor.layerNavigation.revealNode(nodeId, {
            select: true,
            fitViewport: true,
            scrollToRow: true,
          });
        } else {
          editor.setSelection(nodeId);
        }
        const tab = overlayContext.document.nodes[nodeId]?.kind === 'text' ? 'typography' : 'audit';
        if ('setInspectorTab' in editor) {
          (editor as unknown as { setInspectorTab: (tab: string) => void }).setInspectorTab(tab);
        }
      }
    },
    [editor, overlayContext.document],
  );

  const handleFindingHover = useCallback(
    (findingId: string | null) => {
      if (findingId) {
        const nodeId = resolveNodeIdFromFinding(findingId, overlayContext.document);
        if (nodeId) {
          const el = document.querySelector(`[data-finding-id="${findingId}"]`);
          el?.classList.add('finding-highlighted');
        }
      } else {
        for (const el of document.querySelectorAll('.finding-highlighted')) {
          el.classList.remove('finding-highlighted');
        }
      }
    },
    [overlayContext.document],
  );

  const viewportRect = {
    x: -viewport.width / 2,
    y: -viewport.height / 2,
    w: viewport.width * 2,
    h: viewport.height * 2,
  };

  if (!isFeatureEnabled('findingsOverlay')) return null;
  if (!editor.state.findingsOverlayVisible) return null;
  if (viewport.width === 0 || viewport.height === 0) return null;

  return (
    <AuditOverlayRenderer
      registry={registry}
      overlayContext={overlayContext}
      viewportRect={viewportRect}
      canvasRect={canvasRect}
      onFindingClick={handleFindingClick}
      onFindingHover={handleFindingHover}
    />
  );
}

function resolveNodeIdFromFinding(findingId: string, _doc: unknown): string | null {
  const parts = findingId.split('-');
  if (parts.length >= 2) {
    const maybeNodeId = parts.slice(1).join('-');
    if (maybeNodeId.startsWith('n')) return maybeNodeId;
  }
  return null;
}
