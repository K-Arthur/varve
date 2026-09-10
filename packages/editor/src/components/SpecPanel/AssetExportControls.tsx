import { exportNodeToSvg } from '@varve/codegen';
import { createEngine, type Engine } from '@varve/engine';
import type { Platform } from '@varve/platform';
import type {
  Document,
  ExportBatch,
  ExportPreset,
  ExportScale,
  ExportFormat as LegacyExportFormat,
  SceneNode,
} from '@varve/scene';
import {
  type BuiltinPresetDefinition,
  builtinBundleList,
  builtinPresetList,
  capabilitiesForFormat,
  configurationToLegacyPreset,
  formatFileName,
  formatSupportedOnPlatform,
  getBuiltinPreset,
  legacyFormatToCanonical,
  legacyScaleToCanonical,
  materializePreset,
  type PlatformKind,
} from '@varve/scene/export';
import { CopyButton, Icon, Select, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isCapabilityRestricted } from '../../capabilities/restrictions';
import { composeFlattenedRasterAssetsForNode } from '../../export/compositor';
import { runBatchPreflight } from '../../exportService';
import { suggestExportFormat } from '../../intelligence/exportAdvisor';
import { buildJobs } from '../Export/ExportDialog';
import {
  buildFilename,
  downloadBlob,
  exportNodeAsPdf,
  exportNodeAsRaster,
  type RasterFormat,
} from './export';

import './SpecPanel.css';

export interface AssetExportControlsProps {
  node: SceneNode;
  doc: Document;
  engine?: Engine;
  platform?: Platform;
  /** Present in the live Inspector (node-mutation allowed). */
  onAddPreset?: (preset: ExportPreset) => void;
  onUpdatePreset?: (preset: ExportPreset) => void;
  onRemovePreset?: (presetId: string) => void;
  onOpenAdvancedExport?: () => void;
}

/** Quick-export formats this surface can produce today. */
type QuickFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf';

const QUICK_FORMATS: {
  value: QuickFormat;
  label: string;
  mime?: RasterFormat;
}[] = [
  { value: 'png', label: 'PNG', mime: 'image/png' },
  { value: 'jpeg', label: 'JPEG', mime: 'image/jpeg' },
  { value: 'webp', label: 'WebP', mime: 'image/webp' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF' },
];

/**
 * The formats this deployment actually offers. PDF goes through the print
 * pipeline, which a browser-only deployment does not have — offering it and
 * then failing the export would be worse than not offering it.
 */
function availableQuickFormats(): typeof QUICK_FORMATS {
  if (!isCapabilityRestricted('printProduction')) return QUICK_FORMATS;
  return QUICK_FORMATS.filter((f) => f.value !== 'pdf');
}

const SCALES = [1, 2, 3];

/**
 * Every format a per-node export setting can hold, grouped the way the export
 * workflows actually differ (assets / press / code) rather than by encoder.
 *
 * This is deliberately wider than QUICK_FORMATS: quick export runs inline in
 * this panel, while an export setting is executed later by ExportService, which
 * additionally reaches the native print pipeline and the codegen emitters.
 * Availability is resolved against the canonical capability contract, never
 * hardcoded — a format with no encoder (AVIF today) must never be offered.
 */
const PRESET_FORMAT_GROUPS: {
  label: string;
  formats: { value: LegacyExportFormat; label: string }[];
}[] = [
  {
    label: 'Images & vector',
    formats: [
      { value: 'png', label: 'PNG' },
      { value: 'jpg', label: 'JPEG' },
      { value: 'webp', label: 'WebP' },
      { value: 'svg', label: 'SVG' },
    ],
  },
  {
    label: 'Print',
    formats: [
      { value: 'pdf-screen', label: 'PDF (screen)' },
      { value: 'pdf-x1a', label: 'PDF/X-1a' },
      { value: 'pdf-x4', label: 'PDF/X-4' },
    ],
  },
  {
    label: 'Code',
    formats: [
      { value: 'react-tailwind', label: 'React + Tailwind' },
      { value: 'react-cssmodules', label: 'React + CSS Modules' },
      { value: 'svg-component', label: 'SVG component' },
      { value: 'flutter', label: 'Flutter' },
      { value: 'swiftui', label: 'SwiftUI' },
    ],
  },
];

/** One-click starting points for the most common per-node exports, scoped to what a compact inspector can reasonably hold (a full categorized preset library belongs in the advanced dialog). */
const QUICK_PRESETS: {
  label: string;
  format: LegacyExportFormat;
  scale: number;
  suffix: string;
}[] = [
  { label: 'PNG 1x', format: 'png', scale: 1, suffix: '' },
  { label: 'PNG 2x', format: 'png', scale: 2, suffix: '@2x' },
  { label: 'SVG', format: 'svg', scale: 1, suffix: '' },
];

/**
 * Convert a built-in catalog preset into the legacy per-node `ExportPreset`
 * shape that `node.presets` persists and `ExportDialog.buildJobs` expands.
 *
 * Returns undefined when the preset's format has no legacy representation
 * (e.g. canonical-only formats), so the catalog can grow without this surface
 * silently persisting something the executor cannot run.
 */
function builtinPresetToLegacy(
  preset: BuiltinPresetDefinition,
  nodeId: string,
  id: string,
): ExportPreset | undefined {
  return configurationToLegacyPreset(materializePreset(preset, { type: 'node', nodeId }, id));
}

/** Formats whose scale control is meaningless (vector, press, or code output). */
const UNSCALED_PRESET_FORMATS = new Set<LegacyExportFormat>([
  'svg',
  'svg-component',
  'pdf-screen',
  'pdf-x1a',
  'pdf-x4',
  'react-tailwind',
  'react-cssmodules',
  'flutter',
  'swiftui',
]);

function platformKind(p?: Platform): PlatformKind {
  return p?.kind === 'tauri' ? 'tauri' : 'web';
}

function isTauriPlatform(p?: Platform): boolean {
  return p?.kind === 'tauri';
}

function advisorFormatToQuick(
  format: 'image/png' | 'image/jpeg' | 'image/webp' | 'svg' | 'pdf',
): QuickFormat {
  switch (format) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpeg';
    case 'image/webp':
      return 'webp';
    case 'svg':
      return 'svg';
    case 'pdf':
      return 'pdf';
  }
}

