/**
 * Facts the canvas renderer needs about a whole document on every frame.
 *
 * They depend only on the (immutable) document, yet each was a full node
 * scan per frame — including camera-only pan and zoom frames. One entry is
 * enough: consecutive frames render the same document until it changes.
 */
import { type Document, isAnimatedMediaNode } from '@varve/scene';

export interface RenderDocumentFacts {
  /** Total authored nodes, for frame diagnostics. */
  readonly nodeCount: number;
  /** Nodes with animated-media fills; their IR must rebuild every frame. */
  readonly animatedMediaNodeIds: ReadonlySet<string>;
}

let lastDocument: Document | null = null;
let lastFacts: RenderDocumentFacts | null = null;

export function renderDocumentFacts(doc: Document): RenderDocumentFacts {
  if (lastDocument === doc && lastFacts) return lastFacts;
  let nodeCount = 0;
  const animatedMediaNodeIds = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    nodeCount++;
    if (node && isAnimatedMediaNode(node, doc)) animatedMediaNodeIds.add(node.id);
  }
  lastDocument = doc;
  lastFacts = { nodeCount, animatedMediaNodeIds };
  return lastFacts;
}
