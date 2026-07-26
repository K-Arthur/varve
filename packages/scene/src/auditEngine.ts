/**
 * Audit Rule Registry — workspace-aware, mode-aware audit rule orchestration.
 *
 * Every audit source registers its rules here. The engine:
 * 1. Selects applicable rules based on workspace mode, canvas mode, and active tool
 * 2. Runs rules in priority order with cost-based scheduling
 * 3. Caches results with revision-aware invalidation
 * 4. Produces a unified AuditReport
 *
 * Architecture:
 * - Rules are pure functions: (doc, context) => AuditFinding[]
 * - Rules declare their applicability (workspaces, nodeKinds, cost, execution stage)
 * - The engine groups rules by cost tier: immediate → debounced → on-demand → preflight
 * - Results are cached by (ruleId, docRevision, selectionHash)
 *
 * Research basis: incremental linting (ESLint incremental), SaaS audit pipelines
 * (Figma Dev Mode, Storybook a11y addon), WCAG 2.1 evaluation methodology.
 */

import type {
  AuditFinding,
  AuditSeverity,
  FindingCategory,
  FindingCost,
  FindingSource,
  WorkspaceMode,
} from './auditFinding';
import { buildAuditSummary } from './auditFinding';
import type { Document } from './document';
import type { SuppressionEntry } from './suppressions';
import { isSuppressed } from './suppressions';
import type { NodeId } from './types';

// ---------------------------------------------------------------------------
// Rule applicability model
// ---------------------------------------------------------------------------

/** When a rule executes in the audit lifecycle. */
export type ExecutionStage =
  | 'immediate' // Run after every relevant doc change (< 50ms budget)
  | 'debounced' // Run after interaction settles (300ms debounce)
  | 'on-demand' // Run only when user explicitly requests
  | 'preflight'; // Run before export/publishing

/** Node kinds a rule applies to. Empty = all nodes. */
export type NodeKindFilter = string[];

/** Contextual information passed to audit rules during execution. */
export interface AuditContext {
  /** Current document. */
  doc: Document;
  /** Active workspace mode. */
  workspaceMode: WorkspaceMode;
  /** Active canvas mode ('full' | 'outline' | 'preview'). */
  canvasMode: 'full' | 'outline' | 'preview';
  /** Active tool ID. */
  tool: string;
  /** Currently selected node IDs. */
  selection: NodeId[];
  /** Active page ID. */
  pageId?: string;
  /** Available font families (from FontRegistry). */
  availableFonts?: Set<string>;
  /** Document color mode. */
  colorMode?: string;
  /** Whether we're in prototype/presentation mode. */
  isPresenting: boolean;
  /** Active camera viewport (for viewport-scoped rules). */
  viewport?: { x: number; y: number; w: number; h: number };
}

/** A registered audit rule definition. */
export interface AuditRuleDef {
  /** Unique rule identifier (e.g. 'contrast/aa-fail'). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** High-level category for grouping. */
  category: FindingCategory;
  /** The audit source this rule belongs to. */
  source: FindingSource;
  /** Default severity when the rule fires. */
  defaultSeverity: AuditSeverity;
  /** Performance cost tier. */
  cost: FindingCost;
  /** Execution stage. */
  stage: ExecutionStage;
  /** Which workspace modes this rule applies to. Empty = all. */
  workspaces: WorkspaceMode[];
  /** Node kinds to scan. Empty = all. */
  nodeKinds: NodeKindFilter;
  /** Whether this finding blocks export/publishing. */
  blocking: boolean;
  /** Whether the finding is context-dependent (should not interrupt editing). */
  contextDependent: boolean;
  /** Confidence floor — findings below this confidence are discarded. */
  confidenceFloor: number;
  /** Whether this rule can be suppressed. */
  suppressible: boolean;
  /** The actual check function. */
  run: (ctx: AuditContext) => AuditFinding[];
}

/** A completed scan result for a single rule. */
export interface RuleScanResult {
  ruleId: string;
  findings: AuditFinding[];
  durationMs: number;
  scanId: number;
  stale: boolean;
}

/** Full audit report from a scan cycle. */
export interface AuditReport {
  /** All findings across all rules. */
  findings: AuditFinding[];
  /** Per-rule results. */
  ruleResults: RuleScanResult[];
  /** Aggregated summary. */
  summary: ReturnType<typeof buildAuditSummary>;
  /** Which rules were skipped and why. */
  skippedRules: Array<{ ruleId: string; reason: string }>;
  /** Total scan duration. */
  durationMs: number;
  /** Monotonic scan ID (for staleness detection). */
  scanId: number;
  /** Which execution stage produced this report. */
  stage: ExecutionStage;
  /** Active workspace mode at scan time. */
  workspaceMode: WorkspaceMode;
  /** Active tool at scan time. */
  tool: string;
}

