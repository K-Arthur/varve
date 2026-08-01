import { exportNodeToSvg } from '@strata/codegen';
import { createEngine, type Engine } from '@strata/engine';
import type { Platform } from '@strata/platform';
import type { ExportPreset, ExportFormat as PresetFormat, SceneNode } from '@strata/scene';
import { CopyButton, Icon, Tooltip } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { composeFlattenedRasterAssetsForNode } from '../../export/compositor';
import { suggestExportFormat } from '../../intelligence/exportAdvisor';
import {
  buildFilename,
  downloadBlob,
  exportNodeAsPdf,
  exportNodeAsRaster,
  type RasterFormat,
} from './export';

export interface AssetExportControlsProps {
  node: SceneNode;
  doc: import('@strata/scene').Document;
  engine?: Engine;
  platform?: Platform;
  /** When provided (editable contexts only), renders the multi-configuration list below quick export. */
  onAddPreset?: (preset: ExportPreset) => void;
  onUpdatePreset?: (preset: ExportPreset) => void;
  onRemovePreset?: (presetId: string) => void;
  onOpenAdvancedExport?: () => void;
}

type ExportFormat = RasterFormat | 'svg' | 'pdf';

const FORMATS: { value: ExportFormat; label: string; desktopOnly?: boolean }[] = [
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'svg', label: 'SVG' },
  { value: 'pdf', label: 'PDF', desktopOnly: true },
];

const SCALES = [1, 2, 3];

const PRESET_FORMAT_LABELS: Partial<Record<PresetFormat, string>> = {
  png: 'PNG',
  jpg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  svg: 'SVG',
  'pdf-screen': 'PDF',
  'pdf-x1a': 'PDF/X-1a',
  'pdf-x4': 'PDF/X-4',
  'react-tailwind': 'React + Tailwind',
  'react-cssmodules': 'React + CSS Modules',
  flutter: 'Flutter',
  swiftui: 'SwiftUI',
  'svg-component': 'SVG Component',
};

function presetFileExtension(format: PresetFormat): string {
  if (format.startsWith('pdf')) return 'pdf';
  if (format === 'jpg') return 'jpg';
  if (format.startsWith('react')) return 'tsx';
  if (format === 'flutter') return 'dart';
  if (format === 'swiftui') return 'swift';
  if (format === 'svg-component') return 'svg';
  return format;
}

/** Seeds a new preset from the quick-export panel's current format/scale, so "Add export setting" doesn't start blank. */
function buildPresetFromQuickExport(
  presetCount: number,
  format: ExportFormat,
  scale: number,
): ExportPreset {
  const presetFormat: PresetFormat =
    format === 'image/png'
      ? 'png'
      : format === 'image/jpeg'
        ? 'jpg'
        : format === 'image/webp'
          ? 'webp'
          : format === 'svg'
            ? 'svg'
            : 'pdf-screen';
  const isVectorish = presetFormat === 'svg' || presetFormat.startsWith('pdf');
  return {
    id: `preset-${Date.now()}-${presetCount}`,
    format: presetFormat,
    scale: { type: 'factor', value: isVectorish ? 1 : scale },
    suffix: isVectorish || scale === 1 ? '' : `@${scale}x`,
    enabled: true,
  };
}

