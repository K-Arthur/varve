/**
 * PrototypeFlowView — BFS flow graph of frame screens and navigation connections.
 */

import { createFlowData, findEntryPoint, getOutgoingConnections } from '@strata/prototype';
import type { Document, NodeId } from '@strata/scene';
import { getInteractionsForNode, getParent } from '@strata/scene';
import { useMemo } from 'react';

export interface PrototypeFlowViewProps {
  document: Document;
  currentScreenId?: NodeId;
  selectedInteractionId?: string | null;
  onSelectScreen?: (screenId: NodeId) => void;
  onSelectInteraction?: (nodeId: NodeId, interactionId: string) => void;
}

function resolveScreenId(doc: Document, nodeId: NodeId): NodeId {
  const node = doc.nodes[nodeId];
  if (node?.kind === 'frame') return nodeId;
  let current: NodeId | null = nodeId;
  while (current) {
    const parentId = getParent(doc, current);
    if (!parentId) break;
    const parent = doc.nodes[parentId];
    if (parent?.kind === 'frame') return parentId;
    current = parentId;
  }
  return nodeId;
}

function collectNavigateConnections(doc: Document): Array<{
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  interactionId: string;
  interactionNodeId: NodeId;
}> {
  const connections: Array<{
    sourceNodeId: NodeId;
    targetNodeId: NodeId;
    interactionId: string;
    interactionNodeId: NodeId;
  }> = [];
  for (const node of Object.values(doc.nodes)) {
    const list = getInteractionsForNode(doc, node.id);
    for (const ix of list) {
      if (!ix.enabled) continue;
      for (const action of ix.actions) {
        const a = action as { kind?: string; targetId?: string };
        if (a.kind === 'navigateTo' && a.targetId) {
          connections.push({
            sourceNodeId: resolveScreenId(doc, node.id),
            targetNodeId: a.targetId,
            interactionId: ix.id,
            interactionNodeId: node.id,
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
  selectedInteractionId,
  onSelectScreen,
  onSelectInteraction,
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
    return { flowData, raw };
  }, [document, screens]);

  const entry = useMemo(() => findEntryPoint(flow.flowData), [flow]);

  if (screens.length === 0) {
    return <p className="prototype-flow__empty">Add frames to build a prototype flow.</p>;
  }

  return (
    <section className="prototype-flow" aria-label="Prototype flow">
      <p className="prototype-flow__entry">
        Entry: {screens.find((s) => s.id === entry)?.name ?? 'First frame'}
      </p>
      <ul className="prototype-flow__list">
        {screens.map((screen) => {
          const outgoing = getOutgoingConnections(flow.flowData, screen.id);
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
                    const isSelected = selectedInteractionId === conn.interactionId;
                    const interactionNodeId =
                      flow.raw.find((r) => r.interactionId === conn.interactionId)
                        ?.interactionNodeId ?? conn.sourceNodeId;
                    return (
                      <li key={conn.id} className="prototype-flow__edge">
                        <button
                          type="button"
                          className={`prototype-flow__edge-btn${isSelected ? ' prototype-flow__edge-btn--selected' : ''}`}
                          aria-pressed={isSelected}
                          aria-label={`Edit interaction to ${target?.name ?? conn.targetNodeId}`}
                          onClick={() =>
                            onSelectInteraction?.(interactionNodeId, conn.interactionId)
                          }
                        >
                          to {target?.name ?? conn.targetNodeId}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
