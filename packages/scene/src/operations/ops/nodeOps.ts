/**
 * Starter operation family: node.*
 *
 * Every operation here is pure: `apply(document, payload)` returns a new
 * document and never mutates its input. Payloads are validated before apply.
 * See ADR-0017/0018 for the pipeline contract.
 */
import type { Document } from '../../document';
import { addChild, addNode, arrangeNode, moveNode, removeNode } from '../../document';
import type { NodeId, SceneNode } from '../../types';
import { registerOperation } from '../registry';

// ── node.create ──────────────────────────────────────────────────────────────

export interface NodeCreatePayload {
  node: SceneNode;
  /** Parent node id; omitted = document root. */
  parentId?: string;
  /** Optional paint-order position among siblings (default append). */
  index?: number;
}

export function registerNodeOperations(): void {
  registerOperation<NodeCreatePayload>({
    type: 'node.create',
    schemaVersion: 1,
    validate(payload: unknown) {
      if (typeof payload !== 'object' || payload === null) {
        return { ok: false, errors: ['node.create payload must be an object'] };
      }
      const p = payload as Record<string, unknown>;
      const node = p.node as Record<string, unknown> | undefined;
      if (typeof node !== 'object' || node === null) {
        return { ok: false, errors: ['node.create requires a node object'] };
      }
      if (typeof node.id !== 'string' || node.id.length === 0) {
        return { ok: false, errors: ['node.create requires node.id'] };
      }
      if (typeof node.kind !== 'string') {
        return { ok: false, errors: ['node.create requires node.kind'] };
      }
      if (p.parentId !== undefined && typeof p.parentId !== 'string') {
        return { ok: false, errors: ['node.create parentId must be a string'] };
      }
      if (p.index !== undefined && (typeof p.index !== 'number' || !Number.isInteger(p.index))) {
        return { ok: false, errors: ['node.create index must be an integer'] };
      }
      return { ok: true, value: p as unknown as NodeCreatePayload };
    },
    apply(document: Document, payload: NodeCreatePayload) {
      const withNode =
        payload.parentId !== undefined
          ? addChild(document, payload.parentId, payload.node)
          : addNode(document, payload.node);
      if (payload.index === undefined) return withNode;
      return moveNode(withNode, payload.node.id, payload.index);
    },
    summarize(payload: NodeCreatePayload) {
      return {
        label: `Create ${payload.node.name || payload.node.kind}`,
        kind: 'create',
        affectedEntityIds: [payload.node.id],
      };
    },
    affectedEntities(payload: NodeCreatePayload) {
      return [payload.node.id];
    },
    precondition(document: Document, payload: NodeCreatePayload) {
      if (document.nodes[payload.node.id]) return `node already exists: ${payload.node.id}`;
      if (payload.parentId !== undefined && !document.nodes[payload.parentId]) {
        return `parent does not exist: ${payload.parentId}`;
      }
      return null;
    },
    maxPayloadBytes: 250_000,
  });

  // ── node.delete ──────────────────────────────────────────────────────────────

  registerOperation<{ nodeId: NodeId }>({
    type: 'node.delete',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null || typeof p.nodeId !== 'string') {
        return { ok: false, errors: ['node.delete requires nodeId'] };
      }
      return { ok: true, value: p as unknown as { nodeId: NodeId } };
    },
    apply(document: Document, payload: { nodeId: NodeId }) {
      return removeNode(document, payload.nodeId);
    },
    summarize(payload: { nodeId: NodeId }) {
      return { label: 'Delete', kind: 'delete', affectedEntityIds: [payload.nodeId] };
    },
    affectedEntities(payload: { nodeId: NodeId }) {
      return [payload.nodeId];
    },
    precondition(document: Document, payload: { nodeId: NodeId }) {
      return document.nodes[payload.nodeId] ? null : `node does not exist: ${payload.nodeId}`;
    },
  });

  // ── node.move (paint-order move within the root) ─────────────────────────────

  registerOperation<{ nodeId: NodeId; toIndex: number }>({
    type: 'node.move',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null || typeof p.nodeId !== 'string') {
        return { ok: false, errors: ['node.move requires nodeId'] };
      }
      if (typeof p.toIndex !== 'number' || !Number.isInteger(p.toIndex)) {
        return { ok: false, errors: ['node.move requires integer toIndex'] };
      }
      return { ok: true, value: p as unknown as { nodeId: NodeId; toIndex: number } };
    },
    apply(document: Document, payload: { nodeId: NodeId; toIndex: number }) {
      return moveNode(document, payload.nodeId, payload.toIndex);
    },
    summarize(payload: { nodeId: NodeId }) {
      return { label: 'Move layer', kind: 'move', affectedEntityIds: [payload.nodeId] };
    },
    affectedEntities(payload: { nodeId: NodeId }) {
      return [payload.nodeId];
    },
    precondition(document: Document, payload: { nodeId: NodeId }) {
      return document.nodes[payload.nodeId] ? null : `node does not exist: ${payload.nodeId}`;
    },
  });

  // ── node.reorder (arrange within siblings) ───────────────────────────────────

  registerOperation<{ nodeId: NodeId; position: 'front' | 'back' | 'forward' | 'backward' }>({
    type: 'node.reorder',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null || typeof p.nodeId !== 'string') {
        return { ok: false, errors: ['node.reorder requires nodeId'] };
      }
      if (!['front', 'back', 'forward', 'backward'].includes(p.position as string)) {
        return { ok: false, errors: ['node.reorder requires a valid position'] };
      }
      return {
        ok: true,
        value: p as unknown as {
          nodeId: NodeId;
          position: 'front' | 'back' | 'forward' | 'backward';
        },
      };
    },
    apply(
      document: Document,
      payload: { nodeId: NodeId; position: 'front' | 'back' | 'forward' | 'backward' },
    ) {
      return arrangeNode(document, payload.nodeId, payload.position);
    },
    summarize(payload: { nodeId: NodeId; position: string }) {
      return {
        label: `Reorder (${payload.position})`,
        kind: 'reorder',
        affectedEntityIds: [payload.nodeId],
      };
    },
    affectedEntities(payload: { nodeId: NodeId }) {
      return [payload.nodeId];
    },
  });

  // ── node.rename ──────────────────────────────────────────────────────────────

  registerOperation<{ nodeId: NodeId; name: string }>({
    type: 'node.rename',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null || typeof p.nodeId !== 'string') {
        return { ok: false, errors: ['node.rename requires nodeId'] };
      }
      if (typeof p.name !== 'string') {
        return { ok: false, errors: ['node.rename requires name'] };
      }
      return { ok: true, value: p as unknown as { nodeId: NodeId; name: string } };
    },
    apply(document: Document, payload: { nodeId: NodeId; name: string }) {
      const node = document.nodes[payload.nodeId];
      if (!node) return document;
      return {
        ...document,
        nodes: { ...document.nodes, [payload.nodeId]: { ...node, name: payload.name } },
      };
    },
    summarize(payload: { nodeId: NodeId; name: string }) {
      return {
        label: `Rename to "${payload.name}"`,
        kind: 'rename',
        affectedEntityIds: [payload.nodeId],
      };
    },
    affectedEntities(payload: { nodeId: NodeId }) {
      return [payload.nodeId];
    },
    precondition(document: Document, payload: { nodeId: NodeId }) {
      return document.nodes[payload.nodeId] ? null : `node does not exist: ${payload.nodeId}`;
    },
  });

  // ── node.patch (validated property update) ───────────────────────────────────

  registerOperation<{ nodeId: NodeId; path: string; value: unknown }>({
    type: 'node.patch',
    schemaVersion: 1,
    validate(payload: unknown) {
      const p = payload as Record<string, unknown> | null;
      if (typeof p !== 'object' || p === null || typeof p.nodeId !== 'string') {
        return { ok: false, errors: ['node.patch requires nodeId'] };
      }
      if (typeof p.path !== 'string' || !PROPERTY_PATHS.has(p.path)) {
        return { ok: false, errors: [`node.patch path not allowed: ${String(p.path)}`] };
      }
      const validate = PROPERTY_PATHS.get(p.path)!;
      const error = validate(p.value);
      if (error) return { ok: false, errors: [`node.patch ${p.path}: ${error}`] };
      return { ok: true, value: p as unknown as { nodeId: NodeId; path: string; value: unknown } };
    },
    apply(document: Document, payload: { nodeId: NodeId; path: string; value: unknown }) {
      return patchNodeProperty(document, payload.nodeId, payload.path, payload.value);
    },
    summarize(payload: { nodeId: NodeId; path: string }) {
      return {
        label: `Change ${payload.path}`,
        kind: 'modify',
        affectedEntityIds: [payload.nodeId],
      };
    },
    affectedEntities(payload: { nodeId: NodeId }) {
      return [payload.nodeId];
    },
    precondition(document: Document, payload: { nodeId: NodeId }) {
      return document.nodes[payload.nodeId] ? null : `node does not exist: ${payload.nodeId}`;
    },
    maxPayloadBytes: 500_000,
  });
}

