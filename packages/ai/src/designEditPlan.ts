/**
 * Provider-independent multimodal editing contract.
 *
 * Providers may suggest this JSON-shaped plan, but they never receive a
 * document mutator. The editor validates freshness, previews the operations,
 * and translates an approved plan into its normal command/history boundary.
 */

export type DesignInputKind =
  | 'text'
  | 'screenshot'
  | 'photo'
  | 'sketch'
  | 'wireframe'
  | 'selection'
  | 'document'
  | 'svg'
  | 'raster'
  | 'tokens';

export type DesignPlanMode = 'suggest' | 'preview' | 'apply';
export type DesignPlanScope = 'selection' | 'frame' | 'page' | 'document';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface DesignPlanSource {
  kind: DesignInputKind;
  /** Stable caller-owned reference, never a filesystem path or credential. */
  id?: string;
  label?: string;
}

export interface DesignEditPlan {
  planId: string;
  requestId: string;
  documentId: string;
  /** Editor-owned revision captured before analysis began. */
  baseRevision: number;
  mode: DesignPlanMode;
  scope: DesignPlanScope;
  source: DesignPlanSource;
  confidence: number;
  warnings: string[];
  operations: DesignEditOperation[];
}

export type DesignNodeKind = 'shape' | 'text' | 'frame' | 'group' | 'image';

export type DesignEditOperation =
  | {
      kind: 'create-node';
      nodeId: string;
      nodeKind: DesignNodeKind;
      parentId?: string;
      name?: string;
      properties?: Record<string, JsonValue>;
    }
  | {
      kind: 'set-property';
      nodeId: string;
      property: string;
      value: JsonValue;
    }
  | {
      kind: 'move-node';
      nodeId: string;
      x: number;
      y: number;
    }
  | {
      kind: 'resize-node';
      nodeId: string;
      width: number;
      height: number;
    }
  | {
      kind: 'reparent-node';
      nodeId: string;
      parentId: string;
    }
  | {
      kind: 'apply-layout';
      nodeId: string;
      layout: 'none' | 'stack' | 'row' | 'column' | 'grid';
      gap?: number;
      padding?: number;
    }
  | {
      kind: 'create-component';
      componentId: string;
      rootNodeId: string;
      name: string;
    }
  | {
      kind: 'bind-token';
      nodeId: string;
      property: string;
      tokenId: string;
    }
  | {
      kind: 'import-asset';
      assetId: string;
      mimeType: string;
      sourceId: string;
    }
  | {
      kind: 'connect-interaction';
      sourceNodeId: string;
      targetNodeId: string;
      trigger: 'click' | 'tap' | 'hover' | 'key';
    };

export interface DesignEditSnapshot {
  documentId: string;
  revision: number;
  nodeIds: ReadonlySet<string>;
}

export interface DesignPlanValidation {
  valid: boolean;
  errors: string[];
  plan?: DesignEditPlan;
}

export interface DesignPlanFreshness {
  fresh: boolean;
  reasons: string[];
}