function quickToLegacyFormat(format: QuickFormat): 'png' | 'jpg' | 'webp' | 'svg' | 'pdf-screen' {
  switch (format) {
    case 'png':
      return 'png';
    case 'jpeg':
      return 'jpg';
    case 'webp':
      return 'webp';
    case 'svg':
      return 'svg';
    case 'pdf':
      return 'pdf-screen';
  }
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof Response !== 'undefined') {
    return new Uint8Array(await new Response(blob).arrayBuffer());
  }
  if (typeof blob.text === 'function') {
    return new TextEncoder().encode(await blob.text());
  }
  throw new Error('Blob byte extraction is not supported in this environment');
}

/** Resolved filename for a legacy per-node preset using the canonical naming engine. */
function presetFileName(nodeName: string, preset: ExportPreset): string {
  const format = legacyFormatToCanonical(preset.format);
  return formatFileName('{name}{suffix}.{ext}', {
    name: nodeName,
    format,
    scale: legacyScaleToCanonical(preset.scale),
    suffix: preset.suffix || undefined,
  });
}

function presetSummary(preset: ExportPreset): string {
  const format = legacyFormatToCanonical(preset.format);
  const label = capabilitiesForFormat(format, 'web').label;
  const scale = scaleLabel(preset.scale);
  const suffix = preset.suffix ? ` \u00b7 ${preset.suffix}` : '';
  return `${label}${scale ? ` \u00b7 ${scale}` : ''}${suffix}`;
}

function scaleLabel(scale: ExportScale): string {
  if (scale.type === 'factor') {
    return scale.value === 1 ? '' : `${scale.value}x`;
  }
  if (scale.type === 'width') return `${scale.pixels}w`;
  if (scale.type === 'height') return `${scale.pixels}h`;
  if (scale.type === 'resolution') return `${scale.dpi}ppi`;
  return '';
}