// ── node.patch property whitelist ─────────────────────────────────────────────

const BLEND_MODES = new Set([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

type PropertyValidator = (value: unknown) => string | null;

const isString = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numberIn(lo: number, hi: number): PropertyValidator {
  return (v) =>
    isFiniteNumber(v) && v >= lo && v <= hi ? null : `expected a finite number in [${lo}, ${hi}]`;
}

function shapeField(name: string): PropertyValidator {
  return (v) => (isFiniteNumber(v) ? null : `shape.${name} must be a finite number`);
}

const PROPERTY_PATHS = new Map<string, PropertyValidator>([
  ['name', (v) => (isString(v) ? null : 'name must be a string')],
  ['visible', (v) => (isBoolean(v) ? null : 'visible must be a boolean')],
  ['locked', (v) => (isBoolean(v) ? null : 'locked must be a boolean')],
  ['opacity', numberIn(0, 1)],
  ['rotation', (v) => (isFiniteNumber(v) ? null : 'rotation must be a finite number')],
  ['blendMode', (v) => (isString(v) && BLEND_MODES.has(v) ? null : 'unknown blend mode')],
  ['styleId', (v) => (isString(v) ? null : 'styleId must be a string')],
  ['shape.x', shapeField('x')],
  ['shape.y', shapeField('y')],
  ['shape.w', shapeField('w')],
  ['shape.h', shapeField('h')],
  ['shape.cx', shapeField('cx')],
  ['shape.cy', shapeField('cy')],
  ['shape.rx', shapeField('rx')],
  ['shape.ry', shapeField('ry')],
  ['shape.r', shapeField('r')],
  ['shape.radius', shapeField('radius')],
  ['w', shapeField('w')],
  ['h', shapeField('h')],
  ['text', (v) => (isString(v) ? null : 'text must be a string')],
  ['fontSize', (v) => (isFiniteNumber(v) && v > 0 ? null : 'fontSize must be a positive number')],
  ['fontWeight', (v) => (isFiniteNumber(v) ? null : 'fontWeight must be a number')],
  ['fontFamily', (v) => (isString(v) ? null : 'fontFamily must be a string')],
  ['textAlign', (v) => (isString(v) ? null : 'textAlign must be a string')],
  [
    'cornerRadius',
    (v) => {
      if (isFiniteNumber(v)) return null;
      if (Array.isArray(v) && v.length === 4 && v.every(isFiniteNumber)) return null;
      return 'cornerRadius must be a number or 4-number array';
    },
  ],
  ['clipContent', (v) => (isBoolean(v) ? null : 'clipContent must be a boolean')],
  [
    'fill',
    (v) => {
      if (typeof v !== 'object' || v === null) return 'fill must be an object';
      const c = v as Record<string, unknown>;
      return isString(c.space) && c.space.length > 0 ? null : 'fill must be a managed color';
    },
  ],
]);

export function isAllowedPropertyPath(path: string): boolean {
  return PROPERTY_PATHS.has(path);
}

function patchNodeProperty(
  document: Document,
  nodeId: NodeId,
  path: string,
  value: unknown,
): Document {
  const node = document.nodes[nodeId];
  if (!node) return document;
  const next: SceneNode = { ...node } as SceneNode;
  const record = next as unknown as Record<string, unknown>;
  if (path.startsWith('shape.')) {
    const field = path.slice('shape.'.length);
    const shape = { ...(record.shape as Record<string, unknown>), [field]: value };
    record.shape = shape;
  } else {
    record[path] = value;
  }
  return { ...document, nodes: { ...document.nodes, [nodeId]: next } };
}
