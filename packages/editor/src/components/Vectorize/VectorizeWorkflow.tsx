/**
 * VectorizeWorkflow — host-agnostic vectorization controls.
 *
 * Used by the Logo panel (vectorization stage of the logo workflow) and the
 * Inspector Image & Vector section (design/image workspaces) so every surface
 * offers the same key features: presets, source preparation, live preview
 * with diagnostics, and a single-undo Apply that inserts native editable
 * Strata paths beside the source.
 *
 * Non-destructive by design: previews run on a panel canvas at bounded
 * resolution and never touch the document; Apply re-runs the same settings at
 * final resolution and commits through the shared insertTraceGroup op.
 * Stale results are rejected via VectorizationSession (request id +
 * generation + abort), so newer previews cancel older ones.
 */

import type { RasterTracePath, RasterTraceResult } from '@varve/engine';
import { imageShapeSrc, isImageShape, type SceneNode, type ShapeNode } from '@varve/scene';
import { Button, Checkbox, SegmentedControl, Select, Slider, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { insertTraceGroup } from '../../imageOperations';
import { MAX_PREVIEW_DIM } from '../../logo/vectorization/prepareSource';
import { drawPreview, MAX_FINAL_DIM, runPreviewTrace } from '../../logo/vectorization/preview';
import {
  type TraceDiagnostics,
  traceDiagnostics,
  VectorizationSession,
} from '../../logo/vectorization/session';
import {
  applyPreset,
  DEFAULT_VECTORIZATION_SETTINGS,
  getVectorizationPreset,
  hashVectorizationSettings,
  VECTORIZATION_PRESETS,
  type VectorizationSettings,
  validateVectorizationSettings,
} from '../../logo/vectorization/settings';
import './vectorize.css';

const MODE_OPTIONS = [
  { value: 'monochrome', label: 'B&W' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'color', label: 'Color' },
] as const;

const TRACE_MODE_OPTIONS = [
  { value: 'silhouette', label: 'Filled' },
  { value: 'centerline', label: 'Centerline' },
] as const;

const FOREGROUND_OPTIONS = [
  { value: 'dark', label: 'Dark ink' },
  { value: 'light', label: 'Light ink' },
] as const;

type PreviewStatus = 'idle' | 'running' | 'ready' | 'error';

interface PreviewState {
  status: PreviewStatus;
  error?: string;
  payload?: {
    imageData: ImageData;
    result: RasterTraceResult;
    width: number;
    height: number;
  };
  diagnostics?: TraceDiagnostics;
}

export interface VectorizeWorkflowProps {
  /** Copy shown when no single image layer is selected. */
  emptyStateNote?: string;
}

/** The selected node when it is exactly one image-filled shape. */
function selectedImageNode(
  selection: string[],
  doc: { nodes: Record<string, SceneNode> },
): ShapeNode | null {
  if (selection.length !== 1) return null;
  const node = doc.nodes[selection[0] ?? ''];
  return node && node.kind === 'shape' && isImageShape(node) ? node : null;
}

function sliderProps(label: string, value: number, min: number, max: number, step = 1) {
  return { label, value, min, max, step };
}

export function VectorizeWorkflow({ emptyStateNote }: VectorizeWorkflowProps) {
  const editor = useEditor();
  const { document: doc, selection } = editor.state;
  const node = useMemo(() => selectedImageNode(selection, doc), [doc, selection]);
  const [settings, setSettings] = useState<VectorizationSettings>({
    ...DEFAULT_VECTORIZATION_SETTINGS,
  });
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [applying, setApplying] = useState(false);
  const sessionRef = useRef<VectorizationSession | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const nodeId = node?.id ?? null;
  const settingsHash = hashVectorizationSettings(settings);

  // Session lifecycle: one session per source node; dispose on unmount or
  // source switch so stale worker responses can never overwrite a newer one.
  useEffect(() => {
    const session = new VectorizationSession();
    sessionRef.current = session;
    return () => session.dispose();
  }, [nodeId]);

  // Debounced preview run on settings/source change.
  useEffect(() => {
    if (!node || !sessionRef.current) {
      setPreview({ status: 'idle' });
      return;
    }
    const session = sessionRef.current;
    let cancelled = false;
    setPreview({ status: 'running' });
    const timer = window.setTimeout(() => {
      const { handle, signal } = session.beginRequest();
      runPreviewTrace(imageShapeSrc(node), settings, signal)
        .then((payload) => {
          if (cancelled || !session.isCurrent(handle)) return;
          session.release(handle);
          setPreview({
            status: 'ready',
            payload,
            diagnostics: traceDiagnostics(payload.result),
          });
        })
        .catch((error) => {
          if (cancelled || !session.isCurrent(handle)) return;
          session.release(handle);
          const message = error instanceof Error ? error.message : String(error);
          setPreview({ status: 'error', error: message === 'cancelled' ? undefined : message });
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      session.cancelAll();
    };
  }, [node, settingsHash, settings]);

  // Draw the ready preview into the panel canvas.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || preview.status !== 'ready' || !preview.payload) return;
    drawPreview(
      canvas,
      preview.payload,
      getComputedStyle(document.documentElement).getPropertyValue('--color-surface-canvas') ||
        '#ffffff',
    );
  }, [preview]);

  const apply = useCallback(async () => {
    if (!node || !sessionRef.current) return;
    setApplying(true);
    const session = sessionRef.current;
    const { handle, signal } = session.beginRequest();
    try {
      const payload = await runPreviewTrace(imageShapeSrc(node), settings, signal, MAX_FINAL_DIM);
      const { result, width, height } = payload;
      const current = editor.state;
      const sourceNode = current.document.nodes[node.id];
      if (
        !session.isCurrent(handle) ||
        !current.selection.includes(node.id) ||
        sourceNode !== node
      ) {
        editor.announce('Vectorization cancelled: the source changed');
        return;
      }
      if (result.paths.length === 0) {
        editor.announce('No foreground contours were found; adjust threshold or source prep');
        return;
      }
      const paths = result.paths as Array<
        Pick<RasterTracePath, 'closed' | 'points' | 'holes' | 'fill'>
      >;
      const insertedRef: { nodeId: string | null } = { nodeId: null };
      editor.updateDoc((d) => {
        const inserted = insertTraceGroup(d, node.id, {
          width,
          height,
          paths,
          omittedHoles: result.omittedHoles,
          cornerAngle: settings.cornerAngle,
          maxError: 1.0,
          traceMode: settings.traceMode,
          centerlineWidth:
            settings.traceMode === 'centerline' ? settings.centerlineWidth : undefined,
        });
        insertedRef.nodeId = inserted.nodeId;
        return inserted.doc;
      });
      if (insertedRef.nodeId) editor.setSelection(insertedRef.nodeId);
      const holeNote = result.omittedHoles > 0 ? ` (${result.omittedHoles} holes omitted)` : '';
      editor.announce(
        `Inserted ${result.paths.length} vector path${result.paths.length === 1 ? '' : 's'}${holeNote}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') return;
      const message = error instanceof Error ? error.message : String(error);
      editor.announce(`Vectorization failed: ${message}`);
    } finally {
      setApplying(false);
    }
  }, [editor, node, settings]);

  const cancelPreview = useCallback(() => {
    sessionRef.current?.cancelAll();
    setPreview({ status: 'idle' });
  }, []);

  const setPreset = useCallback(
    (id: string) => {
      const preset = getVectorizationPreset(id);
      if (preset) setSettings(applyPreset(settings, preset));
    },
    [settings],
  );

  const patch = useCallback((patch: Partial<VectorizationSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch, presetId: null }));
  }, []);

  const patchPrep = useCallback((patch: Partial<VectorizationSettings['prep']>) => {
    setSettings((prev) => ({
      ...prev,
      presetId: null,
      prep: { ...prev.prep, ...patch },
    }));
  }, []);

  const validation = validateVectorizationSettings(settings);
  const sourceIsLarge =
    node !== null && Math.max(node.shape.kind === 'rect' ? node.shape.w : 0, 0) > 2048;
  const previewIsDownsampled =
    node !== null && Math.max(node.shape.kind === 'rect' ? node.shape.w : 0, 0) > MAX_PREVIEW_DIM;

  const controlPanel = (
    <div className="vectorize__body">
      <div className="vectorize__field">
        <span className="vectorize__field-label">Preset</span>
        <Select
          label="Vectorization preset"
          value={settings.presetId ?? ''}
          onChange={setPreset}
          options={VECTORIZATION_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
        <p className="vectorize__muted">
          {getVectorizationPreset(settings.presetId)?.description ??
            'Custom settings (select a preset to start from).'}
        </p>
      </div>

      <SegmentedControl
        label="Trace mode"
        value={settings.traceMode}
        options={TRACE_MODE_OPTIONS}
        onChange={(value) => patch({ traceMode: value })}
      />

      <Slider
        {...sliderProps('Threshold', settings.threshold, 1, 254)}
        formatValue={(v) => String(v)}
        onChange={(threshold) => patch({ threshold })}
      />

      {settings.mode !== 'monochrome' && (
        <Slider
          {...sliderProps('Color count', settings.maxColors, 2, 32)}
          onChange={(maxColors) => patch({ maxColors })}
        />
      )}

      <Slider
        {...sliderProps('Minimum region area', settings.minArea, 0, 100)}
        onChange={(minArea) => patch({ minArea })}
      />
      <Slider
        {...sliderProps('Simplification', settings.simplifyTolerance, 0, 4)}
        step={0.05}
        formatValue={(v) => v.toFixed(2)}
        onChange={(simplifyTolerance) => patch({ simplifyTolerance })}
      />
      <Slider
        {...sliderProps('Max paths', settings.maxPaths, 50, 2000)}
        step={50}
        onChange={(maxPaths) => patch({ maxPaths })}
      />
      <Slider
        {...sliderProps('Corner angle', settings.cornerAngle, 90, 180)}
        onChange={(cornerAngle) => patch({ cornerAngle })}
      />

      {settings.traceMode === 'centerline' && (
        <>
          <Slider
            {...sliderProps('Stroke width', settings.centerlineWidth, 1, 50)}
            onChange={(centerlineWidth) => patch({ centerlineWidth })}
          />
          <Slider
            {...sliderProps('Branch prune', settings.centerlinePrune, 1, 100)}
            onChange={(centerlinePrune) => patch({ centerlinePrune })}
          />
        </>
      )}

      <div className="vectorize__field">
        <span className="vectorize__field-label">Ink color</span>
        <SegmentedControl
          label="Foreground ink"
          value={settings.foreground}
          options={FOREGROUND_OPTIONS}
          onChange={(foreground) => patch({ foreground })}
        />
      </div>

      <details className="vectorize__subsection">
        <summary className="vectorize__subsection-heading">Source preparation</summary>
        <div className="vectorize__subsection-body">
          <Checkbox
            label="Grayscale first"
            checked={settings.prep.grayscale}
            onChange={(e) => patchPrep({ grayscale: e.target.checked })}
          />
          <Checkbox
            label="Invert"
            checked={settings.prep.invert}
            onChange={(e) => patchPrep({ invert: e.target.checked })}
          />
          <Checkbox
            label="Binary threshold before tracing"
            checked={settings.prep.threshold}
            onChange={(e) => patchPrep({ threshold: e.target.checked })}
          />
          <Checkbox
            label="Ignore transparent pixels"
            checked={settings.prep.ignoreTransparent}
            onChange={(e) => patchPrep({ ignoreTransparent: e.target.checked })}
          />
          <Slider
            {...sliderProps('Contrast', settings.prep.contrast, 0.5, 1.5)}
            step={0.05}
            formatValue={(v) => v.toFixed(2)}
            onChange={(contrast) => patchPrep({ contrast })}
          />
          <Slider
            {...sliderProps('Brightness', settings.prep.brightness, -100, 100)}
            onChange={(brightness) => patchPrep({ brightness })}
          />
          <Slider
            {...sliderProps('Denoise', settings.prep.denoise, 0, 2)}
            onChange={(denoise) => patchPrep({ denoise })}
          />
        </div>
      </details>
    </div>
  );

  if (!node) {
    return (
      <div className="vectorize__body">
        <p className="vectorize__muted">
          {emptyStateNote ??
            'Select an image layer to vectorize it. The result is inserted beside the source as editable paths.'}
        </p>
      </div>
    );
  }

  const diagnostics = preview.diagnostics;

  return (
    <div className="vectorize__body">
      <SegmentedControl
        label="Trace type"
        value={settings.mode}
        options={MODE_OPTIONS}
        onChange={(mode) => patch({ mode })}
      />

      {controlPanel}

      {validation.warnings.length > 0 && (
        <div className="vectorize__warning" role="alert">
          {validation.warnings.join(' ')}
        </div>
      )}

      <div className="vectorize__preview" role="img" aria-label="Vectorization preview">
        <canvas ref={canvasRef} className="vectorize__preview-canvas" />
        {preview.status === 'running' && (
          <span className="vectorize__preview-badge" role="status">
            Tracing preview…
          </span>
        )}
        {preview.status === 'error' && preview.error && (
          <span className="vectorize__preview-badge vectorize__preview-badge--error" role="alert">
            {preview.error}
          </span>
        )}
        {preview.status === 'idle' && (
          <span className="vectorize__preview-badge">Preview appears here</span>
        )}
      </div>

      {previewIsDownsampled && preview.status !== 'idle' && (
        <p className="vectorize__muted">
          Preview is downsampled for responsiveness; Apply traces at full resolution.
        </p>
      )}

      {diagnostics && (
        <dl className="vectorize__diagnostics">
          <div>
            <dt>Paths</dt>
            <dd>{diagnostics.pathCount}</dd>
          </div>
          <div>
            <dt>Points</dt>
            <dd>{diagnostics.pointCount}</dd>
          </div>
          <div>
            <dt>Holes</dt>
            <dd>{diagnostics.holeCount}</dd>
          </div>
          <div>
            <dt>Omitted</dt>
            <dd>{diagnostics.omittedHoles}</dd>
          </div>
        </dl>
      )}

      <div className="vectorize__button-row">
        <Tooltip
          label="Insert the traced paths beside the source (undoable)"
          disabledReason={preview.status !== 'ready' ? 'Run a preview first' : undefined}
        >
          <Button
            size="sm"
            loading={applying}
            disabled={preview.status !== 'ready' || applying || validation.warnings.length > 0}
            onClick={() => void apply()}
          >
            Apply trace
          </Button>
        </Tooltip>
        <Button
          size="sm"
          variant="secondary"
          disabled={preview.status === 'idle'}
          onClick={cancelPreview}
        >
          Cancel
        </Button>
      </div>
      <p className="vectorize__muted">
        {sourceIsLarge
          ? 'Large source — final trace may take a moment.'
          : 'The source image is preserved; only the new paths are inserted.'}
      </p>
    </div>
  );
}
