/**
 * Document-scoped variable store accessor — single source of truth on Document.
 */
import { createVariableStore, type Document, type VariableStore } from '@varve/scene';

export function docVariableStore(doc: Document): VariableStore {
  return doc.variableStore ?? createVariableStore();
}