const MAX_OPERATIONS = 1000;
const MAX_STRING_LENGTH = 4000;
const MAX_JSON_DEPTH = 8;
const PROPERTY_SEGMENT = /^[A-Za-z_$][\w$]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeString(value: unknown, required = true): value is string {
  return (
    typeof value === 'string' &&
    (required ? value.length > 0 : true) &&
    value.length <= MAX_STRING_LENGTH &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return typeof value !== 'string' || isSafeString(value, false);
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= MAX_JSON_DEPTH || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  return Object.entries(value).every(
    ([key, entry]) =>
      key !== '__proto__' &&
      key !== 'constructor' &&
      key !== 'prototype' &&
      isJsonValue(entry, depth + 1),
  );
}

function isPropertyPath(value: unknown): value is string {
  if (!isSafeString(value)) return false;
  return value
    .split('.')
    .every(
      (segment) =>
        PROPERTY_SEGMENT.test(segment) &&
        segment !== '__proto__' &&
        segment !== 'constructor' &&
        segment !== 'prototype',
    );
}

function hasNode(knownNodeIds: Set<string>, nodeId: unknown): nodeId is string {
  return isSafeString(nodeId) && knownNodeIds.has(nodeId);
}

function validateOperation(
  raw: unknown,
  index: number,
  knownNodeIds: Set<string>,
  createdComponentIds: Set<string>,
  errors: string[],
): raw is DesignEditOperation {
  if (!isRecord(raw) || !isSafeString(raw.kind)) {
    errors.push(`operations[${index}] must have a valid kind`);
    return false;
  }

  const operation = raw as Record<string, unknown>;
  const requireNode = (field: string): boolean => {
    if (!hasNode(knownNodeIds, operation[field])) {
      errors.push(
        `operations[${index}].${field} must reference an existing or earlier-created node`,
      );
      return false;
    }
    return true;
  };
  const requireFinite = (field: string): boolean => {
    if (!isFiniteNumber(operation[field])) {
      errors.push(`operations[${index}].${field} must be a finite number`);
      return false;
    }
    return true;
  };

  switch (operation.kind) {
    case 'create-node': {
      if (!isSafeString(operation.nodeId) || knownNodeIds.has(operation.nodeId)) {
        errors.push(`operations[${index}].nodeId must be unique and valid`);
      } else {
        knownNodeIds.add(operation.nodeId);
      }
      if (!['shape', 'text', 'frame', 'group', 'image'].includes(String(operation.nodeKind))) {
        errors.push(`operations[${index}].nodeKind is unsupported`);
      }
      if (operation.parentId !== undefined && !requireNode('parentId')) return false;
      if (operation.name !== undefined && !isSafeString(operation.name)) {
        errors.push(`operations[${index}].name must be a safe string`);
      }
      if (
        operation.properties !== undefined &&
        (!isRecord(operation.properties) || !isJsonValue(operation.properties))
      ) {
        errors.push(`operations[${index}].properties must be JSON data`);
      }
      return true;
    }
    case 'set-property':
      requireNode('nodeId');
      if (!isPropertyPath(operation.property))
        errors.push(`operations[${index}].property is invalid`);
      if (!isJsonValue(operation.value))
        errors.push(`operations[${index}].value must be JSON data`);
      return true;
    case 'move-node':
      requireNode('nodeId');
      requireFinite('x');
      requireFinite('y');
      return true;
    case 'resize-node':
      requireNode('nodeId');
      requireFinite('width');
      requireFinite('height');
      if (isFiniteNumber(operation.width) && operation.width < 0)
        errors.push(`operations[${index}].width cannot be negative`);
      if (isFiniteNumber(operation.height) && operation.height < 0)
        errors.push(`operations[${index}].height cannot be negative`);
      return true;
    case 'reparent-node':
      requireNode('nodeId');
      if (!requireNode('parentId')) return true;
      if (operation.nodeId === operation.parentId)
        errors.push(`operations[${index}] cannot reparent a node to itself`);
      return true;
    case 'apply-layout':
      requireNode('nodeId');
      if (!['none', 'stack', 'row', 'column', 'grid'].includes(String(operation.layout)))
        errors.push(`operations[${index}].layout is unsupported`);
      if (operation.gap !== undefined) requireFinite('gap');
      if (operation.padding !== undefined) requireFinite('padding');
      return true;
    case 'create-component':
      if (!isSafeString(operation.componentId) || createdComponentIds.has(operation.componentId))
        errors.push(`operations[${index}].componentId must be unique and valid`);
      else createdComponentIds.add(operation.componentId);
      requireNode('rootNodeId');
      if (!isSafeString(operation.name))
        errors.push(`operations[${index}].name must be a safe string`);
      return true;
    case 'bind-token':
      requireNode('nodeId');
      if (!isPropertyPath(operation.property))
        errors.push(`operations[${index}].property is invalid`);
      if (!isSafeString(operation.tokenId))
        errors.push(`operations[${index}].tokenId must be valid`);
      return true;
    case 'import-asset':
      if (!isSafeString(operation.assetId) || !isSafeString(operation.sourceId))
        errors.push(`operations[${index}] asset ids must be valid`);
      if (!isSafeString(operation.mimeType) || !operation.mimeType.includes('/'))
        errors.push(`operations[${index}].mimeType must be valid`);
      return true;
    case 'connect-interaction':
      requireNode('sourceNodeId');
      requireNode('targetNodeId');
      if (!['click', 'tap', 'hover', 'key'].includes(String(operation.trigger)))
        errors.push(`operations[${index}].trigger is unsupported`);
      return true;
    default:
      errors.push(`operations[${index}] has unsupported kind '${operation.kind}'`);
      return false;
  }
}

/** Validate an untrusted provider result before it can reach editor code. */
export function validateDesignEditPlan(
  input: unknown,
  snapshot?: DesignEditSnapshot,
): DesignPlanValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['plan must be an object'] };

  const requiredStrings = ['planId', 'requestId', 'documentId'] as const;
  for (const field of requiredStrings) {
    if (!isSafeString(input[field])) errors.push(`plan.${field} must be a safe string`);
  }
  if (!isFiniteNumber(input.baseRevision) || input.baseRevision < 0)
    errors.push('plan.baseRevision must be a non-negative finite number');
  if (!['suggest', 'preview', 'apply'].includes(String(input.mode)))
    errors.push('plan.mode is unsupported');
  if (!['selection', 'frame', 'page', 'document'].includes(String(input.scope)))
    errors.push('plan.scope is unsupported');
  if (
    !isRecord(input.source) ||
    ![
      'text',
      'screenshot',
      'photo',
      'sketch',
      'wireframe',
      'selection',
      'document',
      'svg',
      'raster',
      'tokens',
    ].includes(String(input.source?.kind))
  ) {
    errors.push('plan.source.kind is unsupported');
  }
  if (isRecord(input.source)) {
    if (input.source.id !== undefined && !isSafeString(input.source.id))
      errors.push('plan.source.id must be a safe string');
    if (input.source.label !== undefined && !isSafeString(input.source.label))
      errors.push('plan.source.label must be a safe string');
  }
  if (!isFiniteNumber(input.confidence) || input.confidence < 0 || input.confidence > 1)
    errors.push('plan.confidence must be between 0 and 1');
  if (!Array.isArray(input.warnings) || !input.warnings.every((warning) => isSafeString(warning)))
    errors.push('plan.warnings must be safe strings');
  if (!Array.isArray(input.operations) || input.operations.length > MAX_OPERATIONS) {
    errors.push(`plan.operations must contain at most ${MAX_OPERATIONS} items`);
  }

  const knownNodeIds = new Set(snapshot?.nodeIds ?? []);
  const createdComponentIds = new Set<string>();
  if (Array.isArray(input.operations)) {
    input.operations.forEach((operation, index) => {
      validateOperation(operation, index, knownNodeIds, createdComponentIds, errors);
    });
  }

  const plan = input as unknown as DesignEditPlan;
  if (snapshot) {
    const freshness = checkDesignPlanFreshness(plan, snapshot);
    errors.push(...freshness.reasons);
  }
  return errors.length === 0 ? { valid: true, errors: [], plan } : { valid: false, errors };
}

