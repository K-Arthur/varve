/**
 * ExportPackageSection — package export controls for the Logo panel.
 *
 * Variant/format selection, icon-size presets, naming preview, folder-tree
 * preview, file-count estimate, progress, and a structured completion report.
 * Everything routes through the shared logoPackageExport builder (which
 * reuses the existing raster/SVG/PDF pipelines plus the ICO/ICNS encoders),
 * so the panel, menu command, and any future surface produce identical
 * packages.
 */

import { sanitizeSegment } from '@varve/scene/export';
import { Button, Checkbox, Icon, Select, Tooltip } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import {
  buildLogoPackage,
  collectRenderTargets,
  DEFAULT_ICO_SIZES,
  estimatePackageFileCount,
  type LogoPackageOptions,
  saveLogoPackage,
} from '../../logo/logoPackageExport';

type BuildState = 'idle' | 'building' | 'done' | 'error';

interface BuildReport {
  state: BuildState;
  message?: string;
  savedPath?: string;
  fileCount?: number;
  counts?: Record<string, number>;
  warnings?: string[];
  entries?: string[];
}

const FORMAT_OPTIONS = [
  { id: 'svg', label: 'SVG' },
  { id: 'png', label: 'PNG' },
  { id: 'pdf', label: 'PDF' },
  { id: 'ico', label: 'ICO' },
  { id: 'icns', label: 'ICNS' },
] as const;

const ICO_PRESETS = [
  { label: '16 / 32 / 48 / 256 (recommended)', sizes: [16, 32, 48, 256] },
  { label: 'All sizes (16-256)', sizes: [...DEFAULT_ICO_SIZES] },
] as const;

