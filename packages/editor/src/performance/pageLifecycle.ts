/**
 * Page-lifecycle bridge for disposable derived work.
 *
 * The browser's hidden/frozen states are the last reliable opportunity to
 * stop work that the user cannot see. This bridge pauses the shared admission
 * gate (queued work stays available for a later resume) and resumes it when a
 * page is shown again. It deliberately does not own saves or document state;
 * LifecycleProvider keeps those responsibilities in the termination/recovery
 * coordinator.
 */

import { type DerivedWorkAdmission, getDerivedWorkAdmission } from '@varve/platform';

interface LifecycleDocument extends EventTarget {
  readonly hidden?: boolean;
  readonly visibilityState?: string;
}

interface LifecycleWindow extends EventTarget {}

export interface PageLifecycleAdmissionOptions {
  admission?: DerivedWorkAdmission;
  documentTarget?: LifecycleDocument;
  windowTarget?: LifecycleWindow;
}

function pageIsHidden(target: LifecycleDocument): boolean {
  return target.hidden === true || target.visibilityState === 'hidden';
}

function globalDocument(): LifecycleDocument | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

function globalWindow(): LifecycleWindow | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/** Install one reversible listener set; returns an idempotent cleanup. */
export function installPageLifecycleAdmission(
  options: PageLifecycleAdmissionOptions = {},
): () => void {
  const admission = options.admission ?? getDerivedWorkAdmission();
  const documentTarget = options.documentTarget ?? globalDocument();
  const windowTarget = options.windowTarget ?? globalWindow();
  if (!documentTarget && !windowTarget) return () => undefined;

  const pause = (): void => admission.pause();
  const resume = (): void => admission.resume();
  const onVisibilityChange = (): void => {
    if (documentTarget && pageIsHidden(documentTarget)) pause();
    else resume();
  };

  // `visibilitychange`, `freeze`, and `resume` are document events; page
  // history transitions are window events. Capture observes the transition
  // before a component can enqueue another optional job.
  documentTarget?.addEventListener('visibilitychange', onVisibilityChange, { capture: true });
  documentTarget?.addEventListener('freeze', pause, { capture: true });
  documentTarget?.addEventListener('resume', resume, { capture: true });
  windowTarget?.addEventListener('pagehide', pause, { capture: true });
  windowTarget?.addEventListener('pageshow', resume, { capture: true });
  onVisibilityChange();

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    documentTarget?.removeEventListener('visibilitychange', onVisibilityChange, {
      capture: true,
    });
    documentTarget?.removeEventListener('freeze', pause, { capture: true });
    documentTarget?.removeEventListener('resume', resume, { capture: true });
    windowTarget?.removeEventListener('pagehide', pause, { capture: true });
    windowTarget?.removeEventListener('pageshow', resume, { capture: true });
  };
}