/** Reject a plan produced for a document or revision that has since changed. */
export function checkDesignPlanFreshness(
  plan: DesignEditPlan,
  snapshot: DesignEditSnapshot,
): DesignPlanFreshness {
  const reasons: string[] = [];
  if (plan.documentId !== snapshot.documentId)
    reasons.push('document changed while the plan was pending');
  if (plan.baseRevision !== snapshot.revision)
    reasons.push('document revision changed while the plan was pending');

  const created = new Set(
    plan.operations
      .filter((operation) => operation.kind === 'create-node')
      .map((operation) => operation.nodeId),
  );
  for (const operation of plan.operations) {
    const ids =
      operation.kind === 'connect-interaction'
        ? [operation.sourceNodeId, operation.targetNodeId]
        : operation.kind === 'create-node'
          ? operation.parentId
            ? [operation.parentId]
            : []
          : operation.kind === 'create-component'
            ? [operation.rootNodeId]
            : operation.kind === 'import-asset'
              ? []
              : [
                  operation.nodeId,
                  operation.kind === 'reparent-node' ? operation.parentId : undefined,
                ];
    for (const id of ids) {
      if (id && !snapshot.nodeIds.has(id) && !created.has(id))
        reasons.push(`target node '${id}' no longer exists`);
    }
  }
  return { fresh: reasons.length === 0, reasons: [...new Set(reasons)] };
}
