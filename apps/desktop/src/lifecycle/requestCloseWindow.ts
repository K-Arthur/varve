/**
 * Title-bar close entry point — routes through the termination coordinator
 * (ADR-0216 D6). The raw window.close() is only used when no coordinator is
 * installed, which implies no editor is mounted and no unsaved work can
 * exist.
 */

import { getLifecycleCoordinator } from '@varve/editor';
import { runWindowAction } from '../chrome/windowActions';

export function requestCloseWindow(): void {
  const coordinator = getLifecycleCoordinator();
  if (coordinator) {
    void coordinator.requestTermination('close-window', 'title-bar');
    return;
  }
  runWindowAction('close');
}
