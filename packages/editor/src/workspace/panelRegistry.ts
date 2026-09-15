/**
 * Declarative panel registry — the single source of truth for what panels
 * exist, what they can do, and whether they may detach (ADR-0019).
 *
 * Everything panel-related derives from here:
 * - Detach/attach/move commands and validation
 * - Dock-model validation (minimum sizes, instance policies)
 * - Auxiliary-window chunk loading (loadPolicy, requires* capabilities)
 * - Per-window capability scoping (documentRequirement, selectionScope)
 *
 * A panel is NOT detachable until it implements the full
 * `DetachablePanelLifecycle` and its local-state codec, and its definition
 * is flipped to `detachable: true` with tests (M7). Until then `detachable`
 * is false for every registered panel; the invariant checker enforces the
 * rule that a detachable panel must carry the lifecycle + codec.
 *
 * The existing `PanelId` union (workspaceTypes.ts) stays the authoritative
 * panel *type* id list; the registry registers exactly those ids. Panel
 * *instances* (stable ids, host assignment) belong to the dock model
 * (ADR-0021), not the registry.
 */

import type { IconName } from '@varve/ui';
import type { PanelId } from './workspaceTypes';

export type PanelTypeId = PanelId;

export type PanelInstancePolicy = 'singleton' | 'single-per-document' | 'multiple';
export type PanelDocumentRequirement = 'none' | 'active-document';
export type PanelSelectionScope = 'shared' | 'none';
export type PanelHostKind = 'primary-sidebar' | 'auxiliary-window';
export type PanelLoadPolicy = 'eager' | 'lazy';
export type PanelInactivePolicy = 'keep-mounted' | 'suspend' | 'unmount-with-state';

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelCapabilities {
  /** Panel requires the canvas element/DOM (viewport math, overlays). */
  requiresCanvas: boolean;
  /** Panel requires the scene compositor/renderer (IR replay, thumbnails). */
  requiresRenderer: boolean;
  /** Panel requires model runtimes (ONNX workers, inference). */
  requiresModels: boolean;
  /** Panel supports more than one instance per session. */
  supportsMultipleInstances: boolean;
  /** Panel supports being pinned to a specific document (deferred, ADR-0027). */
  supportsDocumentPinning: boolean;
}

/** Context provided to a panel during a transfer transaction (ADR-0029). */
export interface PanelTransferContext {
  panelTypeId: PanelTypeId;
  panelInstanceId: string;
  originHostId: string;
  destinationHostId: string;
  documentId: string | null;
  activeDocumentId: string | null;
}

/**
 * Bounded, typed, versioned snapshot of a panel's local presentation state.
 * Must never contain DOM nodes, functions, credentials, or large document
 * slices (ADR-0018).
 */
export interface PanelTransferSnapshot {
  schemaVersion: number;
  panelTypeId: PanelTypeId;
  state: unknown;
  /** Approximate serialized byte size, enforced against the codec budget. */
  byteSize: number;
}

export type PanelCloseDecision = { allow: true } | { allow: false; reason: string };

/**
 * Lifecycle contract a panel must implement before it may detach
 * (ADR-0019). Every method is optional in the type so definitions stay
 * small; the invariant checker requires the full set when
 * `detachable: true`.
 */
export interface DetachablePanelLifecycle {
  prepareForTransfer?(context: PanelTransferContext): Promise<PanelTransferSnapshot>;
  restoreFromTransfer?(snapshot: PanelTransferSnapshot): Promise<void>;
  suspend?(): Promise<void>;
  resume?(): Promise<void>;
  beforeHostClose?(): Promise<PanelCloseDecision>;
}

/**
 * Typed, versioned, bounded codec for panel-local state. `encode` must
 * return null when the state cannot be serialized safely (open modal,
 * active pointer capture, IME composition — the panel blocks the transfer
 * instead of guessing, ADR-0034).
 */
export interface PanelLocalStateCodec {
  readonly maxBytes: number;
  encode(instanceState: unknown): PanelTransferSnapshot | null;
  decode(snapshot: PanelTransferSnapshot): unknown | null;
}

/** Menu/command ids the registry exposes for a panel (registry-derived UI). */
export interface PanelCommandIds {
  detach?: string;
  reattach?: string;
  moveTo?: string;
}

export interface PanelA11yLabels {
  detach: string;
  reattach: string;
  moveTo: string;
  close: string;
}

export interface PanelEmptyState {
  title: string;
  description: string;
}

export interface PanelDefinition {
  id: PanelTypeId;
  title: string;
  icon?: IconName;

  instancePolicy: PanelInstancePolicy;
  documentRequirement: PanelDocumentRequirement;
  selectionScope: PanelSelectionScope;

  /** Hosts this panel may render in. Canvas-dependent panels may only
   *  register 'primary-sidebar' (ADR-0037). */
  allowedHosts: readonly PanelHostKind[];
  detachable: boolean;
  dockable: boolean;

  minimumSize: PanelSize;
  preferredSize?: PanelSize;

  loadPolicy: PanelLoadPolicy;
  inactivePolicy: PanelInactivePolicy;

  capabilities: PanelCapabilities;

  lifecycle?: DetachablePanelLifecycle;
  localStateCodec?: PanelLocalStateCodec;
  commands?: PanelCommandIds;
  a11yLabels?: PanelA11yLabels;
  emptyState?: PanelEmptyState;
}

/** Default cap for serialized panel-local state (64 KiB, ADR-0019). */
export const DEFAULT_PANEL_LOCAL_STATE_BYTES = 64 * 1024;

