/**
 * Build a prototype runtime from Document interactions.
 */
import { createRuntime, type Interaction, type PrototypeRuntime } from '@varve/prototype';
import { type Document, flattenInteractions } from '@varve/scene';

export function createRuntimeFromDocument(doc: Document): {
  runtime: PrototypeRuntime;
  entryScreenId: string;
} {
  const screens = Object.values(doc.nodes).filter(
    (n): n is import('@varve/scene').FrameNode => n.kind === 'frame',
  );
  const firstScreen = screens[0];
  const interactions = flattenInteractions(doc) as Interaction[];
  const entryScreenId = firstScreen?.id ?? '';
  const runtime = createRuntime(interactions, entryScreenId);
  return { runtime, entryScreenId };
}

/**
 * Build PrototypeData.interactions map from Document for editor state.
 */
export function interactionsMapFromDocument(doc: Document): Record<string, Interaction[]> {
  const map = doc.interactions ?? {};
  const result: Record<string, Interaction[]> = {};
  for (const [nodeId, list] of Object.entries(map)) {
    result[nodeId] = list as Interaction[];
  }
  return result;
}
