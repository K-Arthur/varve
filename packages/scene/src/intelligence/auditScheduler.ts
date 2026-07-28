/**
 * Audit Scheduler
 *
 * Schedules audit rule execution based on cost, document changes, and user preferences.
 * Implements immediate, debounced, on-demand, and preflight execution modes.
 *
 * @module auditScheduler
 */

import type { AuditFinding, ExecutionCost } from '@strata/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Document change type.
 */
export type DocumentChangeType =
  | 'node-added'
  | 'node-deleted'
  | 'property-changed'
  | 'node-moved'
  | 'node-reparented'
  | 'style-changed'
  | 'component-changed';

/**
 * Document change.
 */
export interface DocumentChange {
  type: DocumentChangeType;
  nodeId?: string;
  property?: string;
  timestamp: number;
}

/**
 * Execution schedule for audit rules.
 */
export interface ExecutionSchedule {
  /** Rule IDs to run immediately (debounced 50ms) */
  immediate: string[];

  /** Rule IDs to run debounced (debounced 300ms) */
  debounced: string[];

  /** Rule IDs to run on-demand only */
  onDemand: string[];

  /** Rule IDs to run at preflight */
  preflight: string[];

  /** Rule IDs to run on schedule (periodic) */
  scheduled: string[];
}

/**
 * Audit execution plan.
 */
export interface AuditExecutionPlan {
  immediate: string[];
  debounced: string[];
  onDemand: string[];
  preflight: string[];
  scheduled: string[];
}

/**
 * Audit execution preferences.
 */
export interface AuditExecutionPreferences {
  /** Debounce delay for immediate rules (ms) */
  immediateDebounceMs: number;

  /** Debounce delay for debounced rules (ms) */
  debouncedDebounceMs: number;

  /** Whether to run expensive rules automatically */
  autoRunExpensive: boolean;

  /** Scheduled audit interval (ms, 0 = disabled) */
  scheduledIntervalMs: number;

  /** Whether to pause audit during rapid edits */
  pauseDuringRapidEdits: boolean;

  /** Rapid edit threshold (edits per second) */
  rapidEditThreshold: number;
}

/**
 * Default execution preferences.
 */
export const DEFAULT_PREFERENCES: AuditExecutionPreferences = {
  immediateDebounceMs: 50,
  debouncedDebounceMs: 300,
  autoRunExpensive: false,
  scheduledIntervalMs: 300000, // 5 minutes
  pauseDuringRapidEdits: true,
  rapidEditThreshold: 10,
};

/**
 * Rule cost classification.
 */
export interface RuleCost {
  ruleId: string;
  cost: ExecutionCost;
}

/**
 * Audit scheduler options.
 */
export interface SchedulerOptions {
  preferences?: Partial<AuditExecutionPreferences>;
  schedule?: Partial<ExecutionSchedule>;
}

// ============================================================================
// Scheduler Class
// ============================================================================

/**
 * Audit scheduler for cost-based rule execution.
 */
export class AuditScheduler {
  private preferences: AuditExecutionPreferences;
  private schedule: ExecutionSchedule;

  getExecutionSchedule(): ExecutionSchedule {
    return this.schedule;
  }

  private pendingRules: Set<string> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private immediateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isPaused: boolean = false;
  private recentChanges: DocumentChange[] = [];
  private scheduledTimer: ReturnType<typeof setInterval> | null = null;
  private ruleCosts: Map<string, ExecutionCost> = new Map();

  // Event callbacks
  private onFindingsUpdated?: (findings: AuditFinding[]) => void;

  constructor(options: SchedulerOptions = {}) {
    this.preferences = {
      ...DEFAULT_PREFERENCES,
      ...options.preferences,
    };

    this.schedule = {
      immediate: ['missing-fonts', 'broken-target', 'missing-home-screen'],
      debounced: ['contrast-aa-fail', 'overset-text', 'zero-size', 'off-canvas'],
      onDemand: ['alpha-fringe', 'banding-risk', 'self-intersection'],
      preflight: [], // Determined by export type
      scheduled: ['orphan-styles', 'unused-components'],
      ...options.schedule,
    };

    // Initialize rule costs
    this.initializeRuleCosts();
  }

  /**
   * Initialize rule cost classifications.
   */
  private initializeRuleCosts(): void {
    // Immediate rules (0-5ms)
    this.ruleCosts.set('missing-fonts', 'immediate');
    this.ruleCosts.set('broken-target', 'immediate');
    this.ruleCosts.set('missing-home-screen', 'immediate');

    // Cheap rules (5-50ms)
    this.ruleCosts.set('contrast-aa-fail', 'cheap');
    this.ruleCosts.set('zero-size', 'cheap');
    this.ruleCosts.set('off-canvas', 'cheap');

    // Moderate rules (50-500ms)
    this.ruleCosts.set('overset-text', 'moderate');
    this.ruleCosts.set('self-intersection', 'moderate');
    this.ruleCosts.set('unnecessary-anchors', 'moderate');

    // Expensive rules (500ms+)
    this.ruleCosts.set('alpha-fringe', 'expensive');
    this.ruleCosts.set('banding-risk', 'expensive');
  }

