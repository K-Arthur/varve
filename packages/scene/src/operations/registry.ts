/**
 * Versioned operation registry (ADR-0017/0045).
 *
 * Every operation type must be registered exactly once with its schema
 * version, validator, pure apply function, summary, and affected-entity
 * extraction. Replay and diff migrate payloads in memory before apply.
 */
import type { Document } from '../document';
import type { NodeId } from '../types';
import type { OperationDefinition, ValidationResult } from './types';

const registry = new Map<string, OperationDefinition<unknown>>();

/** Register an operation type. Throws on duplicate type or schema conflict. */
export function registerOperation<TPayload>(def: OperationDefinition<TPayload>): void {
  const existing = registry.get(def.type);
  if (existing && existing.schemaVersion !== def.schemaVersion) {
    throw new Error(
      `Operation ${def.type} already registered with schemaVersion ${existing.schemaVersion}; ` +
        `refusing ${def.schemaVersion}`,
    );
  }
  registry.set(def.type, def as OperationDefinition<unknown>);
}

export function hasOperation(type: string): boolean {
  return registry.has(type);
}

export function getOperation(type: string): OperationDefinition<unknown> | undefined {
  return registry.get(type);
}

/** All registered operation types (sorted for deterministic iteration). */
export function listOperationTypes(): string[] {
  return [...registry.keys()].sort();
}

/** Validate an unknown payload against the registered definition. */
export function validatePayload(type: string, payload: unknown): ValidationResult<unknown> {
  const def = registry.get(type);
  if (!def) return { ok: false, errors: [`unknown operation type: ${type}`] };
  return def.validate(payload) as ValidationResult<unknown>;
}

/** Apply an operation to a document (pure). Throws when unregistered. */
export function applyOperation<TPayload>(
  document: Document,
  type: string,
  payload: TPayload,
): Document {
  const def = registry.get(type);
  if (!def) throw new Error(`unknown operation type: ${type}`);
  return def.apply(document, payload as never);
}

/** Summarize an operation payload into a history-step label. */
export function summarizeOperation(
  type: string,
  payload: unknown,
): { label: string; kind: string; affectedEntityIds: NodeId[] } {
  const def = registry.get(type);
  if (!def) throw new Error(`unknown operation type: ${type}`);
  const summary = def.summarize(payload as never, {});
  return {
    label: summary.label,
    kind: summary.kind,
    affectedEntityIds: summary.affectedEntityIds,
  };
}

/** Affected entity ids for a payload (drives entity-history indexes). */
export function affectedEntitiesOf<TPayload>(type: string, payload: TPayload): NodeId[] {
  const def = registry.get(type);
  if (!def) throw new Error(`unknown operation type: ${type}`);
  return def.affectedEntities(payload as never);
}

/** Precondition check against the current document; null = satisfied. */
export function preconditionFailure<TPayload>(
  document: Document,
  type: string,
  payload: TPayload,
): string | null {
  const def = registry.get(type);
  if (!def) return `unknown operation type: ${type}`;
  return def.precondition ? def.precondition(document, payload as never) : null;
}

/** Migrate a payload recorded under an older schema version (ADR-0045). */
export function migratePayload(type: string, payload: unknown, fromVersion: number): unknown {
  const def = registry.get(type);
  if (!def) return payload;
  if (!def.migrate || fromVersion >= def.schemaVersion) return payload;
  return def.migrate(payload, fromVersion);
}
