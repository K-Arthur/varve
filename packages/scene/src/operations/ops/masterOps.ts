/**
 * Master/parent page operation family: master.* (ADR-0229).
 *
 * Master content remains source content. These operations change the master
 * record, page assignment, or sparse page override map; they never materialize
 * inherited nodes into a page's local content root.
 */

import type { Document } from '../../document';
import {
  addMasterOverride,
  assignMasterToPage,
  createMaster,
  deleteMaster,
  duplicateMaster,
  removeMasterOverride,
  renameMaster,
  resetMasterOverrides,
  setMasterAppliesTo,
} from '../../document';
import type { MasterAppliesTo, MasterOverrideType, NodeId } from '../../types';
import { registerOperation } from '../registry';
import type { ValidationResult } from '../types';

export interface MasterCreatePayload {
  name: string;
  width: number;
  height: number;
  appliesTo?: MasterAppliesTo;
  description?: string;
}

export interface MasterDeletePayload {
  masterId: NodeId;
}

export interface MasterRenamePayload {
  masterId: NodeId;
  name: string;
}

export interface MasterDuplicatePayload {
  masterId: NodeId;
}

export interface MasterSetAppliesToPayload {
  masterId: NodeId;
  appliesTo: MasterAppliesTo;
}

export interface MasterAssignPayload {
  pageId: NodeId;
  masterId: NodeId | null;
}

export interface MasterOverridePayload {
  pageId: NodeId;
  masterNodeId: NodeId;
  type: MasterOverrideType;
  localNodeId?: NodeId;
}

export interface MasterRemoveOverridePayload {
  pageId: NodeId;
  masterNodeId: NodeId;
}

export interface MasterResetOverridesPayload {
  pageId: NodeId;
}

const MASTER_APPLIES_TO = ['all', 'left', 'right'] as const;
const MASTER_OVERRIDE_TYPES = ['modified', 'hidden', 'deleted'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateMasterCreate(payload: unknown): ValidationResult<MasterCreatePayload> {
  if (!isRecord(payload)) return { ok: false, errors: ['master.create payload must be an object'] };
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    return { ok: false, errors: ['master.create requires a non-empty name'] };
  }
  if (typeof payload.width !== 'number' || !Number.isFinite(payload.width) || payload.width <= 0) {
    return { ok: false, errors: ['master.create width must be positive and finite'] };
  }
  if (
    typeof payload.height !== 'number' ||
    !Number.isFinite(payload.height) ||
    payload.height <= 0
  ) {
    return { ok: false, errors: ['master.create height must be positive and finite'] };
  }
  if (
    payload.appliesTo !== undefined &&
    !MASTER_APPLIES_TO.includes(payload.appliesTo as MasterAppliesTo)
  ) {
    return { ok: false, errors: [`unknown master appliesTo value: ${String(payload.appliesTo)}`] };
  }
  if (payload.description !== undefined && typeof payload.description !== 'string') {
    return { ok: false, errors: ['master.create description must be a string'] };
  }
  return {
    ok: true,
    value: {
      name: payload.name.trim(),
      width: payload.width,
      height: payload.height,
      ...(payload.appliesTo !== undefined
        ? { appliesTo: payload.appliesTo as MasterAppliesTo }
        : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
    },
  };
}

function validateMasterRename(payload: unknown): ValidationResult<MasterRenamePayload> {
  if (!isRecord(payload)) return { ok: false, errors: ['master.rename payload must be an object'] };
  if (typeof payload.masterId !== 'string' || payload.masterId.length === 0) {
    return { ok: false, errors: ['master.rename requires masterId'] };
  }
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    return { ok: false, errors: ['master.rename requires a non-empty name'] };
  }
  return { ok: true, value: { masterId: payload.masterId, name: payload.name.trim() } };
}

function validateMasterId<T extends { masterId: NodeId }>(
  payload: unknown,
  operation: string,
): ValidationResult<T> {
  if (!isRecord(payload)) return { ok: false, errors: [`${operation} payload must be an object`] };
  if (typeof payload.masterId !== 'string' || payload.masterId.length === 0) {
    return { ok: false, errors: [`${operation} requires masterId`] };
  }
  return { ok: true, value: payload as T };
}

function validateMasterAppliesTo(payload: unknown): ValidationResult<MasterSetAppliesToPayload> {
  if (!isRecord(payload) || typeof payload.masterId !== 'string') {
    return { ok: false, errors: ['master.set-applies-to requires masterId'] };
  }
  if (!MASTER_APPLIES_TO.includes(payload.appliesTo as MasterAppliesTo)) {
    return { ok: false, errors: [`unknown master appliesTo value: ${String(payload.appliesTo)}`] };
  }
  return {
    ok: true,
    value: { masterId: payload.masterId, appliesTo: payload.appliesTo as MasterAppliesTo },
  };
}

