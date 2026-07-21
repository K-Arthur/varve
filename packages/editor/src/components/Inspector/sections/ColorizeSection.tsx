import type { ColorizationWorkflow, ImageStats, QualityMode } from '@strata/engine';
import {
  analyzeImageData,
  classifyTask,
  colorizationPipeline,
  listAllModels,
} from '@strata/engine';
import type { SceneNode, ShapeNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import './ColorizeSection.css';

interface ColorizeState {
  workflow: ColorizationWorkflow;
  qualityMode: QualityMode;
  luminancePreservation: number;
  chromaStrength: number;
  skinProtection: boolean;
  neutralProtection: boolean;
  adherence: number;
}

function normalizeErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'cancelled' || msg.includes('aborted')) return 'Cancelled';
  if (msg.includes('timed out')) return 'AI model timed out. Try a faster quality mode.';
  if (msg.includes('Model')) return `Model error: ${msg}`;
  return msg.length > 180 ? `${msg.slice(0, 180)}...` : msg;
}

const WORKFLOW_LABELS: Record<ColorizationWorkflow, string> = {
  'photo-colorize': 'Photo Colorize',
  'lineart-colorize': 'Line Art',
  'palette-colorize': 'Palette',
  'reference-transfer': 'Color Transfer',
  'selective-recolor': 'Selective Recolor',
  harmonize: 'Harmonize',
};

const WORKFLOW_DESCRIPTIONS: Record<ColorizationWorkflow, string> = {
  'photo-colorize': 'Colorize grayscale or faded photos using AI',
  'lineart-colorize': 'Add color to line art, manga, or sketches',
  'palette-colorize': 'Apply a color palette to a grayscale image',
  'reference-transfer': 'Transfer color mood from a reference image',
  'selective-recolor': 'Change specific colors in an image',
  harmonize: 'Match color and lighting to surrounding content',
};

function getImageSource(node: SceneNode): string | undefined {
  if (isImageShape(node)) return imageShapeSrc(node as ShapeNode);
  return undefined;
}

