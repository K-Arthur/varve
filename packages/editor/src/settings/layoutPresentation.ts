import type { LayoutPreference } from '../settings';

export type LayoutPresentationMode = 'compact' | 'tablet' | 'desktop';

export interface LayoutCapabilities {
  viewportWidth: number;
  anyPointerCoarse: boolean;
  anyPointerFine: boolean;
  maxTouchPoints: number;
  observedTouchOrPen?: boolean;
}

export function resolveLayoutPresentation(
  preference: LayoutPreference,
  capabilities: LayoutCapabilities,
): LayoutPresentationMode {
  if (preference === 'tablet') return 'tablet';
  if (preference === 'desktop') return 'desktop';

  const touchCapable =
    capabilities.anyPointerCoarse ||
    capabilities.maxTouchPoints > 0 ||
    capabilities.observedTouchOrPen === true;
  if (capabilities.viewportWidth <= 899) return touchCapable ? 'tablet' : 'compact';
  if (capabilities.viewportWidth <= 1280 && touchCapable) return 'tablet';
  const coarseOnly =
    (capabilities.anyPointerCoarse && !capabilities.anyPointerFine) ||
    capabilities.observedTouchOrPen === true;
  return coarseOnly ? 'tablet' : 'desktop';
}

export interface LayoutPresentationController {
  setPreference: (preference: LayoutPreference) => void;
  setControlsMirrored: (mirrored: boolean) => void;
  updateCapabilities: () => void;
  contactStart: (pointerId: number, pointerType?: string) => void;
  contactEnd: (pointerId: number) => void;
  compositionStart: () => void;
  compositionEnd: () => void;
  clearContacts: () => void;
}

export function createLayoutPresentationController(
  root: Pick<HTMLElement, 'dataset'>,
  getCapabilities: () => LayoutCapabilities,
  initialPreference: LayoutPreference = 'auto',
  initialControlsMirrored = false,
): LayoutPresentationController {
  let preference = initialPreference;
  let controlsMirrored = initialControlsMirrored;
  let composing = false;
  let pending = false;
  let observedTouchOrPen = false;
  const activePointers = new Set<number>();

  const apply = () => {
    if (activePointers.size > 0 || composing) {
      pending = true;
      return;
    }
    pending = false;
    root.dataset.layoutPreference = preference;
    root.dataset.layoutMode = resolveLayoutPresentation(preference, {
      ...getCapabilities(),
      observedTouchOrPen,
    });
    root.dataset.tabletControlsMirrored = String(controlsMirrored);
  };

  const flush = () => {
    if (pending && activePointers.size === 0 && !composing) apply();
  };

  apply();
  return {
    setPreference(next) {
      preference = next;
      apply();
    },
    setControlsMirrored(next) {
      controlsMirrored = next;
      apply();
    },
    updateCapabilities: apply,
    contactStart(pointerId, pointerType) {
      activePointers.add(pointerId);
      if (pointerType === 'touch' || pointerType === 'pen') {
        observedTouchOrPen = true;
        pending = true;
      }
    },
    contactEnd(pointerId) {
      activePointers.delete(pointerId);
      flush();
    },
    compositionStart() {
      composing = true;
    },
    compositionEnd() {
      composing = false;
      flush();
    },
    clearContacts() {
      activePointers.clear();
      flush();
    },
  };
}

function readBrowserCapabilities(): LayoutCapabilities {
  const match = (query: string) =>
    typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
  return {
    viewportWidth: window.innerWidth,
    anyPointerCoarse: match('(any-pointer: coarse)'),
    anyPointerFine: match('(any-pointer: fine)'),
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

let mountedController: LayoutPresentationController | null = null;

/** Observe device/viewport changes once while the application settings provider is mounted. */
export function mountLayoutPresentation(
  preference: LayoutPreference,
  controlsMirrored = false,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  mountedController?.clearContacts();
  const controller = createLayoutPresentationController(
    document.documentElement,
    readBrowserCapabilities,
    preference,
    controlsMirrored,
  );
  mountedController = controller;

  const onPointerDown = (event: PointerEvent) =>
    controller.contactStart(event.pointerId, event.pointerType);
  const onPointerEnd = (event: PointerEvent) => controller.contactEnd(event.pointerId);
  const onCompositionStart = () => controller.compositionStart();
  const onCompositionEnd = () => controller.compositionEnd();
  const onViewportChange = () => controller.updateCapabilities();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') controller.clearContacts();
    else controller.updateCapabilities();
  };
  const onBlur = () => controller.clearContacts();
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  document.addEventListener('lostpointercapture', onPointerEnd, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('blur', onBlur);
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', onViewportChange);
  const mediaQueries =
    typeof window.matchMedia === 'function'
      ? ['(any-pointer: coarse)', '(any-pointer: fine)'].map((query) => window.matchMedia(query))
      : [];
  for (const media of mediaQueries) media.addEventListener?.('change', onViewportChange);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerEnd, true);
    document.removeEventListener('pointercancel', onPointerEnd, true);
    document.removeEventListener('lostpointercapture', onPointerEnd, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('blur', onBlur);
    viewport?.removeEventListener('resize', onViewportChange);
    for (const media of mediaQueries) media.removeEventListener?.('change', onViewportChange);
    if (mountedController === controller) mountedController = null;
  };
}

export function setLayoutPreference(preference: LayoutPreference): void {
  if (mountedController) {
    mountedController.setPreference(preference);
    return;
  }
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  document.documentElement.dataset.layoutPreference = preference;
  document.documentElement.dataset.layoutMode = resolveLayoutPresentation(
    preference,
    readBrowserCapabilities(),
  );
}

export function setTabletControlsMirrored(mirrored: boolean): void {
  if (mountedController) {
    mountedController.setControlsMirrored(mirrored);
    return;
  }
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.tabletControlsMirrored = String(mirrored);
}

export const LAYOUT_PREFERENCE_REQUEST_EVENT = 'varve:layout-preference-request';