export function ExportPackageSection() {
  const editor = useEditor();
  const doc = editor.state.document;
  const project = doc.logoProject;

  const targets = useMemo(() => collectRenderTargets(doc, {}), [doc]);
  const allTargetIds = useMemo(
    () => [...targets.concepts.map((c) => c.id), ...targets.variants.map((v) => v.id)],
    [targets],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set(allTargetIds));
  const [formats, setFormats] = useState<Set<string>>(
    new Set(['svg', 'png', 'pdf', 'ico', 'icns']),
  );
  const [icoSizes, setIcoSizes] = useState<number[]>([16, 32, 48, 256]);
  const [fullIcns, setFullIcns] = useState(true);
  const [report, setReport] = useState<BuildReport>({ state: 'idle' });

  const brandName = project?.brief?.brandName || project?.name || doc.name || 'Brand';
  const zipName = `${sanitizeSegment(brandName)}-Logo-Package.zip`;
  const estimated = estimatePackageFileCount({}, selected.size);

  const toggleTarget = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFormat = useCallback((id: string) => {
    setFormats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const buildOptions = useCallback((): LogoPackageOptions => {
    return {
      brandName,
      conceptIds: targets.concepts.filter((c) => selected.has(c.id)).map((c) => c.id),
      includeVariants: true,
      includeSvg: formats.has('svg'),
      includePng: formats.has('png'),
      includePdf: formats.has('pdf'),
      includeIco: formats.has('ico'),
      icoSizes,
      includeIcns: formats.has('icns'),
      icnsTypes: fullIcns ? undefined : ['icp4', 'icp5', 'ic08', 'ic09', 'ic10'],
      includePalette: true,
      includeSource: true,
      sourceJson: editor.serializeDocument(),
    };
  }, [brandName, editor, formats, fullIcns, icoSizes, selected, targets]);

  const runExport = useCallback(async () => {
    if (selected.size === 0) return;
    setReport({ state: 'building' });
    try {
      const result = await buildLogoPackage(doc, buildOptions());
      const saved = await saveLogoPackage(editor.platform, result);
      setReport({
        state: 'done',
        savedPath: saved ? zipName : undefined,
        fileCount: result.entries.length,
        counts: result.counts,
        entries: result.entries,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setReport({ state: 'error', message });
    }
  }, [buildOptions, doc, editor.platform, selected.size, zipName]);

  const targetLabel = (id: string): string => {
    const concept = targets.concepts.find((c) => c.id === id);
    if (concept) return `${concept.name} (concept)`;
    const variant = targets.variants.find((v) => v.id === id);
    return variant ? `${variant.name} (${variant.kind ?? 'variant'})` : id;
  };

  const folderTree = useMemo(() => {
    const lines: string[] = [
      `${sanitizeSegment(brandName)}-Logo-Package/`,
      '  README.md, manifest.json, Palette/, Source/',
    ];
    for (const format of FORMAT_OPTIONS) {
      if (!formats.has(format.id)) continue;
      lines.push(
        `  ${format.id.toUpperCase()}/  ${selected.size} item${selected.size === 1 ? '' : 's'}`,
      );
    }
    return lines;
  }, [brandName, formats, selected.size]);

  return (
    <div className="logo-panel__section-body">
      <div className="logo-panel__field">
        <span className="logo-panel__field-label">Include</span>
        <ul className="logo-panel__list">
          {allTargetIds.map((id) => (
            <li key={id} className="logo-panel__list-item">
              <Checkbox
                label={targetLabel(id)}
                checked={selected.has(id)}
                onChange={() => toggleTarget(id)}
              />
            </li>
          ))}
          {allTargetIds.length === 0 && (
            <li className="logo-panel__muted">No concepts or variants yet.</li>
          )}
        </ul>
      </div>

      <div className="logo-panel__field">
        <span className="logo-panel__field-label">Formats</span>
        <div className="logo-panel__button-row logo-panel__button-row--wrap">
          {FORMAT_OPTIONS.map((format) => (
            <Checkbox
              key={format.id}
              label={format.label}
              checked={formats.has(format.id)}
              onChange={() => toggleFormat(format.id)}
            />
          ))}
        </div>
      </div>

      {formats.has('ico') && (
        <div className="logo-panel__field">
          <span className="logo-panel__field-label">ICO sizes</span>
          <div className="logo-panel__button-row">
            <Select
              label="ICO size preset"
              value={icoSizes.join(',')}
              onChange={(value) => setIcoSizes(value.split(',').map(Number))}
              options={ICO_PRESETS.map((preset) => ({
                value: preset.sizes.join(','),
                label: preset.label,
              }))}
            />
          </div>
        </div>
      )}

      {formats.has('icns') && (
        <div className="logo-panel__field">
          <Checkbox
            label="Full Retina set (icp4–ic15, incl. 2x)"
            checked={fullIcns}
            onChange={(e) => setFullIcns(e.target.checked)}
          />
        </div>
      )}

      <div className="logo-panel__field">
        <span className="logo-panel__field-label">Output</span>
        <code className="logo-panel__code">{zipName}</code>
        <pre className="logo-panel__tree">{folderTree.join('\n')}</pre>
        <p className="logo-panel__muted">
          ~{estimated} files across {selected.size} item{selected.size === 1 ? '' : 's'}.
        </p>
      </div>

      <div className="logo-panel__button-row">
        <Tooltip
          label="Build the logo package and save it"
          disabledReason={
            selected.size === 0 ? 'Select at least one concept or variant' : undefined
          }
        >
          <Button
            size="sm"
            loading={report.state === 'building'}
            disabled={selected.size === 0 || report.state === 'building'}
            onClick={() => void runExport()}
          >
            Export package…
          </Button>
        </Tooltip>
      </div>

      {report.state === 'building' && (
        <p className="logo-panel__muted" role="status">
          Building package (rendering {selected.size} item
          {selected.size === 1 ? '' : 's'} across formats)…
        </p>
      )}

      {report.state === 'done' && report.fileCount !== undefined && (
        <div className="logo-panel__report" role="status">
          <p>
            <Icon name="Check" size={14} />
            {report.savedPath
              ? `Saved ${report.savedPath}`
              : 'Package built; choose a destination to save it.'}
          </p>
          <p className="logo-panel__muted">
            {report.fileCount} files
            {report.counts
              ? ' — ' +
                Object.entries(report.counts)
                  .map(([section, count]) => `${section}: ${count}`)
                  .join(', ')
              : ''}
          </p>
        </div>
      )}

      {report.state === 'error' && (
        <div className="logo-panel__warning" role="alert">
          Package export failed: {report.message}
        </div>
      )}
    </div>
  );
}
