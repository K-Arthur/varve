/**
 * Persisted prototype interaction types for the Document model.
 *
 * Structurally compatible with @varve/prototype Interaction but defined here
 * to avoid a circular package dependency (prototype depends on scene).
 *
 * Research basis: Figma prototype interactions model, Framer event wiring.
 */
import type { NodeId } from './types';

/**
 * A prototype interaction stored on the Document.
 * `trigger` and `actions` are JSON-serializable objects matching
 * @varve/prototype Trigger and Action unions at runtime.
 */
export interface DocumentInteraction {
  id: string;
  nodeId: NodeId;
  name: string;
  trigger: unknown;
  actions: unknown[];
  enabled: boolean;
  description?: string;
}