/** Audit execution options. */
export interface AuditOptions {
  /** Specific rules to run. Empty = all applicable rules. */
  ruleIds?: string[];
  /** Specific stages to run. Empty = all stages. */
  stages?: ExecutionStage[];
  /** Skip cached results and force re-run. */
  force?: boolean;
  /** Specific node IDs to scope to (selection-scoped). */
  scopeNodeIds?: NodeId[];
  /** Suppression entries to apply. */
  suppressions?: SuppressionEntry[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const rules = new Map<string, AuditRuleDef>();
let scanCounter = 0;

/** Register an audit rule. Overwrites if ID already exists. */
export function registerRule(rule: AuditRuleDef): void {
  if (rules.has(rule.id) && process.env.NODE_ENV !== 'production') {
    console.warn(`[audit] Overwriting rule: ${rule.id}`);
  }
  rules.set(rule.id, rule);
}

/** Get a rule by ID. */
export function getRule(id: string): AuditRuleDef | undefined {
  return rules.get(id);
}

/** Get all registered rules. */
export function getAllRules(): AuditRuleDef[] {
  return Array.from(rules.values());
}

/** Get rules filtered by criteria. */
export function getRules(filter: {
  workspaceMode?: WorkspaceMode;
  stage?: ExecutionStage;
  cost?: FindingCost;
  source?: FindingSource;
  category?: FindingCategory;
}): AuditRuleDef[] {
  return Array.from(rules.values()).filter((rule) => {
    if (filter.workspaceMode && rule.workspaces.length > 0) {
      if (!rule.workspaces.includes(filter.workspaceMode)) return false;
    }
    if (filter.stage && rule.stage !== filter.stage) return false;
    if (filter.cost && rule.cost !== filter.cost) return false;
    if (filter.source && rule.source !== filter.source) return false;
    if (filter.category && rule.category !== filter.category) return false;
    return true;
  });
}

/** Check if a rule is applicable to the current context. */
export function isRuleApplicable(rule: AuditRuleDef, ctx: AuditContext): boolean {
  // Workspace filter
  if (rule.workspaces.length > 0 && !rule.workspaces.includes(ctx.workspaceMode)) {
    return false;
  }

  // Presentation mode — only run preflight rules
  if (ctx.isPresenting && rule.stage !== 'preflight') {
    return false;
  }

  // Outline/preview canvas mode — skip expensive rules
  if (ctx.canvasMode !== 'full' && rule.cost === 'expensive') {
    return false;
  }

  return true;
}

/** Clear all registered rules (for testing). */
export function clearRules(): void {
  rules.clear();
}

/** Get the number of registered rules. */
export function ruleCount(): number {
  return rules.size;
}

// ---------------------------------------------------------------------------
// Scan cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  findings: AuditFinding[];
  scanId: number;
  timestamp: number;
  docRevision: number;
  selectionKey: string;
}

const scanCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5000;

function selectionKey(selection: NodeId[]): string {
  return [...selection].sort().join(',');
}

function cacheKey(ruleId: string, docRevision: number, selKey: string): string {
  return `${ruleId}:${docRevision}:${selKey}`;
}

function getCached(ruleId: string, docRevision: number, selKey: string): AuditFinding[] | null {
  const key = cacheKey(ruleId, docRevision, selKey);
  const entry = scanCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    scanCache.delete(key);
    return null;
  }
  return entry.findings;
}

function setCached(
  ruleId: string,
  docRevision: number,
  selKey: string,
  findings: AuditFinding[],
): void {
  const key = cacheKey(ruleId, docRevision, selKey);
  scanCache.set(key, {
    findings,
    scanId: scanCounter,
    timestamp: Date.now(),
    docRevision,
    selectionKey: selKey,
  });
}

/** Invalidate all cache entries for a specific document revision. */
export function invalidateCache(docRevision?: number): void {
  if (docRevision === undefined) {
    scanCache.clear();
    return;
  }
  for (const [key, entry] of scanCache) {
    if (entry.docRevision === docRevision) scanCache.delete(key);
  }
}