export function ColorizeSection({ nodes }: { nodes: SceneNode[] }) {
  const { announce } = useEditor();
  const node = nodes[0];
  const src = node ? getImageSource(node) : undefined;

  const [params, setParams] = useState<ColorizeState>({
    workflow: 'photo-colorize',
    qualityMode: 'automatic',
    luminancePreservation: 1,
    chromaStrength: 1,
    skinProtection: true,
    neutralProtection: true,
    adherence: 0.5,
  });
  const [resultDataUrl, setResultDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; percent: number } | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const [imageStats, setImageStats] = useState<ImageStats | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const stats = analyzeImageData(imageData);
      setImageStats(stats);
      const classification = classifyTask(stats);
      setParams((p) => ({
        ...p,
        workflow: classification.recommendedWorkflow,
      }));
    };
    img.src = src;
  }, [src]);

  useEffect(() => {
    const models = listAllModels();
    const hasDdColor = models.some((m) => m.id === 'ddcolor' || m.id === 'ddcolor-tiny');
    setModelReady(hasDdColor);
  }, []);

  const handleApply = useCallback(async () => {
    if (!node || !src || busy) return;
    setError(null);
    setResultDataUrl(null);
    setBusy(true);
    setProgress({ phase: 'preprocessing', percent: 0 });

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load source image'));
        img.src = src;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot get canvas context');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const result = await colorizationPipeline.execute({
        params: {
          workflow: params.workflow,
          qualityMode: params.qualityMode,
          sourceNodeId: node.id,
          sourceRevision: 0,
          luminancePreservation: params.luminancePreservation,
          chromaStrength: params.chromaStrength,
          skinProtection: params.skinProtection,
          neutralProtection: params.neutralProtection,
          adherence: params.adherence,
        },
        imageData,
        signal: abort.signal,
        onProgress: (p) => {
          if (isMountedRef.current) {
            setProgress({ phase: p.phase, percent: p.percent });
          }
        },
      });

      if (!isMountedRef.current || abort.signal.aborted) return;

      const resultCanvas = document.createElement('canvas');
      resultCanvas.width = result.imageData.width;
      resultCanvas.height = result.imageData.height;
      const resultCtx = resultCanvas.getContext('2d');
      if (!resultCtx) throw new Error('Cannot create result canvas');
      resultCtx.putImageData(result.imageData, 0, 0);
      const dataUrl = resultCanvas.toDataURL('image/png');

      setResultDataUrl(dataUrl);
      announce(`Colorization complete in ${Math.round(result.elapsedMs / 1000)}s`);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.message === 'cancelled' || err.message.includes('aborted'))
      ) {
        return;
      }
      if (isMountedRef.current) {
        setError(normalizeErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setBusy(false);
        setProgress(null);
        abortRef.current = null;
      }
    }
  }, [node, src, params, busy, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleCommitResult = useCallback(() => {
    if (!resultDataUrl || !node) return;
    announce('Colorization applied');
    setResultDataUrl(null);
  }, [resultDataUrl, node, announce]);

  if (!node || !src) return null;

  return (
    <DisclosureSection sectionId="colorize" title="Colorize">
      <div className="colorize-section__controls">
        <FieldRow label="Workflow">
          <select
            className="insp-select"
            value={params.workflow}
            onChange={(e) =>
              setParams((p) => ({ ...p, workflow: e.target.value as ColorizationWorkflow }))
            }
            aria-label="Colorization workflow"
          >
            {Object.entries(WORKFLOW_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </FieldRow>
        {imageStats && (
          <p className="colorize-section__hint">
            {WORKFLOW_DESCRIPTIONS[params.workflow]}
            {params.workflow === 'photo-colorize' && imageStats.fractionLowSaturation > 0.7
              ? ' — low-saturation source detected'
              : ''}
          </p>
        )}

        <fieldset className="colorize-section__quality-row">
          <legend className="sr-only">Quality mode</legend>
          {(['fast', 'balanced', 'quality', 'automatic'] as QualityMode[]).map((qm) => (
            <label
              key={qm}
              className={`colorize-section__quality-btn${params.qualityMode === qm ? ' colorize-section__quality-btn--active' : ''}`}
            >
              <input
                type="radio"
                name="quality-mode"
                className="sr-only"
                checked={params.qualityMode === qm}
                onChange={() => setParams((p) => ({ ...p, qualityMode: qm }))}
              />
              {qm.charAt(0).toUpperCase() + qm.slice(1)}
            </label>
          ))}
        </fieldset>

        {params.workflow === 'photo-colorize' && (
          <>
            <div className="colorize-section__slider-row">
              <label htmlFor="colorize-lum-pres">
                Luminance preservation: {Math.round(params.luminancePreservation * 100)}%
              </label>
              <input
                id="colorize-lum-pres"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params.luminancePreservation}
                onChange={(e) =>
                  setParams((p) => ({ ...p, luminancePreservation: parseFloat(e.target.value) }))
                }
              />
            </div>
            <div className="colorize-section__slider-row">
              <label htmlFor="colorize-chroma">
                Chroma strength: {Math.round(params.chromaStrength * 100)}%
              </label>
              <input
                id="colorize-chroma"
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={params.chromaStrength}
                onChange={(e) =>
                  setParams((p) => ({ ...p, chromaStrength: parseFloat(e.target.value) }))
                }
              />
            </div>
            <div className="colorize-section__checkboxes">
              <label className="colorize-section__checkbox-row">
                <input
                  type="checkbox"
                  checked={params.skinProtection}
                  onChange={(e) => setParams((p) => ({ ...p, skinProtection: e.target.checked }))}
                />
                Skin tone protection
              </label>
              <label className="colorize-section__checkbox-row">
                <input
                  type="checkbox"
                  checked={params.neutralProtection}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, neutralProtection: e.target.checked }))
                  }
                />
                Neutral region protection
              </label>
            </div>
          </>
        )}

        {params.workflow === 'palette-colorize' && (
          <div className="colorize-section__slider-row">
            <label htmlFor="colorize-adherence">
              Palette adherence: {Math.round(params.adherence * 100)}%
            </label>
            <input
              id="colorize-adherence"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={params.adherence}
              onChange={(e) => setParams((p) => ({ ...p, adherence: parseFloat(e.target.value) }))}
            />
          </div>
        )}

        <div className="colorize-section__action-row">
          {!busy ? (
            <Button variant="primary" onClick={handleApply} disabled={!src}>
              {params.workflow === 'photo-colorize' || params.workflow === 'lineart-colorize'
                ? 'Colorize'
                : params.workflow === 'reference-transfer'
                  ? 'Transfer'
                  : 'Apply'}
            </Button>
          ) : (
            <Button variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          )}
        </div>

        {progress && (
          <div className="colorize-section__progress">
            <div className="colorize-section__progress-bar">
              <div
                className="colorize-section__progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="colorize-section__status">
              {progress.phase === 'preprocessing'
                ? 'Preparing image...'
                : progress.phase === 'downloading'
                  ? 'Downloading model...'
                  : progress.phase === 'inference'
                    ? 'Running AI...'
                    : progress.phase === 'postprocessing'
                      ? 'Post-processing...'
                      : 'Complete'}
            </span>
          </div>
        )}

        {resultDataUrl && (
          <div className="colorize-section__result-actions">
            <Button variant="primary" onClick={handleCommitResult}>
              Apply Result
            </Button>
            <Button variant="ghost" onClick={() => setResultDataUrl(null)}>
              Discard
            </Button>
          </div>
        )}

        {error && (
          <div className="colorize-section__error" role="alert">
            {error}
          </div>
        )}

        {modelReady === false && (
          <p className="colorize-section__hint">
            DDColor model not yet available. Open Settings Models to download it.
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
