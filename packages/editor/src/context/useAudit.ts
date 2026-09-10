import { getPlatformInfo } from '@varve/platform';
import type { Document } from '@varve/scene';
import { AuditScheduler } from '@varve/scene';
import { useCallback, useEffect, useRef } from 'react';

export interface AuditDiagnostics {
  registeredRuleCount: number;
  ruleIds: string[];
  isSchedulerActive: boolean;
  lastScanDuration: number | null;
}

export function useAudit(
  document: Document | null,
  _onToggleOverlay: (visible: boolean) => void,
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

    const isDev =
      getPlatformInfo().kind === 'memory' ||
      (typeof process !== 'undefined' && process.env.NODE_ENV === 'development');

    if (isDev && schedulerRef.current) {
      const start = performance.now();
      schedulerRef.current.scheduleAudit([{ type: 'node-added', timestamp: Date.now() }]);
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
      ? schedulerRef.current.getExecutionSchedule().immediate.length +
        schedulerRef.current.getExecutionSchedule().debounced.length +
        schedulerRef.current.getExecutionSchedule().onDemand.length +
        schedulerRef.current.getExecutionSchedule().preflight.length +
        schedulerRef.current.getExecutionSchedule().scheduled.length
      : 0,
    ruleIds: schedulerRef.current
      ? [
          ...schedulerRef.current.getExecutionSchedule().immediate,
          ...schedulerRef.current.getExecutionSchedule().debounced,
          ...schedulerRef.current.getExecutionSchedule().onDemand,
          ...schedulerRef.current.getExecutionSchedule().preflight,
          ...schedulerRef.current.getExecutionSchedule().scheduled,
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
