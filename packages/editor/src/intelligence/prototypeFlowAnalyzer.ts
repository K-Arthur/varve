import type { Document, DocumentInteraction, FrameNode, NodeId, SceneNode } from '@varve/scene';
import { getInteractionsForNode, walkNodes } from '@varve/scene';

export interface FlowIssue {
  nodeId?: string;
  type: 'dead-end' | 'missing-back-nav' | 'orphan' | 'inconsistent-transition';
  message: string;
  suggestion?: string;
}

function isFrameNode(node: SceneNode): node is FrameNode & SceneNode {
  return node.kind === 'frame';
}

void _hasNavigateToAction;
function _hasNavigateToAction(_interactions: DocumentInteraction[]): boolean {
  return false;
}

function getTargetsFromInteractions(interactions: DocumentInteraction[]): string[] {
  const targets: string[] = [];
  for (const ix of interactions) {
    if (!Array.isArray(ix.actions)) continue;
    for (const a of ix.actions) {
      const act = a as { kind?: string; targetId?: string };
      if (act.kind === 'navigateTo' && act.targetId) {
        targets.push(act.targetId);
      }
    }
  }
  return targets;
}

function hasGoBackAction(interactions: DocumentInteraction[]): boolean {
  return interactions.some(
    (ix) =>
      Array.isArray(ix.actions) &&
      ix.actions.some((a: unknown) => {
        const act = a as { kind?: string };
        return act.kind === 'goBack';
      }),
  );
}

function getTransitionKinds(interactions: DocumentInteraction[]): Set<string> {
  const kinds = new Set<string>();
  for (const ix of interactions) {
    if (!Array.isArray(ix.actions)) continue;
    for (const a of ix.actions) {
      const act = a as { kind?: string; transition?: { kind?: string } };
      if (act.transition?.kind) {
        kinds.add(act.transition.kind);
      }
    }
  }
  return kinds;
}

function extractNodeName(doc: Document, nodeId: string): string {
  return doc.nodes[nodeId as NodeId]?.name ?? '';
}

export function analyzePrototypeFlow(doc: Document): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const nodes = walkNodes(doc);

  const frameIds: NodeId[] = [];
  for (const [id, entry] of nodes) {
    if (isFrameNode(entry.node)) {
      frameIds.push(id as NodeId);
    }
  }

  if (frameIds.length === 0) return issues;

  const outgoing: Map<NodeId, string[]> = new Map();
  const incoming: Map<NodeId, string[]> = new Map();
  const frameWithInteractions = new Set<NodeId>();
  const backNavFrames = new Set<NodeId>();
  const transitionKindMap: Map<NodeId, Set<string>> = new Map();

  for (const fid of frameIds) {
    const interactions = getInteractionsForNode(doc, fid);
    if (interactions.length > 0) {
      frameWithInteractions.add(fid);

      const targets = getTargetsFromInteractions(interactions);
      outgoing.set(fid, targets);

      for (const t of targets) {
        const tid = t as NodeId;
        incoming.set(tid, [...(incoming.get(tid) ?? []), fid as string]);
      }

      if (hasGoBackAction(interactions)) {
        backNavFrames.add(fid);
      }

      transitionKindMap.set(fid, getTransitionKinds(interactions));
    } else {
      outgoing.set(fid, []);
    }
  }

  const framesWithNoInteraction = frameIds.filter((fid) => !frameWithInteractions.has(fid));

  for (const fid of framesWithNoInteraction) {
    const name = extractNodeName(doc, fid);
    issues.push({
      nodeId: fid,
      type: 'dead-end',
      message: `Screen "${name}" has no interactions — users cannot navigate away`,
      suggestion: `Add a navigation interaction to "${name}" so users can leave this screen`,
    });
  }

  const allTargets = new Set<NodeId>();
  for (const targets of outgoing.values()) {
    for (const t of targets) {
      allTargets.add(t as NodeId);
    }
  }

  for (const fid of frameIds) {
    if (!allTargets.has(fid)) {
      const name = extractNodeName(doc, fid);
      issues.push({
        nodeId: fid,
        type: 'orphan',
        message: `Screen "${name}" is not reachable from any other screen`,
        suggestion: `Add a navigation target pointing to "${name}" from another screen`,
      });
    }
  }

  for (const fid of frameIds) {
    if (frameWithInteractions.has(fid) && !backNavFrames.has(fid)) {
      const targets = outgoing.get(fid) ?? [];
      const hasNonSelfTarget = targets.some((t) => t !== fid);
      const hasIncoming = (incoming.get(fid)?.length ?? 0) > 0;
      if (hasNonSelfTarget && hasIncoming) {
        const name = extractNodeName(doc, fid);
        issues.push({
          nodeId: fid,
          type: 'missing-back-nav',
          message: `Screen "${name}" has no back navigation`,
          suggestion: `Add a goBack action to "${name}" so users can return to the previous screen`,
        });
      }
    }
  }

  const frameNames = new Map<NodeId, string>();
  for (const fid of frameIds) {
    frameNames.set(fid, extractNodeName(doc, fid).toLowerCase());
  }

  for (const [fid, name] of frameNames) {
    if (name.includes('detail') || name.includes('details')) {
      const hasIncoming = (incoming.get(fid)?.length ?? 0) > 0;
      if (!backNavFrames.has(fid) && hasIncoming) {
        const listScreens = frameIds.filter((other) => {
          const n = frameNames.get(other) ?? '';
          return (
            other !== fid &&
            (n.includes('list') ||
              n.includes('browse') ||
              n.includes('gallery') ||
              n.includes('index'))
          );
        });
        if (listScreens.length > 0) {
          const listName = extractNodeName(doc, listScreens[0]!);
          issues.push({
            nodeId: fid,
            type: 'missing-back-nav',
            message: `Detail screen "${extractNodeName(doc, fid)}" likely needs back navigation to "${listName}"`,
            suggestion: `Add a goBack or navigateTo action from "${extractNodeName(doc, fid)}" to "${listName}"`,
          });
        }
      }
    }
  }

  let dominantKind: string | null = null;
  for (const [fid, kinds] of transitionKindMap) {
    if (kinds.size === 0) continue;
    if (dominantKind === null) {
      dominantKind = [...kinds][0] ?? null;
    }
    for (const k of kinds) {
      if (k !== dominantKind) {
        const name = extractNodeName(doc, fid);
        issues.push({
          nodeId: fid,
          type: 'inconsistent-transition',
          message: `Screen "${name}" uses "${k}" transition (dominant is "${dominantKind}")`,
          suggestion: `Change "${name}" to use "${dominantKind}" transitions for consistency, or apply "${k}" across all screens if intentional`,
        });
      }
    }
  }

  return issues;
}
