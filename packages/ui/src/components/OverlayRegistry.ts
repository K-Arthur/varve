/**
 * Owner-document overlay registry.
 *
 * This is intentionally framework-neutral. React portals, native dialogs,
 * and detached-window roots can all register a DOM node in the same document
 * tree without adding one listener per menu level.
 */

import type { OverlayKind } from './overlayTypes';

export type { OverlayKind } from './overlayTypes';

export type OverlayCloseReason =
  | 'action'
  | 'escape'
  | 'left-arrow'
  | 'tab'
  | 'outside-pointer'
  | 'trigger-toggle'
  | 'open-sibling'
  | 'parent-close'
  | 'anchor-detached'
  | 'context-invalidated'
  | 'window-blur'
  | 'document-change'
  | 'workspace-change'
  | 'programmatic';

export interface OverlayRegistrationInput {
  id: string;
  kind: OverlayKind;
  parentId?: string | null;
  ownerDocument: Document;
  portalRoot: HTMLElement;
  node: HTMLElement;
  anchorElement?: HTMLElement | null;
  auxiliaryElements?: readonly HTMLElement[];
  onClose?: (reason: OverlayCloseReason) => void;
  dismissOnPointerDown?: boolean;
  dismissOnEscape?: boolean;
  dismissOnWindowBlur?: boolean;
}

export interface OverlaySnapshot {
  id: string;
  kind: OverlayKind;
  parentId: string | null;
  ownerWindowId: string;
  portalRoot: string;
  nodeConnected: boolean;
  nodeRect: DOMRect | null;
  anchorRect: DOMRect | null;
}

export interface OverlayTraceEvent {
  time: number;
  event: string;
  id?: string;
  kind?: OverlayKind;
  parentId?: string | null;
  ownerWindowId?: string;
  decision?: string;
  reason?: OverlayCloseReason;
  placement?: string;
  x?: number;
  y?: number;
  details?: Record<string, unknown>;
}

interface OverlayEntry extends OverlayRegistrationInput {
  parentId: string | null;
}

interface DocumentRegistry {
  ownerDocument: Document;
  entries: Map<string, OverlayEntry>;
  /** Prevents duplicate close callbacks while React is unmounting a tree. */
  closingIds: Set<string>;
  traces: OverlayTraceEvent[];
  debug: boolean;
  pointerListener: (event: PointerEvent) => void;
  keyListener: (event: KeyboardEvent) => void;
  blurListener: () => void;
}

const registries = new WeakMap<Document, DocumentRegistry>();
const debugDocuments = new WeakSet<Document>();
const windowIds = new WeakMap<Window, string>();
let nextWindowId = 1;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function ownerWindowId(ownerDocument: Document): string {
  const view = ownerDocument.defaultView;
  if (!view) return 'window:none';
  const existing = windowIds.get(view);
  if (existing) return existing;
  const id = `window-${nextWindowId++}`;
  windowIds.set(view, id);
  return id;
}

function eventPath(event: Event): readonly EventTarget[] {
  if (typeof event.composedPath === 'function') return event.composedPath();
  return event.target ? [event.target] : [];
}

function pathContains(
  path: readonly EventTarget[],
  element: HTMLElement | null | undefined,
): boolean {
  return Boolean(element && path.includes(element));
}

function isDescendantOf(
  candidate: OverlayEntry,
  ancestorId: string,
  entries: Map<string, OverlayEntry>,
): boolean {
  let current: OverlayEntry | undefined = candidate;
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    visited.add(current.id);
    current = entries.get(current.parentId);
  }
  return false;
}

function depthOf(entry: OverlayEntry, entries: Map<string, OverlayEntry>): number {
  let depth = 0;
  let current: OverlayEntry | undefined = entry;
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = entries.get(current.parentId);
    if (current) depth += 1;
  }
  return depth;
}

function isInsideTree(
  entry: OverlayEntry,
  path: readonly EventTarget[],
  entries: Map<string, OverlayEntry>,
): boolean {
  if (
    pathContains(path, entry.node) ||
    pathContains(path, entry.anchorElement) ||
    entry.auxiliaryElements?.some((element) => pathContains(path, element))
  ) {
    return true;
  }
  return Array.from(entries.values()).some(
    (candidate) =>
      candidate.id !== entry.id &&
      isDescendantOf(candidate, entry.id, entries) &&
      (pathContains(path, candidate.node) ||
        pathContains(path, candidate.anchorElement) ||
        candidate.auxiliaryElements?.some((element) => pathContains(path, element))),
  );
}

