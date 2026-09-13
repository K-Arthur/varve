/**
 * Interaction resolution for workspace switches and layout applications.
 *
 * A workspace switch or layout apply changes which surfaces are mounted. Any
 * in-progress interaction owned by one of those surfaces must be classified
 * explicitly — commit, cancel, pause, continue, or block — instead of being
 * silently reduced to "switch to Select" or dropped with the surface.
 *
 * The classifier is pure: callers supply the observable snapshot (editor
 * state plus DOM probes) so it can be unit-tested without a browser, and the
 * caller executes the typed plan.
 */

import type { ToolId } from '../tools/types';

export type InteractionKind =
  | 'node-edit'
  | 'crop'
  | 'mask-preview'
  | 'text-edit'
  | 'ime-composition'
  | 'active-control'
  | 'motion-playback'
  | 'modal';

export type InteractionAction = 'commit' | 'cancel' | 'pause' | 'continue' | 'block';

export interface InteractionResolution {
  kind: InteractionKind;
  action: InteractionAction;
  detail: string;
}

export interface WorkspaceInteractionPlan {
  /** When true the caller must not change the arrangement. */
  blocked: boolean;
  /** Machine-readable reason for a blocked plan. */
  blockedReason?: 'modal-open' | 'ime-composition';
  resolutions: InteractionResolution[];
}

export interface WorkspaceInteractionSnapshot {
  /** Active selectable/transient tool. */
  tool: ToolId;
  /** Mask preview mode; anything other than 'none' is an active preview. */
  maskPreviewMode: string;
  /** Whether a timeline is playing. */
  isPlaying: boolean;
  /** Focused element, when one exists. */
  activeElement?: Element | null;
  /** True when a modal `<dialog open>` is present. */
  hasOpenModal: boolean;
  /** True when the DOM reports an active IME composition. */
  hasImeComposition: boolean;
  /** True when a control marked itself mid-drag (sliders, panel handles). */
  hasActiveControl: boolean;
}

function isTextEntry(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  return element.getAttribute('contenteditable') === 'true';
}

/**
 * Classify every interaction that a workspace switch or layout apply touches.
 *
 * `modal` and `ime-composition` block the operation because cancelling them
 * could destroy unsubmitted input; every other active interaction is resolved
 * in place and the operation proceeds.
 */
export function classifyWorkspaceInteractions(
  snapshot: WorkspaceInteractionSnapshot,
): WorkspaceInteractionPlan {
  const resolutions: InteractionResolution[] = [];

  if (snapshot.hasImeComposition) {
    resolutions.push({
      kind: 'ime-composition',
      action: 'block',
      detail: 'text composition is in progress',
    });
    return { blocked: true, blockedReason: 'ime-composition', resolutions };
  }

  if (snapshot.hasOpenModal) {
    resolutions.push({
      kind: 'modal',
      action: 'block',
      detail: 'a modal dialog is open',
    });
    return { blocked: true, blockedReason: 'modal-open', resolutions };
  }

  if (snapshot.tool === 'nodeEdit') {
    resolutions.push({ kind: 'node-edit', action: 'commit', detail: 'resolve node editing' });
  }
  if (snapshot.tool === 'crop') {
    resolutions.push({ kind: 'crop', action: 'commit', detail: 'resolve cropping' });
  }
  if (snapshot.maskPreviewMode !== 'none') {
    resolutions.push({
      kind: 'mask-preview',
      action: 'commit',
      detail: 'resolve the mask preview',
    });
  }
  if (isTextEntry(snapshot.activeElement)) {
    resolutions.push({
      kind: 'text-edit',
      action: 'commit',
      detail: 'commit the focused text field',
    });
  }
  if (snapshot.hasActiveControl) {
    resolutions.push({
      kind: 'active-control',
      action: 'cancel',
      detail: 'finish the active control drag',
    });
  }
  if (snapshot.isPlaying) {
    resolutions.push({
      kind: 'motion-playback',
      action: 'continue',
      detail: 'playback continues; the motion system is not remounted',
    });
  }

  return { blocked: false, resolutions };
}

/** DOM probes kept separate from the pure classifier for testability. */
export function readWorkspaceInteractionSnapshot(input: {
  tool: ToolId;
  maskPreviewMode: string;
  isPlaying: boolean;
  document?: Document | null;
}): WorkspaceInteractionSnapshot {
  const doc = input.document ?? (typeof document !== 'undefined' ? document : null);
  return {
    tool: input.tool,
    maskPreviewMode: input.maskPreviewMode,
    isPlaying: input.isPlaying,
    activeElement: doc?.activeElement ?? null,
    hasOpenModal: Boolean(doc?.querySelector('dialog[open]')),
    hasImeComposition: Boolean(doc?.querySelector('[data-ime-composing]')),
    hasActiveControl: Boolean(doc?.querySelector('[data-slider-active], [data-drag-active]')),
  };
}
