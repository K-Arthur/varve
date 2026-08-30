/**
 * Editor adapters for the typed master.* operation family.
 *
 * Master mutations share the editor's existing updateDoc/history boundary,
 * while the scene operation registry remains the canonical validation and
 * precondition layer. This keeps stale panel actions from mutating a document
 * directly and gives master overrides the same replayable contract as pages.
 */

import {
  applyOperation,
  type Document,
  type MasterAssignPayload,
  type MasterCreatePayload,
  type MasterDeletePayload,
  type MasterDuplicatePayload,
  type MasterOverridePayload,
  type MasterRemoveOverridePayload,
  type MasterRenamePayload,
  type MasterResetOverridesPayload,
  type MasterSetAppliesToPayload,
  preconditionFailure,
  registerBuiltinOperations,
  validatePayload,
} from '@varve/scene';

let operationsReady = false;

function ensureMasterOperations(): void {
  if (operationsReady) return;
  registerBuiltinOperations();
  operationsReady = true;
}

function applyMasterOperation<TPayload>(doc: Document, type: string, payload: TPayload): Document {
  ensureMasterOperations();
  const validated = validatePayload(type, payload);
  if (!validated.ok) return doc;
  if (preconditionFailure(doc, type, validated.value)) return doc;
  return applyOperation(doc, type, validated.value);
}

export function createMasterCommand(doc: Document, payload: MasterCreatePayload): Document {
  return applyMasterOperation(doc, 'master.create', payload);
}

export function deleteMasterCommand(doc: Document, payload: MasterDeletePayload): Document {
  return applyMasterOperation(doc, 'master.delete', payload);
}

export function renameMasterCommand(doc: Document, payload: MasterRenamePayload): Document {
  return applyMasterOperation(doc, 'master.rename', payload);
}

export function duplicateMasterCommand(doc: Document, payload: MasterDuplicatePayload): Document {
  return applyMasterOperation(doc, 'master.duplicate', payload);
}

export function setMasterAppliesToCommand(
  doc: Document,
  payload: MasterSetAppliesToPayload,
): Document {
  return applyMasterOperation(doc, 'master.set-applies-to', payload);
}

export function assignMasterCommand(doc: Document, payload: MasterAssignPayload): Document {
  return applyMasterOperation(doc, 'master.assign', payload);
}

export function setMasterOverrideCommand(doc: Document, payload: MasterOverridePayload): Document {
  return applyMasterOperation(doc, 'master.override', payload);
}

export function removeMasterOverrideCommand(
  doc: Document,
  payload: MasterRemoveOverridePayload,
): Document {
  return applyMasterOperation(doc, 'master.remove-override', payload);
}

export function resetMasterOverridesCommand(
  doc: Document,
  payload: MasterResetOverridesPayload,
): Document {
  return applyMasterOperation(doc, 'master.reset-overrides', payload);
}
