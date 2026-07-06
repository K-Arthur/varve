/**
 * PrototypeFlowView — BFS flow graph of frame screens and navigation connections.
 */
import type { Document, NodeId } from '@strata/scene';
import { getInteractionsForNode } from '@strata/scene';
import { createFlowData, findEntryPoint, getOutgoingConnections } from '@strata/prototype';
import { useMemo } from 'react';

export interface PrototypeFlowViewProps {
  document: Document;
  currentScreenId?: NodeId;
  onSelectScreen?: (screenId: NodeId) => void;
}

function collectNavigateConnections(doc: Document): Array<{
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  interactionId: string;
}> {
  const connections: Array<{
    sourceNodeId: NodeId;
    targetNodeId: NodeId;
    interactionId: string;
  }> = [];
  for (const node of Object.values(doc.nodes)) {
    const list = getInteractionsForNode(doc, node.id);
    for (const ix of list) {
      if (!ix.enabled) continue;
      for (const action of ix.actions) {
        const a = action as { kind?: string; targetId?: string };
        if (a.kind === 'navigateTo' && a.targetId) {
          connections.push({
            sourceNodeId: node.id,
            targetNodeId: a.targetId,
            interactionId: ix.id,
          });
        }
      }
    }
  }
  return connections;
}

export function PrototypeFlowView({
  document,
  currentScreenId,
  onSelectScreen,
}: PrototypeFlowViewProps) {
  const screens = useMemo(
    () =>
      Object.values(document.nodes)
        .filter((n) => n.kind === 'frame')
        .map((n) => ({ id: n.id, name: n.name })),
    [document.nodes],
  );

  const flow = useMemo(() => {
    const nodeIds = screens.map((s) => s.id);
    const raw = collectNavigateConnections(document);
    const flowData = createFlowData(
      nodeIds,
      raw.map((c) => ({
        id: `fc-${c.interactionId}`,
        sourceNodeId: c.sourceNodeId,
        targetNodeId: c.targetNodeId,
        interactionId: c.interactionId,
      })),
    );
    return flowData;
  }, [document, screens]);

  const entry = useMemo(() => findEntryPoint(flow), [flow]);

  if (screens.length === 0) {
    return <p className="prototype-flow__empty">Add frames to build a prototype flow.</p>;
  }

  return (
    <div className="prototype-flow" role="region" aria-label="Prototype flow">
      <p className="prototype-flow__entry">
        Entry: {screens.find((s) => s.id === entry)?.name ?? 'First frame'}
      </p>
      <ul className="prototype-flow__list">
        {screens.map((screen) => {
          const outgoing = getOutgoingConnections(flow, screen.id);
          const isCurrent = screen.id === currentScreenId;
          return (
            <li key={screen.id} className="prototype-flow__item">
              <button
                type="button"
                className={`prototype-flow__node${isCurrent ? ' prototype-flow__node--current' : ''}`}
                onClick={() => onSelectScreen?.(screen.id)}
              >
                {screen.name}
              </button>
              {outgoing.length > 0 && (
                <ul className="prototype-flow__edges">
                  {outgoing.map((conn) => {
                    const target = screens.find((s) => s.id === conn.targetNodeId);
                    return (
                      <li key={conn.id} className="prototype-flow__edge">
                        → {target?.name ?? conn.targetNodeId}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
