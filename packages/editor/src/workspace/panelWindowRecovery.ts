/**
 * User-initiated detached-panel window recovery.
 *
 * The primary window owns these operations. They work only with live records
 * from its current session and use the platform facade for every native/window
 * operation, so an old placement or a stale auxiliary host cannot move or
 * reattach a newer panel window.
 */

import type { DisplayInfo, NativeWindowService, WindowPlacement } from '@varve/platform';
import {
  type DetachedPanelRecord,
  getDetachedPanels,
  markPanelReattached,
} from './detachedPanelsStore';
import { recordPanelWindowDiagnostic } from './panelWindowDiagnostics';
import { getSessionBroker } from './sessionBroker';
import {
  clearPanelPlacementForWindow,
  clearPanelPlacements,
  gatherPanelPlacementsOntoDisplay,
  loadPanelPlacements,
  savePanelPlacement,
} from './workspaceManager';

export interface PanelWindowRecoveryOptions {
  windowService: NativeWindowService;
  sessionId: string;
  /** User-facing completion or partial-failure message. */
  announce?: (message: string) => void;
}

export interface PanelWindowRecoveryResult {
  requested: number;
  completed: number;
  failed: number;
}

function currentSessionRecords(sessionId: string): DetachedPanelRecord[] {
  return getDetachedPanels().filter((record) => record.sessionId === sessionId);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function sameLiveRecord(record: DetachedPanelRecord): boolean {
  return getDetachedPanels().some(
    (candidate) =>
      candidate.panelTypeId === record.panelTypeId &&
      candidate.windowId === record.windowId &&
      candidate.sessionId === record.sessionId &&
      candidate.generation === record.generation,
  );
}

function placementBounds(placement: WindowPlacement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: placement.logicalPosition.x,
    y: placement.logicalPosition.y,
    width: placement.logicalSize.width,
    height: placement.logicalSize.height,
  };
}

/**
 * The recovery target is the display containing the primary window. A
 * compositor can omit `currentMonitor`, so prefer its placement hint and then
 * fall back to the current primary display.
 */
async function currentPrimaryDisplay(
  windowService: NativeWindowService,
): Promise<{ display: DisplayInfo; displays: DisplayInfo[] } | null> {
  const [displays, current] = await Promise.all([
    windowService.listMonitors().catch(() => [] as DisplayInfo[]),
    windowService.getCurrentWindow().catch(() => null),
  ]);
  if (displays.length === 0) return null;

  const currentDisplayId = current?.monitor?.runtimeId ?? current?.placement?.displayId;
  const display =
    (currentDisplayId
      ? displays.find((candidate) => candidate.runtimeId === currentDisplayId)
      : undefined) ??
    displays.find((candidate) => candidate.isPrimary) ??
    displays[0];
  return display ? { display, displays } : null;
}

async function livePlacementInput(
  record: DetachedPanelRecord,
  windowService: NativeWindowService,
): Promise<{
  panelTypeId: string;
  windowId: string;
  displayId?: string;
  displayFingerprint?: WindowPlacement['displayFingerprint'];
  logicalPosition: { x: number; y: number };
  logicalSize: { width: number; height: number };
  state: 'normal';
  updatedAt: number;
} | null> {
  const actual = await windowService.getWindowPlacement(record.windowId).catch(() => null);
  const saved = loadPanelPlacements().find(
    (placement) =>
      placement.panelTypeId === record.panelTypeId && placement.windowId === record.windowId,
  );
  const source = actual ?? saved;
  if (!source) return null;

  // Recovery intentionally de-minimizes (and un-fullscreens) a panel before
  // cascading it. The action's promise is that visible chrome becomes
  // reachable on the current display, not that a stale fullscreen state wins.
  return {
    panelTypeId: record.panelTypeId,
    windowId: record.windowId,
    ...(source.displayId ? { displayId: source.displayId } : {}),
    ...(source.displayFingerprint ? { displayFingerprint: source.displayFingerprint } : {}),
    logicalPosition: source.logicalPosition,
    logicalSize: source.logicalSize,
    state: 'normal',
    updatedAt: Date.now(),
  };
}

/**
 * Move every live detached panel window onto the display containing the
 * primary editor. A just-created host is included even before its debounced
 * placement persistence has run, because its actual placement is read first.
 */