/** Invalidate cache entries that include specific node IDs. */
export function invalidateNodes(nodeIds: NodeId[]): void {
  const idSet = new Set(nodeIds);
  for (const [key, entry] of scanCache) {
    for (const f of entry.findings) {
      if (f.nodeId && idSet.has(f.nodeId)) {
        scanCache.delete(key);
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Run a single audit rule against the context. */
function runRule(
  rule: AuditRuleDef,
  ctx: AuditContext,
  suppressions: SuppressionEntry[],
  force: boolean,
): RuleScanResult {
  const start = performance.now();
  const selKey = selectionKey(ctx.selection);

  // Cache check
  if (!force) {
    const cached = getCached(
      rule.id,
      ctx.doc.formatVersion ? Number(ctx.doc.formatVersion) : 0,
      selKey,
    );
    if (cached) {
      return {
        ruleId: rule.id,
        findings: cached,
        durationMs: performance.now() - start,
        scanId: scanCounter,
        stale: false,
      };
    }
  }

  // Run the rule
  let rawFindings: AuditFinding[];
  try {
    rawFindings = rule.run(ctx);
  } catch (err) {
    console.error(`[audit] Rule ${rule.id} failed:`, err);
    rawFindings = [];
  }

  // Apply confidence floor
  let findings = rawFindings.filter((f) => f.confidence >= rule.confidenceFloor);

  // Apply suppressions
  if (suppressions.length > 0) {
    findings = findings.filter((f) => !isSuppressed(f, suppressions));
  }

  // Cache results
  setCached(rule.id, ctx.doc.formatVersion ? Number(ctx.doc.formatVersion) : 0, selKey, findings);

  return {
    ruleId: rule.id,
    findings,
    durationMs: performance.now() - start,
    scanId: scanCounter,
    stale: false,
  };
}

/**
 * Run the full audit pipeline for the given context.
 *
 * Execution order:
 * 1. Filter rules by workspace, canvas mode, cost, and stage
 * 2. Sort by cost (cheap first) within each stage
 * 3. Run rules, collect findings
 * 4. Apply suppressions
 * 5. Build summary and report
 */
export function runAudit(ctx: AuditContext, opts: AuditOptions = {}): AuditReport {
  const start = performance.now();
  scanCounter++;
  const currentScanId = scanCounter;

  const suppressions = opts.suppressions ?? [];
  const force = opts.force ?? false;
  const stages = opts.stages ?? ['immediate', 'debounced', 'on-demand', 'preflight'];

  // Select applicable rules
  const applicableRules = Array.from(rules.values()).filter((rule) => {
    if (!isRuleApplicable(rule, ctx)) return false;
    if (!stages.includes(rule.stage)) return false;
    if (opts.ruleIds && opts.ruleIds.length > 0) {
      if (!opts.ruleIds.includes(rule.id)) return false;
    }
    return true;
  });

  // Sort by cost tier (cheap → moderate → expensive)
  const costOrder: Record<FindingCost, number> = { cheap: 0, moderate: 1, expensive: 2 };
  applicableRules.sort((a, b) => costOrder[a.cost] - costOrder[b.cost]);

  // Run rules
  const ruleResults: RuleScanResult[] = [];
  const skippedRules: Array<{ ruleId: string; reason: string }> = [];
  const allFindings: AuditFinding[] = [];

  for (const rule of applicableRules) {
    const result = runRule(rule, ctx, suppressions, force);
    ruleResults.push(result);
    allFindings.push(...result.findings);
  }

  // Check for rules that were expected but not registered

  const durationMs = performance.now() - start;

  return {
    findings: allFindings,
    ruleResults,
    summary: buildAuditSummary(allFindings),
    skippedRules,
    durationMs,
    scanId: currentScanId,
    stage: opts.stages?.[0] ?? 'debounced',
    workspaceMode: ctx.workspaceMode,
    tool: ctx.tool,
  };
}

/**
 * Run a quick status check (immediate stage only, cheap rules only).
 * Used for L1 status bar indicators — must be fast (< 20ms).
 */
export function runQuickStatus(ctx: AuditContext): {
  errorCount: number;
  warningCount: number;
  hasBlocking: boolean;
} {
  const applicableRules = Array.from(rules.values()).filter(
    (rule) => rule.cost === 'cheap' && rule.stage === 'immediate' && isRuleApplicable(rule, ctx),
  );

  let errorCount = 0;
  let warningCount = 0;
  let hasBlocking = false;

  for (const rule of applicableRules) {
    const result = runRule(rule, ctx, [], false);
    for (const f of result.findings) {
      if (f.severity === 'error') {
        errorCount++;
        if (f.blocking) hasBlocking = true;
      } else if (f.severity === 'warning') {
        warningCount++;
      }
    }
  }

  return { errorCount, warningCount, hasBlocking };
}