function validateMasterAssign(payload: unknown): ValidationResult<MasterAssignPayload> {
  if (!isRecord(payload)) return { ok: false, errors: ['master.assign payload must be an object'] };
  if (typeof payload.pageId !== 'string' || payload.pageId.length === 0) {
    return { ok: false, errors: ['master.assign requires pageId'] };
  }
  if (payload.masterId !== null && typeof payload.masterId !== 'string') {
    return { ok: false, errors: ['master.assign masterId must be a string or null'] };
  }
  return {
    ok: true,
    value: { pageId: payload.pageId, masterId: payload.masterId as NodeId | null },
  };
}

function validateMasterOverride(payload: unknown): ValidationResult<MasterOverridePayload> {
  if (!isRecord(payload))
    return { ok: false, errors: ['master.override payload must be an object'] };
  if (typeof payload.pageId !== 'string' || payload.pageId.length === 0) {
    return { ok: false, errors: ['master.override requires pageId'] };
  }
  if (typeof payload.masterNodeId !== 'string' || payload.masterNodeId.length === 0) {
    return { ok: false, errors: ['master.override requires masterNodeId'] };
  }
  if (!MASTER_OVERRIDE_TYPES.includes(payload.type as MasterOverrideType)) {
    return { ok: false, errors: [`unknown master override type: ${String(payload.type)}`] };
  }
  if (
    payload.type === 'modified' &&
    (typeof payload.localNodeId !== 'string' || !payload.localNodeId)
  ) {
    return { ok: false, errors: ['master.override modified requires localNodeId'] };
  }
  return {
    ok: true,
    value: {
      pageId: payload.pageId,
      masterNodeId: payload.masterNodeId,
      type: payload.type as MasterOverrideType,
      ...(payload.localNodeId !== undefined ? { localNodeId: payload.localNodeId as NodeId } : {}),
    },
  };
}

function validateMasterOverrideId<T extends { pageId: NodeId; masterNodeId: NodeId }>(
  payload: unknown,
  operation: string,
): ValidationResult<T> {
  if (!isRecord(payload)) return { ok: false, errors: [`${operation} payload must be an object`] };
  if (
    typeof payload.pageId !== 'string' ||
    payload.pageId.length === 0 ||
    typeof payload.masterNodeId !== 'string' ||
    payload.masterNodeId.length === 0
  ) {
    return { ok: false, errors: [`${operation} requires pageId and masterNodeId`] };
  }
  return { ok: true, value: payload as T };
}

function validatePageId<T extends { pageId: NodeId }>(
  payload: unknown,
  operation: string,
): ValidationResult<T> {
  if (!isRecord(payload)) return { ok: false, errors: [`${operation} payload must be an object`] };
  if (typeof payload.pageId !== 'string' || payload.pageId.length === 0) {
    return { ok: false, errors: [`${operation} requires pageId`] };
  }
  return { ok: true, value: payload as T };
}

function masterSourceExists(document: Document, pageId: NodeId, masterNodeId: NodeId): boolean {
  const page = document.pages?.find((candidate) => candidate.id === pageId);
  const master = page?.masterPageId ? document.masters?.[page.masterPageId] : undefined;
  const root = master ? document.nodes[master.contentRoot] : undefined;
  return !!root && 'children' in root && root.children.includes(masterNodeId);
}

function pageExists(document: Document, pageId: NodeId): boolean {
  return !!document.pages?.some((page) => page.id === pageId);
}

function masterExists(document: Document, masterId: NodeId): boolean {
  return !!document.masters?.[masterId];
}

