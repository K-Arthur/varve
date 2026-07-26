import { useCallback } from 'react';
import { useEditor } from '../../context';
import { AuditOverlayRenderer } from './renderer';
import { useFindingsOverlay } from './useFindingsOverlay';

interface AuditOverlayHostProps {
  viewport: { width: number; height: number };
}

export function AuditOverlayHost({ viewport }: AuditOverlayHostProps) {
  const editor = useEditor();

  const { registry, overlayContext } = useFindingsOverlay(viewport);

  const handleFindingClick = useCallback(
    (findingId: string) => {
      const nodeId = resolveNodeIdFromFinding(findingId, overlayContext.document);
      if (nodeId) {
        editor.setSelection(nodeId);
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

  if (!editor.state.findingsOverlayVisible) return null;

  return (
    <AuditOverlayRenderer
      registry={registry}
      overlayContext={overlayContext}
      viewportRect={{
        x: -viewport.width / 2,
        y: -viewport.height / 2,
        w: viewport.width * 2,
        h: viewport.height * 2,
      }}
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
