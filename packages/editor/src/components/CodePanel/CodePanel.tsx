/**
 * CodePanel — dedicated "Codegen & Design Audit" workspace panel.
 *
 * Two primary tabs:
 *   1. Codegen  — framework selector, responsive preview sizing, copy/download
 *   2. Audit    — design audit findings grouped by severity/category
 *   3. Readiness — per-format codegen readiness assessment
 *
 * Research basis: Figma Dev Mode code panel; CodeGenView + IntelligencePanel
 * patterns from the same codebase.
 */
import {
  type AuditCategory,
  type AuditFinding,
  analyseDocument,
  type DesignAuditReport,
  exportNodeToCss,
  exportNodeToReact,
  exportNodeToSvelte,
  exportNodeToSvg,
  exportNodeToTailwind,
  exportNodeToVue,
  exportNodeToWebComponent,
  runCodegenReadiness,
  runDesignAudit,
  type TargetAnalysisResult,
} from '@varve/codegen';
import type { Document, SceneNode } from '@varve/scene';
import { CopyButton, Icon, type IconName, type Tab, Tabs } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { PanelDragHandle } from '../PanelDragHandle';
import { buildFilename, downloadBlob } from '../SpecPanel/export';
import { highlight } from '../SpecPanel/syntax';

import './CodePanel.css';

type PrimaryTab = 'codegen' | 'audit' | 'readiness';

const PRIMARY_TABS: Tab<PrimaryTab>[] = [
  { value: 'codegen', label: 'Codegen' },
  { value: 'audit', label: 'Audit' },
  { value: 'readiness', label: 'Readiness' },
];

type CodeTarget = 'css' | 'react' | 'tailwind' | 'vue' | 'svelte' | 'web-component' | 'svg';

const CODE_TABS: Tab<CodeTarget>[] = [
  { value: 'css', label: 'HTML/CSS' },
  { value: 'react', label: 'React' },
  { value: 'tailwind', label: 'Tailwind React' },
  { value: 'vue', label: 'Vue' },
  { value: 'svelte', label: 'Svelte' },
  { value: 'web-component', label: 'Web Component' },
  { value: 'svg', label: 'SVG' },
];

type PreviewSize = 'mobile' | 'tablet' | 'desktop';

const PREVIEW_SIZES: { value: PreviewSize; label: string; width: number | null }[] = [
  { value: 'mobile', label: '375', width: 375 },
  { value: 'tablet', label: '768', width: 768 },
  { value: 'desktop', label: 'Full', width: null },
];

const SEVERITY_LABELS: Record<AuditFinding['severity'], string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
};

const SEVERITY_ORDER: AuditFinding['severity'][] = ['error', 'warning', 'info'];

const CATEGORY_ICONS: Partial<Record<AuditCategory, string>> = {
  contrast: 'CircleAlert',
  typography: 'Bold',
  layout: 'LayoutGrid',
  accessibility: 'Keyboard',
  vector: 'Pen',
  raster: 'Image',
  color: 'Palette',
  performance: 'Faders',
  spacing: 'Ruler',
  codegen: 'Code',
};

export interface CodePanelProps {
  doc: Document;
  selection: SceneNode[];
}

function generateCode(node: SceneNode, doc: Document, target: CodeTarget): string {
  switch (target) {
    case 'css':
      return exportNodeToCss(node, doc);
    case 'react':
      return exportNodeToReact(node, doc);
    case 'tailwind':
      return exportNodeToTailwind(node, doc);
    case 'vue':
      return exportNodeToVue(node, doc);
    case 'svelte':
      return exportNodeToSvelte(node, doc);
    case 'web-component':
      return exportNodeToWebComponent(node, doc);
    case 'svg':
      return exportNodeToSvg(node, doc);
  }
}

function getCodeLanguage(target: CodeTarget): string {
  switch (target) {
    case 'css':
      return 'css';
    case 'react':
      return 'tsx';
    case 'tailwind':
      return 'jsx';
    case 'vue':
      return 'markup';
    case 'svelte':
      return 'markup';
    case 'web-component':
      return 'markup';
    case 'svg':
      return 'markup';
  }
}

