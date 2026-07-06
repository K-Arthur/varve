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
import type { AuditIssue } from '@strata/scene';
import { Icon } from '@strata/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../context';
import { type NamingSuggestion, renameSelected, suggestName } from '../intelligence/autoNamer';
import {
  analyzeSpacing,
  harmonizeSpacing,
  type SpacingAnalysis,
} from '../intelligence/spacingHarmonizer';

import '../components/Inspector/inspector.css';

type IntelligenceTab = 'audit' | 'spacing' | 'naming';

/** Mock audit issues — replace with real audit runner when available. */
const MOCK_ISSUES: AuditIssue[] = [];

export function IntelligencePanel() {
  const [tab, setTab] = useState<IntelligenceTab>('audit');

  return (
    <div className="intelligence-panel">
      <div className="intelligence-tabs" role="tablist" aria-label="Intelligence tabs">
        {(['audit', 'spacing', 'naming'] as const).map((t) => (
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
      </div>

      {tab === 'audit' && <AuditTab />}
      {tab === 'spacing' && <SpacingTab />}
      {tab === 'naming' && <NamingTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1: Audit — Issues & Warnings                                  */
/* ------------------------------------------------------------------ */

function AuditTab() {
  const { setSelection, updateDoc } = useEditor();
  const issues = MOCK_ISSUES;

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
              onClick={() => updateDoc(() => issue.autoFix?.())}
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

function NamingTab() {
  const { selectedNodes, state, updateDoc } = useEditor();
  const sel = selectedNodes();
  const [onlyDefault, setOnlyDefault] = useState(true);
  const [suggestions, setSuggestions] = useState<NamingSuggestion[]>([]);

  const handleSuggest = useCallback(() => {
    const results: NamingSuggestion[] = [];
    for (const node of sel) {
      const suggestion = suggestName(node, state.document);
      results.push(suggestion);
    }
    setSuggestions(results);
  }, [sel, state.document]);

  const handleApplyAll = useCallback(() => {
    updateDoc((doc) =>
      renameSelected(
        doc,
        sel.map((n) => n.id),
        onlyDefault,
      ),
    );
    setSuggestions([]);
  }, [sel, onlyDefault, updateDoc]);

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

  return (
    <div className="intelligence-tab-content">
      <p className="intelligence-hint">
        Suggest meaningful names for selected nodes based on their type, content, and layout.
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
        disabled={sel.length === 0}
        onClick={handleSuggest}
      >
        <Icon name="Wand" label={undefined} size="0.85em" />
        Suggest names
      </button>

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
