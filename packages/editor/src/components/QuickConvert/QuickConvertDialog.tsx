import {
  convertRasterBytes,
  getFormatCapability,
  planRasterConversion,
  RASTER_CONVERSION_FORMATS,
  RasterConversionError,
  type RasterConversionFormat,
  type RasterConversionPlan,
} from '@varve/import';
import type { Platform } from '@varve/platform';
import { Dialog } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { saveExportBytes } from '../../exportSaveAdapter';
import './quick-convert.css';

const MAX_BATCH_FILES = 25;
const MAX_BATCH_BYTES = 512 * 1024 * 1024;
const DEFAULT_OUTPUT: RasterConversionFormat = 'webp';
const DEFAULT_QUALITY = 0.92;
const DEFAULT_BACKGROUND = '#ffffff';

const FORMAT_LABELS: Record<RasterConversionFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
};

const FORMAT_EXTENSIONS: Record<RasterConversionFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
};

interface ConversionFile {
  id: string;
  file: File;
  bytes: Uint8Array;
  plan?: RasterConversionPlan;
  error?: string;
  status: 'ready' | 'converting' | 'saved' | 'failed' | 'cancelled';
  outputName?: string;
}

export interface QuickConvertDialogProps {
  open: boolean;
  onClose: () => void;
  platform?: Platform;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeStem(name: string): string {
  const stem = name
    .replace(/\.[^./\\]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return stem || 'image';
}

function displayFormat(plan?: RasterConversionPlan): string {
  return plan ? plan.inputFormat.toUpperCase() : 'Unknown';
}

function errorMessage(error: unknown): string {
  if (error instanceof RasterConversionError) return error.message;
  return error instanceof Error ? error.message : 'This file could not be prepared for conversion';
}

function acceptsFormat(format: RasterConversionFormat): boolean {
  return getFormatCapability(format)?.export.available === true;
}

function dimensionValue(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function QuickConvertDialog({ open, onClose, platform }: QuickConvertDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<ConversionFile[]>([]);
  const [outputFormat, setOutputFormat] = useState<RasterConversionFormat>(DEFAULT_OUTPUT);
  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [background, setBackground] = useState(DEFAULT_BACKGROUND);
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [widthText, setWidthText] = useState('');
  const [heightText, setHeightText] = useState('');
  const [lockAspect, setLockAspect] = useState(true);
  const [resampling, setResampling] = useState<'smooth' | 'nearest'>('smooth');
  const [busy, setBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState('');

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    setFiles([]);
    setBatchNotice('');
    setBusy(false);
    abortRef.current = null;
  }, [open]);

  const planOptions = useCallback(
    () => ({
      outputFormat,
      background: outputFormat === 'jpeg' ? background : undefined,
      ...(resizeEnabled
        ? { width: dimensionValue(widthText), height: dimensionValue(heightText) }
        : {}),
    }),
    [background, heightText, outputFormat, resizeEnabled, widthText],
  );

  const prepareFiles = useCallback(
    async (selected: FileList | File[]) => {
      const sourceFiles = Array.from(selected);
      const bounded = sourceFiles.slice(0, MAX_BATCH_FILES);
      const notices: string[] = [];
      if (sourceFiles.length > MAX_BATCH_FILES) {
        notices.push(`Only the first ${MAX_BATCH_FILES} files were queued to keep memory bounded.`);
      }
      const next: ConversionFile[] = [];
      let queuedBytes = 0;
      for (const file of bounded) {
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        if (queuedBytes + file.size > MAX_BATCH_BYTES) {
          next.push({
            id,
            file,
            bytes: new Uint8Array(),
            error: `Batch input exceeds the ${formatBytes(MAX_BATCH_BYTES)} memory budget`,
            status: 'failed',
          });
          continue;
        }
        queuedBytes += file.size;
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          next.push({
            id,
            file,
            bytes,
            plan: planRasterConversion(bytes, planOptions()),
            status: 'ready',
          });
        } catch (error) {
          next.push({
            id,
            file,
            bytes: new Uint8Array(),
            error: errorMessage(error),
            status: 'failed',
          });
        }
      }
      if (next.some((item) => item.error?.includes('memory budget'))) {
        notices.push(`The batch is limited to ${formatBytes(MAX_BATCH_BYTES)} of encoded input.`);
      }
      setBatchNotice(notices.join(' '));
      setFiles(next);
    },
    [planOptions],
  );

  const replan = useCallback(() => {
    setFiles((current) =>
      current.map((item) => {
        if (item.error || item.bytes.byteLength === 0) return item;
        try {
          return {
            ...item,
            plan: planRasterConversion(item.bytes, planOptions()),
            error: undefined,
            status: 'ready',
          };
        } catch (error) {
          return { ...item, plan: undefined, error: errorMessage(error), status: 'failed' };
        }
      }),
    );
  }, [planOptions]);

  useEffect(() => {
    if (files.length > 0 && !busy) replan();
    // Replanning is intentionally triggered by output controls, not by the
    // function identity changing as the file list is replaced.
  }, [background, heightText, outputFormat, resampling, resizeEnabled, widthText]);

  const hasLossyOutput = outputFormat !== 'png';
  const readyFiles = useMemo(
    () => files.filter((item) => item.plan && !item.error && item.plan.blockingIssues.length === 0),
    [files],
  );
  const canConvert = !busy && readyFiles.length > 0;

  const handleClose = () => {
    abortRef.current?.abort();
    setBusy(false);
    onClose();
  };

  const handleConvert = async () => {
    if (!canConvert) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    for (const item of readyFiles) {
      if (controller.signal.aborted) break;
      setFiles((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, status: 'converting' } : candidate,
        ),
      );
      try {
        const result = await convertRasterBytes(item.bytes, {
          ...planOptions(),
          quality,
          resampling,
          signal: controller.signal,
        });
        const outputName = `${safeStem(item.file.name)}.${FORMAT_EXTENSIONS[outputFormat]}`;
        await saveExportBytes(
          platform,
          outputName,
          result.bytes,
          result.mimeType,
          `.${FORMAT_EXTENSIONS[outputFormat]}`,
        );
        setFiles((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, status: 'saved', outputName } : candidate,
          ),
        );
      } catch (error) {
        const cancelled = error instanceof RasterConversionError && error.code === 'aborted';
        setFiles((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? {
                  ...candidate,
                  status: cancelled ? 'cancelled' : 'failed',
                  error: errorMessage(error),
                }
              : candidate,
          ),
        );
        if (cancelled) break;
      }
    }
    setBusy(false);
    abortRef.current = null;
  };

  const statusLabel = (item: ConversionFile): string => {
    if (item.status === 'converting') return 'Converting…';
    if (item.status === 'saved') return `Saved ${item.outputName}`;
    if (item.status === 'cancelled') return 'Cancelled';
    if (item.status === 'failed') return item.error ?? 'Could not convert';
    return item.plan?.blockingIssues[0] ?? 'Ready';
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Quick Convert"
      size="lg"
      focusFirstControl
      className="quick-convert-dialog"
      footer={
        <div className="quick-convert__footer">
          <span className="quick-convert__status" role="status" aria-live="polite">
            {busy ? 'Converting files one at a time…' : `${readyFiles.length} ready`}
          </span>
          <div className="quick-convert__actions">
            <button
              type="button"
              className="quick-convert__button quick-convert__button--quiet"
              onClick={handleClose}
            >
              {busy ? 'Cancel' : 'Close'}
            </button>
            <button
              type="button"
              className="quick-convert__button quick-convert__button--primary"
              onClick={() => void handleConvert()}
              disabled={!canConvert}
            >
              Convert and save
            </button>
          </div>
        </div>
      }
    >
      <div className="quick-convert" data-testid="quick-convert-dialog">
        <div className="quick-convert__intro">
          <p>Convert common raster images locally using the browser or desktop runtime codecs.</p>
          <p className="quick-convert__fine-print">
            SVG, PDF, PSD, and design files use their own import/export workflows. This tool exports
            one normalized raster frame at a time.
          </p>
        </div>

        <input
          ref={inputRef}
          className="quick-convert__file-input"
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.jpe,.webp,.avif,.gif,.bmp,.tif,.tiff"
          onChange={(event) => {
            const selected = event.target.files;
            if (selected) void prepareFiles(selected);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="quick-convert__dropzone"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <span className="quick-convert__dropzone-title">Choose image files</span>
          <span className="quick-convert__dropzone-copy">
            PNG, JPEG, WebP, AVIF, GIF, BMP, or TIFF · up to {MAX_BATCH_FILES} at a time
          </span>
        </button>

        <div className="quick-convert__controls">
          <label>
            <span>Output format</span>
            <select
              value={outputFormat}
              onChange={(event) => setOutputFormat(event.target.value as RasterConversionFormat)}
              disabled={busy}
            >
              {RASTER_CONVERSION_FORMATS.filter(acceptsFormat).map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
          </label>
          {hasLossyOutput && (
            <label>
              <span>
                Quality <output>{Math.round(quality * 100)}%</output>
              </span>
              <input
                type="range"
                min="0.01"
                max="1"
                step="0.01"
                value={quality}
                onChange={(event) => setQuality(Number(event.target.value))}
                disabled={busy}
                aria-label="Output quality"
              />
            </label>
          )}
          {outputFormat === 'jpeg' && (
            <label>
              <span>JPEG background</span>
              <input
                type="color"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
                disabled={busy}
                aria-label="JPEG background color"
              />
            </label>
          )}
        </div>

        <details className="quick-convert__advanced">
          <summary>Advanced output controls</summary>
          <div className="quick-convert__advanced-body">
            <label className="quick-convert__check">
              <input
                type="checkbox"
                checked={resizeEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setResizeEnabled(enabled);
                  if (enabled && files[0]?.plan) {
                    setWidthText(String(files[0].plan.width));
                    setHeightText(String(files[0].plan.height));
                  }
                }}
                disabled={busy}
              />
              <span>Resize output</span>
            </label>
            <label>
              <span>Width</span>
              <input
                type="number"
                min="1"
                value={widthText}
                onChange={(event) => {
                  const next = event.target.value;
                  setWidthText(next);
                  if (lockAspect && files[0]?.plan && Number.isFinite(Number(next))) {
                    setHeightText(
                      String(
                        Math.max(
                          1,
                          Math.round((Number(next) * files[0].plan.height) / files[0].plan.width),
                        ),
                      ),
                    );
                  }
                }}
                disabled={!resizeEnabled || busy}
                aria-label="Output width"
              />
            </label>
            <label>
              <span>Height</span>
              <input
                type="number"
                min="1"
                value={heightText}
                onChange={(event) => {
                  const next = event.target.value;
                  setHeightText(next);
                  if (lockAspect && files[0]?.plan && Number.isFinite(Number(next))) {
                    setWidthText(
                      String(
                        Math.max(
                          1,
                          Math.round((Number(next) * files[0].plan.width) / files[0].plan.height),
                        ),
                      ),
                    );
                  }
                }}
                disabled={!resizeEnabled || busy}
                aria-label="Output height"
              />
            </label>
            <label className="quick-convert__check">
              <input
                type="checkbox"
                checked={lockAspect}
                onChange={(event) => setLockAspect(event.target.checked)}
                disabled={!resizeEnabled || busy}
              />
              <span>Lock aspect ratio</span>
            </label>
            <label>
              <span>Resampling</span>
              <select
                value={resampling}
                onChange={(event) => setResampling(event.target.value as 'smooth' | 'nearest')}
                disabled={!resizeEnabled || busy}
              >
                <option value="smooth">Smooth</option>
                <option value="nearest">Nearest neighbor</option>
              </select>
            </label>
          </div>
        </details>

        {batchNotice && <p className="quick-convert__notice">{batchNotice}</p>}

        {files.length === 0 ? (
          <p className="quick-convert__empty">No files selected yet.</p>
        ) : (
          <ul className="quick-convert__files" aria-label="Files queued for conversion">
            {files.map((item) => (
              <li
                key={item.id}
                className={`quick-convert__file quick-convert__file--${item.status}`}
              >
                <div>
                  <strong>{item.file.name}</strong>
                  <span>
                    {displayFormat(item.plan)}
                    {item.plan ? ` · ${item.plan.width} x ${item.plan.height}` : ''} ·{' '}
                    {formatBytes(item.file.size)}
                  </span>
                  {item.plan && (
                    <span>
                      {item.plan.sourceColorModel.toUpperCase()} · alpha {item.plan.sourceAlphaMode}{' '}
                      · {item.plan.sourceBitDepth} · {item.plan.sourceProfile}
                    </span>
                  )}
                </div>
                <span className="quick-convert__file-status">{statusLabel(item)}</span>
              </li>
            ))}
          </ul>
        )}

        {files.some((item) => item.plan?.warnings.length) && (
          <div className="quick-convert__warnings" role="note">
            <strong>Before you convert</strong>
            <ul>
              {Array.from(new Set(files.flatMap((item) => item.plan?.warnings ?? []))).map(
                (warning) => (
                  <li key={warning}>{warning}</li>
                ),
              )}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