export async function bringAllPanelsToCurrentDisplay(
  options: PanelWindowRecoveryOptions,
): Promise<PanelWindowRecoveryResult> {
  const records = currentSessionRecords(options.sessionId);
  if (records.length === 0) {
    options.announce?.('There are no detached panel windows to bring to this display.');
    return { requested: 0, completed: 0, failed: 0 };
  }

  const target = await currentPrimaryDisplay(options.windowService);
  if (!target) {
    options.announce?.('Panel windows could not be moved because no display is available.');
    return { requested: records.length, completed: 0, failed: records.length };
  }

  const inputs = (
    await Promise.all(records.map((record) => livePlacementInput(record, options.windowService)))
  ).filter((input): input is NonNullable<typeof input> => input !== null);
  const plans = gatherPanelPlacementsOntoDisplay(inputs, target.display);
  const recordsByPanel = new Map<string, DetachedPanelRecord>(
    records.map((record) => [record.panelTypeId, record]),
  );
  let completed = 0;
  let failed = records.length - plans.length;

  await Promise.all(
    plans.map(async (plan) => {
      const record = recordsByPanel.get(plan.record.panelTypeId);
      if (!record || !sameLiveRecord(record)) {
        failed += 1;
        return;
      }
      const placement = { ...plan.placement, state: 'normal' as const };
      try {
        await options.windowService.setWindowPlacement(record.windowId, placement);
        recordPanelWindowDiagnostic({
          type: 'placement-applied',
          panelTypeId: record.panelTypeId,
          windowId: record.windowId,
          sessionId: options.sessionId,
          displayId: placement.displayId,
          logicalBounds: placementBounds(placement),
          result: 'recovery',
        });
        await options.windowService.showWindow(record.windowId);
        savePanelPlacement(
          {
            panelTypeId: record.panelTypeId,
            windowId: record.windowId,
            displayId: placement.displayId,
            displayFingerprint: placement.displayFingerprint,
            logicalPosition: placement.logicalPosition,
            logicalSize: placement.logicalSize,
            state: placement.state,
            updatedAt: Date.now(),
          },
          { display: target.display, displays: target.displays },
        );
        recordPanelWindowDiagnostic({
          type: 'layout-persisted',
          panelTypeId: record.panelTypeId,
          windowId: record.windowId,
          sessionId: options.sessionId,
          displayId: placement.displayId,
          logicalBounds: placementBounds(placement),
          result: 'recovery',
        });
        completed += 1;
      } catch {
        recordPanelWindowDiagnostic({
          type: 'layout-persistence-failed',
          panelTypeId: record.panelTypeId,
          windowId: record.windowId,
          sessionId: options.sessionId,
          errorCode: 'placement-apply-failed',
        });
        failed += 1;
      }
    }),
  );

  if (failed === 0) {
    options.announce?.(`Brought ${plural(completed, 'panel window')} to this display.`);
  } else if (completed > 0) {
    options.announce?.(
      `Brought ${plural(completed, 'panel window')} to this display; ${plural(failed, 'window')} could not be moved.`,
    );
  } else {
    options.announce?.('Panel windows could not be moved to this display.');
  }
  return { requested: records.length, completed, failed };
}

/**
 * Reattach live detached panels, close their auxiliary hosts, and clear only
 * their machine-local placement records. Documents and workspace preferences
 * are deliberately untouched.
 */
export async function resetPanelWindowLayout(
  options: PanelWindowRecoveryOptions,
): Promise<PanelWindowRecoveryResult> {
  const records = currentSessionRecords(options.sessionId);
  if (records.length === 0) {
    clearPanelPlacements();
    options.announce?.('Panel window layout reset.');
    return { requested: 0, completed: 0, failed: 0 };
  }

  let completed = 0;
  let failed = 0;
  await Promise.all(
    records.map(async (record) => {
      try {
        recordPanelWindowDiagnostic({
          type: 'auxiliary-close-requested',
          panelTypeId: record.panelTypeId,
          windowId: record.windowId,
          sessionId: options.sessionId,
          result: 'reset',
        });
        await options.windowService.closeWindow(record.windowId);
        // Native close events normally perform this cleanup. Invoke the
        // broker as an idempotent fallback because a compositor or test
        // adapter may resolve close after the event subscription was removed.
        getSessionBroker(options.sessionId)?.unregister(record.windowId);
        if (sameLiveRecord(record)) markPanelReattached(record.panelTypeId);
        clearPanelPlacementForWindow(record.panelTypeId, record.windowId);
        recordPanelWindowDiagnostic({
          type: 'host-cleanup-completed',
          panelTypeId: record.panelTypeId,
          windowId: record.windowId,
          sessionId: options.sessionId,
          result: 'reset',
        });
        completed += 1;
      } catch {
        // Keep a failed host's membership and last placement so the user can
        // retry recovery instead of silently turning it into a duplicate.
        recordPanelWindowDiagnostic({
          type: 'layout-persistence-failed',
          panelTypeId: record.panelTypeId,
          windowId: record.windowId,
          sessionId: options.sessionId,
          errorCode: 'reset-close-failed',
        });
        failed += 1;
      }
    }),
  );

  if (failed === 0) {
    // Also discard stale geometry for panels that are no longer live.
    clearPanelPlacements();
    options.announce?.('Panel window layout reset; detached panels returned to the main window.');
  } else if (completed > 0) {
    options.announce?.(
      `Reset ${plural(completed, 'panel window')}; ${plural(failed, 'window')} could not be closed.`,
    );
  } else {
    options.announce?.('Panel window layout could not be reset.');
  }
  return { requested: records.length, completed, failed };
}