function trace(registry: DocumentRegistry, event: OverlayTraceEvent): void {
  if (!registry.debug) return;
  registry.traces.push(event);
  if (registry.traces.length > 200) registry.traces.splice(0, registry.traces.length - 200);
  if (typeof console !== 'undefined' && typeof console.debug === 'function') {
    console.debug('[varve-overlay]', event);
  }
}

function descendantEntries(rootId: string, entries: Map<string, OverlayEntry>): OverlayEntry[] {
  return Array.from(entries.values())
    .filter((entry) => entry.id === rootId || isDescendantOf(entry, rootId, entries))
    .sort((a, b) => depthOf(b, entries) - depthOf(a, entries));
}

function requestClose(
  registry: DocumentRegistry,
  entry: OverlayEntry,
  reason: OverlayCloseReason,
): void {
  if (registry.closingIds.has(entry.id)) return;
  registry.closingIds.add(entry.id);
  trace(registry, {
    time: now(),
    event: 'close-requested',
    id: entry.id,
    kind: entry.kind,
    parentId: entry.parentId,
    decision: 'close-once',
    reason,
  });
  entry.onClose?.(reason);
}

function closeTreeEntries(
  registry: DocumentRegistry,
  rootId: string,
  rootReason: OverlayCloseReason,
): void {
  for (const entry of descendantEntries(rootId, registry.entries)) {
    requestClose(registry, entry, entry.id === rootId ? rootReason : 'parent-close');
  }
}

function isRootMenuKind(kind: OverlayKind): boolean {
  return kind === 'menubar-menu' || kind === 'action-menu' || kind === 'context-menu';
}

function closeConflictingRootMenus(registry: DocumentRegistry, next: OverlayEntry): void {
  if (next.parentId || !isRootMenuKind(next.kind)) return;
  for (const existing of Array.from(registry.entries.values())) {
    if (existing.id !== next.id && !existing.parentId && isRootMenuKind(existing.kind)) {
      trace(registry, {
        time: now(),
        event: 'open-sibling',
        id: existing.id,
        kind: existing.kind,
        parentId: existing.parentId,
        decision: 'replace-root-menu',
        reason: 'open-sibling',
        details: { replacementId: next.id, replacementKind: next.kind },
      });
      closeTreeEntries(registry, existing.id, 'open-sibling');
    }
  }
}

function closeOutsideTree(registry: DocumentRegistry, event: PointerEvent): void {
  const path = eventPath(event);
  const entries = Array.from(registry.entries.values());
  const rootsToClose = new Set<string>();
  const childrenToClose = new Set<string>();

  for (const entry of entries) {
    if (isInsideTree(entry, path, registry.entries)) continue;
    const parent = entry.parentId ? registry.entries.get(entry.parentId) : undefined;
    if (parent && isInsideTree(parent, path, registry.entries)) {
      childrenToClose.add(entry.id);
    } else if (!parent) {
      rootsToClose.add(entry.id);
    }
  }

  const closed = new Set<string>();
  for (const id of rootsToClose) {
    const root = registry.entries.get(id);
    if (root?.dismissOnPointerDown) {
      trace(registry, {
        time: now(),
        event: 'outside-event',
        id,
        kind: root.kind,
        parentId: root.parentId,
        decision: 'close-tree',
        reason: 'outside-pointer',
      });
      // Descendants close deepest-first. This gives nested surfaces a chance
      // to clean their own focus/listeners before the parent restores focus,
      // while still making one outside press close the complete tree.
      for (const entry of descendantEntries(id, registry.entries)) {
        if (!entry.dismissOnPointerDown || closed.has(entry.id)) continue;
        closed.add(entry.id);
        requestClose(registry, entry, entry.id === id ? 'outside-pointer' : 'parent-close');
      }
    }
  }

  // A click in an open parent is outside a child branch but must not close the
  // parent. Close deepest children first so sibling/branch transitions are
  // deterministic even when React batches the resulting state updates.
  for (const id of Array.from(childrenToClose).sort((a, b) => {
    const left = registry.entries.get(a);
    const right = registry.entries.get(b);
    return (
      (right ? depthOf(right, registry.entries) : 0) - (left ? depthOf(left, registry.entries) : 0)
    );
  })) {
    const entry = registry.entries.get(id);
    if (entry?.dismissOnPointerDown && !closed.has(id)) {
      trace(registry, {
        time: now(),
        event: 'outside-event',
        id,
        kind: entry.kind,
        parentId: entry.parentId,
        decision: 'close-branch',
        reason: 'outside-pointer',
      });
      closed.add(id);
      requestClose(registry, entry, 'outside-pointer');
    }
  }
}