  /**
   * Register event callbacks.
   */
  on(event: 'findings-updated', callback: (findings: AuditFinding[]) => void): void;
  on(event: string, callback: unknown): void {
    if (event === 'findings-updated') {
      this.onFindingsUpdated = callback as (findings: AuditFinding[]) => void;
    }
  }

  /**
   * Register event callbacks (generic).
   */
  onAny(event: string, callback: unknown): void {
    if (event === 'findings-updated') {
      this.onFindingsUpdated = callback as (findings: AuditFinding[]) => void;
    }
  }

  /**
   * Schedule audit execution based on document changes.
   */
  scheduleAudit(changes: DocumentChange[]): AuditExecutionPlan {
    if (this.isPaused) {
      return {
        immediate: [],
        debounced: [],
        onDemand: [],
        preflight: [],
        scheduled: [],
      };
    }

    // Track recent changes for rapid edit detection
    this.recentChanges.push(...changes);
    this.trimRecentChanges();

    // Check for rapid edits
    if (this.preferences.pauseDuringRapidEdits && this.isRapidEdit()) {
      return {
        immediate: [],
        debounced: [],
        onDemand: [],
        preflight: [],
        scheduled: [],
      };
    }

    // Identify affected rules based on changes
    const affectedRules = this.identifyAffectedRules(changes);

    // Classify by cost and schedule
    const plan: AuditExecutionPlan = {
      immediate: [],
      debounced: [],
      onDemand: [],
      preflight: [],
      scheduled: [],
    };

    for (const ruleId of affectedRules) {
      const cost = this.ruleCosts.get(ruleId) || 'moderate';

      if (this.schedule.immediate.includes(ruleId)) {
        plan.immediate.push(ruleId);
      } else if (cost === 'immediate' || cost === 'cheap') {
        plan.debounced.push(ruleId);
      } else if (cost === 'moderate') {
        plan.debounced.push(ruleId);
      } else if (cost === 'expensive') {
        if (this.preferences.autoRunExpensive) {
          plan.debounced.push(ruleId);
        } else {
          plan.onDemand.push(ruleId);
        }
      }
    }

    return plan;
  }

  /**
   * Execute the audit plan.
   */
  async executePlan(
    plan: AuditExecutionPlan,
    runRule: (ruleId: string) => Promise<AuditFinding[]>,
  ): Promise<void> {
    // Run immediate rules
    if (plan.immediate.length > 0) {
      await this.runImmediate(plan.immediate, runRule);
    }

    // Schedule debounced rules
    if (plan.debounced.length > 0) {
      this.scheduleDebounced(plan.debounced, runRule);
    }

    // Queue on-demand rules (don't run automatically)
    this.pendingRules = new Set(plan.onDemand);
  }

  /**
   * Run immediate rules.
   */
  private async runImmediate(
    ruleIds: string[],
    runRule: (ruleId: string) => Promise<AuditFinding[]>,
  ): Promise<void> {
    if (this.immediateDebounceTimer) {
      clearTimeout(this.immediateDebounceTimer);
    }

    this.immediateDebounceTimer = setTimeout(async () => {
      const findings: AuditFinding[] = [];

      for (const ruleId of ruleIds) {
        try {
          const ruleFindings = await runRule(ruleId);
          findings.push(...ruleFindings);
        } catch (error) {
          console.error(`Error running rule ${ruleId}:`, error);
        }
      }

      this.emitFindingsUpdated(findings);
    }, this.preferences.immediateDebounceMs);
  }

  /**
   * Schedule debounced rules.
   */
  private scheduleDebounced(
    ruleIds: string[],
    runRule: (ruleId: string) => Promise<AuditFinding[]>,
  ): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const findings: AuditFinding[] = [];

      for (const ruleId of ruleIds) {
        try {
          const ruleFindings = await runRule(ruleId);
          findings.push(...ruleFindings);
        } catch (error) {
          console.error(`Error running rule ${ruleId}:`, error);
        }
      }

