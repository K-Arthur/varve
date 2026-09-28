import { deserializeDockLayout } from './dockOps';
import type { DockLayout } from './dockTypes';
import { newId } from './dockTypes';

/** Recovery metadata lives inside the existing per-workspace preference record. */
export interface DockRestoreState {
  revision: number;
  writerId: string;
  /** Failed launches since the last layout was mounted successfully. */
  failedAttempts: number;
  /** True while a restored arrangement has not yet completed its first mount. */
  pending: boolean;
  /** Last tree observed to validate and mount successfully. */
  lastKnownGood?: DockLayout;
}

export function createDockRestoreWriterId(): string {
  return newId();
}

/** Merge hydration copies by revision, then writer identity for concurrent ties. */
export function mergeDockRestoreState(
  local: DockRestoreState | undefined,
  remote: DockRestoreState | undefined,
): DockRestoreState | undefined {
  if (!local) return remote;
  if (!remote) return local;
  if (local.revision !== remote.revision) return local.revision > remote.revision ? local : remote;
  return local.writerId.localeCompare(remote.writerId) >= 0 ? local : remote;
}

/** Reject malformed metadata and validate any embedded recovery tree. */
export function sanitizeDockRestoreState(value: unknown): DockRestoreState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.revision !== 'number' ||
    !Number.isSafeInteger(raw.revision) ||
    raw.revision < 0 ||
    typeof raw.writerId !== 'string' ||
    raw.writerId.length === 0 ||
    raw.writerId.length > 128 ||
    typeof raw.failedAttempts !== 'number' ||
    !Number.isSafeInteger(raw.failedAttempts) ||
    raw.failedAttempts < 0 ||
    raw.failedAttempts > 2 ||
    typeof raw.pending !== 'boolean'
  ) {
    return undefined;
  }
  const result: DockRestoreState = {
    revision: raw.revision,
    writerId: raw.writerId,
    failedAttempts: raw.failedAttempts,
    pending: raw.pending,
  };
  if (raw.lastKnownGood !== undefined) {
    const layout = deserializeDockLayout(raw.lastKnownGood);
    if (layout.ok) result.lastKnownGood = layout.layout;
  }
  return result;
}

/**
 * Begin restoring the saved tree. A pending attempt from the previous app
 * launch counts as one failed restore; the second such failure selects the
 * default arrangement before mounting the saved tree again.
 */
export function beginDockRestoreAttempt(
  current: DockRestoreState | undefined,
  writerId: string,
): DockRestoreState {
  const failedAttempts = current?.pending
    ? Math.min(2, current.failedAttempts + 1)
    : (current?.failedAttempts ?? 0);
  return {
    revision: (current?.revision ?? 0) + 1,
    writerId,
    failedAttempts,
    pending: true,
    ...(current?.lastKnownGood ? { lastKnownGood: current.lastKnownGood } : {}),
  };
}

/** Decide from the persisted pre-launch snapshot, before rendering saved docks. */
export function shouldUseDockRecoveryDefault(state: DockRestoreState | undefined): boolean {
  return Boolean(state?.pending && state.failedAttempts >= 1);
}

/** Promote only a layout that passed validation and completed a mount. */
export function markDockRestoreSucceeded(
  current: DockRestoreState | undefined,
  layout: DockLayout,
  writerId: string,
): DockRestoreState {
  const parsed = deserializeDockLayout(layout);
  if (!parsed.ok) {
    return {
      revision: (current?.revision ?? 0) + 1,
      writerId,
      failedAttempts: current?.failedAttempts ?? 0,
      pending: true,
      ...(current?.lastKnownGood ? { lastKnownGood: current.lastKnownGood } : {}),
    };
  }
  return {
    revision: (current?.revision ?? 0) + 1,
    writerId,
    failedAttempts: 0,
    pending: false,
    lastKnownGood: parsed.layout,
  };
}
