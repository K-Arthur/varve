/**
 * Mockup tab request store.
 *
 * The Mockups panel lives inside the shared resources panel (Shell mounts
 * ResourcesPanel). To open it from context menus / command palette without
 * growing Shell's import budget or EditorState, actions publish a request
 * here; the panel subscribes and switches to its tab. Latest request wins.
 */

export interface MockupsTabRequest {
  sourceNodeIds?: string[];
  seq: number;
}

type Listener = (request: MockupsTabRequest) => void;

let current: MockupsTabRequest | null = null;
let seq = 0;
const listeners = new Set<Listener>();

export function requestMockupsTab(sourceNodeIds?: string[]): MockupsTabRequest {
  const request: MockupsTabRequest = { sourceNodeIds, seq: ++seq };
  current = request;
  for (const listener of listeners) listener(request);
  return request;
}

export function getMockupsTabRequest(): MockupsTabRequest | null {
  return current;
}

export function subscribeMockupsTab(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
