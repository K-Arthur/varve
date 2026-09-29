import type { Document } from '../../document';
import {
  applyPresentationLayoutPreview,
  isPresentationLayoutSourceOutdated,
  type PresentationLayoutPreview,
  previewPresentationLayout,
  registerPresentationLayout,
  removePresentationLayout,
  updatePresentationLayoutSource,
} from '../../presentation/layouts';
import {
  addPresentationDeck,
  addPresentationSection,
  addPresentationSlide,
  findPresentationDeck,
  type PresentationSlideUpdate,
  removePresentationDeck,
  removePresentationSection,
  removePresentationSlide,
  renamePresentationDeck,
  renamePresentationSection,
  reorderPresentationSlide,
  updatePresentationSlide,
} from '../../presentation/model';
import type {
  PresentationDeck,
  PresentationLayoutSource,
  PresentationSection,
  PresentationSlideEntry,
} from '../../presentation/types';
import type { NodeId } from '../../types';
import { registerOperation } from '../registry';
import type { ValidationResult } from '../types';

export interface PresentationDeckCreatePayload {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface PresentationDeckIdPayload {
  deckId: string;
}

export interface PresentationDeckRenamePayload extends PresentationDeckIdPayload {
  name: string;
}

export interface PresentationSlideAddPayload extends PresentationDeckIdPayload {
  entry: PresentationSlideEntry;
  index?: number;
}

export interface PresentationSlideReferencePayload extends PresentationDeckIdPayload {
  entryId: string;
}

export interface PresentationSlideUpdatePayload extends PresentationSlideReferencePayload {
  update: PresentationSlideUpdate;
}

export interface PresentationSlideReorderPayload extends PresentationSlideReferencePayload {
  toIndex: number;
}

export interface PresentationSectionCreatePayload extends PresentationDeckIdPayload {
  section: PresentationSection;
}

export interface PresentationSectionRenamePayload extends PresentationDeckIdPayload {
  sectionId: string;
  title: string;
}

export interface PresentationSectionDeletePayload extends PresentationDeckIdPayload {
  sectionId: string;
}

export interface PresentationLayoutRegisterPayload {
  source: PresentationLayoutSource;
}

export interface PresentationLayoutUpdatePayload {
  sourceId: string;
  name: string;
  frameId: NodeId;
  roleNodes: Record<string, NodeId>;
}

export interface PresentationLayoutDeletePayload {
  sourceId: string;
}

export interface PresentationLayoutApplyPayload {
  preview: PresentationLayoutPreview;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateLayoutBinding(value: unknown): boolean {
  if (value === undefined) return true;
  if (
    !record(value) ||
    !nonEmptyString(value.sourceId) ||
    !nonEmptyString(value.sourceFrameId) ||
    typeof value.appliedRevision !== 'number' ||
    !Number.isInteger(value.appliedRevision) ||
    value.appliedRevision < 0 ||
    !record(value.roleNodes) ||
    Object.values(value.roleNodes).some((nodeId) => !nonEmptyString(nodeId))
  ) {
    return false;
  }
  if (value.managedBaseline === undefined) return true;
  return record(value.managedBaseline) && Object.values(value.managedBaseline).every(record);
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateDeckId<T extends PresentationDeckIdPayload>(
  payload: unknown,
  operation: string,
): ValidationResult<T> {
  if (!record(payload) || !nonEmptyString(payload.deckId)) {
    return { ok: false, errors: [`${operation} requires deckId`] };
  }
  return { ok: true, value: payload as T };
}

function validateDeckCreate(payload: unknown): ValidationResult<PresentationDeckCreatePayload> {
  if (!record(payload))
    return { ok: false, errors: ['presentation.deck.create payload must be an object'] };
  if (!nonEmptyString(payload.id) || !nonEmptyString(payload.name)) {
    return { ok: false, errors: ['presentation.deck.create requires id and name'] };
  }
  if (!finitePositive(payload.width) || !finitePositive(payload.height)) {
    return {
      ok: false,
      errors: ['presentation.deck.create dimensions must be positive and finite'],
    };
  }
  return {
    ok: true,
    value: {
      id: payload.id,
      name: payload.name.trim(),
      width: payload.width,
      height: payload.height,
    },
  };
}

function validateDeckRename(payload: unknown): ValidationResult<PresentationDeckRenamePayload> {
  if (!record(payload) || !nonEmptyString(payload.deckId) || !nonEmptyString(payload.name)) {
    return { ok: false, errors: ['presentation.deck.rename requires deckId and name'] };
  }
  return { ok: true, value: { deckId: payload.deckId, name: payload.name.trim() } };
}

function validateSlideEntry(value: unknown): value is PresentationSlideEntry {
  if (
    !record(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.frameId) ||
    typeof value.title !== 'string'
  ) {
    return false;
  }
  if (
    (value.notes !== undefined && typeof value.notes !== 'string') ||
    (value.notes !== undefined && value.notes.length > 250_000) ||
    (value.skipped !== undefined && typeof value.skipped !== 'boolean') ||
    (value.sectionId !== undefined && !nonEmptyString(value.sectionId)) ||
    (value.themeId !== undefined && !nonEmptyString(value.themeId)) ||
    (value.language !== undefined && typeof value.language !== 'string') ||
    (value.altText !== undefined && typeof value.altText !== 'string') ||
    !validateLayoutBinding(value.layoutBinding) ||
    (value.readingOrder !== undefined &&
      (!Array.isArray(value.readingOrder) || !value.readingOrder.every(nonEmptyString)))
  ) {
    return false;
  }
  return true;
}

function validateSlideAdd(payload: unknown): ValidationResult<PresentationSlideAddPayload> {
  if (!record(payload) || !nonEmptyString(payload.deckId) || !validateSlideEntry(payload.entry)) {
    return {
      ok: false,
      errors: ['presentation.slide.add requires deckId and a valid slide entry'],
    };
  }
  if (
    payload.index !== undefined &&
    (typeof payload.index !== 'number' || !Number.isInteger(payload.index) || payload.index < 0)
  ) {
    return { ok: false, errors: ['presentation.slide.add index must be a non-negative integer'] };
  }
  return {
    ok: true,
    value: {
      deckId: payload.deckId,
      entry: { ...payload.entry, title: payload.entry.title.trim() || 'Untitled slide' },
      ...(payload.index !== undefined ? { index: payload.index as number } : {}),
    },
  };
}

function validateSlideReference<T extends PresentationSlideReferencePayload>(
  payload: unknown,
  operation: string,
): ValidationResult<T> {
  if (!record(payload) || !nonEmptyString(payload.deckId) || !nonEmptyString(payload.entryId)) {
    return { ok: false, errors: [`${operation} requires deckId and entryId`] };
  }
  return { ok: true, value: payload as T };
}

const SLIDE_UPDATE_KEYS = new Set([
  'title',
  'notes',
  'skipped',
  'sectionId',
  'themeId',
  'language',
  'altText',
  'readingOrder',
]);

function validateSlideUpdate(payload: unknown): ValidationResult<PresentationSlideUpdatePayload> {
  if (
    !record(payload) ||
    !nonEmptyString(payload.deckId) ||
    !nonEmptyString(payload.entryId) ||
    !record(payload.update) ||
    Object.keys(payload.update).some((key) => !SLIDE_UPDATE_KEYS.has(key))
  ) {
    return { ok: false, errors: ['presentation.slide.update requires a supported update object'] };
  }
  const update = payload.update;
  if (
    (update.title !== undefined && typeof update.title !== 'string') ||
    (update.notes !== undefined &&
      update.notes !== null &&
      (typeof update.notes !== 'string' || update.notes.length > 250_000)) ||
    (update.skipped !== undefined && typeof update.skipped !== 'boolean') ||
    (update.sectionId !== undefined &&
      update.sectionId !== null &&
      !nonEmptyString(update.sectionId)) ||
    (update.themeId !== undefined && update.themeId !== null && !nonEmptyString(update.themeId)) ||
    (update.language !== undefined &&
      update.language !== null &&
      typeof update.language !== 'string') ||
    (update.altText !== undefined &&
      update.altText !== null &&
      typeof update.altText !== 'string') ||
    (update.readingOrder !== undefined &&
      update.readingOrder !== null &&
      (!Array.isArray(update.readingOrder) || !update.readingOrder.every(nonEmptyString)))
  ) {
    return { ok: false, errors: ['presentation.slide.update contains invalid values'] };
  }
  const normalized: PresentationSlideUpdate = {
    ...(typeof update.title === 'string' ? { title: update.title.trim() || 'Untitled slide' } : {}),
    ...(typeof update.notes === 'string' || update.notes === null
      ? { notes: update.notes as string | null }
      : {}),
    ...(typeof update.skipped === 'boolean' ? { skipped: update.skipped } : {}),
    ...(typeof update.sectionId === 'string' || update.sectionId === null
      ? { sectionId: update.sectionId as string | null }
      : {}),
    ...(typeof update.themeId === 'string' || update.themeId === null
      ? { themeId: update.themeId as string | null }
      : {}),
    ...(typeof update.language === 'string' || update.language === null
      ? { language: update.language as string | null }
      : {}),
    ...(typeof update.altText === 'string' || update.altText === null
      ? { altText: update.altText as string | null }
      : {}),
    ...(Array.isArray(update.readingOrder)
      ? { readingOrder: update.readingOrder as NodeId[] }
      : update.readingOrder === null
        ? { readingOrder: null }
        : {}),
  };
  return {
    ok: true,
    value: { deckId: payload.deckId, entryId: payload.entryId, update: normalized },
  };
}

function validateSlideReorder(payload: unknown): ValidationResult<PresentationSlideReorderPayload> {
  if (
    !record(payload) ||
    !nonEmptyString(payload.deckId) ||
    !nonEmptyString(payload.entryId) ||
    typeof payload.toIndex !== 'number' ||
    !Number.isInteger(payload.toIndex) ||
    payload.toIndex < 0
  ) {
    return { ok: false, errors: ['presentation.slide.reorder requires a non-negative toIndex'] };
  }
  return {
    ok: true,
    value: { deckId: payload.deckId, entryId: payload.entryId, toIndex: payload.toIndex },
  };
}

function validateSectionCreate(
  payload: unknown,
): ValidationResult<PresentationSectionCreatePayload> {
  if (
    !record(payload) ||
    !nonEmptyString(payload.deckId) ||
    !record(payload.section) ||
    !nonEmptyString(payload.section.id) ||
    !nonEmptyString(payload.section.title)
  ) {
    return { ok: false, errors: ['presentation.section.create requires deckId, id, and title'] };
  }
  return {
    ok: true,
    value: {
      deckId: payload.deckId,
      section: { id: payload.section.id, title: payload.section.title.trim() },
    },
  };
}

function validateSectionRename(
  payload: unknown,
): ValidationResult<PresentationSectionRenamePayload> {
  if (
    !record(payload) ||
    !nonEmptyString(payload.deckId) ||
    !nonEmptyString(payload.sectionId) ||
    !nonEmptyString(payload.title)
  ) {
    return {
      ok: false,
      errors: ['presentation.section.rename requires deckId, sectionId, and title'],
    };
  }
  return {
    ok: true,
    value: {
      deckId: payload.deckId,
      sectionId: payload.sectionId,
      title: payload.title.trim(),
    },
  };
}

function validateSectionDelete(
  payload: unknown,
): ValidationResult<PresentationSectionDeletePayload> {
  if (!record(payload) || !nonEmptyString(payload.deckId) || !nonEmptyString(payload.sectionId)) {
    return { ok: false, errors: ['presentation.section.delete requires deckId and sectionId'] };
  }
  return { ok: true, value: { deckId: payload.deckId, sectionId: payload.sectionId } };
}

function validRoleMap(value: unknown): value is Record<string, NodeId> {
  return (
    record(value) &&
    Object.keys(value).length <= 200 &&
    new Set(Object.values(value)).size === Object.values(value).length &&
    Object.entries(value).every(
      ([role, nodeId]) => nonEmptyString(role) && role.length <= 100 && nonEmptyString(nodeId),
    )
  );
}

function validateLayoutSource(value: unknown): value is PresentationLayoutSource {
  return (
    record(value) &&
    nonEmptyString(value.id) &&
    nonEmptyString(value.name) &&
    value.name.length <= 240 &&
    nonEmptyString(value.frameId) &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    value.revision >= 1 &&
    validRoleMap(value.roleNodes) &&
    (value.geometrySnapshot === undefined || record(value.geometrySnapshot))
  );
}

function validateLayoutRegister(
  payload: unknown,
): ValidationResult<PresentationLayoutRegisterPayload> {
  if (!record(payload) || !validateLayoutSource(payload.source)) {
    return { ok: false, errors: ['presentation.layout.register requires a valid layout source'] };
  }
  return { ok: true, value: { source: payload.source } };
}

function validateLayoutUpdate(payload: unknown): ValidationResult<PresentationLayoutUpdatePayload> {
  if (
    !record(payload) ||
    !nonEmptyString(payload.sourceId) ||
    !nonEmptyString(payload.name) ||
    payload.name.length > 240 ||
    !nonEmptyString(payload.frameId) ||
    !validRoleMap(payload.roleNodes)
  ) {
    return {
      ok: false,
      errors: ['presentation.layout.update requires sourceId, name, frameId, and roleNodes'],
    };
  }
  return {
    ok: true,
    value: {
      sourceId: payload.sourceId,
      name: payload.name.trim(),
      frameId: payload.frameId,
      roleNodes: payload.roleNodes,
    },
  };
}

function validateLayoutDelete(payload: unknown): ValidationResult<PresentationLayoutDeletePayload> {
  if (!record(payload) || !nonEmptyString(payload.sourceId)) {
    return { ok: false, errors: ['presentation.layout.delete requires sourceId'] };
  }
  return { ok: true, value: { sourceId: payload.sourceId } };
}

function validLayoutProperties(value: unknown): value is Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['transform', 'rotation', 'shape', 'w', 'h'].includes(key))
  ) {
    return false;
  }
  return Object.entries(value).every(([key, item]) => {
    if (key === 'transform') {
      return (
        Array.isArray(item) &&
        item.length === 6 &&
        item.every((part) => typeof part === 'number' && Number.isFinite(part))
      );
    }
    if (key === 'rotation') return typeof item === 'number' && Number.isFinite(item);
    if (key === 'w' || key === 'h')
      return typeof item === 'number' && Number.isFinite(item) && item > 0;
    return record(item) && nonEmptyString(item.kind);
  });
}