export function AssetExportControls({
  node,
  doc,
  engine: _engine,
  platform,
  onAddPreset,
  onUpdatePreset,
  onRemovePreset,
  onOpenAdvancedExport,
}: AssetExportControlsProps) {
  const suggestion = useMemo(() => suggestExportFormat(node, doc), [node, doc]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [format, setFormat] = useState<QuickFormat>(advisorFormatToQuick(suggestion.format));
  const [scale, setScale] = useState(suggestion.scale);
  const [customScale, setCustomScale] = useState('');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [presetFormat, setPresetFormat] = useState<LegacyExportFormat>(() =>
    quickToLegacyFormat(advisorFormatToQuick(suggestion.format)),
  );
  const liveRef = useRef<HTMLDivElement>(null);
  const suggestedForNodeRef = useRef(node.id);

  // Capability-driven format availability for the active platform.
  const platformKindValue = platformKind(platform);
  const presets = node.presets ?? [];

  // Reuse the shared preflight pipeline over the enabled per-node presets so
  // the compact inspector surfaces the same findings the advanced dialog would
  // (oversized output, missing fonts, unsupported formats).
  const preflightFindings = useMemo(() => {
    const enabledPresets = presets.filter((p) => p.enabled);
    if (enabledPresets.length === 0) return [];
    const batch: ExportBatch = {
      jobs: buildJobs([{ ...node, presets: enabledPresets }], doc),
      destinationFolder: null,
      filenameTemplate: '{name}{suffix}.{ext}',
      folderRule: 'flat',
    };
    return runBatchPreflight(batch, doc, platformKindValue);
  }, [presets, node, doc, platformKindValue]);

  const visibleFormats = useMemo(
    () =>
      availableQuickFormats().filter((entry) =>
        formatSupportedOnPlatform(entry.value, platformKindValue),
      ),
    [platformKindValue],
  );

  // Re-apply the advisor's suggestion when the selected node changes, but
  // never fight the user's manual choice while they stay on the same node.
  useEffect(() => {
    if (suggestedForNodeRef.current !== node.id) {
      suggestedForNodeRef.current = node.id;
      const suggested = advisorFormatToQuick(suggestion.format);
      setFormat(suggested);
      setPresetFormat(quickToLegacyFormat(suggested));
      setScale(suggestion.scale);
      setCustomScale('');
    }
  }, [node.id, suggestion]);

  const effectiveScale = customScale ? Number.parseFloat(customScale) : scale;
  const isTauri = isTauriPlatform(platform);

  useEffect(() => {
    if (_engine) {
      setEngine(_engine);
    } else {
      createEngine('stub').then(setEngine);
    }
  }, [_engine]);

  const handleExport = useCallback(async () => {
    const eng = engine;
    if (!eng && format !== 'svg') {
      setMessage('Engine not ready');
      return;
    }
    setExporting(true);
    setMessage('');
    try {
      if (format === 'pdf') {
        const { bytes, filename } = await exportNodeAsPdf(
          node,
          doc,
          effectiveScale,
          eng ?? undefined,
        );
        if (platform) {
          const saved = await platform.saveBinaryFile(filename, bytes, 'application/pdf', '.pdf');
          setMessage(saved ? `Exported ${node.name} as PDF` : 'Export cancelled');
        } else {
          const browserBytes = new Uint8Array(bytes.byteLength);
          browserBytes.set(bytes);
          downloadBlob(new Blob([browserBytes.buffer], { type: 'application/pdf' }), filename);
          setMessage(`Downloaded ${node.name} as PDF`);
        }
      } else if (format === 'svg') {
        const rasterAssets = await composeFlattenedRasterAssetsForNode(node, doc, 'svg', {
          scale: 1,
          engine: eng ?? undefined,
        });
        const svg = exportNodeToSvg(node, doc, { rasterAssets });
        if (isTauri && platform) {
          const bytes = new TextEncoder().encode(svg);
          await platform.saveBinaryFile(
            buildFilename(node.name, 'svg'),
            bytes,
            'image/svg+xml',
            '.svg',
          );
          setMessage(`Exported ${node.name} as SVG`);
        } else {
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          downloadBlob(blob, buildFilename(node.name, 'svg'));
          setMessage(`Exported ${node.name} as SVG`);
        }
      } else {
        if (!eng) {
          setMessage('Engine not ready');
          return;
        }
        const mime = QUICK_FORMATS.find((f) => f.value === format)?.mime ?? 'image/png';
        const { blob, warnings } = await exportNodeAsRaster(node, doc, eng, {
          format: mime,
          scale: effectiveScale,
          quality: format === 'jpeg' ? 0.92 : undefined,
        });
        const ext = format === 'png' ? 'png' : format === 'jpeg' ? 'jpg' : 'webp';
        const warningSuffix = warnings.length > 0 ? ` \u2014 ${warnings.join(' ')}` : '';
        if (isTauri && platform) {
          const bytes = await blobToBytes(blob);
          await platform.saveBinaryFile(buildFilename(node.name, ext), bytes, blob.type, `.${ext}`);
          setMessage(
            `Exported ${node.name} as ${ext.toUpperCase()} at ${effectiveScale}x${warningSuffix}`,
          );
        } else {
          downloadBlob(blob, buildFilename(node.name, ext));
          setMessage(
            `Exported ${node.name} as ${ext.toUpperCase()} at ${effectiveScale}x${warningSuffix}`,
          );
        }
      }
    } catch (err) {
      setMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [node, doc, engine, format, effectiveScale, isTauri, platform]);

  // Availability of each preset format on the active platform, resolved from
  // the canonical capability contract (never a hardcoded list).
  const presetFormatGroups = useMemo(
    () =>
      PRESET_FORMAT_GROUPS.map((group) => ({
        label: group.label,
        formats: group.formats
          .map((entry) => {
            const canonical = legacyFormatToCanonical(entry.value);
            const cap = capabilitiesForFormat(canonical, platformKindValue);
            const availableHere = formatSupportedOnPlatform(canonical, platformKindValue);
            return {
              ...entry,
              // Unsupported anywhere (no encoder) is omitted entirely;
              // supported-but-not-here is shown disabled with a reason.
              omit: !cap.supported,
              disabled: !availableHere,
              disabledReason: availableHere
                ? undefined
                : `${cap.label} export requires the desktop app`,
            };
          })
          .filter((entry) => !entry.omit),
      })).filter((group) => group.formats.length > 0),
    [platformKindValue],
  );

  const presetFormatOptions = useMemo(
    () =>
      presetFormatGroups.flatMap((group) =>
        group.formats.map((entry) => ({
          value: entry.value,
          label: entry.disabled ? `${entry.label} (desktop only)` : entry.label,
          disabled: entry.disabled,
        })),
      ),
    [presetFormatGroups],
  );

  const presetFormatLabel = useMemo(
    () => capabilitiesForFormat(legacyFormatToCanonical(presetFormat), platformKindValue).label,
    [presetFormat, platformKindValue],
  );

  const presetFormatAvailable = useCallback(
    (candidate: LegacyExportFormat) =>
      formatSupportedOnPlatform(legacyFormatToCanonical(candidate), platformKindValue),
    [platformKindValue],
  );

  /**
   * Built-in catalog entries usable here: they must map to a legacy preset and
   * their format must be encodable on this platform. Bundles are offered when
   * at least one member survives that filter.
   */
  const catalogOptions = useMemo(() => {
    const presetEntries = builtinPresetList()
      .filter((p) => {
        if (!builtinPresetToLegacy(p, node.id, 'probe')) return false;
        return formatSupportedOnPlatform(p.format, platformKindValue);
      })
      .map((p) => ({ value: `preset:${p.id}`, label: `${p.name} · ${p.category}` }));

    const bundleEntries = builtinBundleList()
      .filter((b) =>
        b.presetIds.some((id) => {
          const preset = getBuiltinPreset(id);
          return (
            preset !== undefined &&
            builtinPresetToLegacy(preset, node.id, 'probe') !== undefined &&
            formatSupportedOnPlatform(preset.format, platformKindValue)
          );
        }),
      )
      .map((b) => ({ value: `bundle:${b.id}`, label: `${b.name} · bundle` }));

    return [...bundleEntries, ...presetEntries];
  }, [node.id, platformKindValue]);

  const handleApplyCatalogEntry = useCallback(
    (selection: string) => {
      if (!onAddPreset || !selection) return;
      const stamp = Date.now();

      if (selection.startsWith('bundle:')) {
        const bundle = builtinBundleList().find((b) => b.id === selection.slice(7));
        if (!bundle) return;
        bundle.presetIds.forEach((presetId, index) => {
          const preset = getBuiltinPreset(presetId);
          if (!preset || !formatSupportedOnPlatform(preset.format, platformKindValue)) return;
          const legacy = builtinPresetToLegacy(preset, node.id, `preset-${stamp}-${index}`);
          if (legacy) onAddPreset(legacy);
        });
        return;
      }

      const preset = getBuiltinPreset(selection.slice(7));
      if (!preset || !formatSupportedOnPlatform(preset.format, platformKindValue)) return;
      const legacy = builtinPresetToLegacy(preset, node.id, `preset-${stamp}`);
      if (legacy) onAddPreset(legacy);
    },
    [onAddPreset, platformKindValue, node.id],
  );

  const handleAddPreset = useCallback(() => {
    if (!onAddPreset || !presetFormatAvailable(presetFormat)) return;
    const scaled = !UNSCALED_PRESET_FORMATS.has(presetFormat);
    const scaleValue = scaled ? effectiveScale : 1;
    const suffix =
      scaled && Number.isFinite(scaleValue) && scaleValue !== 1
        ? `@${formatScaleNumber(scaleValue)}x`
        : '';
    onAddPreset({
      id: `preset-${Date.now()}`,
      format: presetFormat,
      scale: { type: 'factor', value: scaleValue },
      suffix,
      enabled: true,
    });
  }, [onAddPreset, presetFormat, effectiveScale, presetFormatAvailable]);

  return (
    <section className="spec-panel__section" aria-labelledby="spec-export-heading">
      <div className="spec-export__section-heading">
        <h3 id="spec-export-heading">Quick export</h3>
        <p>Export this {nodeLabel(node)} once with the settings below.</p>
      </div>

      <div className="spec-export__row">
        <span className="spec-row__label">
          Format
          <Tooltip label={suggestion.reason}>
            <button
              type="button"
              className="spec-export__why-btn"
              aria-label={`Why ${QUICK_FORMATS.find((f) => f.value === suggestion.format)?.label ?? suggestion.format}?`}
            >
              <Icon name="Info" size={12} label={undefined} />
            </button>
          </Tooltip>
        </span>
        <div className="spec-export__group">
          {visibleFormats.map((f) => (
            <Tooltip key={f.value} label={f.label}>
              <button
                type="button"
                className={`spec-export__btn${format === f.value ? ' spec-export__btn--active' : ''}`}
                aria-pressed={format === f.value}
                onClick={() => {
                  setFormat(f.value);
                  // Picking a quick format also arms "Add export setting" with
                  // it; the picker below can still override with a print or
                  // code format the quick row doesn't carry.
                  setPresetFormat(quickToLegacyFormat(f.value));
                }}
              >
                {f.label}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {format !== 'svg' && format !== 'pdf' && (
        <div className="spec-export__row">
          <span className="spec-row__label">Scale</span>
          <div className="spec-export__group">
            {SCALES.map((s) => (
              <button
                key={s}
                type="button"
                className={`spec-export__btn${effectiveScale === s && !customScale ? ' spec-export__btn--active' : ''}`}
                aria-pressed={effectiveScale === s && !customScale}
                onClick={() => {
                  setScale(s);
                  setCustomScale('');
                }}
              >
                {s}x
              </button>
            ))}
            <input
              type="number"
              className="spec-export__input"
              placeholder="custom"
              min={0.1}
              max={10}
              step={0.5}
              value={customScale}
              onChange={(e) => setCustomScale(e.target.value)}
              aria-label="Custom scale multiplier"
            />
          </div>
        </div>
      )}

      <div className="spec-export__actions">
        <button
          type="button"
          className="spec-export__download"
          disabled={exporting || !effectiveScale || effectiveScale <= 0}
          onClick={handleExport}
        >
          <Icon name="Download" size={14} label={undefined} />
          {exporting
            ? 'Exporting\u2026'
            : `${isTauri ? 'Export' : 'Download'} ${QUICK_FORMATS.find((f) => f.value === format)?.label ?? format.toUpperCase()}`}
        </button>
        {format === 'svg' && (
          <CopyButton
            value={exportNodeToSvg(node, doc)}
            label="SVG markup"
            className="spec-row__copy"
          />
        )}
      </div>

      {onAddPreset && (
        <section className="spec-export__presets" aria-labelledby="spec-export-presets-heading">
          <div className="spec-export__section-heading">
            <h4 id="spec-export-presets-heading">Export configurations</h4>
            <p>Saved outputs included whenever this {nodeLabel(node)} is batch exported.</p>
          </div>
          {preflightFindings.length > 0 && (
            <div className="spec-export__configs-preflight" role="status">
              <strong>
                {preflightFindings.length} preflight{' '}
                {preflightFindings.length === 1 ? 'warning' : 'warnings'}
              </strong>
              <ul>
                {preflightFindings.map((finding) => (
                  <li key={finding.id}>{finding.title}</li>
                ))}
              </ul>
            </div>
          )}
          {presets.length === 0 && (
            <p className="spec-export__presets-empty">
              No saved configurations yet. Add a preset or create a custom configuration below.
            </p>
          )}
          {presets.map((preset) => {
            const fileName = presetFileName(node.name, preset);
            return (
              <div key={preset.id} className="spec-export__preset-row">
                <label className="spec-export__preset-enabled">
                  <input
                    type="checkbox"
                    checked={preset.enabled}
                    onChange={() => onUpdatePreset?.({ ...preset, enabled: !preset.enabled })}
                    aria-label={`Enable ${fileName} export`}
                  />
                  <span className="varve-visually-hidden">Enabled</span>
                </label>
                <div className="spec-export__preset-info">
                  <span className="spec-export__preset-summary">{presetSummary(preset)}</span>
                  <code className="spec-export__preset-file">{fileName}</code>
                  <input
                    type="text"
                    className="spec-export__preset-suffix"
                    value={preset.suffix}
                    placeholder="suffix"
                    aria-label={`Filename suffix for ${fileName}`}
                    onChange={(e) => onUpdatePreset?.({ ...preset, suffix: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className="spec-export__preset-remove"
                  aria-label={`Remove ${fileName} export`}
                  onClick={() => onRemovePreset?.(preset.id)}
                >
                  <Icon name="X" size={12} label={undefined} />
                </button>
              </div>
            );
          })}
          <fieldset className="spec-export__preset-add">
            <legend>Add configuration</legend>
            <span className="spec-export__field-label">Quick presets</span>
            <div className="spec-export__configs-quick">
              {QUICK_PRESETS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  className="spec-export__configs-quick-btn"
                  onClick={() =>
                    onAddPreset({
                      id: `preset-${Date.now()}-${presets.length}`,
                      format: qp.format,
                      scale: { type: 'factor', value: qp.scale },
                      suffix: qp.suffix,
                      enabled: true,
                    })
                  }
                >
                  {qp.label}
                </button>
              ))}
            </div>
            <div className="spec-export__field">
              <span className="spec-export__field-label">Preset library</span>
              <Select
                label="Add from preset"
                placeholder="Choose a preset…"
                value=""
                options={catalogOptions}
                onChange={handleApplyCatalogEntry}
              />
            </div>
            <div className="spec-export__field">
              <span className="spec-export__field-label">Custom format</span>
              <Select
                label="Format for new export setting"
                value={presetFormat}
                options={presetFormatOptions}
                onChange={(next) => setPresetFormat(next as LegacyExportFormat)}
              />
            </div>
            <button
              type="button"
              className="spec-export__add-preset"
              disabled={!presetFormatAvailable(presetFormat)}
              onClick={handleAddPreset}
            >
              <Icon name="Plus" size={14} label={undefined} />
              Add configuration
            </button>
            {!presetFormatAvailable(presetFormat) && (
              <p className="spec-export__preset-unavailable" role="note">
                {presetFormatLabel} export requires the desktop app.
              </p>
            )}
          </fieldset>
          {onOpenAdvancedExport && (
            <div className="spec-export__preset-actions">
              <button
                type="button"
                className="spec-export__advanced"
                onClick={onOpenAdvancedExport}
                aria-label="Open advanced export workspace"
              >
                <Icon name="SlidersHorizontal" size={14} label={undefined} />
                <span>
                  Open export workspace
                  <small>Batch selection, print, naming, and destination options</small>
                </span>
                <Icon name="ChevronRight" size={14} label={undefined} />
              </button>
            </div>
          )}
        </section>
      )}

      <div ref={liveRef} role="status" aria-live="polite" className="varve-visually-hidden">
        {message}
      </div>
      {message && <p className="spec-export__message">{message}</p>}
    </section>
  );
}

function nodeLabel(node: SceneNode): string {
  switch (node.kind) {
    case 'frame':
      return 'frame';
    case 'text':
      return 'text object';
    default:
      return 'object';
  }
}

function formatScaleNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toFixed(3)));
}
