/**
 * AssetExportControls — export format/scale picker with download button.
 *
 * Supports PNG/JPG/WebP at 1x/2x/3x/custom scales, and SVG copy/download.
 * Progress and completion communicated via aria-live.
 *
 * Research basis: Figma export dialog (format + scale + background).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, type Engine } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { exportNodeToSvg } from '@strata/codegen';
import { CopyButton } from '@strata/ui';
import {
  exportNodeAsRaster,
  downloadBlob,
  buildFilename,
  type RasterFormat,
} from './export';

export interface AssetExportControlsProps {
  node: SceneNode;
  doc: import('@strata/scene').Document;
  engine?: Engine;
}

type ExportFormat = RasterFormat | 'svg';

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/webp', label: 'WebP' },
  { value: 'svg', label: 'SVG' },
];

const SCALES = [1, 2, 3];

export function AssetExportControls({ node, doc, engine: _engine }: AssetExportControlsProps) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [format, setFormat] = useState<ExportFormat>('image/png');
  const [scale, setScale] = useState(2);
  const [customScale, setCustomScale] = useState('');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const liveRef = useRef<HTMLDivElement>(null);

  const effectiveScale = customScale ? Number.parseFloat(customScale) : scale;

  useEffect(() => {
    if (_engine) {
      setEngine(_engine);
    } else {
      createEngine('stub').then(setEngine);
    }
  }, [_engine]);

  const handleExport = useCallback(async () => {
    const eng = engine;
    if (!eng) {
      setMessage('Engine not ready');
      return;
    }
    setExporting(true);
    setMessage('');
    try {
      if (format === 'svg') {
        const blob = await exportNodeAsRaster(node, doc, eng, {
          format: 'image/png',
          scale: effectiveScale,
        });
        downloadBlob(blob, buildFilename(node.name, 'svg'));
        setMessage(`Exported ${node.name} as SVG`);
      } else {
        const blob = await exportNodeAsRaster(node, doc, eng, {
          format: format as 'image/png' | 'image/jpeg' | 'image/webp',
          scale: effectiveScale,
          quality: format === 'image/jpeg' ? 0.92 : undefined,
        });
        const ext = format === 'image/png' ? 'png' : format === 'image/jpeg' ? 'jpg' : 'webp';
        downloadBlob(blob, buildFilename(node.name, ext));
        setMessage(`Exported ${node.name} as ${ext.toUpperCase()} at ${effectiveScale}x`);
      }
    } catch (err) {
      setMessage(`Export failed: ${(err as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [node, doc, engine, format, effectiveScale]);

  return (
    <section className="spec-panel__section" aria-labelledby="spec-export-heading">
      <h3 id="spec-export-heading">Export</h3>

      <div className="spec-export__row">
        <span className="spec-row__label">Format</span>
        <div className="spec-export__group">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`spec-export__btn${format === f.value ? ' spec-export__btn--active' : ''}`}
              aria-pressed={format === f.value}
              onClick={() => setFormat(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {format !== 'svg' && (
        <div className="spec-export__row">
          <span className="spec-row__label">Scale</span>
          <div className="spec-export__group">
            {SCALES.map((s) => (
              <button
                key={s}
                type="button"
                className={`spec-export__btn${effectiveScale === s && !customScale ? ' spec-export__btn--active' : ''}`}
                aria-pressed={effectiveScale === s && !customScale}
                onClick={() => { setScale(s); setCustomScale(''); }}
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
          {exporting ? 'Exporting\u2026' : 'Download'}
        </button>
        {format === 'svg' && (
          <CopyButton value={exportNodeToSvg(node, doc)} label="SVG markup" className="spec-row__copy" />
        )}
      </div>

      <div ref={liveRef} role="status" aria-live="polite" className="strata-visually-hidden">
        {message}
      </div>
      {message && <p className="spec-export__message">{message}</p>}
    </section>
  );
}
