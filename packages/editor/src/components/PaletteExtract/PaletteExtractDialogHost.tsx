/**
 * Extract Color Palette dialog — the menu/command-palette "Extract Color
 * Palette" action surface. Lets the user choose how many colors to extract
 * (3–12) before running the analysis, then shows the swatches with hex
 * values and coverage. Analysis runs through the same worker-backed
 * pipeline as the inspector's Palette section.
 */

import type { PaletteAnalysis, PaletteSwatch } from '@varve/engine';
import { type ManagedColorShim, managedColorToRgba } from '@varve/shared';
import { Button, Dialog } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analyzePaletteInWorker,
  type PaletteAnalysisRequest,
} from '../../intelligence/paletteAnalysisService';

interface PaletteExtractDialogHostProps {
  src: string;
  onClose: () => void;
}

const MIN_COLORS = 3;
const MAX_COLORS = 12;
const DEFAULT_COLORS = 6;

function hexOf(color: ManagedColorShim): string {
  const [r, g, b] = managedColorToRgba(color);
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function swatchLabel(swatch: PaletteSwatch): string {
  return `${swatch.roleCandidate.replace('-', ' ')} ${hexOf(swatch.color)}`;
}

export function PaletteExtractDialogHost({ src, onClose }: PaletteExtractDialogHostProps) {
  const [colorCount, setColorCount] = useState(DEFAULT_COLORS);
  const [status, setStatus] = useState<'loading' | 'success' | 'empty' | 'error'>('loading');
  const [result, setResult] = useState<PaletteAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const srcRef = useRef(src);
  srcRef.current = src;

  const runAnalysis = useCallback(async (count: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setErrorMessage(null);
    setCopiedHex(null);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = srcRef.current;
      });
      if (controller.signal.aborted) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const request: PaletteAnalysisRequest = {
        width: data.width,
        height: data.height,
        data: data.data,
        source: {
          width: data.width,
          height: data.height,
        },
      };
      const analysis = await analyzePaletteInWorker(
        request,
        { colorCount: count },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setResult(analysis);
      setStatus(analysis.extracted.length > 0 ? 'success' : 'empty');
    } catch (err) {
      if (controller.signal.aborted) return;
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Palette extraction failed.');
    }
  }, []);

  useEffect(() => {
    void runAnalysis(colorCount);
    return () => abortRef.current?.abort();
  }, [colorCount, runAnalysis]);

  const handleCopy = useCallback((swatch: PaletteSwatch) => {
    const hex = hexOf(swatch.color);
    void navigator.clipboard?.writeText(hex).catch(() => {});
    setCopiedHex(hex);
    window.setTimeout(() => setCopiedHex((current) => (current === hex ? null : current)), 1200);
  }, []);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Extract Color Palette"
      className="palette-extract-dialog"
      focusFirstControl
    >
      <div className="palette-extract-dialog__body">
        <div className="palette-extract-dialog__controls">
          <label htmlFor="palette-extract-count" className="palette-extract-dialog__label">
            Number of colors
          </label>
          <input
            id="palette-extract-count"
            type="number"
            min={MIN_COLORS}
            max={MAX_COLORS}
            value={colorCount}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isNaN(value)) {
                setColorCount(Math.max(MIN_COLORS, Math.min(MAX_COLORS, value)));
              }
            }}
          />
          <p className="insp-hint">
            Analysis runs locally on this device ({MIN_COLORS}–{MAX_COLORS} colors).
          </p>
        </div>

        {status === 'loading' && (
          <p className="insp-hint" role="status">
            Extracting palette…
          </p>
        )}
        {status === 'empty' && (
          <p className="insp-hint insp-hint--error" role="alert">
            No colors could be extracted from this image.
          </p>
        )}
        {status === 'error' && (
          <p className="insp-hint insp-hint--error" role="alert">
            {errorMessage ?? 'Palette extraction failed.'}
          </p>
        )}

        {status === 'success' && result && (
          <>
            <ul
              className="palette-extract-dialog__swatches"
              aria-label={`Extracted ${result.extracted.length} colors`}
            >
              {result.extracted.map((swatch) => (
                <button
                  key={`${hexOf(swatch.color)}-${swatch.roleCandidate}`}
                  type="button"
                  className="palette-extract-dialog__swatch"
                  style={{ backgroundColor: hexOf(swatch.color) }}
                  onClick={() => handleCopy(swatch)}
                  aria-label={swatchLabel(swatch)}
                  title="Click to copy hex"
                >
                  <span className="palette-extract-dialog__swatch-name">
                    {swatch.roleCandidate.replace('-', ' ')}
                  </span>
                  <span className="palette-extract-dialog__swatch-hex">{hexOf(swatch.color)}</span>
                </button>
              ))}
            </ul>
            <p className="insp-hint" role="status">
              {copiedHex
                ? `${copiedHex} copied`
                : `${result.extracted.length} colors, ${(result.coverage * 100).toFixed(0)}% coverage`}
            </p>
          </>
        )}

        <div className="palette-extract-dialog__footer">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