export function registerMasterOperations(): void {
  registerOperation<MasterCreatePayload>({
    type: 'master.create',
    schemaVersion: 1,
    validate: validateMasterCreate,
    apply: createMaster,
    summarize: (payload) => ({
      label: `Create master ${payload.name}`,
      kind: 'create',
      affectedEntityIds: [],
    }),
    affectedEntities: () => [],
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterDeletePayload>({
    type: 'master.delete',
    schemaVersion: 1,
    validate: (payload) => validateMasterId<MasterDeletePayload>(payload, 'master.delete'),
    apply: (document, payload) => deleteMaster(document, payload.masterId),
    summarize: (payload) => ({
      label: 'Delete master page',
      kind: 'delete',
      affectedEntityIds: [payload.masterId],
    }),
    affectedEntities: (payload) => [payload.masterId],
    precondition: (document, payload) =>
      masterExists(document, payload.masterId)
        ? null
        : `master does not exist: ${payload.masterId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterRenamePayload>({
    type: 'master.rename',
    schemaVersion: 1,
    validate: validateMasterRename,
    apply: (document, payload) => renameMaster(document, payload.masterId, payload.name),
    summarize: (payload) => ({
      label: `Rename master to ${payload.name}`,
      kind: 'rename',
      affectedEntityIds: [payload.masterId],
    }),
    affectedEntities: (payload) => [payload.masterId],
    precondition: (document, payload) =>
      masterExists(document, payload.masterId)
        ? null
        : `master does not exist: ${payload.masterId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterDuplicatePayload>({
    type: 'master.duplicate',
    schemaVersion: 1,
    validate: (payload) => validateMasterId<MasterDuplicatePayload>(payload, 'master.duplicate'),
    apply: (document, payload) => duplicateMaster(document, payload.masterId),
    summarize: () => ({ label: 'Duplicate master page', kind: 'create', affectedEntityIds: [] }),
    affectedEntities: (payload) => [payload.masterId],
    precondition: (document, payload) =>
      masterExists(document, payload.masterId)
        ? null
        : `master does not exist: ${payload.masterId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterSetAppliesToPayload>({
    type: 'master.set-applies-to',
    schemaVersion: 1,
    validate: validateMasterAppliesTo,
    apply: (document, payload) => setMasterAppliesTo(document, payload.masterId, payload.appliesTo),
    summarize: (payload) => ({
      label: `Set master applicability to ${payload.appliesTo}`,
      kind: 'modify',
      affectedEntityIds: [payload.masterId],
    }),
    affectedEntities: (payload) => [payload.masterId],
    precondition: (document, payload) =>
      masterExists(document, payload.masterId)
        ? null
        : `master does not exist: ${payload.masterId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterAssignPayload>({
    type: 'master.assign',
    schemaVersion: 1,
    validate: validateMasterAssign,
    apply: (document, payload) => assignMasterToPage(document, payload.pageId, payload.masterId),
    summarize: (payload) => ({
      label: payload.masterId ? 'Apply master to page' : 'Detach master from page',
      kind: 'modify',
      affectedEntityIds: [payload.pageId, ...(payload.masterId ? [payload.masterId] : [])],
    }),
    affectedEntities: (payload) => [
      payload.pageId,
      ...(payload.masterId ? [payload.masterId] : []),
    ],
    precondition: (document, payload) => {
      if (!pageExists(document, payload.pageId)) return `page does not exist: ${payload.pageId}`;
      if (payload.masterId && !masterExists(document, payload.masterId)) {
        return `master does not exist: ${payload.masterId}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterOverridePayload>({
    type: 'master.override',
    schemaVersion: 1,
    validate: validateMasterOverride,
    apply: (document, payload) =>
      addMasterOverride(
        document,
        payload.pageId,
        payload.masterNodeId,
        payload.type,
        payload.localNodeId,
      ),
    summarize: (payload) => ({
      label: `Set master ${payload.type} override`,
      kind: 'modify',
      affectedEntityIds: [
        payload.pageId,
        payload.masterNodeId,
        ...(payload.localNodeId ? [payload.localNodeId] : []),
      ],
    }),
    affectedEntities: (payload) => [
      payload.pageId,
      payload.masterNodeId,
      ...(payload.localNodeId ? [payload.localNodeId] : []),
    ],
    precondition: (document, payload) => {
      if (!pageExists(document, payload.pageId)) return `page does not exist: ${payload.pageId}`;
      if (!masterSourceExists(document, payload.pageId, payload.masterNodeId)) {
        return `master source node does not exist on the assigned master: ${payload.masterNodeId}`;
      }
      if (payload.type === 'modified' && !document.nodes[payload.localNodeId ?? '']) {
        return `override replacement node does not exist: ${String(payload.localNodeId)}`;
      }
      return null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterRemoveOverridePayload>({
    type: 'master.remove-override',
    schemaVersion: 1,
    validate: (payload) =>
      validateMasterOverrideId<MasterRemoveOverridePayload>(payload, 'master.remove-override'),
    apply: (document, payload) =>
      removeMasterOverride(document, payload.pageId, payload.masterNodeId),
    summarize: () => ({ label: 'Reset master override', kind: 'modify', affectedEntityIds: [] }),
    affectedEntities: (payload) => [payload.pageId, payload.masterNodeId],
    precondition: (document, payload) =>
      pageExists(document, payload.pageId) ? null : `page does not exist: ${payload.pageId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<MasterResetOverridesPayload>({
    type: 'master.reset-overrides',
    schemaVersion: 1,
    validate: (payload) =>
      validatePageId<MasterResetOverridesPayload>(payload, 'master.reset-overrides'),
    apply: (document, payload) => resetMasterOverrides(document, payload.pageId),
    summarize: (payload) => ({
      label: 'Reset master overrides',
      kind: 'modify',
      affectedEntityIds: [payload.pageId],
    }),
    affectedEntities: (payload) => [payload.pageId],
    precondition: (document, payload) =>
      pageExists(document, payload.pageId) ? null : `page does not exist: ${payload.pageId}`,
    maxPayloadBytes: 8_000,
  });
}