function validateLayoutApply(payload: unknown): ValidationResult<PresentationLayoutApplyPayload> {
  if (!record(payload) || !record(payload.preview)) {
    return { ok: false, errors: ['presentation.layout.apply requires a preview'] };
  }
  const preview = payload.preview;
  const validMode = preview.mode === 'reflow' || preview.mode === 'fit' || preview.mode === 'crop';
  const validChanges =
    Array.isArray(preview.changes) &&
    preview.changes.length <= 500 &&
    preview.changes.every(
      (change) =>
        record(change) &&
        nonEmptyString(change.role) &&
        nonEmptyString(change.nodeId) &&
        validLayoutProperties(change.properties) &&
        record(change.baseline) &&
        Object.keys(change.baseline).every((key) =>
          ['transform', 'rotation', 'shape', 'w', 'h'].includes(key),
        ) &&
        Array.isArray(change.preservedOverrides) &&
        change.preservedOverrides.every(nonEmptyString),
    );
  if (
    !nonEmptyString(preview.deckId) ||
    !nonEmptyString(preview.entryId) ||
    !nonEmptyString(preview.sourceId) ||
    !nonEmptyString(preview.sourceFrameId) ||
    typeof preview.sourceRevision !== 'number' ||
    !Number.isInteger(preview.sourceRevision) ||
    preview.sourceRevision < 1 ||
    !validMode ||
    !validRoleMap(preview.roleNodes) ||
    !validChanges ||
    !Array.isArray(preview.unmatchedSourceRoles) ||
    !preview.unmatchedSourceRoles.every(nonEmptyString) ||
    !Array.isArray(preview.unmatchedSlideNodeIds) ||
    !preview.unmatchedSlideNodeIds.every(nonEmptyString) ||
    !Array.isArray(preview.warnings) ||
    !preview.warnings.every((warning) => typeof warning === 'string')
  ) {
    return { ok: false, errors: ['presentation.layout.apply preview contains invalid values'] };
  }
  return { ok: true, value: { preview: preview as unknown as PresentationLayoutPreview } };
}

