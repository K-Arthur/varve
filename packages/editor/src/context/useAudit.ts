import { useEffect, useRef, useCallback } from 'react';
import { AuditScheduler } from '@strata/scene';
import type { Document } from '@strata/scene';
import { getPlatformInfo } from '@strata/platform';

export interface AuditDiagnostics {
  registeredRuleCount: number;
  ruleIds: string[];
  isSchedulerActive: boolean;
  lastScanDuration: number | null;
}

export function useAudit(
  document: Document | null,
  onToggleOverlay: (visible: boolean) => void,
): {
  scheduler: AuditScheduler | null;
  diagnostics: AuditDiagnostics;
  refreshScheduler: () => void;
} {
  const schedulerRef = useRef<AuditScheduler | null>(null);
  const lastScanRef = useRef<number | null>(null);

  // Create scheduler on mount, destroy on unmount
  useEffect(() => {
    const scheduler = new AuditScheduler();
    schedulerRef.current = scheduler;

    return () => {
      scheduler.destroy();
      schedulerRef.current = null;
    };
  }, []);

  // Schedule scans when document changes
  useEffect(() => {
    if (!document || !schedulerRef.current) return;

    const isDev = getPlatformInfo().kind === 'memory' || 
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');

    if (isDev && schedulerRef.current) {
      const start = performance.now();
      const plan = schedulerRef.current.scheduleAudit([
        { type: 'node-added', timestamp: Date.now() },
      ]);
      lastScanRef.current = performance.now() - start;
    }
  }, [document]);

  const refreshScheduler = useCallback(() => {
    if (schedulerRef.current) {
      schedulerRef.current.destroy();
    }
    const scheduler = new AuditScheduler();
    schedulerRef.current = scheduler;
  }, []);

  const diagnostics: AuditDiagnostics = {
    registeredRuleCount: schedulerRef.current
      ? schedulerRef.current['schedule']?.immediate.length +
        schedulerRef.current['schedule']?.debounced.length +
        schedulerRef.current['schedule']?.onDemand.length +
        schedulerRef.current['schedule']?.preflight.length +
        schedulerRef.current['schedule']?.scheduled.length
      : 0,
    ruleIds: schedulerRef.current
      ? [
          ...(schedulerRef.current['schedule']?.immediate ?? []),
          ...(schedulerRef.current['schedule']?.debounced ?? []),
          ...(schedulerRef.current['schedule']?.onDemand ?? []),
          ...(schedulerRef.current['schedule']?.preflight ?? []),
          ...(schedulerRef.current['schedule']?.scheduled ?? []),
        ]
      : [],
    isSchedulerActive: schedulerRef.current !== null,
    lastScanDuration: lastScanRef.current,
  };

  return {
    scheduler: schedulerRef.current,
    diagnostics,
    refreshScheduler,
  };
}