function ExportConfigRow({
  preset,
  nodeName,
  onUpdate,
  onRemove,
}: {
  preset: ExportPreset;
  nodeName: string;
  onUpdate?: (preset: ExportPreset) => void;
  onRemove?: (presetId: string) => void;
}) {
  const scaleLabel =
    preset.scale.type === 'factor' ? `${preset.scale.value}x` : `${preset.scale.pixels}px`;
  const formatLabel = PRESET_FORMAT_LABELS[preset.format] ?? preset.format;
  return (
    <div className="spec-export__config-row">
      <label className="spec-export__config-checkbox">
        <input
          type="checkbox"
          checked={preset.enabled}
          onChange={(e) => onUpdate?.({ ...preset, enabled: e.target.checked })}
          aria-label={`Enable ${formatLabel} export setting`}
        />
      </label>
      <div className="spec-export__config-label">
        <div className="spec-export__config-name">
          {nodeName}
          {preset.suffix}.{presetFileExtension(preset.format)}
        </div>
        <div className="spec-export__config-details">
          {formatLabel}, {scaleLabel}
        </div>
      </div>
      <input
        value={preset.suffix}
        onChange={(e) => onUpdate?.({ ...preset, suffix: e.target.value })}
        aria-label="Filename suffix"
        className="spec-export__config-suffix"
      />
      <button
        type="button"
        onClick={() => onRemove?.(preset.id)}
        aria-label={`Remove ${formatLabel} export setting`}
        className="spec-export__config-remove"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function isTauriPlatform(p?: Platform): boolean {
  return p?.kind === 'tauri';
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
  const [format, setFormat] = useState<ExportFormat>(suggestion.format);
  const [scale, setScale] = useState(suggestion.scale);
  const [customScale, setCustomScale] = useState('');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const liveRef = useRef<HTMLDivElement>(null);
  const suggestedForNodeRef = useRef(node.id);

  // Re-apply the advisor's suggestion when the selected node changes, but
  // never fight the user's manual choice while they stay on the same node.
  useEffect(() => {
    if (suggestedForNodeRef.current !== node.id) {
      suggestedForNodeRef.current = node.id;
      setFormat(suggestion.format);
      setScale(suggestion.scale);
      setCustomScale('');
    }
  }, [node.id, suggestion]);

  const effectiveScale = customScale ? Number.parseFloat(customScale) : scale;
  const isTauri = isTauriPlatform(platform);
  const isPdfDesktopOnly = format === 'pdf' && !isTauri;
  const formatLabel = FORMATS.find((f) => f.value === format)?.label ?? format;
  const usesDesktopSave = isTauri && !!platform;
  const primaryActionLabel = exporting
    ? 'Exporting…'
    : `${usesDesktopSave ? 'Export' : 'Download'} ${formatLabel}`;
  const nodePresets = node.presets ?? [];
  const showConfigList = !!(onAddPreset || onUpdatePreset || onRemovePreset);

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
        if (!isTauri) {
          setMessage('PDF export requires the desktop app');
          return;
        }
        const { bytes, filename } = await exportNodeAsPdf(
          node,
          doc,
          effectiveScale,
          eng ?? undefined,
        );
        const saved = await platform?.saveBinaryFile(filename, bytes, 'application/pdf', '.pdf');
        setMessage(saved ? `Exported ${node.name} as PDF` : 'Export cancelled');
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
        const { blob, warnings } = await exportNodeAsRaster(node, doc, eng, {
          format: format as 'image/png' | 'image/jpeg' | 'image/webp',
          scale: effectiveScale,
          quality: format === 'image/jpeg' ? 0.92 : undefined,
        });
        const ext = format === 'image/png' ? 'png' : format === 'image/jpeg' ? 'jpg' : 'webp';
        const warningSuffix = warnings.length > 0 ? ` — ${warnings.join(' ')}` : '';
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

  return (
    <section className="spec-panel__section" aria-labelledby="spec-export-heading">
      <h3 id="spec-export-heading">Export</h3>

      <div className="spec-export__row">
        <span className="spec-row__label">
          Format
          <Tooltip label={suggestion.reason}>
            <button
              type="button"
              className="spec-export__why-btn"
              aria-label={`Why ${FORMATS.find((f) => f.value === suggestion.format)?.label ?? suggestion.format}?`}
            >
              <Icon name="Info" size={12} label={undefined} />
            </button>
          </Tooltip>
        </span>
        <div className="spec-export__group">
          {FORMATS.map((f) => (
            <Tooltip
              key={f.value}
              label={f.label}
              disabledReason={f.desktopOnly && !isTauri ? 'Requires desktop app' : undefined}
            >
              <button
                type="button"
                className={`spec-export__btn${format === f.value ? ' spec-export__btn--active' : ''}`}
                aria-pressed={format === f.value}
                disabled={f.desktopOnly && !isTauri}
                onClick={() => setFormat(f.value)}
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
          disabled={exporting || !effectiveScale || effectiveScale <= 0 || isPdfDesktopOnly}
          onClick={handleExport}
        >
          {primaryActionLabel}
        </button>
        {format === 'svg' && (
          <CopyButton
            value={exportNodeToSvg(node, doc)}
            label="SVG markup"
            className="spec-row__copy"
          />
        )}
      </div>

      <div ref={liveRef} role="status" aria-live="polite" className="strata-visually-hidden">
        {message}
      </div>
      {message && <p className="spec-export__message">{message}</p>}

      {showConfigList && (
        <section className="spec-export__configs" aria-labelledby="spec-export-configs-heading">
          <h4 id="spec-export-configs-heading" className="spec-export__configs-title">
            Export settings
          </h4>
          {nodePresets.length === 0 ? (
            <p className="spec-export__configs-empty">
              No export settings have been added. Add one to export this node as PNG, SVG, PDF, or
              another supported format whenever you batch-export the document.
            </p>
          ) : (
            nodePresets.map((preset) => (
              <ExportConfigRow
                key={preset.id}
                preset={preset}
                nodeName={node.name}
                onUpdate={onUpdatePreset}
                onRemove={onRemovePreset}
              />
            ))
          )}
          <div className="spec-export__configs-actions">
            {onAddPreset && (
              <button
                type="button"
                className="spec-export__configs-add"
                onClick={() =>
                  onAddPreset(
                    buildPresetFromQuickExport(nodePresets.length, format, effectiveScale),
                  )
                }
              >
                + Add export setting
              </button>
            )}
            {onOpenAdvancedExport && (
              <button
                type="button"
                className="spec-export__configs-advanced"
                onClick={onOpenAdvancedExport}
              >
                {'Open advanced export\u2026'}
              </button>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