function deckExists(document: Document, deckId: string): boolean {
  return findPresentationDeck(document, deckId) !== undefined;
}

function sectionExists(document: Document, deckId: string, sectionId: string): boolean {
  return (
    findPresentationDeck(document, deckId)?.sections.some((section) => section.id === sectionId) ===
    true
  );
}

function slideExists(document: Document, deckId: string, entryId: string): boolean {
  return (
    findPresentationDeck(document, deckId)?.slides.some((slide) => slide.id === entryId) === true
  );
}

function isPresentationSlideFrame(document: Document, frameId: NodeId): boolean {
  return (
    document.presentation?.decks.some((deck) =>
      deck.slides.some((slide) => slide.frameId === frameId),
    ) === true
  );
}

export function registerPresentationOperations(): void {
  registerOperation<PresentationDeckCreatePayload>({
    type: 'presentation.deck.create',
    schemaVersion: 1,
    validate: validateDeckCreate,
    apply: (document, payload) => {
      const deck: PresentationDeck = {
        ...payload,
        slides: [],
        sections: [],
      };
      return addPresentationDeck(document, deck);
    },
    summarize: (payload) => ({
      label: `Create presentation ${payload.name}`,
      kind: 'create',
      affectedEntityIds: [payload.id],
    }),
    affectedEntities: (payload) => [payload.id],
    precondition: (document, payload) =>
      document.presentation?.decks.some((deck) => deck.id === payload.id)
        ? `presentation deck id already exists: ${payload.id}`
        : null,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationDeckIdPayload>({
    type: 'presentation.deck.delete',
    schemaVersion: 1,
    validate: (payload) => validateDeckId(payload, 'presentation.deck.delete'),
    apply: (document, payload) => removePresentationDeck(document, payload.deckId),
    summarize: () => ({ label: 'Remove presentation deck', kind: 'delete', affectedEntityIds: [] }),
    affectedEntities: (payload) => [payload.deckId],
    precondition: (document, payload) =>
      deckExists(document, payload.deckId)
        ? null
        : `presentation deck does not exist: ${payload.deckId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationDeckRenamePayload>({
    type: 'presentation.deck.rename',
    schemaVersion: 1,
    validate: validateDeckRename,
    apply: (document, payload) => renamePresentationDeck(document, payload.deckId, payload.name),
    summarize: (payload) => ({
      label: `Rename presentation to ${payload.name}`,
      kind: 'rename',
      affectedEntityIds: [payload.deckId],
    }),
    affectedEntities: (payload) => [payload.deckId],
    precondition: (document, payload) =>
      deckExists(document, payload.deckId)
        ? null
        : `presentation deck does not exist: ${payload.deckId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationSlideAddPayload>({
    type: 'presentation.slide.add',
    schemaVersion: 1,
    validate: validateSlideAdd,
    apply: (document, payload) =>
      addPresentationSlide(document, payload.deckId, payload.entry, payload.index),
    summarize: (payload) => ({
      label: `Add slide ${payload.entry.title}`,
      kind: 'create',
      affectedEntityIds: [payload.entry.frameId],
    }),
    affectedEntities: (payload) => [payload.deckId, payload.entry.frameId],
    precondition: (document, payload) => {
      const deck = findPresentationDeck(document, payload.deckId);
      if (!deck) return `presentation deck does not exist: ${payload.deckId}`;
      const frame = document.nodes[payload.entry.frameId];
      if (frame?.kind !== 'frame' || frame.frameRole === 'exportRegion') {
        return `presentation slide must reference an ordinary frame: ${payload.entry.frameId}`;
      }
      if (deck.slides.some((slide) => slide.frameId === payload.entry.frameId)) {
        return `frame already appears in presentation deck: ${payload.entry.frameId}`;
      }
      if (
        document.presentation?.decks.some((candidate) =>
          candidate.slides.some((slide) => slide.id === payload.entry.id),
        )
      ) {
        return `presentation slide entry id already exists: ${payload.entry.id}`;
      }
      if (
        payload.entry.sectionId &&
        !deck.sections.some((section) => section.id === payload.entry.sectionId)
      ) {
        return `presentation section does not exist: ${payload.entry.sectionId}`;
      }
      if (payload.index !== undefined && payload.index > deck.slides.length) {
        return `presentation slide insertion index is out of range: ${payload.index}`;
      }
      return null;
    },
    maxPayloadBytes: 300_000,
  });

  registerOperation<PresentationSlideReferencePayload>({
    type: 'presentation.slide.remove',
    schemaVersion: 1,
    validate: (payload) => validateSlideReference(payload, 'presentation.slide.remove'),
    apply: (document, payload) =>
      removePresentationSlide(document, payload.deckId, payload.entryId),
    summarize: () => ({
      label: 'Remove slide from presentation',
      kind: 'delete',
      affectedEntityIds: [],
    }),
    affectedEntities: (payload) => [payload.deckId, payload.entryId],
    precondition: (document, payload) =>
      slideExists(document, payload.deckId, payload.entryId)
        ? null
        : `presentation slide entry does not exist: ${payload.entryId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationSlideUpdatePayload>({
    type: 'presentation.slide.update',
    schemaVersion: 1,
    validate: validateSlideUpdate,
    apply: (document, payload) =>
      updatePresentationSlide(document, payload.deckId, payload.entryId, payload.update),
    summarize: () => ({
      label: 'Update presentation slide',
      kind: 'modify',
      affectedEntityIds: [],
    }),
    affectedEntities: (payload) => [payload.deckId, payload.entryId],
    precondition: (document, payload) => {
      if (!slideExists(document, payload.deckId, payload.entryId)) {
        return `presentation slide entry does not exist: ${payload.entryId}`;
      }
      if (
        typeof payload.update.sectionId === 'string' &&
        !sectionExists(document, payload.deckId, payload.update.sectionId)
      ) {
        return `presentation section does not exist: ${payload.update.sectionId}`;
      }
      return null;
    },
    maxPayloadBytes: 300_000,
  });

  registerOperation<PresentationSlideReorderPayload>({
    type: 'presentation.slide.reorder',
    schemaVersion: 1,
    validate: validateSlideReorder,
    apply: (document, payload) =>
      reorderPresentationSlide(document, payload.deckId, payload.entryId, payload.toIndex),
    summarize: () => ({
      label: 'Reorder presentation slides',
      kind: 'reorder',
      affectedEntityIds: [],
    }),
    affectedEntities: (payload) => [payload.deckId, payload.entryId],
    precondition: (document, payload) => {
      const deck = findPresentationDeck(document, payload.deckId);
      if (!deck) return `presentation deck does not exist: ${payload.deckId}`;
      if (!deck.slides.some((slide) => slide.id === payload.entryId)) {
        return `presentation slide entry does not exist: ${payload.entryId}`;
      }
      return payload.toIndex < deck.slides.length
        ? null
        : `presentation slide destination is out of range: ${payload.toIndex}`;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationSectionCreatePayload>({
    type: 'presentation.section.create',
    schemaVersion: 1,
    validate: validateSectionCreate,
    apply: (document, payload) => addPresentationSection(document, payload.deckId, payload.section),
    summarize: (payload) => ({
      label: `Create section ${payload.section.title}`,
      kind: 'create',
      affectedEntityIds: [payload.deckId],
    }),
    affectedEntities: (payload) => [payload.deckId],
    precondition: (document, payload) => {
      const deck = findPresentationDeck(document, payload.deckId);
      if (!deck) return `presentation deck does not exist: ${payload.deckId}`;
      return deck.sections.some((section) => section.id === payload.section.id)
        ? `presentation section id already exists: ${payload.section.id}`
        : null;
    },
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationSectionRenamePayload>({
    type: 'presentation.section.rename',
    schemaVersion: 1,
    validate: validateSectionRename,
    apply: (document, payload) =>
      renamePresentationSection(document, payload.deckId, payload.sectionId, payload.title),
    summarize: (payload) => ({
      label: `Rename presentation section to ${payload.title}`,
      kind: 'rename',
      affectedEntityIds: [payload.deckId],
    }),
    affectedEntities: (payload) => [payload.deckId],
    precondition: (document, payload) =>
      sectionExists(document, payload.deckId, payload.sectionId)
        ? null
        : `presentation section does not exist: ${payload.sectionId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationSectionDeletePayload>({
    type: 'presentation.section.delete',
    schemaVersion: 1,
    validate: validateSectionDelete,
    apply: (document, payload) =>
      removePresentationSection(document, payload.deckId, payload.sectionId),
    summarize: () => ({
      label: 'Remove presentation section',
      kind: 'delete',
      affectedEntityIds: [],
    }),
    affectedEntities: (payload) => [payload.deckId],
    precondition: (document, payload) =>
      sectionExists(document, payload.deckId, payload.sectionId)
        ? null
        : `presentation section does not exist: ${payload.sectionId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationLayoutRegisterPayload>({
    type: 'presentation.layout.register',
    schemaVersion: 1,
    validate: validateLayoutRegister,
    apply: (document, payload) => registerPresentationLayout(document, payload.source),
    summarize: (payload) => ({
      label: `Register presentation layout ${payload.source.name}`,
      kind: 'create',
      affectedEntityIds: [payload.source.id, payload.source.frameId],
    }),
    affectedEntities: (payload) => [payload.source.id, payload.source.frameId],
    precondition: (document, payload) => {
      if (!document.presentation) return 'Create a presentation before registering a layout.';
      if (document.presentation.layouts.some((layout) => layout.id === payload.source.id)) {
        return `presentation layout id already exists: ${payload.source.id}`;
      }
      const frame = document.nodes[payload.source.frameId];
      if (frame?.kind !== 'frame')
        return `presentation layout frame does not exist: ${payload.source.frameId}`;
      if (isPresentationSlideFrame(document, frame.id)) {
        return 'A layout source frame must not also appear as a slide in a presentation deck.';
      }
      return Object.values(payload.source.roleNodes).every((nodeId) =>
        frame.children.includes(nodeId),
      )
        ? null
        : 'Every layout role must point to a direct child of its source frame.';
    },
    maxPayloadBytes: 40_000,
  });

  registerOperation<PresentationLayoutUpdatePayload>({
    type: 'presentation.layout.update',
    schemaVersion: 1,
    validate: validateLayoutUpdate,
    apply: (document, payload) =>
      updatePresentationLayoutSource(document, payload.sourceId, {
        name: payload.name,
        frameId: payload.frameId,
        roleNodes: payload.roleNodes,
      }),
    summarize: (payload) => ({
      label: `Update presentation layout ${payload.name}`,
      kind: 'modify',
      affectedEntityIds: [payload.sourceId, payload.frameId],
    }),
    affectedEntities: (payload) => [payload.sourceId, payload.frameId],
    precondition: (document, payload) => {
      const source = document.presentation?.layouts.find(
        (layout) => layout.id === payload.sourceId,
      );
      if (!source) return `presentation layout source does not exist: ${payload.sourceId}`;
      const frame = document.nodes[payload.frameId];
      if (frame?.kind !== 'frame')
        return `presentation layout frame does not exist: ${payload.frameId}`;
      if (isPresentationSlideFrame(document, frame.id)) {
        return 'A layout source frame must not also appear as a slide in a presentation deck.';
      }
      return Object.values(payload.roleNodes).every((nodeId) => frame.children.includes(nodeId))
        ? null
        : 'Every layout role must point to a direct child of its source frame.';
    },
    maxPayloadBytes: 40_000,
  });

  registerOperation<PresentationLayoutDeletePayload>({
    type: 'presentation.layout.delete',
    schemaVersion: 1,
    validate: validateLayoutDelete,
    apply: (document, payload) => removePresentationLayout(document, payload.sourceId),
    summarize: () => ({
      label: 'Remove presentation layout source',
      kind: 'delete',
      affectedEntityIds: [],
    }),
    affectedEntities: (payload) => [payload.sourceId],
    precondition: (document, payload) =>
      document.presentation?.layouts.some((layout) => layout.id === payload.sourceId)
        ? null
        : `presentation layout source does not exist: ${payload.sourceId}`,
    maxPayloadBytes: 8_000,
  });

  registerOperation<PresentationLayoutApplyPayload>({
    type: 'presentation.layout.apply',
    schemaVersion: 1,
    validate: validateLayoutApply,
    apply: (document, payload) => applyPresentationLayoutPreview(document, payload.preview),
    summarize: () => ({
      label: 'Apply presentation layout',
      kind: 'modify',
      affectedEntityIds: [],
    }),
    affectedEntities: (payload) => [
      payload.preview.deckId,
      payload.preview.entryId,
      payload.preview.sourceId,
    ],
    precondition: (document, payload) => {
      const { preview } = payload;
      const source = document.presentation?.layouts.find(
        (layout) => layout.id === preview.sourceId,
      );
      if (
        !source ||
        source.frameId !== preview.sourceFrameId ||
        source.revision !== preview.sourceRevision
      ) {
        return 'The layout source changed after preview. Preview the latest revision before applying.';
      }
      if (isPresentationLayoutSourceOutdated(document, source)) {
        return 'The layout source has unreviewed edits. Refresh the source and preview again before applying.';
      }
      try {
        const current = previewPresentationLayout(
          document,
          preview.deckId,
          preview.entryId,
          preview.sourceId,
          preview.roleNodes,
          preview.mode,
        );
        return JSON.stringify(current) === JSON.stringify(preview)
          ? null
          : 'The slide or layout changed after preview. Review a fresh layout preview before applying.';
      } catch (error) {
        return error instanceof Error
          ? error.message
          : 'The slide or layout is no longer available.';
      }
    },
    maxPayloadBytes: 500_000,
  });
}
