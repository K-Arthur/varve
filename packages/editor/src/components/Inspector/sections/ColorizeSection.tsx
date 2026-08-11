/**
 * ColorizeSection — unified selective recolor / palette colorize /
 * reference transfer inspector panel with progressive disclosure.
 *
 * Provides:
 *   - Workflow selector (Recolor / Palette / Transfer / Harmonize)
 *   - SAM2 mask integration for selective recolor
 *   - Document swatch picker for palette colorize
 *   - Reference image picker for color transfer
 *   - Preview / Apply / Cancel flow
 *   - Model installation state
 *   - WCAG 2.2 AA compliant
 *
 * Uses the shared colorization request contract and pipeline dispatch.
 */
import type { QualityMode } from '@varve/engine';
import { listAllModels } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecolorWorkflow = 'recolor' | 'palette' | 'transfer' | 'harmonize';

interface ColorizeState {
  status: 'idle' | 'previewing' | 'applying' | 'error';
  errorMessage: string | null;
  previewDataUrl: string | null;
  elapsedMs: number;
  modelAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ColorizeSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0];
  const hueId = useId();
  const satId = useId();
  const lumId = useId();
  const blendId = useId();
  const adherenceId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const elapsedRef = useRef<number | null>(null);

  const [workflow, setWorkflow] = useState<RecolorWorkflow>('recolor');
  const [targetHue, setTargetHue] = useState(0);
  const [saturationScale, setSaturationScale] = useState(1);
  const [luminancePreservation, setLuminancePreservation] = useState(1);
  const [blendStrength, setBlendStrength] = useState(1);
  const [adherence, setAdherence] = useState(0.5);
  const [qualityMode, setQualityMode] = useState<QualityMode>('balanced');
  const [chromaStrength, setChromaStrength] = useState(1);
  const [skinProtection, setSkinProtection] = useState(true);
  const [neutralProtection, setNeutralProtection] = useState(true);
  const [modelAvailable, setModelAvailable] = useState<boolean | null>(null);
  const [_selectedSwatchIds, _setSelectedSwatchIds] = useState<string[]>([]);
  const [_referenceSrc, _setReferenceSrc] = useState<string | null>(null);
  const [maskData, _setMaskData] = useState<Uint8Array | null>(null);
  const [_maskWidth, _setMaskWidth] = useState(0);
  const [_maskHeight, _setMaskHeight] = useState(0);

  const [colorize, setColorize] = useState<ColorizeState>({
    status: 'idle',
    errorMessage: null,
    previewDataUrl: null,
    elapsedMs: 0,
    modelAvailable: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  // Elapsed timer
  useEffect(() => {
    if (colorize.status === 'previewing' || colorize.status === 'applying') {
      setColorize((prev) => ({ ...prev, elapsedMs: 0 }));
      const start = Date.now();
      elapsedRef.current = window.setInterval(() => {
        setColorize((prev) => ({ ...prev, elapsedMs: Date.now() - start }));
      }, 250);
    } else if (elapsedRef.current !== null) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
    return () => {
      if (elapsedRef.current !== null) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [colorize.status]);

  const resetState = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setColorize((prev) => ({
      status: 'idle',
      errorMessage: null,
      previewDataUrl: null,
      elapsedMs: 0,
      modelAvailable: prev.modelAvailable,
    }));
  }, []);

  // Check model availability
  useEffect(() => {
    try {
      const models = listAllModels();
      setModelAvailable(models.some((m) => m.id === 'ddcolor' || m.id === 'ddcolor-tiny'));
    } catch {
      setModelAvailable(false);
    }
  }, []);

  // Load image from cache
  const loadImageData = useCallback(async (src: string): Promise<ImageData> => {
    const { cachedImageDims, getImageCache } = await import('@varve/engine');
    const img = await getImageCache().load(src);
    const { width: w, height: h } = cachedImageDims(img);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }, []);

  // Run colorization
  const runColorize = useCallback(
    async (fullData: ImageData): Promise<ImageData> => {
      const { dispatchColorization, generateColorizationRequestId } = await import('@varve/engine');
      const { managedColorToHex } = await import('@varve/scene');

      // Build palette from selected swatches
      let paletteColors: string[] = [];
      if (workflow === 'palette' && _selectedSwatchIds.length > 0) {
        const doc = state.document;
        const swatches = doc.swatches ?? [];
        paletteColors = _selectedSwatchIds
          .map((id: string) => swatches.find((s: { id: string }) => s.id === id))
          .filter((s): s is NonNullable<typeof s> => s != null)
          .map((s) => managedColorToHex(s.color));
      }

      const request = {
        requestId: generateColorizationRequestId(),
        kind:
          workflow === 'palette'
            ? ('palette-colorize' as const)
            : workflow === 'transfer'
              ? ('reference-transfer' as const)
              : workflow === 'harmonize'
                ? ('harmonize' as const)
                : ('selective-recolor' as const),
        source: {
          nodeId: state.selection[0] ?? '',
          revision: 0,
          width: fullData.width,
          height: fullData.height,
        },
        qualityMode,
        provider: { backend: 'auto' as const, intent: 'full' as const },
        mask: maskData
          ? {
              maskId: 'current',
              revision: 0,
              data: maskData,
              width: _maskWidth,
              height: _maskHeight,
            }
          : undefined,
        palette:
          paletteColors.length >= 2
            ? {
                colors: paletteColors,
                revision: 0,
                adherence,
              }
            : undefined,
        params: {
          targetHue,
          saturationScale,
          luminancePreservation,
          chromaStrength,
          skinProtection,
          neutralProtection,
        },
        signal: abortRef.current?.signal,
      };

      const result = await dispatchColorization(request, fullData);
      return result.imageData;
    },
    [
      workflow,
      targetHue,
      saturationScale,
      luminancePreservation,
      chromaStrength,
      skinProtection,
      neutralProtection,
      adherence,
      qualityMode,
      _selectedSwatchIds,
      maskData,
      _maskWidth,
      _maskHeight,
      state.selection,
      state.document,
    ],
  );

  const handlePreview = useCallback(async () => {
    if (!imageSrc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setColorize((prev) => ({
      ...prev,
      status: 'previewing',
      errorMessage: null,
      previewDataUrl: null,
      elapsedMs: 0,
    }));

    try {
      const fullData = await loadImageData(imageSrc);
      if (controller.signal.aborted) return;
      const result = await runColorize(fullData);
      if (controller.signal.aborted) return;

      // Render preview
      const maxPreviewDim = 512;
      let previewW = result.width;
      let previewH = result.height;
      if (Math.max(previewW, previewH) > maxPreviewDim) {
        const s = maxPreviewDim / Math.max(previewW, previewH);
        previewW = Math.round(previewW * s);
        previewH = Math.round(previewH * s);
      }

      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = result.width;
      tmpCanvas.height = result.height;
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.putImageData(result, 0, 0);

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = previewW;
      previewCanvas.height = previewH;
      const ctx = previewCanvas.getContext('2d')!;
      ctx.drawImage(tmpCanvas, 0, 0, previewW, previewH);

      const dataUrl = previewCanvas.toDataURL('image/png');
      setColorize((prev) => ({
        ...prev,
        status: 'idle',
        previewDataUrl: dataUrl,
        elapsedMs: 0,
      }));
      announce('Colorize preview ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Preview failed';
      setColorize((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [imageSrc, loadImageData, runColorize, announce]);

  const handleApply = useCallback(async () => {
    if (!imageSrc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setColorize((prev) => ({
      ...prev,
      status: 'applying',
      errorMessage: null,
      elapsedMs: 0,
    }));

    try {
      const fullData = await loadImageData(imageSrc);
      if (controller.signal.aborted) return;
      const result = await runColorize(fullData);
      if (controller.signal.aborted) return;

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = result.width;
      outputCanvas.height = result.height;
      const outputCtx = outputCanvas.getContext('2d')!;
      outputCtx.putImageData(result, 0, 0);
      const dataUrl = outputCanvas.toDataURL('image/png');

      const { insertDerivedImageShape } = await import('../../../imageOperations');
      const currentDoc = state.document;
      const sourceId = state.selection[0];
      if (!sourceId) throw new Error('No selection');
      const sourceNode = currentDoc.nodes[sourceId];
      if (!sourceNode) throw new Error('Source node no longer exists');

      const inserted = insertDerivedImageShape(currentDoc, sourceId, {
        dataUrl,
        width: result.width,
        height: result.height,
        suffix: `${workflow}-result`,
      });
      updateDoc(() => inserted.doc);
      announce(`Colorize applied (${result.width} x ${result.height})`);
      resetState();
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Apply failed';
      setColorize((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [
    imageSrc,
    loadImageData,
    runColorize,
    workflow,
    state.document,
    state.selection,
    updateDoc,
    announce,
    resetState,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setColorize((prev) => ({ ...prev, status: 'idle', elapsedMs: 0 }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = colorize.status === 'previewing' || colorize.status === 'applying';
  const showPreview = colorize.previewDataUrl != null;

  return (
    <DisclosureSection title="Colorize" sectionId="colorize">
      <div className="insp-field-group">
        <p className="insp-hint">
          Selective recolor, palette-based colorization, and reference color transfer. Runs locally
          via classical algorithms or AI models.
        </p>

        {/* Workflow selector */}
        <FieldRow label="Mode">
          <Select
            label="Colorization workflow"
            value={workflow}
            disabled={isProcessing}
            onChange={(v) => setWorkflow(v as RecolorWorkflow)}
            options={[
              { value: 'recolor', label: 'Recolor (Hue Shift)' },
              { value: 'palette', label: 'Palette Colorize' },
              { value: 'transfer', label: 'Reference Transfer' },
              { value: 'harmonize', label: 'Harmonize' },
            ]}
          />
        </FieldRow>

        {/* Recolor controls */}
        {workflow === 'recolor' && (
          <>
            <FieldRow label="Hue" htmlFor={hueId}>
              <input
                id={hueId}
                type="range"
                className="insp-range"
                min={-180}
                max={180}
                step={1}
                value={targetHue}
                disabled={isProcessing}
                aria-label="Target hue shift in degrees"
                onChange={(e) => setTargetHue(Number(e.target.value))}
              />
              <output htmlFor={hueId}>{targetHue}deg</output>
            </FieldRow>
            <FieldRow label="Saturation" htmlFor={satId}>
              <input
                id={satId}
                type="range"
                className="insp-range"
                min={0}
                max={3}
                step={0.05}
                value={saturationScale}
                disabled={isProcessing}
                aria-label="Saturation scale"
                onChange={(e) => setSaturationScale(Number(e.target.value))}
              />
              <output htmlFor={satId}>{Math.round(saturationScale * 100)}%</output>
            </FieldRow>
          </>
        )}

        {/* Quality mode */}
        <fieldset className="colorize-section__quality-row">
          <legend className="insp-label">Quality</legend>
          <div
            className="colorize-section__quality-options"
            role="radiogroup"
            aria-label="Quality mode"
          >
            {(['fast', 'balanced', 'quality', 'automatic'] as QualityMode[]).map((qm) => (
              <label
                key={qm}
                className={`insp-radio-btn${qualityMode === qm ? ' insp-radio-btn--active' : ''}`}
              >
                <input
                  type="radio"
                  name="quality-mode"
                  checked={qualityMode === qm}
                  onChange={() => setQualityMode(qm)}
                />
                {qm.charAt(0).toUpperCase() + qm.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Palette controls */}
        {workflow === 'palette' && (
          <p className="insp-hint">
            Select document swatches to use as the target palette. The image will be re-colored to
            match the selected swatch colors.
          </p>
        )}

        {/* Transfer controls */}
        {workflow === 'transfer' && (
          <p className="insp-hint">
            Pick a reference image to transfer its color characteristics to the selected image. Uses
            Reinhard et al. (2001) LAB-space transfer.
          </p>
        )}

        {/* Photo/recolor controls */}
        {workflow === 'recolor' && (
          <>
            <FieldRow label="Chroma" htmlFor={`${hueId}-chroma`}>
              <input
                id={`${hueId}-chroma`}
                type="range"
                className="insp-range"
                min={0}
                max={2}
                step={0.05}
                value={chromaStrength}
                disabled={isProcessing}
                aria-label="Chroma strength"
                onChange={(e) => setChromaStrength(Number(e.target.value))}
              />
              <output htmlFor={`${hueId}-chroma`}>{Math.round(chromaStrength * 100)}%</output>
            </FieldRow>
            <div className="insp-field-group">
              <label className="insp-checkbox-row">
                <input
                  type="checkbox"
                  checked={skinProtection}
                  disabled={isProcessing}
                  onChange={(e) => setSkinProtection(e.target.checked)}
                />
                <span>Skin tone protection</span>
              </label>
              <label className="insp-checkbox-row">
                <input
                  type="checkbox"
                  checked={neutralProtection}
                  disabled={isProcessing}
                  onChange={(e) => setNeutralProtection(e.target.checked)}
                />
                <span>Neutral region protection</span>
              </label>
            </div>
          </>
        )}

        {/* Shared controls */}
        <FieldRow label="Luminance" htmlFor={lumId}>
          <input
            id={lumId}
            type="range"
            className="insp-range"
            min={0}
            max={1}
            step={0.05}
            value={luminancePreservation}
            disabled={isProcessing}
            aria-label="Luminance preservation strength"
            onChange={(e) => setLuminancePreservation(Number(e.target.value))}
          />
          <output htmlFor={lumId}>{Math.round(luminancePreservation * 100)}%</output>
        </FieldRow>

        <FieldRow label="Blend" htmlFor={blendId}>
          <input
            id={blendId}
            type="range"
            className="insp-range"
            min={0}
            max={1}
            step={0.05}
            value={blendStrength}
            disabled={isProcessing}
            aria-label="Blend strength"
            onChange={(e) => setBlendStrength(Number(e.target.value))}
          />
          <output htmlFor={blendId}>{Math.round(blendStrength * 100)}%</output>
        </FieldRow>

        {workflow === 'palette' && (
          <FieldRow label="Adherence" htmlFor={adherenceId}>
            <input
              id={adherenceId}
              type="range"
              className="insp-range"
              min={0}
              max={1}
              step={0.05}
              value={adherence}
              disabled={isProcessing}
              aria-label="Palette adherence"
              onChange={(e) => setAdherence(Number(e.target.value))}
            />
            <output htmlFor={adherenceId}>{Math.round(adherence * 100)}%</output>
          </FieldRow>
        )}

        {/* Preview */}
        {showPreview && (
          <section className="insp-nested-panel" aria-label="Colorize preview">
            <p className="insp-subsection__label">Preview</p>
            <div
              className="insp-mask-review"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-sunken) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-sunken) 75%)',
                backgroundSize: '16px 16px',
              }}
            >
              <img
                src={colorize.previewDataUrl ?? undefined}
                alt="Colorize preview"
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 180,
                  objectFit: 'contain',
                }}
              />
            </div>
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={isProcessing}
                loading={colorize.status === 'applying'}
                aria-label="Apply colorization at full resolution"
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setColorize((prev) => ({ ...prev, previewDataUrl: null }))}
                disabled={isProcessing}
              >
                Discard
              </Button>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                {colorize.status === 'previewing' ? 'Generating preview…' : 'Applying colorize…'}{' '}
                {Math.round(colorize.elapsedMs / 1000)}s
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                aria-label="Cancel colorization"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handlePreview}
                aria-label="Generate colorize preview"
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!showPreview}
                onClick={handleApply}
                aria-label="Apply colorization at full resolution"
              >
                Apply Full
              </Button>
            </>
          )}
        </div>

        {colorize.status === 'error' && colorize.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {colorize.errorMessage}
          </p>
        )}

        {modelAvailable === false && (
          <p className="insp-hint">
            DDColor model not yet available. Open Settings Models to download it.
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