      this.emitFindingsUpdated(findings);
    }, this.preferences.debouncedDebounceMs);
  }

  /**
   * Run on-demand rules.
   */
  async runOnDemand(
    runRule: (ruleId: string) => Promise<AuditFinding[]>,
    ruleIds?: string[],
  ): Promise<AuditFinding[]> {
    const rulesToRun = ruleIds || Array.from(this.pendingRules);

    const findings: AuditFinding[] = [];

    for (const ruleId of rulesToRun) {
      try {
        const ruleFindings = await runRule(ruleId);
        findings.push(...ruleFindings);
      } catch (error) {
        console.error(`Error running rule ${ruleId}:`, error);
      }
    }

    this.pendingRules.clear();
    return findings;
  }

  /**
   * Run preflight checks.
   */
  async runPreflight(
    exportType: string,
    runRule: (ruleId: string) => Promise<AuditFinding[]>,
  ): Promise<{ findings: AuditFinding[]; passed: boolean }> {
    const preflightRules = this.getPreflightRules(exportType);

    const findings: AuditFinding[] = [];

    for (const ruleId of preflightRules) {
      try {
        const ruleFindings = await runRule(ruleId);
        findings.push(...ruleFindings);
      } catch (error) {
        console.error(`Error running preflight rule ${ruleId}:`, error);
      }
    }

    const errors = findings.filter((f) => f.severity === 'error');
    const passed = errors.length === 0;

    return { findings, passed };
  }

  /**
   * Pause automatic audit execution.
   */
  pause(): void {
    this.isPaused = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.immediateDebounceTimer) {
      clearTimeout(this.immediateDebounceTimer);
      this.immediateDebounceTimer = null;
    }
  }

  /**
   * Resume automatic audit execution.
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Refresh all audits (manual refresh).
   */
  async refresh(
    allRuleIds: string[],
    runRule: (ruleId: string) => Promise<AuditFinding[]>,
  ): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    for (const ruleId of allRuleIds) {
      try {
        const ruleFindings = await runRule(ruleId);
        findings.push(...ruleFindings);
      } catch (error) {
        console.error(`Error running rule ${ruleId}:`, error);
      }
    }

    return findings;
  }

  /**
   * Update preferences.
   */
  updatePreferences(preferences: Partial<AuditExecutionPreferences>): void {
    this.preferences = {
      ...this.preferences,
      ...preferences,
    };
  }

  /**
   * Update schedule.
   */
  updateSchedule(schedule: Partial<ExecutionSchedule>): void {
    this.schedule = {
      ...this.schedule,
      ...schedule,
    };
  }

  /**
   * Get current preferences.
   */
  getPreferences(): AuditExecutionPreferences {
    return { ...this.preferences };
  }

  /**
   * Get current schedule.
   */
  getSchedule(): ExecutionSchedule {
    return { ...this.schedule };
  }

  /**
   * Identify affected rules based on document changes.
   */
  private identifyAffectedRules(changes: DocumentChange[]): string[] {
    const affectedRules = new Set<string>();

    for (const change of changes) {
      switch (change.type) {
        case 'node-added':
          affectedRules.add('unnamed-layers');
          affectedRules.add('zero-size');
          break;
        case 'node-deleted':
          affectedRules.add('orphan-styles');
          affectedRules.add('unused-components');
          break;
        case 'property-changed':
          if (change.property === 'fill' || change.property === 'color') {
            affectedRules.add('contrast-aa-fail');
            affectedRules.add('untokenized-colors');
          }
          if (change.property === 'fontFamily') {
            affectedRules.add('missing-fonts');
          }
          break;
        case 'node-moved':
          affectedRules.add('off-canvas');
          break;
      }
    }

    return Array.from(affectedRules);
  }

  /**
   * Check if edits are rapid (above threshold).
   */
  private isRapidEdit(): boolean {
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    const recentChanges = this.recentChanges.filter((c) => c.timestamp > oneSecondAgo);

    return recentChanges.length >= this.preferences.rapidEditThreshold;
  }

  /**
   * Trim recent changes to last 5 seconds.
   */
  private trimRecentChanges(): void {
    const now = Date.now();
    const fiveSecondsAgo = now - 5000;

    this.recentChanges = this.recentChanges.filter((c) => c.timestamp > fiveSecondsAgo);
  }

  /**
   * Get preflight rules for export type.
   */
  private getPreflightRules(exportType: string): string[] {
    // This would be expanded based on export type
    switch (exportType) {
      case 'pdf':
        return ['missing-fonts', 'mixed-color-spaces', 'low-resolution', 'overset-text'];
      case 'png':
      case 'jpeg':
        return ['missing-fonts', 'low-resolution', 'oversized-assets'];
      case 'svg':
        return ['open-path', 'self-intersection', 'unsupported-effects'];
      default:
        return [];
    }
  }

  /**
   * Emit findings updated event.
   */
  private emitFindingsUpdated(findings: AuditFinding[]): void {
    if (this.onFindingsUpdated) {
      this.onFindingsUpdated(findings);
    }
  }

  /**
   * Cleanup timers.
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.immediateDebounceTimer) {
      clearTimeout(this.immediateDebounceTimer);
    }
    if (this.scheduledTimer) {
      clearInterval(this.scheduledTimer);
    }
  }
}
