/**
 * Pointer ownership contract shared by drawing tools and canvas navigation.
 *
 * This module is deliberately DOM-free. The canvas adapter supplies events and
 * performs capture/camera/tool dispatch; this state machine decides which
 * interaction owns each pointer. Keeping the decision pure makes hostile
 * multi-pointer sequences testable without pretending Playwright touch
 * emulation is a physical stylus or palm.
 */

export type FingerDrawingMode = 'draw' | 'navigate';
export type InputPointerType = 'mouse' | 'pen' | 'touch' | 'unknown';
export type PointerRole = 'tool' | 'navigation' | 'ignored';

export interface PointerContact {
  pointerId: number;
  pointerType: InputPointerType;
  role: PointerRole;
  x: number;
  y: number;
  /** A contact left after a pinch must not silently become a new stroke. */
  requiresFreshContact: boolean;
}

export interface PointerOwnershipState {
  contacts: Map<number, PointerContact>;
  toolPointerId: number | null;
  penPointerId: number | null;
}

export interface PointerContactStart {
  pointerId: number;
  pointerType: string | undefined;
  clientX: number;
  clientY: number;
}

export interface PointerContactDecision {
  role: PointerRole;
  /** The currently provisional tool contact to resolve, if any. */
  cancelPointerId: number | null;
  /** Existing contacts that must not navigate while a pen owns the surface. */
  suppressedPointerIds: number[];
}

export function createPointerOwnershipState(): PointerOwnershipState {
  return { contacts: new Map(), toolPointerId: null, penPointerId: null };
}

export function classifyPointerType(pointerType: string | undefined): InputPointerType {
  if (pointerType === 'mouse' || pointerType === 'pen' || pointerType === 'touch') {
    return pointerType;
  }
  return 'unknown';
}

/**
 * Register one contact. A second touch never calls global undo: it returns the
 * owner ID so the adapter can cancel only that tool interaction, then converts
 * the touch set to navigation contacts.
 */
export function beginPointerContact(
  state: PointerOwnershipState,
  start: PointerContactStart,
  fingerMode: FingerDrawingMode,
): PointerContactDecision {
  // Pointer IDs may be reused after cancellation. Remove stale ownership
  // before considering the new contact.
  removePointerContact(state, start.pointerId);

  const pointerType = classifyPointerType(start.pointerType);
  let role: PointerRole = 'ignored';
  let cancelPointerId: number | null = null;
  const suppressedPointerIds: number[] = [];

  if (pointerType === 'pen') {
    const currentTool = getToolContact(state);
    if (currentTool && currentTool.pointerId !== start.pointerId) {
      cancelPointerId = currentTool.pointerId;
      // A replacement pen contact must not be allowed to deliver a late
      // pointerup to the new tool owner. Mark the old owner as foreign before
      // the adapter dispatches its scoped cancellation.
      currentTool.role = 'ignored';
      currentTool.requiresFreshContact = true;
    }
    for (const contact of state.contacts.values()) {
      if (contact.pointerType === 'touch' || contact.pointerType === 'unknown') {
        contact.role = 'ignored';
        contact.requiresFreshContact = true;
        suppressedPointerIds.push(contact.pointerId);
      }
    }
    role = 'tool';
    state.penPointerId = start.pointerId;
    state.toolPointerId = start.pointerId;
  } else if (state.penPointerId !== null) {
    // Compatibility mouse events and nearby fingers cannot corrupt an active
    // pen stroke or move the viewport underneath it.
    role = 'ignored';
  } else if (pointerType === 'touch' || pointerType === 'unknown') {
    if (fingerMode === 'navigate') {
      role = 'navigation';
    } else {
      const currentTool = getToolContact(state);
      if (!currentTool) {
        const existingNavigation = [...state.contacts.values()].some(
          (contact) => contact.role === 'navigation' && isTouchLike(contact.pointerType),
        );
        if (existingNavigation) {
          // A third finger, or a new contact while the post-pinch finger is
          // still down, remains navigation-owned. It cannot become a fresh
          // drawing contact until every prior navigation contact has ended.
          role = 'navigation';
        } else {
          role = 'tool';
          state.toolPointerId = start.pointerId;
        }
      } else if (isTouchLike(currentTool.pointerType)) {
        cancelPointerId = currentTool.pointerId;
        currentTool.role = 'navigation';
        currentTool.requiresFreshContact = true;
        state.toolPointerId = null;
        role = 'navigation';
      }
    }
  } else if (pointerType === 'mouse') {
    // A mouse/trackpad click is a separate contact model. A compatibility
    // mouse event arriving behind a touch tool must not produce a duplicate.
    const touchNavigationActive = [...state.contacts.values()].some(
      (contact) => isTouchLike(contact.pointerType) && contact.role === 'navigation',
    );
    if (!getToolContact(state) && !touchNavigationActive) {
      role = 'tool';
      state.toolPointerId = start.pointerId;
    }
  }

  state.contacts.set(start.pointerId, {
    pointerId: start.pointerId,
    pointerType,
    role,
    x: start.clientX,
    y: start.clientY,
    requiresFreshContact: false,
  });
  if (role === 'ignored') suppressedPointerIds.push(start.pointerId);
  return { role, cancelPointerId, suppressedPointerIds };
}

export function updatePointerContact(
  state: PointerOwnershipState,
  pointerId: number,
  clientX: number,
  clientY: number,
): { contact: PointerContact; dx: number; dy: number } | null {
  const contact = state.contacts.get(pointerId);
  if (!contact) return null;
  const dx = clientX - contact.x;
  const dy = clientY - contact.y;
  contact.x = clientX;
  contact.y = clientY;
  return { contact, dx, dy };
}

export function endPointerContact(
  state: PointerOwnershipState,
  pointerId: number,
): PointerContact | null {
  const contact = state.contacts.get(pointerId) ?? null;
  removePointerContact(state, pointerId);
  return contact;
}

export function getPointerContact(
  state: PointerOwnershipState,
  pointerId: number,
): PointerContact | null {
  return state.contacts.get(pointerId) ?? null;
}

export function isToolPointer(state: PointerOwnershipState, pointerId: number): boolean {
  return state.contacts.get(pointerId)?.role === 'tool';
}

export function isNavigationPointer(state: PointerOwnershipState, pointerId: number): boolean {
  return state.contacts.get(pointerId)?.role === 'navigation';
}

export function resetPointerOwnership(state: PointerOwnershipState): void {
  state.contacts.clear();
  state.toolPointerId = null;
  state.penPointerId = null;
}

function isTouchLike(pointerType: InputPointerType): boolean {
  return pointerType === 'touch' || pointerType === 'unknown';
}

function getToolContact(state: PointerOwnershipState): PointerContact | null {
  if (state.toolPointerId === null) return null;
  const contact = state.contacts.get(state.toolPointerId);
  return contact?.role === 'tool' ? contact : null;
}

function removePointerContact(state: PointerOwnershipState, pointerId: number): void {
  const contact = state.contacts.get(pointerId);
  if (!contact) return;
  state.contacts.delete(pointerId);
  if (state.toolPointerId === pointerId) state.toolPointerId = null;
  if (state.penPointerId === pointerId) state.penPointerId = null;
}