const registry = new Map<PanelTypeId, PanelDefinition>();

/** Register a panel type. Throws on duplicate or invalid definitions. */
export function registerPanel(def: PanelDefinition): void {
  const violations = validatePanelDefinition(def);
  if (violations.length > 0) {
    throw new Error(`invalid panel definition '${def.id}': ${violations.join('; ')}`);
  }
  if (registry.has(def.id)) {
    throw new Error(`panel '${def.id}' is already registered`);
  }
  registry.set(def.id, def);
}

/** Remove all registrations (test isolation; never called in production). */
export function resetPanelRegistry(): void {
  registry.clear();
}

export function getPanelDefinition(id: PanelTypeId): PanelDefinition {
  const def = registry.get(id);
  if (!def) {
    throw new Error(`unknown panel type '${id}'`);
  }
  return def;
}

export function tryGetPanelDefinition(id: PanelTypeId): PanelDefinition | undefined {
  return registry.get(id);
}

export function listPanelDefinitions(): PanelDefinition[] {
  return [...registry.values()];
}

export function listDetachablePanels(): PanelDefinition[] {
  return listPanelDefinitions().filter((def) => def.detachable);
}

export function isPanelDetachable(id: PanelTypeId): boolean {
  return registry.get(id)?.detachable === true;
}

export function isPanelDockable(id: PanelTypeId): boolean {
  return registry.get(id)?.dockable === true;
}

export function isPanelCanvasDependent(id: PanelTypeId): boolean {
  const def = registry.get(id);
  return def?.capabilities.requiresCanvas === true || def?.capabilities.requiresRenderer === true;
}

/**
 * Per-definition invariant violations. Used at registration time and by
 * tests. Rules (ADR-0019/0037):
 * - id and title non-empty
 * - minimum size positive
 * - allowedHosts non-empty
 * - detachable => dockable + full lifecycle + local-state codec
 * - multiple instances require supportsMultipleInstances
 * - canvas/renderer-dependent panels cannot host in auxiliary windows
 * - singleton panels cannot claim multiple-instance support
 */
export function validatePanelDefinition(def: PanelDefinition): string[] {
  const violations: string[] = [];
  if (!def.id) violations.push('id must be non-empty');
  if (!def.title) violations.push('title must be non-empty');
  if (!Number.isFinite(def.minimumSize.width) || def.minimumSize.width <= 0) {
    violations.push('minimumSize.width must be a positive finite number');
  }
  if (!Number.isFinite(def.minimumSize.height) || def.minimumSize.height <= 0) {
    violations.push('minimumSize.height must be a positive finite number');
  }
  if (def.allowedHosts.length === 0) violations.push('allowedHosts must be non-empty');
  if (def.detachable && !def.dockable) violations.push('detachable panels must be dockable');
  if (def.detachable && !def.lifecycle)
    violations.push('detachable panels must implement the lifecycle contract');
  if (def.detachable && !def.localStateCodec)
    violations.push('detachable panels must provide a local-state codec');
  if (
    def.detachable &&
    def.lifecycle &&
    (!def.lifecycle.prepareForTransfer || !def.lifecycle.restoreFromTransfer)
  ) {
    violations.push(
      'detachable lifecycle must implement prepareForTransfer and restoreFromTransfer',
    );
  }
  if (def.instancePolicy === 'multiple' && !def.capabilities.supportsMultipleInstances) {
    violations.push("instancePolicy 'multiple' requires capabilities.supportsMultipleInstances");
  }
  if (def.instancePolicy !== 'multiple' && def.capabilities.supportsMultipleInstances) {
    violations.push('a non-multiple panel cannot claim supportsMultipleInstances');
  }
  if (def.capabilities.requiresCanvas && def.allowedHosts.includes('auxiliary-window')) {
    violations.push('canvas-dependent panels cannot host in auxiliary windows (ADR-0037)');
  }
  if (def.capabilities.requiresRenderer && def.allowedHosts.includes('auxiliary-window')) {
    violations.push('renderer-dependent panels cannot host in auxiliary windows (ADR-0037)');
  }
  return violations;
}

/**
 * Cross-registry invariants (ADR-0019): unique ids, exhaustive coverage of
 * the panel type set, valid definitions. Returns violations; empty = ok.
 */
export function assertPanelInvariants(requiredPanelIds: readonly PanelTypeId[]): string[] {
  const violations: string[] = [];
  const registered = new Set(registry.keys());
  for (const id of requiredPanelIds) {
    if (!registered.has(id)) {
      violations.push(`panel '${id}' is expected but not registered`);
    }
  }
  for (const id of registered) {
    if (!requiredPanelIds.includes(id)) {
      violations.push(`panel '${id}' is registered but not part of the panel type set`);
    }
  }
  for (const def of registry.values()) {
    violations.push(...validatePanelDefinition(def).map((v) => `${def.id}: ${v}`));
  }
  return violations;
}

/** Registry-derived command ids for a panel (empty when not applicable). */
export function getPanelCommandIds(panelTypeId: PanelTypeId): PanelCommandIds {
  const def = registry.get(panelTypeId);
  if (!def) return {};
  const commands: PanelCommandIds = {};
  if (def.detachable) {
    commands.detach = def.commands?.detach ?? `panel.${def.id}.detach`;
    commands.moveTo = def.commands?.moveTo ?? `panel.${def.id}.moveTo`;
  }
  if (def.dockable) {
    commands.reattach = def.commands?.reattach ?? `panel.${def.id}.reattach`;
  }
  return commands;
}