/* ─────────────────────────────────────── */
/*  Codegen Tab                            */
/* ─────────────────────────────────────── */

function CodegenTab({ doc, selection }: CodePanelProps) {
  const [activeTarget, setActiveTarget] = useState<CodeTarget>('css');
  const [previewSize, setPreviewSize] = useState<PreviewSize>('desktop');

  const activeNode = selection[0];
  const code = useMemo(
    () => (activeNode ? generateCode(activeNode, doc, activeTarget) : ''),
    [activeNode, doc, activeTarget],
  );

  const highlightedLines = useMemo(
    () => (code ? highlight(code, getCodeLanguage(activeTarget)).split('\n') : []),
    [code, activeTarget],
  );

  const lineCount = highlightedLines.length;

  const handleDownload = useCallback(() => {
    if (!code) return;
    const extMap: Record<CodeTarget, string> = {
      css: 'css',
      react: 'tsx',
      tailwind: 'tsx',
      vue: 'vue',
      svelte: 'svelte',
      'web-component': 'js',
      svg: 'svg',
    };
    const ext = extMap[activeTarget];
    const filename = activeNode ? buildFilename(activeNode.name, ext) : `export.${ext}`;
    const blob = new Blob([code], { type: 'text/plain' });
    downloadBlob(blob, filename);
  }, [code, activeTarget, activeNode]);

  const previewWidth = PREVIEW_SIZES.find((s) => s.value === previewSize)?.width ?? null;

  if (!activeNode) {
    return (
      <div className="code-panel__empty">
        <Icon name="Code" label={undefined} size="2em" />
        <p className="code-panel__empty-title">Select a layer</p>
        <p className="code-panel__empty-desc">
          Choose a node on the canvas to preview its generated code.
        </p>
      </div>
    );
  }

  return (
    <div className="code-panel__section">
      <div className="code-panel__toolbar-row">
        <Tabs
          label="Code framework"
          tabs={CODE_TABS}
          activeTab={activeTarget}
          onTabChange={setActiveTarget}
        >
          {CODE_TABS.map((tab) => (
            <div key={tab.value} />
          ))}
        </Tabs>
      </div>

      <div className="code-panel__preview-sizes" role="radiogroup" aria-label="Preview width">
        {PREVIEW_SIZES.map((size) => (
          <label
            key={size.value}
            className={`code-panel__size-btn${previewSize === size.value ? ' code-panel__size-btn--active' : ''}`}
          >
            <input
              type="radio"
              name="code-preview-size"
              checked={previewSize === size.value}
              onChange={() => setPreviewSize(size.value)}
              className="sr-only"
            />
            {size.label}
            {size.width && <span className="code-panel__size-unit">px</span>}
          </label>
        ))}
      </div>

      <div className="code-panel__actions">
        <CopyButton
          value={code}
          label={`${activeTarget} code`}
          className="code-panel__action-btn"
        />
        <button
          type="button"
          className="code-panel__action-btn code-panel__action-btn--download"
          onClick={handleDownload}
          disabled={!code}
        >
          <Icon name="Download" label={undefined} size="0.95em" />
          Download
        </button>
      </div>

      <div
        className="code-panel__preview-wrap"
        style={previewWidth ? { maxWidth: previewWidth } : undefined}
      >
        <section className="code-panel__pre" aria-label={`${activeTarget} generated code`}>
          <pre>
            <code>
              {highlightedLines.map((html, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: line-numbered code; position in the rendered block is the identity (index = line number)
                <span key={i} className="code-panel__line">
                  <span className="code-panel__line-num">
                    {String(i + 1).padStart(String(lineCount).length, ' ')}
                  </span>
                  <span
                    className="code-panel__line-text"
                    dangerouslySetInnerHTML={{ __html: html || ' ' }}
                  />
                </span>
              ))}
            </code>
          </pre>
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────── */
/*  Audit Tab                              */
/* ─────────────────────────────────────── */

function AuditTab({ doc }: { doc: Document }) {
  const report = useMemo<DesignAuditReport | null>(() => {
    try {
      return runDesignAudit(doc, { categories: ['vector', 'raster', 'color', 'codegen'] });
    } catch {
      return null;
    }
  }, [doc]);

  if (!report || report.findings.length === 0) {
    return (
      <div className="code-panel__empty">
        <Icon name="CircleCheck" label={undefined} size="2em" />
        <p className="code-panel__empty-title">No issues found</p>
        <p className="code-panel__empty-desc">Run a design audit to surface potential problems.</p>
      </div>
    );
  }

  const bySeverity: Record<AuditFinding['severity'], AuditFinding[]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const finding of report.findings) {
    bySeverity[finding.severity].push(finding);
  }

  return (
    <div className="code-panel__section">
      <div className="code-panel__summary-bar">
        <span className="code-panel__summary-item code-panel__summary-item--error">
          {report.totalErrors} error{report.totalErrors !== 1 ? 's' : ''}
        </span>
        <span className="code-panel__summary-item code-panel__summary-item--warning">
          {report.totalWarnings} warning{report.totalWarnings !== 1 ? 's' : ''}
        </span>
        <span className="code-panel__summary-item code-panel__summary-item--info">
          {report.totalInfo} info
        </span>
      </div>

      {SEVERITY_ORDER.map(
        (sev) =>
          bySeverity[sev].length > 0 && (
            <section key={sev} className="code-panel__severity-group">
              <h4 className="code-panel__severity-heading">{SEVERITY_LABELS[sev]}</h4>
              {bySeverity[sev].map((finding) => (
                <div
                  key={`${finding.nodeId}-${finding.category}-${finding.message}`}
                  className={`code-panel__finding code-panel__finding--${finding.severity}`}
                >
                  <span className="code-panel__severity-dot" />
                  <div className="code-panel__finding-body">
                    <div className="code-panel__finding-header">
                      <span className="code-panel__finding-category">
                        {CATEGORY_ICONS[finding.category] && (
                          <Icon
                            name={CATEGORY_ICONS[finding.category] as IconName}
                            label={undefined}
                            size="0.8em"
                          />
                        )}
                        {finding.category}
                      </span>
                      <span className="code-panel__finding-node">{finding.nodeName}</span>
                    </div>
                    <p className="code-panel__finding-message">{finding.message}</p>
                    {finding.recommendation && (
                      <p className="code-panel__finding-recommendation">{finding.recommendation}</p>
                    )}
                    {finding.autoFixAvailable && (
                      <span className="code-panel__finding-fix-badge">Auto-fix available</span>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ),
      )}
    </div>
  );
}

/* ─────────────────────────────────────── */
/*  Readiness Tab                          */
/* ─────────────────────────────────────── */

const READINESS_FORMATS: { value: CodeTarget; label: string }[] = [
  { value: 'css', label: 'HTML/CSS' },
  { value: 'react', label: 'React' },
  { value: 'tailwind', label: 'Tailwind React' },
  { value: 'vue', label: 'Vue' },
  { value: 'svelte', label: 'Svelte' },
  { value: 'web-component', label: 'Web Component' },
  { value: 'svg', label: 'SVG' },
];

const FORMAT_TO_CODEEXPORT: Record<CodeTarget, import('@varve/codegen').CodeExportFormat> = {
  css: 'css',
  react: 'react',
  tailwind: 'react-tailwind',
  vue: 'css',
  svelte: 'css',
  'web-component': 'css',
  svg: 'svg',
};

function ReadinessTab({ doc, selection }: CodePanelProps) {
  const rootIds = useMemo(() => selection.map((n) => n.id), [selection]);

  const readiness = useMemo(() => {
    if (rootIds.length === 0) return null;
    return runCodegenReadiness(doc, rootIds);
  }, [doc, rootIds]);

  const formatAnalyses = useMemo(() => {
    const results: { format: string; analysis: TargetAnalysisResult }[] = [];
    for (const fmt of READINESS_FORMATS) {
      const codeFormat = FORMAT_TO_CODEEXPORT[fmt.value];
      const analysis = analyseDocument(doc, codeFormat);
      results.push({ format: fmt.label, analysis });
    }
    return results;
  }, [doc]);

  if (rootIds.length === 0) {
    return (
      <div className="code-panel__empty">
        <Icon name="ClipboardCheck" label={undefined} size="2em" />
        <p className="code-panel__empty-title">Select layers</p>
        <p className="code-panel__empty-desc">
          Choose nodes on the canvas to assess codegen readiness.
        </p>
      </div>
    );
  }

  return (
    <div className="code-panel__section">
      {readiness && (
        <section className="code-panel__readiness-card">
          <div className="code-panel__readiness-status">
            <Icon
              name={readiness.ready ? 'CircleCheck' : 'TriangleAlert'}
              label={undefined}
              size="1.2em"
            />
            <span>
              {readiness.ready
                ? 'All selected nodes can be exported as native HTML/CSS.'
                : `${readiness.issues.length} issue${readiness.issues.length !== 1 ? 's' : ''} found.`}
            </span>
          </div>
          {readiness.issues.length > 0 && (
            <ul className="code-panel__readiness-issues">
              {readiness.issues.map((issue, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stateless issue strings; content keys would collide on duplicates
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <h4 className="code-panel__section-title">Per-format analysis</h4>
      <div className="code-panel__format-grid">
        {formatAnalyses.map(({ format, analysis }) => (
          <div key={format} className="code-panel__format-card">
            <div className="code-panel__format-header">
              <span className="code-panel__format-name">{format}</span>
              {analysis.errorCount === 0 && analysis.warningCount === 0 ? (
                <Icon name="CircleCheck" label={undefined} size="0.95em" />
              ) : (
                <span className="code-panel__format-counts">
                  {analysis.errorCount > 0 && (
                    <span className="code-panel__format-count code-panel__format-count--error">
                      {analysis.errorCount}
                    </span>
                  )}
                  {analysis.warningCount > 0 && (
                    <span className="code-panel__format-count code-panel__format-count--warning">
                      {analysis.warningCount}
                    </span>
                  )}
                </span>
              )}
            </div>
            {analysis.gaps.length > 0 && (
              <ul className="code-panel__format-gaps">
                {analysis.gaps.slice(0, 5).map((gap, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: nodeName+feature can repeat across formats; rows are stateless
                  <li key={i} className="code-panel__format-gap">
                    <span className="code-panel__format-gap-node">{gap.nodeName}</span>
                    <span className="code-panel__format-gap-feature">{gap.feature}</span>
                  </li>
                ))}
                {analysis.gaps.length > 5 && (
                  <li className="code-panel__format-gap-more">+{analysis.gaps.length - 5} more</li>
                )}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────── */
/*  CodePanel — Root                       */
/* ─────────────────────────────────────── */

export function CodePanel({ doc, selection }: CodePanelProps) {
  const [activeTab, setActiveTab] = useState<PrimaryTab>('codegen');

  return (
    <div className="code-panel">
      <PanelDragHandle
        panelTypeId="codegen"
        panelInstanceId="codegen-primary"
        currentWindowId="main"
        title="Code"
      >
        <div className="code-panel__header">
          <h2 className="code-panel__title">Codegen & Audit</h2>
        </div>
      </PanelDragHandle>

      <div className="code-panel__tabs" role="tablist" aria-label="Code panel tabs">
        {PRIMARY_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            className={`code-panel__tab${activeTab === t.value ? ' code-panel__tab--active' : ''}`}
            aria-selected={activeTab === t.value}
            onClick={() => setActiveTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="code-panel__body">
        {activeTab === 'codegen' && <CodegenTab doc={doc} selection={selection} />}
        {activeTab === 'audit' && <AuditTab doc={doc} />}
        {activeTab === 'readiness' && <ReadinessTab doc={doc} selection={selection} />}
      </div>
    </div>
  );
}
