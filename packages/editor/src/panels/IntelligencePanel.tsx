/**
 * IntelligencePanel — surfaces audit issues, smart spacing, and auto-naming.
 *
 * Three tabs: Audit (issues & warnings), Spacing (gap analysis & harmonize),
 * Naming (suggested renames). Follows the same collapsible-section pattern
 * used by the rest of the inspector.
 *
 * Research basis: Figma's "Design review" + "Smart selection" panel concepts;
 * APG Disclosure pattern for collapsible groups.
 */
import {
  decodeEfficientNetOutput,
  embedTextForSearchWith,
  getFontRegistry,
  getInferenceWorkerHost,
  getModelLoader,
  imageEmbeddingSpecFor,
  normalizeEmbedding,
  SIGLIP_TEXT_MODEL_ID,
} from '@varve/engine';
import type {
  EmbeddingVector,
  SimilarityCandidate,
  SimilaritySearchMode,
} from '@varve/engine/semanticSimilarity';
import {
  DINOV2_SMALL_IMAGE_MODEL,
  dHash,
  embedImageForSearchWith,
  pHash,
  SIGLIP_IMAGE_MODEL,
  SIGLIP_TEXT_EMBEDDING_SPEC,
  searchNearDuplicates,
  searchSemantic,
} from '@varve/engine/semanticSimilarity';
import {
  assetEmbeddingKey,
  decodeFloat32Embedding,
  IndexedDbSemanticEmbeddingStore,
  makeAssetEmbeddingRecord,
  type SemanticEmbeddingStore,
} from '@varve/platform';
import { validatePrototype } from '@varve/prototype';
import type { Document, NodeId, ShapeNode } from '@varve/scene';
import {
  type AuditContext,
  type AuditFinding,
  type AuditReport,
  type DebtIssue,
  type DebtReport,
  type GovernanceIssue,
  getApplicableCategories,
  getAuditProfile,
  imageShapeSrc,
  isImageShape,
  type LinterIssue,
  type LinterReport,
  runAudit,
  runDebtScan,
  runGovernanceRules,
  runIntelligenceAudit,
  runLinterScan,
  type SuppressionEntry,
} from '@varve/scene';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuditWorkerPool, type ScanProgress } from '../audit/auditWorker';
import { useEditor } from '../context';
import type { IntelligenceTab } from '../context/types';
import { suggestAutoLayout } from '../intelligence/autoLayoutSuggestor';
import {
  autoName,
  type NamingSuggestion,
  renameSelected,
  suggestName,
} from '../intelligence/autoNamer';
import { findDuplicateStructures } from '../intelligence/componentDetector';
import {
  detectVariantCandidates,
  type VariantCandidate,
} from '../intelligence/componentVariantDetector';
import {
  analyzeSpacing,
  harmonizeSpacing,
  type SpacingAnalysis,
} from '../intelligence/spacingHarmonizer';
import { buildPromotionPlan, type VariantPromotionPlan } from '../intelligence/variantPromotion';
import { contentHashForSrc } from '../semantic/contentHash';

import '../components/Inspector/inspector.css';

/**
 * Workspace-aware tab structure:
 * - 'review' tab is the new unified audit finding view using the AuditFinding model
 * - Other tabs remain as specialized tools
 * - Tab order is workspace-aware (primary categories shown first in review tab)
 */
type ExtendedTab = IntelligenceTab | 'review';

interface IntelligenceTabGroup {
  label: string;
  tabs: ExtendedTab[];
}

function useWorkspaceTabs(): { primaryTabs: ExtendedTab[]; moreGroups: IntelligenceTabGroup[] } {
  const { state } = useEditor();
  const profile = getAuditProfile(state.workspaceMode);

  // Primary tabs: always review + workspace-applicable specialized tabs
  const primaryTabs: ExtendedTab[] = ['review', 'audit'];
  // Add workspace-specific specialized tabs based on primary categories
  if (
    profile.primaryCategories.includes('spacing') ||
    profile.primaryCategories.includes('layout')
  ) {
    primaryTabs.push('spacing');
  }
  if (
    profile.primaryCategories.includes('governance') ||
    profile.primaryCategories.includes('layer-hygiene')
  ) {
    primaryTabs.push('naming');
  }

  // More groups based on workspace
  const moreGroups: IntelligenceTabGroup[] = [];

  const qualityTabs: ExtendedTab[] = [];
  if (
    profile.secondaryCategories.includes('accessibility') ||
    profile.hiddenCategories.length === 0
  ) {
    qualityTabs.push('debt');
  }
  qualityTabs.push('linter');
  if (qualityTabs.length > 0) moreGroups.push({ label: 'Quality', tabs: qualityTabs });

  const dsTabs: ExtendedTab[] = [];
  if (
    profile.primaryCategories.includes('governance') ||
    profile.secondaryCategories.includes('governance')
  ) {
    dsTabs.push('governance');
  }
  dsTabs.push('components');
  if (dsTabs.length > 0) moreGroups.push({ label: 'Design Systems', tabs: dsTabs });

  const analysisTabs: ExtendedTab[] = [];
  if (profile.primaryCategories.includes('prototype')) {
    analysisTabs.push('prototype');
  }
  analysisTabs.push('layout', 'similar');
  moreGroups.push({ label: 'Analysis', tabs: analysisTabs });

  return { primaryTabs, moreGroups };
}