function closeDeepestEscape(registry: DocumentRegistry, event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  const path = eventPath(event);
  const focused = registry.ownerDocument.activeElement;
  const entries = Array.from(registry.entries.values());
  const candidates = entries
    .filter(
      (entry) =>
        entry.dismissOnEscape &&
        (isInsideTree(entry, path, registry.entries) ||
          entry.node.contains(focused) ||
          entry.anchorElement?.contains(focused)),
    )
    .sort((a, b) => depthOf(b, registry.entries) - depthOf(a, registry.entries));
  // A non-modal popover may intentionally leave focus on its trigger or on
  // the document body. Escape still belongs to the most recently registered
  // dismissible surface in that owner document; otherwise a document-level
  // Escape would silently do nothing for a valid open overlay.
  const entry = candidates[0] ?? entries.filter((candidate) => candidate.dismissOnEscape).at(-1);
  if (!entry) return;
  event.preventDefault();
  trace(registry, {
    time: now(),
    event: 'escape',
    id: entry.id,
    kind: entry.kind,
    parentId: entry.parentId,
    decision: 'close-deepest',
    reason: 'escape',
  });
  requestClose(registry, entry, 'escape');
}

function closeOnWindowBlur(registry: DocumentRegistry): void {
  const entries = Array.from(registry.entries.values())
    .filter((entry) => entry.dismissOnWindowBlur)
    .sort((a, b) => depthOf(b, registry.entries) - depthOf(a, registry.entries));
  for (const entry of entries) {
    trace(registry, {
      time: now(),
      event: 'window-blur',
      id: entry.id,
      kind: entry.kind,
      parentId: entry.parentId,
      decision: 'close',
      reason: 'window-blur',
    });
    requestClose(registry, entry, 'window-blur');
  }
}

function createRegistry(ownerDocument: Document): DocumentRegistry {
  const registry: DocumentRegistry = {
    ownerDocument,
    entries: new Map(),
    closingIds: new Set(),
    traces: [],
    debug: debugDocuments.has(ownerDocument),
    pointerListener: () => undefined,
    keyListener: () => undefined,
    blurListener: () => undefined,
  };
  registry.pointerListener = (event) => closeOutsideTree(registry, event);
  registry.keyListener = (event) => closeDeepestEscape(registry, event);
  registry.blurListener = () => closeOnWindowBlur(registry);
  registries.set(ownerDocument, registry);
  return registry;
}

function getRegistry(ownerDocument: Document): DocumentRegistry {
  const registry = registries.get(ownerDocument) ?? createRegistry(ownerDocument);
  installOverlayDebugBridge(ownerDocument);
  return registry;
}

function ensureListeners(registry: DocumentRegistry): void {
  if (registry.entries.size !== 1) return;
  registry.ownerDocument.addEventListener('pointerdown', registry.pointerListener, true);
  // Keyboard events from a focused element bubble through its owner document.
  // Keeping this listener on the document (rather than the main application
  // window) is what makes the same registry work in detached WebView windows.
  registry.ownerDocument.addEventListener('keydown', registry.keyListener);
  registry.ownerDocument.defaultView?.addEventListener('blur', registry.blurListener);
}

function removeListeners(registry: DocumentRegistry, ownerDocument: Document): void {
  if (registry.entries.size !== 0) return;
  ownerDocument.removeEventListener('pointerdown', registry.pointerListener, true);
  ownerDocument.removeEventListener('keydown', registry.keyListener);
  ownerDocument.defaultView?.removeEventListener('blur', registry.blurListener);
  registries.delete(ownerDocument);
}

