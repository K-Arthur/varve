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
  getFontRegistry,
  getInferenceWorkerHost,
  getModelLoader,
  normalizeEmbedding,
  rankBySimilarity,
} from '@strata/engine';
import { validatePrototype } from '@strata/prototype';
import type { NodeId, ShapeNode } from '@strata/scene';
import {
  type DebtIssue,
  type DebtReport,
  type GovernanceIssue,
  imageShapeSrc,
  isImageShape,
  runDebtScan,
  runGovernanceRules,
  runIntelligenceAudit,
} from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  analyzeSpacing,
  harmonizeSpacing,
  type SpacingAnalysis,
} from '../intelligence/spacingHarmonizer';

import '../components/Inspector/inspector.css';

const PRIMARY_TABS: IntelligenceTab[] = ['audit', 'spacing', 'naming'];
const MORE_TABS: IntelligenceTab[] = [
  'governance',
  'debt',
  'prototype',
  'layout',
  'components',
  'similar',
];

export function IntelligencePanel({ initialTab }: { initialTab?: IntelligenceTab } = {}) {
  const [tab, setTab] = useState<IntelligenceTab>(initialTab ?? 'audit');
  const [showMore, setShowMore] = useState(false);

  const moreLabel = MORE_TABS.find((t) => t === tab) ?? null;

  return (
    <div className="intelligence-panel">
      <div className="intelligence-tabs" role="tablist" aria-label="Intelligence tabs">
        {PRIMARY_TABS.map((t) => (
          <button
            type="button"
            key={t}
            role="tab"
            className="intelligence-tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
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
        <div
          className="intelligence-more-menu"
          style={{
            display: 'flex',
            gap: 4,
            padding: '0 var(--space-2) var(--space-1)',
            flexWrap: 'wrap',
          }}
        >
          {MORE_TABS.map((t) => (
            <button
              type="button"
              key={t}
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
        </div>
      )}

      {tab === 'audit' && <AuditTab />}
      {tab === 'spacing' && <SpacingTab />}
      {tab === 'naming' && <NamingTab />}
      {tab === 'governance' && <GovernanceTab />}
      {tab === 'debt' && <DebtTab />}
      {tab === 'prototype' && <PrototypeTab />}
      {tab === 'layout' && <LayoutTab />}
      {tab === 'components' && <ComponentsTab />}
      {tab === 'similar' && <SimilarTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1: Audit — Issues & Warnings                                  */
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
      {issues.map((issue, i) => (
        <div
          key={`${issue.nodeId}-${i}`}
          className={`intelligence-issue intelligence-issue--${issue.severity}`}
        >
          <button
            type="button"
            className="intelligence-issue__target"
            onClick={() => setSelection(issue.nodeId)}
            title="Select this node"
          >
            <span className="intelligence-severity-dot" />
            <span className="intelligence-issue__type">{issue.type}</span>
          </button>
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

  return bins.map((freq, i) => (
    <div key={i} className="intelligence-histogram__bar-wrap" title={`${freq} gap(s)`}>
      <div
        className="intelligence-histogram__bar"
        style={{ height: `${(freq / maxFreq) * 100}%` }}
      />
      <span className="intelligence-histogram__tick">{i * binWidth}</span>
    </div>
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
            {ruleIssues.map((issue, i) => (
              <div
                key={`${issue.nodeId}-${i}`}
                className={`intelligence-issue intelligence-issue--${issue.severity}`}
              >
                <button
                  type="button"
                  className="intelligence-issue__target"
                  onClick={() => issue.nodeId && setSelection(issue.nodeId)}
                  disabled={!issue.nodeId}
                  title={issue.nodeId ? 'Select this node' : undefined}
                >
                  <span className="intelligence-severity-dot" />
                  <span className="intelligence-issue__type">{issue.ruleId}</span>
                </button>
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
                {issues.map((issue, i) => (
                  <div
                    key={`${issue.nodeId}-${i}`}
                    className={`intelligence-issue intelligence-issue--${issue.severity}`}
                  >
                    <button
                      type="button"
                      className="intelligence-issue__target"
                      onClick={() => issue.nodeId && setSelection(issue.nodeId)}
                      disabled={!issue.nodeId}
                      title={issue.nodeId ? 'Select this node' : undefined}
                    >
                      <span className="intelligence-severity-dot" />
                      <span className="intelligence-issue__type">{issue.checkId}</span>
                    </button>
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
      {issues.map((issue, i) => (
        <div
          key={`${issue.nodeId}-${i}`}
          className={`intelligence-issue intelligence-issue--${issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}`}
        >
          <button
            type="button"
            className="intelligence-issue__target"
            onClick={() => issue.nodeId && setSelection(issue.nodeId)}
            title={issue.nodeId ? 'Select this node' : undefined}
          >
            <span className="intelligence-severity-dot" />
            <span className="intelligence-issue__type">{issue.code}</span>
          </button>
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
      ? (sel[0] as import('@strata/scene').FrameNode)
      : null;

  const children = useMemo(() => {
    if (!frame) return [];
    return (frame.children ?? [])
      .map((id) => state.document.nodes[id])
      .filter((n): n is import('@strata/scene').SceneNode => n != null);
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
/*  Tab 8: Components — Duplicate Detection                            */
/* ------------------------------------------------------------------ */

function ComponentsTab() {
  const { state, setSelection, createComponentFromGroup } = useEditor();

  const groups = useMemo(() => findDuplicateStructures(state.document), [state.document]);

  if (groups.length === 0) {
    return (
      <div className="intelligence-empty">
        <Icon name="Component" label={undefined} size="1.2em" />
        <p>No duplicate structures found</p>
      </div>
    );
  }

  return (
    <div className="intelligence-tab-content">
      {groups.map((group, i) => (
        <details key={i} className="intelligence-section" open>
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
                <button
                  type="button"
                  className="intelligence-issue__target"
                  onClick={() => setSelection(nid)}
                  title="Select this node"
                >
                  <span className="intelligence-severity-dot" />
                  <span className="intelligence-issue__type">{nid}</span>
                </button>
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
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 9: Similar — Find Similar Images (SigLIP)                     */
/* ------------------------------------------------------------------ */

const SIGLIP_MODEL_ID = 'siglip-base-patch16-224';
/** Bound how many document images get embedded per search — running
 * inference on an unbounded document could stall the UI for a long time. */
const MAX_SIMILAR_CANDIDATES = 30;

interface SimilarMatch {
  nodeId: NodeId;
  src: string;
  similarity: number;
}

function loadImageToImageDataForAI(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
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
  const embeddingCacheRef = useRef<Map<string, Float32Array>>(new Map());
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'searching' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<SimilarMatch[] | null>(null);

  const selectedNode =
    state.selection.length === 1 ? state.document.nodes[state.selection[0]!] : null;
  const isImage = Boolean(selectedNode && isImageShape(selectedNode));
  const imageSrc = isImage ? imageShapeSrc(selectedNode as ShapeNode) : '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await getModelLoader().isModelAvailable(SIGLIP_MODEL_ID);
      if (!cancelled) setModelAvailable(available);
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
        SIGLIP_MODEL_ID,
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

  const embed = useCallback(
    async (src: string, modelPath: string, signal: AbortSignal): Promise<Float32Array> => {
      const cached = embeddingCacheRef.current.get(src);
      if (cached) return cached;

      const imageData = await loadImageToImageDataForAI(src);
      if (signal.aborted) throw new Error('cancelled');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'siglip-image',
          modelPath,
          modelId: SIGLIP_MODEL_ID,
          imageData,
          reuseSession: true,
        },
        { signal, timeoutMs: 30_000 },
      );
      if (signal.aborted) throw new Error('cancelled');

      // Verified real output tensor name (see siglip.ts): "pooler_output".
      const rawOutputs = result.outputs as {
        pooler_output: { data: Float32Array; dims: number[] };
      };
      const raw = rawOutputs.pooler_output;
      if (!raw) throw new Error('Embedding did not produce an output tensor');
      const embedding = normalizeEmbedding(raw.data);
      embeddingCacheRef.current.set(src, embedding);
      return embedding;
    },
    [],
  );

  const handleSearch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('searching');
    setErrorMessage(null);

    try {
      if (!imageSrc || !selectedNode) throw new Error('No image selected');

      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(SIGLIP_MODEL_ID, controller.signal);
      if (!modelPath) throw new Error('Find Similar model not downloaded');

      const queryEmbedding = await embed(imageSrc, modelPath, controller.signal);

      const candidates: Array<{ item: { nodeId: NodeId; src: string }; embedding: Float32Array }> =
        [];
      let scanned = 0;
      for (const [nodeId, candidateNode] of Object.entries(state.document.nodes)) {
        if (controller.signal.aborted) throw new Error('cancelled');
        if (nodeId === selectedNode.id) continue;
        if (candidateNode.kind !== 'shape' || !isImageShape(candidateNode)) continue;
        const src = imageShapeSrc(candidateNode as ShapeNode);
        if (!src) continue;
        if (scanned >= MAX_SIMILAR_CANDIDATES) break;
        scanned++;
        const candidateEmbedding = await embed(src, modelPath, controller.signal);
        candidates.push({ item: { nodeId: nodeId as NodeId, src }, embedding: candidateEmbedding });
      }

      const ranked = rankBySimilarity(queryEmbedding, candidates, 5);
      const results: SimilarMatch[] = ranked.map((r) => ({
        nodeId: r.item.nodeId,
        src: r.item.src,
        similarity: r.similarity,
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
  }, [imageSrc, selectedNode, state.document.nodes, embed, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  if (!isImage) {
    return (
      <div className="intelligence-empty">
        <Icon name="Images" label={undefined} size="1.2em" />
        <p>Select an image to find visually similar images in this document.</p>
      </div>
    );
  }

  const isSearching = status === 'searching';
  const needsDownload = !modelAvailable && status !== 'downloading';

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Embeds the selected image and ranks other images in this document by visual/semantic
        similarity. Image-to-image only — runs locally in a web worker.
      </p>

      {needsDownload && (
        <button
          type="button"
          className="intelligence-action-btn"
          onClick={handleDownload}
          aria-label="Download Find Similar model (~201 MB)"
        >
          <Icon name="Download" label={undefined} size="0.85em" />
          Download AI Model
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
        <div className="intelligence-issue-list">
          {matches.length === 0 ? (
            <p>No other images found in this document.</p>
          ) : (
            matches.map((m) => (
              <div key={m.nodeId} className="intelligence-issue intelligence-issue--info">
                <button
                  type="button"
                  className="intelligence-issue__target"
                  onClick={() => setSelection(m.nodeId)}
                  title="Select this node"
                >
                  <img
                    src={m.src}
                    alt=""
                    style={{
                      width: 28,
                      height: 28,
                      objectFit: 'cover',
                      borderRadius: 4,
                      marginRight: 'var(--space-1)',
                    }}
                  />
                  <span className="intelligence-issue__type">
                    {Math.round(m.similarity * 100)}% match
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
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
          disabled={needsDownload}
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