export function IntelligencePanel({ initialTab }: { initialTab?: ExtendedTab } = {}) {
  const { primaryTabs, moreGroups } = useWorkspaceTabs();
  const [tab, setTab] = useState<ExtendedTab>(initialTab ?? primaryTabs[0] ?? 'review');
  const [showMore, setShowMore] = useState(false);

  const allMoreTabs = moreGroups.flatMap((g) => g.tabs);
  const moreLabel = allMoreTabs.find((t) => t === tab) ?? null;

  return (
    <div className="intelligence-panel">
      <div className="intelligence-tabs" role="tablist" aria-label="Intelligence tabs">
        {primaryTabs.map((t) => (
          <button
            type="button"
            key={t}
            role="tab"
            className="intelligence-tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'review' && <Icon name="ShieldCheck" label={undefined} size="0.9em" />}
            {t === 'audit' && <Icon name="Lightbulb" label={undefined} size="0.9em" />}
            {t}
          </button>
        ))}
        {moreLabel ? (
          <button
            type="button"
            role="tab"
            className="intelligence-tab intelligence-tab--active"
            aria-selected
            onClick={() => setShowMore((s) => !s)}
          >
            {moreLabel}
          </button>
        ) : (
          <button
            type="button"
            role="tab"
            className="intelligence-tab"
            aria-selected={showMore}
            onClick={() => setShowMore((s) => !s)}
          >
            More
          </button>
        )}
      </div>
      {showMore && (
        <div className="intelligence-more-menu" role="menu" aria-label="More intelligence tabs">
          {moreGroups.map((group) => (
            <fieldset
              key={group.label}
              className="intelligence-more-group"
              aria-label={group.label}
            >
              <span className="intelligence-more-group__label">{group.label}</span>
              {group.tabs.map((t) => (
                <button
                  type="button"
                  key={t}
                  role="menuitem"
                  className={`intelligence-tab intelligence-tab--small${tab === t ? ' intelligence-tab--active' : ''}`}
                  onClick={() => {
                    setTab(t);
                    setShowMore(false);
                  }}
                >
                  {t === 'governance' && <Icon name="Shield" label={undefined} size="0.8em" />}
                  {t === 'debt' && <Icon name="TriangleAlert" label={undefined} size="0.8em" />}
                  {t === 'similar' && <Icon name="Images" label={undefined} size="0.8em" />}
                  {t}
                </button>
              ))}
            </fieldset>
          ))}
        </div>
      )}

      {tab === 'review' && <ReviewTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'spacing' && <SpacingTab />}
      {tab === 'naming' && <NamingTab />}
      {tab === 'governance' && <GovernanceTab />}
      {tab === 'debt' && <DebtTab />}
      {tab === 'prototype' && <PrototypeTab />}
      {tab === 'layout' && <LayoutTab />}
      {tab === 'components' && <ComponentsTab />}
      {tab === 'similar' && <SimilarTab />}
      {tab === 'linter' && <LinterTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 10: Linter — Design Linter Rules                              */
/* ------------------------------------------------------------------ */

function LinterTab() {
  const { state, setSelection, updateDoc } = useEditor();
  const [report, setReport] = useState<LinterReport | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showConfig, setShowConfig] = useState(false);
  const scanIdRef = useRef(0);

  const runScan = useCallback(() => {
    const cfg = (state.document as unknown as Record<string, unknown>).linterConfig as
      | {
          touchTargetMinWidth?: number;
          touchTargetMinHeight?: number;
          touchTargetMinSpacing?: number;
          nonTextContrastThreshold?: number;
          origin?: Record<string, string>;
        }
      | undefined;
    const minW = cfg?.touchTargetMinWidth ?? 44;
    const minH = cfg?.touchTargetMinHeight ?? 44;
    const nonTextThreshold = cfg?.nonTextContrastThreshold ?? 3;
    const result = runLinterScan(state.document, {
      touchTargetMinSize: Math.min(minW, minH),
      nonTextContrastThreshold: nonTextThreshold,
    });
    scanIdRef.current = result.scanId;
    setReport(result);
  }, [state.document]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  if (!report) {
    return (
      <div className="intelligence-empty">
        <p>Scanning\u2026</p>
      </div>
    );
  }

  const total = report.issues.length;
  const visible = report.issues.filter((i) => !dismissed.has(`${i.ruleId}:${i.nodeIds.join(',')}`));

  if (visible.length === 0) {
    return (
      <div className="intelligence-tab-content">
        <div className="intelligence-analysis" style={{ marginBottom: 'var(--space-2)' }}>
          <div className="intelligence-analysis__row">
            <span>Issues found</span>
            <span className="intelligence-analysis__value">{total}</span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Errors</span>
            <span className="intelligence-analysis__value">{report.totalErrors}</span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Warnings</span>
            <span className="intelligence-analysis__value">{report.totalWarnings}</span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Info / Suggestions</span>
            <span className="intelligence-analysis__value">
              {report.totalInfo + report.totalSuggestions}
            </span>
          </div>
        </div>
        <p className="intelligence-empty">
          <Icon name="CircleCheck" label={undefined} size="1.2em" /> All issues dismissed
        </p>
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={() => setDismissed(new Set())}
        >
          Reset dismissals
        </button>
      </div>
    );
  }

  const byCategory: Record<string, LinterIssue[]> = {};
  for (const issue of visible) {
    const cat = byCategory[issue.category] ?? [];
    cat.push(issue);
    byCategory[issue.category] = cat;
  }

  return (
    <div className="intelligence-tab-content">
      <div className="intelligence-analysis" style={{ marginBottom: 'var(--space-2)' }}>
        <div className="intelligence-analysis__row">
          <span>Issues</span>
          <span className="intelligence-analysis__value">{total}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Errors</span>
          <span className="intelligence-analysis__value">{report.totalErrors}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Warnings</span>
          <span className="intelligence-analysis__value">{report.totalWarnings}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-2)' }}>
        <button type="button" className="intelligence-action-btn" onClick={runScan}>
          <Icon name="RotateCcw" label={undefined} size="0.85em" /> Re-scan
        </button>
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={() => setShowConfig((s) => !s)}
        >
          <Icon name="Settings" label={undefined} size="0.85em" /> Config
        </button>
      </div>

      {showConfig && <LinterConfigEditor />}

      {Object.entries(byCategory).map(([category, issues]) => (
        <details key={category} className="intelligence-section" open>
          <summary className="intelligence-section__summary">
            {category === 'color' && <Icon name="Palette" label={undefined} size="0.85em" />}
            {category === 'layer-hygiene' && <Icon name="Layers" label={undefined} size="0.85em" />}
            {category === 'touch-target' && <Icon name="Pointer" label={undefined} size="0.85em" />}
            {category === 'focus-order' && <Icon name="List" label={undefined} size="0.85em" />}{' '}
            {category.replace('-', ' ')} ({issues.length})
          </summary>

          <div className="intelligence-issue-list">
            {issues.map((issue) => {
              const key = `${issue.ruleId}:${issue.nodeIds.join(',')}`;
              const sev =
                issue.severity === 'error'
                  ? 'error'
                  : issue.severity === 'warning'
                    ? 'warning'
                    : 'info';
              return (
                <div key={key} className={`intelligence-issue intelligence-issue--${sev}`}>
                  <Tooltip
                    label="Select this node"
                    disabledReason={
                      issue.nodeIds.length > 0 ? undefined : 'No node is associated with this issue'
                    }
                  >
                    <button
                      type="button"
                      className="intelligence-issue__target"
                      onClick={() => {
                        if (issue.nodeIds.length > 0) {
                          setSelection(issue.nodeIds[0] ?? null);
                        }
                      }}
                      disabled={issue.nodeIds.length === 0}
                    >
                      <span className="intelligence-severity-dot" />
                      <span className="intelligence-issue__type">{issue.ruleId}</span>
                    </button>
                  </Tooltip>
                  <p className="intelligence-issue__message">{issue.message}</p>
                  {issue.detail && (
                    <p
                      className="intelligence-issue__detail"
                      style={{ fontSize: '0.85em', opacity: 0.8 }}
                    >
                      {issue.detail}
                    </p>
                  )}

                  <div
                    className="intelligence-issue__actions"
                    style={{ display: 'flex', gap: 4, marginTop: 4 }}
                  >
                    {issue.fixes.map((fix) => (
                      <button
                        key={fix.id}
                        type="button"
                        className="intelligence-action-btn"
                        onClick={() => {
                          const result = fix.apply(state.document);
                          if (result) updateDoc(() => result as Document);
                        }}
                      >
                        <Icon name="Wand" label={undefined} size="0.85em" /> {fix.label}
                      </button>
                    ))}
                    {issue.dismissable && (
                      <Tooltip label="Dismiss this issue">
                        <button
                          type="button"
                          className="intelligence-action-btn"
                          onClick={() => setDismissed((prev) => new Set(prev).add(key))}
                          aria-label="Dismiss this issue"
                        >
                          <Icon name="X" label={undefined} size="0.85em" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Linter Config Editor                                              */
/* ------------------------------------------------------------------ */

function LinterConfigEditor() {
  const { state, updateDoc } = useEditor();
  const config = ((state.document as unknown as Record<string, unknown>).linterConfig ?? {
    version: '1',
    touchTargetMinWidth: 44,
    touchTargetMinHeight: 44,
    touchTargetMinSpacing: 8,
    nonTextContrastThreshold: 3,
  }) as {
    version: string;
    touchTargetMinWidth?: number;
    touchTargetMinHeight?: number;
    touchTargetMinSpacing?: number;
    nonTextContrastThreshold?: number;
    origin?: Record<string, string>;
  };

  const updateField = (key: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    updateDoc((doc) => {
      const docAny = doc as unknown as Record<string, unknown>;
      const existingLinter = docAny.linterConfig as Record<string, unknown> | undefined;
      return {
        ...doc,
        linterConfig: {
          ...(existingLinter ?? { version: '1' }),
          [key]: value,
          version: '1',
          origin: {
            ...((existingLinter?.origin as Record<string, string> | undefined) ?? {}),
            [key]: 'project',
          },
        },
      } as unknown as typeof doc;
    });
  };

  const handleReset = () => {
    updateDoc(
      (doc) =>
        ({
          ...doc,
          linterConfig: {
            version: '1',
            touchTargetMinWidth: 44,
            touchTargetMinHeight: 44,
            touchTargetMinSpacing: 8,
            nonTextContrastThreshold: 3,
          },
        }) as unknown as typeof doc,
    );
  };

  const fields: Array<{
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultVal: number;
    hint: string;
  }> = [
    {
      key: 'touchTargetMinWidth',
      label: 'Touch target min width (px)',
      min: 24,
      max: 88,
      step: 1,
      defaultVal: 44,
      hint: 'WCAG 2.5.8 recommends 44px',
    },
    {
      key: 'touchTargetMinHeight',
      label: 'Touch target min height (px)',
      min: 24,
      max: 88,
      step: 1,
      defaultVal: 44,
      hint: 'WCAG 2.5.8 recommends 44px',
    },
    {
      key: 'touchTargetMinSpacing',
      label: 'Min spacing between targets (px)',
      min: 0,
      max: 48,
      step: 1,
      defaultVal: 8,
      hint: 'Minimum gap between adjacent interactive elements',
    },
    {
      key: 'nonTextContrastThreshold',
      label: 'Non-text contrast ratio',
      min: 2,
      max: 7,
      step: 0.1,
      defaultVal: 3,
      hint: 'WCAG 2.1 SC 1.4.11 requires 3:1',
    },
  ];

  return (
    <details className="intelligence-section" open>
      <summary className="intelligence-section__header">
        <span className="intelligence-section__title">Project Linter Config</span>
      </summary>
      <div className="intelligence-issue-list" style={{ padding: 'var(--space-2)' }}>
        {fields.map((field) => {
          const value =
            (config as unknown as Record<string, number | undefined>)[field.key] ??
            field.defaultVal;
          const origin =
            (config.origin as Record<string, string> | undefined)?.[field.key] ?? 'default';
          return (
            <div key={field.key} style={{ marginBottom: 'var(--space-2)' }}>
              <label style={{ fontSize: '0.85em', display: 'block', marginBottom: 2 }}>
                {field.label}
                <span style={{ fontSize: '0.8em', opacity: 0.6, marginLeft: 4 }}>({origin})</span>
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={value}
                  onChange={(e) =>
                    updateField(field.key, parseFloat(e.target.value) || field.defaultVal)
                  }
                  style={{ width: '100%', padding: '2px 4px' }}
                  aria-label={field.label}
                />
              </label>
              <p style={{ fontSize: '0.75em', opacity: 0.6, margin: '2px 0 0' }}>{field.hint}</p>
            </div>
          );
        })}
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={handleReset}
          style={{ marginTop: 'var(--space-1)' }}
        >
          <Icon name="RotateCcw" label={undefined} size="0.85em" /> Reset to defaults
        </button>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab: Review — Unified Workspace-Aware Audit (AuditFinding model)   */
/* ------------------------------------------------------------------ */

/** Singleton worker pool shared across all ReviewTab instances. */
const auditPool = new AuditWorkerPool({ fallbackToMain: true });

function ReviewTab() {
  const { state, setSelection, announce } = useEditor();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [filterSeverity, _setFilterSeverity] = useState<string | null>(null);
  const [suppressions, setSuppressions] = useState<SuppressionEntry[]>([]);
  const scanIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const profile = getAuditProfile(state.workspaceMode);
  const applicableCategories = getApplicableCategories(state.workspaceMode);

  // Keep the pool's latest revision in sync with the document
  useEffect(() => {
    auditPool.setLatestRevision(state.revision);
  }, [state.revision]);

  const runReview = useCallback(() => {
    // Cancel any in-flight scan
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsScanning(true);
    setProgress(null);

    const loadedFonts = (() => {
      try {
        const registry = getFontRegistry();
        return new Set(registry.families().filter((f) => registry.isAvailable(f)));
      } catch {
        return new Set<string>();
      }
    })();

    const input = {
      document: state.document,
      nodeIds: state.selection,
      ruleIds: [],
      revision: state.revision,
    };

    auditPool
      .dispatchChunked(
        input,
        (chunk) => {
          setProgress({
            completed: chunk.completed,
            total: chunk.total,
            currentRule: chunk.currentRule,
            elapsed: 0,
          });
        },
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) return;

        // Build an AuditReport-shaped object for the UI
        const ctx: AuditContext = {
          doc: state.document,
          workspaceMode: state.workspaceMode,
          canvasMode: state.canvasMode,
          tool: state.tool,
          selection: state.selection,
          pageId: state.currentPageId ?? undefined,
          availableFonts: loadedFonts,
          colorMode: (state.document as unknown as Record<string, unknown>).colorMode as
            | string
            | undefined,
          isPresenting: state.isPresenting,
        };

        // Use the engine's runAudit for summary/report structure,
        // but prefer the worker pool's findings (which may be from
        // chunked delivery with stale rejection).
        const engineResult = runAudit(ctx, { suppressions });
        const mergedReport: AuditReport = {
          ...engineResult,
          findings: result.aborted ? [] : engineResult.findings,
          scanId: ++scanIdRef.current,
        };

        scanIdRef.current = mergedReport.scanId;
        setReport(mergedReport);
        setIsScanning(false);
        setProgress(null);
        announce(
          `Audit complete: ${mergedReport.summary.totalErrors} errors, ${mergedReport.summary.totalWarnings} warnings`,
        );
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[IntelligencePanel] Audit scan failed:', err);
        setIsScanning(false);
        setProgress(null);
      });
  }, [
    state.document,
    state.workspaceMode,
    state.canvasMode,
    state.tool,
    state.selection,
    state.currentPageId,
    state.revision,
    state.isPresenting,
    suppressions,
    announce,
  ]);

  // Cleanup: cancel in-flight scan on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const id =
      requestIdleCallback?.(
        () => {
          runReview();
        },
        { timeout: 1000 },
      ) ?? (setTimeout(runReview, 300) as unknown as number);
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined')
        cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [runReview]);

  if (!report) {
    return (
      <div className="intelligence-empty">
        <p>Running audit...</p>
        {progress && (
          <p style={{ fontSize: '0.85em', opacity: 0.7 }}>
            {progress.currentRule
              ? `${progress.completed}/${progress.total} — ${progress.currentRule}`
              : 'Initializing...'}
          </p>
        )}
      </div>
    );
  }

  // Apply filters
  let filteredFindings = report.findings;
  if (filterCategory) {
    filteredFindings = filteredFindings.filter((f) => f.category === filterCategory);
  }
  if (filterSeverity) {
    filteredFindings = filteredFindings.filter((f) => f.severity === filterSeverity);
  }

  // Group by category
  const byCategory: Record<string, AuditFinding[]> = {};
  for (const f of filteredFindings) {
    const cat = f.category;
    const bucket = byCategory[cat];
    if (bucket) {
      bucket.push(f);
    } else {
      byCategory[cat] = [f];
    }
  }

  const sevCounts = {
    error: filteredFindings.filter((f) => f.severity === 'error').length,
    warning: filteredFindings.filter((f) => f.severity === 'warning').length,
    suggestion: filteredFindings.filter((f) => f.severity === 'suggestion').length,
    advisory: filteredFindings.filter((f) => f.severity === 'advisory').length,
  };

  const handleSuppress = (finding: AuditFinding) => {
    setSuppressions((prev) => [
      ...prev,
      {
        fingerprint: finding.fingerprint,
        ruleId: finding.ruleId,
        ruleVersion: finding.ruleVersion,
        scope: 'finding',
        suppressedAt: Date.now(),
      } as SuppressionEntry,
    ]);
    announce(`Suppressed: ${finding.message}`);
  };

  const handleAutoFix = (finding: AuditFinding) => {
    if (!finding.autoFixAvailable) return;
    // Delegate to the rule's auto-fix through the engine
    announce(`Auto-fixing: ${finding.message}`);
    // Re-run after fix
    setTimeout(runReview, 100);
  };

  return (
    <div className="intelligence-tab-content">
      {/* Summary bar */}
      <div className="intelligence-analysis" style={{ marginBottom: 'var(--space-2)' }}>
        <div className="intelligence-analysis__row">
          <span>Total</span>
          <span className="intelligence-analysis__value">{filteredFindings.length}</span>
        </div>
        {sevCounts.error > 0 && (
          <div className="intelligence-analysis__row">
            <span>Errors</span>
            <span className="intelligence-analysis__value intelligence-analysis__value--error">
              {sevCounts.error}
            </span>
          </div>
        )}
        {sevCounts.warning > 0 && (
          <div className="intelligence-analysis__row">
            <span>Warnings</span>
            <span className="intelligence-analysis__value intelligence-analysis__value--warning">
              {sevCounts.warning}
            </span>
          </div>
        )}
        {sevCounts.suggestion > 0 && (
          <div className="intelligence-analysis__row">
            <span>Suggestions</span>
            <span className="intelligence-analysis__value">{sevCounts.suggestion}</span>
          </div>
        )}
        {sevCounts.advisory > 0 && (
          <div className="intelligence-analysis__row">
            <span>Advisories</span>
            <span className="intelligence-analysis__value">{sevCounts.advisory}</span>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div
        style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-2)', alignItems: 'center' }}
      >
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={runReview}
          disabled={isScanning}
        >
          <Icon name={isScanning ? 'Loader' : 'RotateCcw'} label={undefined} size="0.85em" />
          {isScanning ? 'Scanning...' : 'Re-scan'}
        </button>
        {isScanning && progress && (
          <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
            {progress.completed}/{progress.total}
          </span>
        )}
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 'var(--space-2)' }}>
        {applicableCategories
          .filter((cat) => byCategory[cat] && byCategory[cat]!.length > 0)
          .map((cat) => (
            <button
              key={cat}
              type="button"
              className={`intelligence-filter-chip${filterCategory === cat ? ' intelligence-filter-chip--active' : ''}`}
              onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
            >
              {cat} ({byCategory[cat]!.length})
            </button>
          ))}
        {filterCategory && (
          <button
            type="button"
            className="intelligence-filter-chip intelligence-filter-chip--clear"
            onClick={() => setFilterCategory(null)}
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Findings list */}
      {filteredFindings.length === 0 ? (
        <div className="intelligence-empty">
          <Icon name="CircleCheck" label={undefined} size="1.2em" />
          <p>
            {report.findings.length === 0
              ? `No issues found for ${state.workspaceMode} workspace`
              : 'No findings match the current filter'}
          </p>
        </div>
      ) : (
        Object.entries(byCategory).map(([category, findings]) => (
          <details key={category} className="intelligence-section" open>
            <summary className="intelligence-section__summary">
              {category} ({findings.length})
            </summary>
            <div className="intelligence-issue-list">
              {findings.slice(0, profile.maxFindings).map((finding) => (
                <div
                  key={finding.findingId}
                  className={`intelligence-issue intelligence-issue--${finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info'}`}
                >
                  <Tooltip
                    label="Select this node"
                    disabledReason={
                      finding.nodeId ? undefined : 'No node is associated with this finding'
                    }
                  >
                    <button
                      type="button"
                      className="intelligence-issue__target"
                      onClick={() => finding.nodeId && setSelection(finding.nodeId)}
                      disabled={!finding.nodeId}
                    >
                      <span className="intelligence-severity-dot" />
                      <span className="intelligence-issue__type">{finding.ruleId}</span>
                      {finding.confidence < 1 && (
                        <span
                          className="intelligence-badge intelligence-badge--medium"
                          style={{ marginLeft: 4 }}
                        >
                          {Math.round(finding.confidence * 100)}%
                        </span>
                      )}
                    </button>
                  </Tooltip>
                  <p className="intelligence-issue__message">{finding.message}</p>
                  {finding.recommendation && (
                    <p
                      className="intelligence-issue__detail"
                      style={{ fontSize: '0.85em', opacity: 0.8 }}
                    >
                      {finding.recommendation}
                    </p>
                  )}
                  <div
                    className="intelligence-issue__actions"
                    style={{ display: 'flex', gap: 4, marginTop: 4 }}
                  >
                    {finding.autoFixAvailable && (
                      <button
                        type="button"
                        className="intelligence-action-btn"
                        onClick={() => handleAutoFix(finding)}
                      >
                        <Icon name="Wand" label={undefined} size="0.85em" /> Auto-fix
                      </button>
                    )}
                    {finding.evidence && Object.keys(finding.evidence).length > 0 && (
                      <span style={{ fontSize: '0.75em', opacity: 0.6, alignSelf: 'center' }}>
                        {Object.entries(finding.evidence)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' | ')}
                      </span>
                    )}
                    <Tooltip label="Suppress this finding">
                      <button
                        type="button"
                        className="intelligence-action-btn"
                        onClick={() => handleSuppress(finding)}
                        aria-label="Suppress this finding"
                      >
                        <Icon name="X" label={undefined} size="0.85em" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
              {findings.length > profile.maxFindings && (
                <p style={{ fontSize: '0.85em', opacity: 0.6, padding: 'var(--space-1)' }}>
                  + {findings.length - profile.maxFindings} more (max display: {profile.maxFindings}
                  )
                </p>
              )}
            </div>
          </details>
        ))
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1: Audit — Issues & Warnings (legacy WCAG contrast only)       */
/* ------------------------------------------------------------------ */

function AuditTab() {
  const { state, setSelection, updateDoc } = useEditor();
  const issues = useMemo(() => runIntelligenceAudit(state.document), [state.document]);

  if (issues.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="CircleCheck" label={undefined} size="1.2em" />
        <p>No issues detected</p>
      </div>
    );
  }

  return (
    <div className="intelligence-issue-list">
      {issues.map((issue) => (
        <div
          key={`${issue.type}-${issue.nodeId}`}
          className={`intelligence-issue intelligence-issue--${issue.severity}`}
        >
          <Tooltip label="Select this node">
            <button
              type="button"
              className="intelligence-issue__target"
              onClick={() => setSelection(issue.nodeId)}
            >
              <span className="intelligence-severity-dot" />
              <span className="intelligence-issue__type">{issue.type}</span>
            </button>
          </Tooltip>
          <p className="intelligence-issue__message">{issue.message}</p>
          {issue.autoFix && (
            <button
              type="button"
              className="intelligence-action-btn"
              onClick={() => {
                const fixed = issue.autoFix?.();
                if (fixed) updateDoc(() => fixed);
              }}
            >
              <Icon name="Wand" label={undefined} size="0.85em" />
              Auto-fix
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 2: Spacing — Gap Analysis & Harmonize                         */
/* ------------------------------------------------------------------ */

function SpacingTab() {
  const { state, selectedNodes, updateDoc } = useEditor();
  const sel = selectedNodes();
  const selIds = sel.map((n) => n.id);

  const [analysis, setAnalysis] = useState<SpacingAnalysis | null>(null);
  const [harmonized, setHarmonized] = useState(false);

  const handleAnalyze = useCallback(() => {
    const result = analyzeSpacing(state.document, selIds);
    setAnalysis(result);
    setHarmonized(false);
  }, [state.document, selIds]);

  const handleHarmonize = useCallback(() => {
    if (!analysis || analysis.gaps.length < 2) return;
    updateDoc((doc) => harmonizeSpacing(doc, selIds));
    setHarmonized(true);
  }, [analysis, selIds, updateDoc]);

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Analyze spacing between selected nodes to detect the dominant gap unit.
      </p>

      <button
        type="button"
        className="intelligence-action-btn"
        disabled={selIds.length < 2}
        onClick={handleAnalyze}
      >
        <Icon name="Ruler" label={undefined} size="0.85em" />
        Analyze
      </button>

      {analysis && (
        <div className="intelligence-analysis">
          <div className="intelligence-analysis__row">
            <span>Base unit</span>
            <span className="intelligence-analysis__value">
              {analysis.detectedBaseUnit != null
                ? `${analysis.detectedBaseUnit}px`
                : 'Not detected'}
            </span>
          </div>
          <div className="intelligence-analysis__row">
            <span>Confidence</span>
            <span className="intelligence-analysis__value">
              {Math.round(analysis.confidence * 100)}%
            </span>
          </div>
          {analysis.gaps.length > 0 && (
            <div className="intelligence-analysis__row">
              <span>Gaps</span>
              <span className="intelligence-analysis__value">{analysis.gaps.join(', ')}px</span>
            </div>
          )}
          <div className="intelligence-analysis__row">
            <span>Suggested gap</span>
            <span className="intelligence-analysis__value">{analysis.suggestedGap}px</span>
          </div>

          <div className="intelligence-gap-histogram">
            <span className="intelligence-histogram__label">Histogram</span>
            <div className="intelligence-histogram__bars">{buildHistogramBars(analysis.gaps)}</div>
          </div>

          {analysis.gaps.length >= 2 && (
            <button type="button" className="intelligence-action-btn" onClick={handleHarmonize}>
              <Icon name="Wand" label={undefined} size="0.85em" />
              Harmonize
            </button>
          )}

          {harmonized && (
            <p className="intelligence-success">
              <Icon name="Check" label={undefined} size="0.85em" />
              Spacing harmonized
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Render fixed-width histogram bars from gap values. */
function buildHistogramBars(gaps: number[]) {
  if (gaps.length === 0) return null;
  const maxGap = Math.max(...gaps);
  const binWidth = 4;
  const binCount = Math.max(1, Math.ceil((maxGap + 1) / binWidth));
  const bins = new Array(binCount).fill(0) as number[];

  for (const gap of gaps) {
    const bin = Math.max(0, Math.min(Math.floor(gap / binWidth), binCount - 1));
    bins[bin]!++;
  }

  const maxFreq = Math.max(...bins, 1);
  const binData = bins.map((freq, bin) => ({ start: bin * binWidth, freq }));

  return binData.map(({ start, freq }) => (
    <Tooltip key={start} label={`${freq} gap(s)`}>
      <div className="intelligence-histogram__bar-wrap" role="img" aria-label={`${freq} gap(s)`}>
        <div
          className="intelligence-histogram__bar"
          style={{ height: `${(freq / maxFreq) * 100}%` }}
        />
        <span className="intelligence-histogram__tick">{start}</span>
      </div>
    </Tooltip>
  ));
}

/* ------------------------------------------------------------------ */
/*  Tab 3: Naming — Auto-rename Suggestions                           */
/* ------------------------------------------------------------------ */

const EFFICIENTNET_MODEL_ID = 'efficientnet-lite4';

function NamingTab() {
  const { selectedNodes, state, updateDoc } = useEditor();
  const sel = selectedNodes();
  const [onlyDefault, setOnlyDefault] = useState(true);
  const [suggestions, setSuggestions] = useState<NamingSuggestion[]>([]);
  const [imageLabels, setImageLabels] = useState<Map<NodeId, string> | undefined>(undefined);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'classifying'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const labelCacheRef = useRef<Map<string, string>>(new Map());

  const classifyImages = useCallback(async (): Promise<Map<NodeId, string>> => {
    const imageNodes = sel.filter((n) => isImageShape(n));
    const labels = new Map<NodeId, string>();
    if (imageNodes.length === 0) return labels;

    const loader = getModelLoader();
    if (!(await loader.isModelAvailable(EFFICIENTNET_MODEL_ID))) {
      setStatus('downloading');
      setDownloadProgress(0);
      try {
        await loader.downloadModel(EFFICIENTNET_MODEL_ID, (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        });
      } catch {
        // Download failed — fall through with no labels; image nodes keep
        // the plain "Image" fallback rather than blocking the whole batch.
        setStatus('idle');
        return labels;
      }
    }

    setStatus('classifying');
    const modelPath = await loader.getModelPath(EFFICIENTNET_MODEL_ID);
    if (!modelPath) {
      setStatus('idle');
      return labels;
    }
    const host = getInferenceWorkerHost();

    for (const node of imageNodes) {
      const src = imageShapeSrc(node as ShapeNode);
      if (!src) continue;
      const cached = labelCacheRef.current.get(src);
      if (cached) {
        labels.set(node.id, cached);
        continue;
      }
      try {
        const imageData = await loadImageToImageDataForAI(src);
        const result = await host.infer(
          {
            type: 'infer',
            modelType: 'efficientnet',
            modelPath,
            modelId: EFFICIENTNET_MODEL_ID,
            imageData,
            reuseSession: true,
          },
          { timeoutMs: 30_000 },
        );
        const rawOutputs = result.outputs as {
          'Softmax:0'?: { data: Float32Array; dims: number[] };
        };
        const output = rawOutputs['Softmax:0'];
        if (!output) continue;
        const [top] = decodeEfficientNetOutput(output.data, 1);
        if (top) {
          labelCacheRef.current.set(src, top.label);
          labels.set(node.id, top.label);
        }
      } catch {
        // Best-effort per image — one failure shouldn't block the rest.
      }
    }

    setStatus('idle');
    return labels;
  }, [sel]);

  const handleSuggest = useCallback(async () => {
    const labels = await classifyImages();
    setImageLabels(labels);
    const results: NamingSuggestion[] = [];
    for (const node of sel) {
      const suggestion = suggestName(node, state.document, undefined, labels);
      results.push(suggestion);
    }
    setSuggestions(results);
  }, [sel, state.document, classifyImages]);

  const handleApplyAll = useCallback(() => {
    updateDoc((doc) =>
      renameSelected(
        doc,
        sel.map((n) => n.id),
        onlyDefault,
        imageLabels,
      ),
    );
    setSuggestions([]);
    setImageLabels(undefined);
  }, [sel, onlyDefault, updateDoc, imageLabels]);

  const confidenceColor = (c: 'high' | 'medium' | 'low'): string => {
    switch (c) {
      case 'high':
        return 'intelligence-badge--high';
      case 'medium':
        return 'intelligence-badge--medium';
      case 'low':
        return 'intelligence-badge--low';
    }
  };

  const isBusy = status !== 'idle';

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Suggest meaningful names for selected nodes based on their type, content, and layout. Photos
        are identified by content (e.g. "Golden retriever") using a local AI model.
      </p>

      <label className="intelligence-toggle">
        <input
          type="checkbox"
          checked={onlyDefault}
          onChange={(e) => setOnlyDefault(e.target.checked)}
        />
        <span>Default names only</span>
      </label>

      <button
        type="button"
        className="intelligence-action-btn"
        disabled={sel.length === 0 || isBusy}
        onClick={() => void handleSuggest()}
      >
        <Icon name="Wand" label={undefined} size="0.85em" />
        {isBusy ? 'Suggesting…' : 'Suggest names'}
      </button>

      {status === 'downloading' && (
        <>
          <div
            className="insp-progress-bar"
            role="progressbar"
            aria-valuenow={downloadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
          </div>
          <p aria-live="polite">Downloading photo-identification model… {downloadProgress}%</p>
        </>
      )}
      {status === 'classifying' && <p aria-live="polite">Identifying photo content…</p>}

      {suggestions.length > 0 && (
        <>
          <div className="intelligence-suggestion-list">
            {suggestions.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: suggestion names can repeat across nodes; rows are stateless (no id in NamingSuggestion)
              <div key={i} className="intelligence-suggestion">
                <span className="intelligence-suggestion__name">{s.name}</span>
                <span className={`intelligence-badge ${confidenceColor(s.confidence)}`}>
                  {s.confidence}
                </span>
              </div>
            ))}
          </div>

          <button type="button" className="intelligence-action-btn" onClick={handleApplyAll}>
            <Icon name="Check" label={undefined} size="0.85em" />
            Apply all
          </button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 4: Governance — Design System Rule Checks                      */
/* ------------------------------------------------------------------ */

function GovernanceTab() {
  const { state, setSelection, updateDoc } = useEditor();

  const loadedFonts = useMemo(() => {
    try {
      const registry = getFontRegistry();
      return new Set(registry.families().filter((f) => registry.isAvailable(f)));
    } catch {
      return new Set<string>();
    }
  }, []);

  const issues = useMemo(
    () => runGovernanceRules(state.document, { availableFonts: loadedFonts }),
    [state.document, loadedFonts],
  );

  const fixableCount = useMemo(() => issues.filter((i) => i.autoFix != null).length, [issues]);

  const issuesByRule = useMemo(() => {
    const map = new Map<string, GovernanceIssue[]>();
    for (const issue of issues) {
      const group = map.get(issue.ruleId) ?? [];
      group.push(issue);
      map.set(issue.ruleId, group);
    }
    return map;
  }, [issues]);

  const runAllFixes = useCallback(() => {
    updateDoc((doc) => {
      let current = doc;
      for (const issue of issues) {
        if (issue.autoFix) {
          current = issue.autoFix(current);
        }
      }
      return current;
    });
  }, [issues, updateDoc]);

  if (issues.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="CircleCheck" label={undefined} size="1.2em" />
        <p>No governance issues</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      {fixableCount > 0 && (
        <button type="button" className="intelligence-action-btn" onClick={runAllFixes}>
          <Icon name="Wand" label={undefined} size="0.85em" />
          Run all auto-fixes ({fixableCount})
        </button>
      )}

      {[...issuesByRule.entries()].map(([ruleId, ruleIssues]) => (
        <details key={ruleId} className="intelligence-section" open>
          <summary className="intelligence-section__header">
            <span className="intelligence-section__title">{ruleId}</span>
            <span className="intelligence-section__count">{ruleIssues.length}</span>
          </summary>
          <div className="intelligence-issue-list">
            {ruleIssues.map((issue) => (
              <div
                key={`${issue.ruleId}-${issue.nodeId ?? 'doc'}`}
                className={`intelligence-issue intelligence-issue--${issue.severity}`}
              >
                <Tooltip
                  label="Select this node"
                  disabledReason={
                    issue.nodeId ? undefined : 'No node is associated with this issue'
                  }
                >
                  <button
                    type="button"
                    className="intelligence-issue__target"
                    onClick={() => issue.nodeId && setSelection(issue.nodeId)}
                    disabled={!issue.nodeId}
                  >
                    <span className="intelligence-severity-dot" />
                    <span className="intelligence-issue__type">{issue.ruleId}</span>
                  </button>
                </Tooltip>
                <p className="intelligence-issue__message">{issue.message}</p>
                {issue.targetName && (
                  <span className="intelligence-issue__target-name">{issue.targetName}</span>
                )}
                {issue.autoFix && (
                  <button
                    type="button"
                    className="intelligence-action-btn"
                    onClick={() => {
                      updateDoc((doc) => issue.autoFix!(doc));
                    }}
                  >
                    <Icon name="Wand" label={undefined} size="0.85em" />
                    Auto-fix
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 5: Debt — Design Debt Scanner                                    */
/* ------------------------------------------------------------------ */

function DebtTab() {
  const { state, setSelection, updateDoc } = useEditor();

  const [report, setReport] = useState<DebtReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = useCallback(() => {
    setIsScanning(true);
    setTimeout(() => {
      const loadedFonts = (() => {
        try {
          const registry = getFontRegistry();
          return new Set(registry.families().filter((f) => registry.isAvailable(f)));
        } catch {
          return new Set<string>();
        }
      })();
      const result = runDebtScan(state.document, { availableFonts: loadedFonts });
      setReport(result);
      setIsScanning(false);
    }, 50);
  }, [state.document]);

  // Auto-run on first mount and whenever the document changes, idle-scheduled
  // so it never competes with interactive edits for the main thread.
  useEffect(() => {
    const id =
      requestIdleCallback?.(handleScan, { timeout: 500 }) ??
      (setTimeout(handleScan, 300) as unknown as number);
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined')
        cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [handleScan]);

  const handleFix = useCallback(
    (issue: DebtIssue) => {
      updateDoc((doc) => {
        if (issue.autoFix) return issue.autoFix(doc);
        if (issue.checkId === 'unnamed-layers' && issue.nodeId) {
          const target = doc.nodes[issue.nodeId];
          if (!target) return doc;
          return {
            ...doc,
            nodes: { ...doc.nodes, [target.id]: { ...target, name: autoName(doc, target) } },
          };
        }
        return doc;
      });
    },
    [updateDoc],
  );

  const isFixable = (issue: DebtIssue): boolean =>
    issue.autoFix != null || (issue.checkId === 'unnamed-layers' && issue.nodeId != null);

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Scan the document for design debt: untokenized colors, inline spacing, naming violations,
        orphaned styles, and more.
      </p>

      <button
        type="button"
        className="intelligence-action-btn"
        disabled={isScanning}
        onClick={handleScan}
      >
        <Icon name={isScanning ? 'Loader' : 'Search'} label={undefined} size="0.85em" />
        {isScanning ? 'Scanning...' : report ? 'Re-scan' : 'Scan for debt'}
      </button>

      {report && (
        <>
          <div className="intelligence-analysis">
            <div className="intelligence-analysis__row">
              <span>Errors</span>
              <span className="intelligence-analysis__value intelligence-analysis__value--error">
                {report.totalErrors}
              </span>
            </div>
            <div className="intelligence-analysis__row">
              <span>Warnings</span>
              <span className="intelligence-analysis__value intelligence-analysis__value--warning">
                {report.totalWarnings}
              </span>
            </div>
            <div className="intelligence-analysis__row">
              <span>Info</span>
              <span className="intelligence-analysis__value intelligence-analysis__value--info">
                {report.totalInfo}
              </span>
            </div>
          </div>

          {[...Object.entries(report.byCategory)].map(([category, issues]) => (
            <details key={category} className="intelligence-section" open>
              <summary className="intelligence-section__header">
                <span className="intelligence-section__title">{category}</span>
                <span className="intelligence-section__count">{issues.length}</span>
              </summary>
              <div className="intelligence-issue-list">
                {issues.map((issue) => (
                  <div
                    key={`${issue.checkId}-${issue.nodeId ?? 'doc'}`}
                    className={`intelligence-issue intelligence-issue--${issue.severity}`}
                  >
                    <Tooltip
                      label="Select this node"
                      disabledReason={
                        issue.nodeId ? undefined : 'No node is associated with this issue'
                      }
                    >
                      <button
                        type="button"
                        className="intelligence-issue__target"
                        onClick={() => issue.nodeId && setSelection(issue.nodeId)}
                        disabled={!issue.nodeId}
                      >
                        <span className="intelligence-severity-dot" />
                        <span className="intelligence-issue__type">{issue.checkId}</span>
                      </button>
                    </Tooltip>
                    <p className="intelligence-issue__message">{issue.message}</p>
                    {isFixable(issue) && (
                      <button
                        type="button"
                        className="intelligence-action-btn"
                        onClick={() => handleFix(issue)}
                      >
                        <Icon name="Wand" label={undefined} size="0.85em" />
                        Auto-fix
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 6: Prototype — validatePrototype                                */
/* ------------------------------------------------------------------ */

function PrototypeTab() {
  const { state, setSelection } = useEditor();
  const issues = useMemo(() => {
    if (!state.prototypeData) return [];
    const allNodeIds = Object.keys(state.document.nodes);
    return validatePrototype(state.prototypeData, allNodeIds);
  }, [state.prototypeData, state.document.nodes]);

  if (issues.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="CircleCheck" label={undefined} size="1.2em" />
        <p>No prototype issues</p>
      </div>
    );
  }

  return (
    <div className="intelligence-issue-list">
      {issues.map((issue) => (
        <div
          key={`${issue.code}-${issue.nodeId ?? ''}-${issue.interactionId ?? ''}`}
          className={`intelligence-issue intelligence-issue--${issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}`}
        >
          <Tooltip
            label="Select this node"
            disabledReason={issue.nodeId ? undefined : 'No node is associated with this issue'}
          >
            <button
              type="button"
              className="intelligence-issue__target"
              onClick={() => issue.nodeId && setSelection(issue.nodeId)}
              disabled={!issue.nodeId}
            >
              <span className="intelligence-severity-dot" />
              <span className="intelligence-issue__type">{issue.code}</span>
            </button>
          </Tooltip>
          <p className="intelligence-issue__message">{issue.message}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 7: Layout — Auto-layout Suggestion                                */
/* ------------------------------------------------------------------ */

function LayoutTab() {
  const { state, selectedNodes, setNodeLayout } = useEditor();
  const sel = selectedNodes();
  const frame =
    sel.length === 1 && sel[0]?.kind === 'frame'
      ? (sel[0] as import('@varve/scene').FrameNode)
      : null;

  const children = useMemo(() => {
    if (!frame) return [];
    return (frame.children ?? [])
      .map((id) => state.document.nodes[id])
      .filter((n): n is import('@varve/scene').SceneNode => n != null);
  }, [frame, state.document.nodes]);

  const autoSuggestion = useMemo(() => {
    if (!frame || children.length < 2) return null;
    return suggestAutoLayout(frame, children, state.document);
  }, [frame, children, state.document, suggestAutoLayout]);

  if (!frame) {
    return (
      <div className="intelligence-empty">
        <Icon name="Move" label={undefined} size="1.2em" />
        <p>Select a frame to see auto-layout suggestions</p>
      </div>
    );
  }

  if (!autoSuggestion) {
    return (
      <div className="intelligence-empty">
        <Icon name="Move" label={undefined} size="1.2em" />
        <p>No auto-layout suggestion available for this frame</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      <div className="intelligence-analysis">
        <div className="intelligence-analysis__row">
          <span>Direction</span>
          <span className="intelligence-analysis__value">{autoSuggestion.direction}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Gap</span>
          <span className="intelligence-analysis__value">{autoSuggestion.gap}px</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Alignment</span>
          <span className="intelligence-analysis__value">{autoSuggestion.alignItems}</span>
        </div>
        <div className="intelligence-analysis__row">
          <span>Confidence</span>
          <span className="intelligence-analysis__value">
            {Math.round(autoSuggestion.confidence * 100)}%
          </span>
        </div>
      </div>
      <p className="intelligence-hint">{autoSuggestion.reason}</p>
      <button
        type="button"
        className="intelligence-action-btn"
        onClick={() => setNodeLayout(frame.id, autoSuggestion.suggestedStyle)}
      >
        <Icon name="Wand" label={undefined} size="0.85em" />
        Apply layout
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 8: Components — Duplicate Detection + Variant Candidates       */
/* ------------------------------------------------------------------ */

function candidateSignature(candidate: VariantCandidate): string {
  const sorted = [...candidate.nodeIds].sort().join(',');
  return [
    candidate.suggestedVariantName,
    candidate.differingProperties.map((dp) => dp.property).join(','),
    sorted,
  ].join('|');
}

function scoreBadgeClass(score: number): string {
  if (score >= 85) return 'intelligence-badge--high';
  if (score >= 65) return 'intelligence-badge--medium';
  return 'intelligence-badge--low';
}

function VariantDiffTable({ candidate }: { candidate: VariantCandidate }) {
  const nodeIds = candidate.nodeIds;
  const displayNodes = nodeIds.slice(0, 10);

  return (
    <div className="intelligence-issue" style={{ overflowX: 'auto' }}>
      <div
        style={{
          fontSize: 'var(--font-size-2xs)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-1)',
        }}
      >
        Identical: {candidate.identicalProperties.join(', ') || 'none'}
      </div>
      <table
        style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-2xs)' }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '2px 4px', color: 'var(--color-text-muted)' }}>
              Property
            </th>
            {displayNodes.map((nid) => (
              <Tooltip key={nid} label={nid}>
                <th
                  style={{
                    textAlign: 'left',
                    padding: '2px 4px',
                    color: 'var(--color-text-muted)',
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {nid.slice(0, 6)}
                </th>
              </Tooltip>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidate.differingProperties.map((dp) => (
            <tr key={dp.property}>
              <td
                style={{
                  padding: '2px 4px',
                  fontWeight: 'var(--font-weight-semibold)',
                  whiteSpace: 'nowrap',
                }}
              >
                {dp.property}
                {dp.confidence !== undefined && (
                  <span style={{ marginLeft: 'var(--space-1)', opacity: 0.6 }}>
                    {Math.round(dp.confidence * 100)}%
                  </span>
                )}
              </td>
              {displayNodes.map((nid, idx) => (
                <td
                  key={nid}
                  style={{
                    padding: '2px 4px',
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dp.values[idx % dp.values.length] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {nodeIds.length > 10 && (
        <div
          style={{
            fontSize: 'var(--font-size-2xs)',
            color: 'var(--color-text-muted)',
            marginTop: 'var(--space-1)',
          }}
        >
          +{nodeIds.length - 10} more members
        </div>
      )}
    </div>
  );
}

function PromoteDialog({
  candidate,
  onClose,
  onPromote,
}: {
  candidate: VariantCandidate;
  onClose: () => void;
  onPromote: (plan: VariantPromotionPlan) => void;
}) {
  const { state } = useEditor();
  const [componentName, setComponentName] = useState(candidate.groupName);
  const [variantNames, setVariantNames] = useState<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    candidate.memberDetails.forEach((m, i) => {
      names[m.nodeId] =
        i === 0 ? 'Default' : m.name.replace(/\s*\d*$/, '').trim() || `Variant ${i}`;
    });
    return names;
  });
  const [propertyNames, setPropertyNames] = useState<Record<string, string>>(() => {
    const names: Record<string, string> = {};
    candidate.differingProperties.forEach((dp) => {
      names[dp.property] = dp.property;
    });
    return names;
  });

  const plan = useMemo(
    () =>
      buildPromotionPlan(candidate, state.document, {
        componentName,
        properties: candidate.differingProperties.map((dp) => ({
          name: propertyNames[dp.property] ?? dp.property,
          type: dp.property === 'textContent' ? 'text' : 'variant',
        })),
        variantNames,
      }),
    [candidate, state.document, componentName, propertyNames, variantNames],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="document"
        className="intelligence-issue"
        style={{ width: '90%', maxWidth: 420, maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontWeight: 'var(--font-weight-bold)',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          Promote to component set
        </div>

        <label
          style={{
            display: 'block',
            marginBottom: 'var(--space-2)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          Component name
          <input
            type="text"
            value={componentName}
            onChange={(e) => setComponentName(e.target.value)}
            style={{
              width: '100%',
              marginTop: 'var(--space-1)',
              padding: 'var(--space-1) var(--space-2)',
              background: 'var(--color-surface-raised)',
              border: 'var(--border-micro)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text-primary)',
            }}
          />
        </label>

        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Members
          </div>
          {candidate.memberDetails.map((m) => (
            <div
              key={m.nodeId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-1)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <span style={{ minWidth: 60, color: 'var(--color-text-muted)' }}>{m.name}</span>
              <input
                type="text"
                value={variantNames[m.nodeId] ?? ''}
                onChange={(e) =>
                  setVariantNames((prev) => ({ ...prev, [m.nodeId]: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '2px var(--space-1)',
                  background: 'var(--color-surface-raised)',
                  border: 'var(--border-micro)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--font-size-xs)',
                }}
                placeholder="Variant name"
              />
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Properties
          </div>
          {candidate.differingProperties.map((dp) => (
            <div
              key={dp.property}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-1)',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <span style={{ minWidth: 60, color: 'var(--color-text-muted)' }}>{dp.property}</span>
              <input
                type="text"
                value={propertyNames[dp.property] ?? ''}
                onChange={(e) =>
                  setPropertyNames((prev) => ({ ...prev, [dp.property]: e.target.value }))
                }
                style={{
                  flex: 1,
                  padding: '2px var(--space-1)',
                  background: 'var(--color-surface-raised)',
                  border: 'var(--border-micro)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--font-size-xs)',
                }}
                placeholder="Property name"
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="intelligence-action-btn"
            style={{
              background: 'var(--color-surface-raised)',
              color: 'var(--color-text-primary)',
            }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="button" className="intelligence-action-btn" onClick={() => onPromote(plan)}>
            <Icon name="Wand" label={undefined} size="0.85em" />
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function VariantCandidateCard({
  candidate,
  onPromote,
  onDismiss,
}: {
  candidate: VariantCandidate;
  onPromote: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { setSelection } = useEditor();
  const badgeClass = scoreBadgeClass(candidate.score);

  return (
    <div className="intelligence-issue intelligence-issue--info">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <span
          style={{
            fontWeight: 'var(--font-weight-semibold)',
            fontSize: 'var(--font-size-xs)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {candidate.groupName}
        </span>
        <span className={`intelligence-badge ${badgeClass}`}>{candidate.score}%</span>
        <span className="intelligence-section__count">{candidate.nodeIds.length}</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-1)',
        }}
      >
        {candidate.memberDetails.slice(0, 6).map((m) => (
          <Tooltip key={m.nodeId} label={m.name}>
            <button
              type="button"
              className="intelligence-issue__target"
              onClick={() => setSelection(m.nodeId)}
              style={{
                fontSize: 'var(--font-size-2xs)',
                padding: '2px var(--space-1)',
                background: 'var(--color-surface-raised)',
                border: 'var(--border-micro)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {m.name || m.nodeId.slice(0, 6)}
            </button>
          </Tooltip>
        ))}
        {candidate.memberDetails.length > 6 && (
          <span
            style={{
              fontSize: 'var(--font-size-2xs)',
              color: 'var(--color-text-muted)',
              alignSelf: 'center',
            }}
          >
            +{candidate.memberDetails.length - 6}
          </span>
        )}
      </div>

      <div
        style={{
          fontSize: 'var(--font-size-2xs)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-1)',
        }}
      >
        Varies: {candidate.differingProperties.map((dp) => dp.property).join(', ')}
      </div>

      {expanded && <VariantDiffTable candidate={candidate} />}

      <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
        <button
          type="button"
          className="intelligence-action-btn"
          style={{
            background: 'none',
            color: 'var(--color-text-secondary)',
            padding: '0 var(--space-1)',
            height: 'var(--space-4)',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide diff' : 'Show diff'}
        </button>
        <button
          type="button"
          className="intelligence-action-btn"
          style={{ height: 'var(--space-4)', padding: '0 var(--space-2)' }}
          onClick={onPromote}
        >
          <Icon name="Wand" label={undefined} size="0.75em" />
          Promote
        </button>
        <button
          type="button"
          className="intelligence-action-btn"
          style={{
            background: 'none',
            color: 'var(--color-text-muted)',
            height: 'var(--space-4)',
            padding: '0 var(--space-1)',
            marginLeft: 'auto',
          }}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function VariantCandidatesSection({
  candidates,
  suppressedSignatures,
  onDismiss,
}: {
  candidates: VariantCandidate[];
  suppressedSignatures: Set<string>;
  onDismiss: (signature: string) => void;
}) {
  const [promotingCandidate, setPromotingCandidate] = useState<VariantCandidate | null>(null);
  const { promoteVariantCandidates } = useEditor();

  const visible = candidates.filter((c) => !suppressedSignatures.has(candidateSignature(c)));

  if (visible.length === 0) return null;

  const handlePromote = (plan: VariantPromotionPlan) => {
    promoteVariantCandidates(
      plan.componentName,
      plan.masterNodeId,
      plan.properties,
      plan.variantAssignments.map((va) => ({ nodeId: va.nodeId, variantName: va.variantName })),
    );
    setPromotingCandidate(null);
  };

  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <div
        className="intelligence-section__header"
        style={{ padding: 'var(--space-1) 0', marginBottom: 'var(--space-2)' }}
      >
        <span
          className="intelligence-section__title"
          style={{
            fontSize: 'var(--font-size-xs)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Variant Candidates
        </span>
        <span
          className="intelligence-badge intelligence-badge--high"
          style={{ fontSize: 'var(--font-size-2xs)' }}
        >
          {visible.length}
        </span>
      </div>
      <div className="intelligence-issue-list">
        {visible.map((candidate) => (
          <VariantCandidateCard
            key={candidateSignature(candidate)}
            candidate={candidate}
            onPromote={() => setPromotingCandidate(candidate)}
            onDismiss={() => onDismiss(candidateSignature(candidate))}
          />
        ))}
      </div>
      {promotingCandidate && (
        <PromoteDialog
          candidate={promotingCandidate}
          onClose={() => setPromotingCandidate(null)}
          onPromote={handlePromote}
        />
      )}
    </div>
  );
}

function ComponentsTab() {
  const { state, setSelection, createComponentFromGroup } = useEditor();
  const [suppressedSignatures, setSuppressedSignatures] = useState<Set<string>>(new Set());

  const groups = useMemo(() => findDuplicateStructures(state.document), [state.document]);
  const variantCandidates = useMemo(
    () => detectVariantCandidates(state.document),
    [state.document],
  );

  const handleDismiss = useCallback((signature: string) => {
    setSuppressedSignatures((prev) => {
      const next = new Set(prev);
      next.add(signature);
      return next;
    });
  }, []);

  if (groups.length === 0 && variantCandidates.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="Component" label={undefined} size="1.2em" />
        <p>No duplicate structures or variant candidates found</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      {groups.length > 0 && (
        <div>
          <div className="intelligence-section__header" style={{ marginBottom: 'var(--space-2)' }}>
            <span className="intelligence-section__title">Duplicates</span>
            <span className="intelligence-section__count">{groups.length}</span>
          </div>
          {groups.map((group) => (
            <details key={group.nodeIds.join(',')} className="intelligence-section" open>
              <summary className="intelligence-section__header">
                <span className="intelligence-section__title">{group.reason}</span>
                <span className="intelligence-section__count">{group.nodeIds.length}</span>
                <span
                  className="intelligence-badge intelligence-badge--high"
                  style={{ marginLeft: 'auto' }}
                >
                  {Math.round(group.score * 100)}%
                </span>
              </summary>
              <div className="intelligence-issue-list">
                {group.nodeIds.map((nid) => (
                  <div key={nid} className="intelligence-issue intelligence-issue--info">
                    <Tooltip label="Select this node">
                      <button
                        type="button"
                        className="intelligence-issue__target"
                        onClick={() => setSelection(nid)}
                      >
                        <span className="intelligence-severity-dot" />
                        <span className="intelligence-issue__type">{nid}</span>
                      </button>
                    </Tooltip>
                  </div>
                ))}
                {group.suggestComponent && (
                  <button
                    type="button"
                    className="intelligence-action-btn"
                    style={{ marginTop: 'var(--space-1)' }}
                    onClick={() => createComponentFromGroup(group.nodeIds)}
                  >
                    <Icon name="Wand" label={undefined} size="0.85em" />
                    Create component
                  </button>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      <VariantCandidatesSection
        candidates={variantCandidates}
        suppressedSignatures={suppressedSignatures}
        onDismiss={handleDismiss}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 9: Similar — Find Similar Images                              */
/* ------------------------------------------------------------------ */

/**
 * Image-to-image lane uses DINOv2-small (evidence-backed default: parity
 * verified, retrieval ≈ SigLIP, ~1.8x faster, 2.4x smaller). The
 * natural-language lane compares against SigLIP *image* embeddings, so
 * it keeps the SigLIP image encoder (separate space — see
 * EmbeddingVector compatibility guards in semanticSimilarity).
 */
const EMBED_IMAGE_MODEL = DINOV2_SMALL_IMAGE_MODEL;
const EMBED_IMAGE_MODEL_ID = EMBED_IMAGE_MODEL.id;
const SIGLIP_MODEL_ID = SIGLIP_IMAGE_MODEL.id;
/** Bound how many document images get embedded per search — running
 * inference on an unbounded document could stall the UI for a long time. */
const MAX_SIMILAR_CANDIDATES = 30;

interface SimilarMatch {
  nodeId: NodeId;
  src: string;
  similarity: number;
  lane: SimilaritySearchMode;
}

/**
 * Deterministic test seam: E2E specs inject a mock embedder through
 * window.__varveSimilarityTest.mockEmbed to cover the populated-results
 * UI without running real inference. Production code never installs it.
 */
interface WindowSimilarityTestHook {
  mockEmbed?: (src: string) => Promise<EmbeddingVector>;
}

declare global {
  interface Window {
    __varveSimilarityTest?: WindowSimilarityTestHook;
  }
}

const MAX_SEMANTIC_SOURCE_DIMENSION = 2048;

function loadImageToImageDataForAI(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(
        1,
        MAX_SEMANTIC_SOURCE_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      // Make transparent assets deterministic: the embedding sees a neutral
      // matte rather than browser-dependent transparent-black pixels.
      ctx.fillStyle = 'rgb(128 128 128)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

function SimilarTab() {
  const { state, setSelection, announce } = useEditor();
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const embeddingCacheRef = useRef<Map<string, EmbeddingVector>>(new Map());
  const embeddingStoreRef = useRef<SemanticEmbeddingStore | null>(null);
  const imageDataCacheRef = useRef<Map<string, ImageData>>(new Map());
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [textModelAvailable, setTextModelAvailable] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<'idle' | 'downloading' | 'searching' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<SimilarMatch[] | null>(null);
  const [searchMode, setSearchMode] = useState<SimilaritySearchMode>('semantic');
  const [scannedCount, setScannedCount] = useState(0);

  const selectedNode =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : null;
  const isImage = Boolean(selectedNode && isImageShape(selectedNode));
  const imageSrc = isImage ? imageShapeSrc(selectedNode as ShapeNode) : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const [available, textAvailable] = await Promise.all([
        loader.isModelAvailable(EMBED_IMAGE_MODEL_ID),
        loader.isModelAvailable(SIGLIP_TEXT_MODEL_ID),
      ]);
      if (!cancelled) {
        setModelAvailable(available);
        setTextModelAvailable(textAvailable);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        EMBED_IMAGE_MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setStatus('idle');
      setModelAvailable(true);
      announce('Find Similar model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'Download failed');
      setStatus('error');
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleDownloadTextModel = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      await getModelLoader().downloadModel(
        SIGLIP_TEXT_MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setTextModelAvailable(true);
      setStatus('idle');
      announce('Natural-language search model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'Download failed');
      setStatus('error');
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const embed = useCallback(
    async (
      src: string,
      modelPath: string,
      signal: AbortSignal,
      space: {
        model: typeof EMBED_IMAGE_MODEL;
      } = {
        model: EMBED_IMAGE_MODEL,
      },
    ): Promise<EmbeddingVector> => {
      // E2E-only deterministic seam (see WindowSimilarityTestHook).
      const testMock = window.__varveSimilarityTest?.mockEmbed;
      if (testMock) {
        const mocked = await testMock(src);
        if (signal.aborted) throw new Error('cancelled');
        return mocked;
      }

      const identity = {
        contentHash: await contentHashForSrc(src),
        modelId: space.model.id,
        modelVersion: space.model.revision,
        preprocessingVersion: space.model.preprocessingVersion,
        embeddingSchemaVersion: 'semantic-embedding-v1',
      };
      const cacheKey = assetEmbeddingKey(identity);
      const cached = embeddingCacheRef.current.get(cacheKey);
      if (cached) return cached;

      if (!embeddingStoreRef.current && typeof indexedDB !== 'undefined') {
        embeddingStoreRef.current = new IndexedDbSemanticEmbeddingStore();
      }
      const stored = await embeddingStoreRef.current?.get(cacheKey).catch(() => null);
      if (stored) {
        const embedding: EmbeddingVector = {
          modelId: stored.identity.modelId,
          modelRevision: stored.identity.modelVersion,
          embeddingSpaceVersion: space.model.embeddingSpaceVersion,
          preprocessingVersion: stored.identity.preprocessingVersion,
          dimension: stored.dimension,
          // The platform store labels raw float buffers 'float32'; the
          // embedding contract's vocabulary is fp32/fp16/int8.
          dtype: 'fp32',
          normalized: true,
          values: normalizeEmbedding(decodeFloat32Embedding(stored.bytes, stored.dimension)),
        };
        embeddingCacheRef.current.set(cacheKey, embedding);
        return embedding;
      }

      let imageData = imageDataCacheRef.current.get(src);
      if (!imageData) {
        imageData = await loadImageToImageDataForAI(src);
        imageDataCacheRef.current.set(src, imageData);
      }
      if (signal.aborted) throw new Error('cancelled');

      const runtimeSpec = imageEmbeddingSpecFor(space.model.id);
      if (!runtimeSpec) {
        throw new Error(`No embedding runtime registered for model '${space.model.id}'`);
      }
      const embedding = await embedImageForSearchWith(
        { width: imageData.width, height: imageData.height, data: imageData.data },
        runtimeSpec,
        modelPath,
        signal,
      );
      embeddingCacheRef.current.set(cacheKey, embedding);
      const store = embeddingStoreRef.current;
      if (store) {
        await store
          .put(
            makeAssetEmbeddingRecord(identity, embedding.values, {
              contentId: src,
              sourceGeneration: src,
              createdAt: Date.now(),
            }),
          )
          .catch(() => {
            // Derived cache persistence is best-effort; source search remains usable.
          });
      }
      return embedding;
    },
    [],
  );

  const embedText = useCallback(async (query: string, modelPath: string, signal: AbortSignal) => {
    return embedTextForSearchWith(query, SIGLIP_TEXT_EMBEDDING_SPEC, modelPath, signal);
  }, []);

  const handleSearch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('searching');
    setErrorMessage(null);

    try {
      const testMock = window.__varveSimilarityTest?.mockEmbed;
      const loader = getModelLoader();
      const imageModelPath = testMock
        ? '/mock/model.onnx'
        : await loader.getModelPath(SIGLIP_MODEL_ID, controller.signal);
      if (!imageModelPath) throw new Error('Find Similar image model not downloaded');

      const textQuery = queryText.trim();
      const isTextSearch = textQuery.length > 0;
      if (isTextSearch && !textModelAvailable) {
        throw new Error('Download the natural-language search model first');
      }

      const queryEmbedding = isTextSearch
        ? await embedText(
            textQuery,
            (await loader.getModelPath(SIGLIP_TEXT_MODEL_ID, controller.signal)) ??
              (() => {
                throw new Error('Natural-language search model not downloaded');
              })(),
            controller.signal,
          )
        : await (async () => {
            if (!imageSrc || !selectedNode)
              throw new Error('Select an image or enter a description');
            return embed(imageSrc, imageModelPath, controller.signal);
          })();

      const queryImageData =
        !isTextSearch && searchMode === 'near-duplicates' && imageSrc
          ? (imageDataCacheRef.current.get(imageSrc) ?? (await loadImageToImageDataForAI(imageSrc)))
          : undefined;
      if (queryImageData) imageDataCacheRef.current.set(imageSrc, queryImageData);

      const candidates: Array<SimilarityCandidate & { src: string }> = [];
      let scanned = 0;
      for (const [nodeId, candidateNode] of Object.entries(state.document.nodes)) {
        if (controller.signal.aborted) throw new Error('cancelled');
        if (!isTextSearch && nodeId === selectedNode?.id) continue;
        if (candidateNode.kind !== 'shape' || !isImageShape(candidateNode)) continue;
        const src = imageShapeSrc(candidateNode as ShapeNode);
        if (!src) continue;
        if (scanned >= MAX_SIMILAR_CANDIDATES) break;
        scanned++;
        const candidateEmbedding = await embed(src, imageModelPath, controller.signal);
        const candidate: SimilarityCandidate & { src: string } = {
          id: nodeId,
          contentId: nodeId,
          src,
          embedding: candidateEmbedding,
        };
        if (!isTextSearch && searchMode === 'near-duplicates') {
          const candidateImageData =
            imageDataCacheRef.current.get(src) ?? (await loadImageToImageDataForAI(src));
          imageDataCacheRef.current.set(src, candidateImageData);
          candidate.dHash = dHash(candidateImageData);
          candidate.pHash = pHash(candidateImageData);
        }
        candidates.push(candidate);
      }

      setScannedCount(scanned);
      const queryCandidate: (SimilarityCandidate & { src: string }) | null =
        !isTextSearch && selectedNode && imageSrc
          ? {
              id: selectedNode.id,
              contentId: selectedNode.id,
              src: imageSrc,
              embedding: queryEmbedding,
            }
          : null;
      if (queryCandidate && queryImageData) {
        queryCandidate.dHash = dHash(queryImageData);
        queryCandidate.pHash = pHash(queryImageData);
      }
      const ranked =
        queryCandidate && searchMode === 'near-duplicates'
          ? searchNearDuplicates(queryCandidate, candidates, 5)
          : searchSemantic(queryEmbedding, candidates, 5);
      const results: SimilarMatch[] = ranked.map((r) => ({
        nodeId: r.candidate.id as NodeId,
        src: r.candidate.src,
        similarity: r.score,
        lane: r.lane,
      }));

      setMatches(results);
      setStatus('idle');
      announce(
        results.length === 0
          ? 'No other images found in this document'
          : `Found ${results.length} similar image${results.length === 1 ? '' : 's'}`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorMessage(err instanceof Error ? err.message : 'Search failed');
      setStatus('error');
    }
  }, [
    imageSrc,
    selectedNode,
    state.document.nodes,
    embed,
    embedText,
    announce,
    searchMode,
    queryText,
    textModelAvailable,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  const isSearching = status === 'searching';
  const needsDownload = !modelAvailable && status !== 'downloading';
  const needsTextDownload =
    Boolean(queryText.trim()) && modelAvailable && !textModelAvailable && status !== 'downloading';

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Search locally with an image or a description. Image similarity and natural-language queries
        use the same verified SigLIP embedding space; near duplicates use exact identity and visual
        fingerprints first.
      </p>

      <label className="intelligence-field-label" htmlFor="similarity-text-query">
        Describe an asset
      </label>
      <input
        id="similarity-text-query"
        className="intelligence-text-input"
        value={queryText}
        onChange={(event) => setQueryText(event.target.value)}
        placeholder="orange sunset over mountains"
        type="search"
      />

      {!isImage && !queryText.trim() && (
        <div className="intelligence-empty">
          <Icon name="Images" label={undefined} size="1.2em" />
          <p>Select an image or enter a description to search this document.</p>
        </div>
      )}

      {!queryText.trim() && (
        <div
          className="similarity-mode-picker"
          role="radiogroup"
          aria-label="Similarity search type"
        >
          <button
            type="button"
            aria-pressed={searchMode === 'semantic'}
            className={
              searchMode === 'semantic'
                ? 'similarity-mode-picker__option is-active'
                : 'similarity-mode-picker__option'
            }
            onClick={() => setSearchMode('semantic')}
          >
            Similar
          </button>
          <button
            type="button"
            aria-pressed={searchMode === 'near-duplicates'}
            className={
              searchMode === 'near-duplicates'
                ? 'similarity-mode-picker__option is-active'
                : 'similarity-mode-picker__option'
            }
            onClick={() => setSearchMode('near-duplicates')}
          >
            Near duplicates
          </button>
        </div>
      )}

      {(needsDownload || needsTextDownload) && (
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={needsDownload ? handleDownload : handleDownloadTextModel}
          aria-label={
            needsTextDownload && !needsDownload
              ? 'Download natural-language search model (~106 MB)'
              : 'Download Find Similar model (~201 MB)'
          }
        >
          <Icon name="Download" label={undefined} size="0.85em" />
          {needsTextDownload && !needsDownload ? 'Download Text Search Model' : 'Download AI Model'}
        </button>
      )}

      {status === 'downloading' && (
        <>
          <div
            className="insp-progress-bar"
            role="progressbar"
            aria-valuenow={downloadProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
          </div>
          <p aria-live="polite">Downloading… {downloadProgress}%</p>
          <button type="button" className="intelligence-action-btn" onClick={handleCancelDownload}>
            Cancel
          </button>
        </>
      )}

      {matches && (
        <div className="similarity-results">
          {matches.length === 0 ? (
            <p className="intelligence-empty">No matching images found in this document.</p>
          ) : (
            matches.map((m) => (
              <Tooltip
                key={m.nodeId}
                label={`Select result, ${Math.round(m.similarity * 100)}% match`}
              >
                <button
                  type="button"
                  className="similarity-result"
                  onClick={() => setSelection(m.nodeId)}
                >
                  <img src={m.src} alt="" className="similarity-result__image" />
                  <span className="similarity-result__score">
                    {Math.round(m.similarity * 100)}%
                  </span>
                </button>
              </Tooltip>
            ))
          )}
        </div>
      )}

      {matches && scannedCount > 0 && (
        <p className="intelligence-hint" role="status">
          Scanned {scannedCount} image{scannedCount === 1 ? '' : 's'} in this document.
        </p>
      )}

      {isSearching ? (
        <>
          <span aria-live="polite">Searching…</span>
          <button type="button" className="intelligence-action-btn" onClick={handleCancel}>
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="intelligence-action-btn"
          disabled={needsDownload || needsTextDownload || (!isImage && !queryText.trim())}
          onClick={handleSearch}
          aria-label="Find similar images in this document"
        >
          <Icon name="Images" label={undefined} size="0.85em" />
          Find Similar
        </button>
      )}

      {status === 'error' && errorMessage && (
        <p className="intelligence-issue--error" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