export function registerOverlay(input: OverlayRegistrationInput): () => void {
  const registry = getRegistry(input.ownerDocument);
  const entry: OverlayEntry = { ...input, parentId: input.parentId ?? null };
  closeConflictingRootMenus(registry, entry);
  registry.closingIds.delete(entry.id);
  registry.entries.set(entry.id, entry);
  ensureListeners(registry);
  trace(registry, {
    time: now(),
    event: 'registered',
    id: entry.id,
    kind: entry.kind,
    parentId: entry.parentId,
    ownerWindowId: ownerWindowId(entry.ownerDocument),
    decision: 'active',
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (registry.entries.get(entry.id) === entry) {
      registry.entries.delete(entry.id);
      registry.closingIds.delete(entry.id);
      trace(registry, {
        time: now(),
        event: 'unregistered',
        id: entry.id,
        kind: entry.kind,
        parentId: entry.parentId,
        ownerWindowId: ownerWindowId(entry.ownerDocument),
        decision: 'cleaned',
      });
    }
    removeListeners(registry, entry.ownerDocument);
  };
}

export function traceOverlayEvent(
  ownerDocument: Document,
  event: Omit<OverlayTraceEvent, 'time'>,
): void {
  const registry = getRegistry(ownerDocument);
  trace(registry, { ...event, time: now(), ownerWindowId: ownerWindowId(ownerDocument) });
}

export function getOverlaySnapshot(ownerDocument: Document): OverlaySnapshot[] {
  const registry = registries.get(ownerDocument);
  if (!registry) return [];
  return Array.from(registry.entries.values()).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    parentId: entry.parentId,
    ownerWindowId: ownerWindowId(ownerDocument),
    portalRoot: describeElement(entry.portalRoot),
    nodeConnected: entry.node.isConnected,
    nodeRect: entry.node.isConnected ? entry.node.getBoundingClientRect() : null,
    anchorRect: entry.anchorElement?.isConnected
      ? entry.anchorElement.getBoundingClientRect()
      : null,
  }));
}

export function getOverlayTrace(ownerDocument: Document): readonly OverlayTraceEvent[] {
  return registries.get(ownerDocument)?.traces ?? [];
}

export function setOverlayDebugEnabled(ownerDocument: Document, enabled: boolean): void {
  if (enabled) debugDocuments.add(ownerDocument);
  else debugDocuments.delete(ownerDocument);
  getRegistry(ownerDocument).debug = enabled;
}

/** Close one registered overlay and all of its registered descendants. */
export function closeOverlayTree(
  ownerDocument: Document,
  overlayId: string,
  reason: OverlayCloseReason = 'programmatic',
): void {
  const registry = registries.get(ownerDocument);
  if (!registry?.entries.has(overlayId)) return;
  closeTreeEntries(registry, overlayId, reason);
}

/** Close every overlay tree in one owner document, deepest-first per tree. */
export function closeAllOverlays(
  ownerDocument: Document,
  reason: OverlayCloseReason = 'programmatic',
): void {
  const registry = registries.get(ownerDocument);
  if (!registry) return;
  const roots = Array.from(registry.entries.values()).filter(
    (entry) => !entry.parentId || !registry.entries.has(entry.parentId),
  );
  for (const root of roots) closeTreeEntries(registry, root.id, reason);
}

/** Install the same development bridge in a detached owner window. */
export function installOverlayDebugBridge(ownerDocument: Document): void {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return;
  const globalWindow = ownerWindow as unknown as Record<string, unknown>;
  if (globalWindow.__varveOverlayDebug) return;
  globalWindow.__varveOverlayDebug = {
    enable: () => setOverlayDebugEnabled(ownerDocument, true),
    disable: () => setOverlayDebugEnabled(ownerDocument, false),
    snapshot: () => getOverlaySnapshot(ownerDocument),
    trace: () => getOverlayTrace(ownerDocument),
  };
}

function describeElement(element: HTMLElement): string {
  return element.id
    ? `#${element.id}`
    : element.className
      ? `.${String(element.className).split(/\s+/)[0]}`
      : element.tagName;
}

// Development-only console bridge. It is deliberately not a production UI
// and has no effect until explicitly enabled by a developer or a test.
if (typeof document !== 'undefined') installOverlayDebugBridge(document);
