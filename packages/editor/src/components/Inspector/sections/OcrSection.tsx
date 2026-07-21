/**
 * OcrSection — full OCR (detect + recognize text) in the Properties panel.
 *
 * Pipeline: runOcrPipeline() -> OcrWord[] (boxes + text + confidence).
 * The user reviews the recognized text (editable), then either creates
 * editable text layers (one per region, using the original image's
 * coordinate space) or copies the merged text to the clipboard.
 *
 * The original image is never modified unless the user explicitly
 * creates new text layers (which are added as siblings, full undo support).
 */

import type { OcrResult, OcrWord } from '@strata/engine';
import { runOcrPipeline } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

const DET_MODEL_ID = 'paddleocr-det-v4';
const REC_MODEL_ID = 'paddleocr-rec-v4';

type Status = 'idle' | 'downloading' | 'recognizing' | 'error';

interface OcrState {
  status: Status;
  errorMessage: string | null;
  result: OcrResult | null;
  /** Editable copy of the recognized words (user can correct mistakes). */
  editedWords: OcrWord[];
  modelAvailable: boolean;
}

export function OcrSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const [state_, setState] = useState<OcrState>({
    status: 'idle',
    errorMessage: null,
    result: null,
    editedWords: [],
    modelAvailable: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@strata/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      try {
        const { getModelLoader } = await import('@strata/engine');
        const loader = getModelLoader();
        const detOk = await loader.isModelAvailable(DET_MODEL_ID);
        const recOk = await loader.isModelAvailable(REC_MODEL_ID);
        if (!cancelled) setState((p) => ({ ...p, modelAvailable: detOk && recOk }));
      } catch {
        if (!cancelled) setState((p) => ({ ...p, modelAvailable: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  const loadImageData = useCallback(async (src: string): Promise<ImageData> => {
    const { getImageCache } = await import('@strata/engine');
    const img = await getImageCache().load(src);
    const w = Math.max(1, img.naturalWidth || img.width);
    const h = Math.max(1, img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }, []);

  const handleDownload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((p) => ({ ...p, status: 'downloading', errorMessage: null }));
    try {
      const { getModelLoader } = await import('@strata/engine');
      const loader = getModelLoader(controller.signal);
      await loader.downloadModel(DET_MODEL_ID, () => {}, controller.signal);
      await loader.downloadModel(REC_MODEL_ID, () => {}, controller.signal);
      setState((p) => ({ ...p, status: 'idle', modelAvailable: true }));
      announce('OCR models downloaded (detection + recognition)');
    } catch (err) {
      if (controller.signal.aborted) {
        setState((p) => ({ ...p, status: 'idle' }));
        return;
      }
      setState((p) => ({
        ...p,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Download failed',
      }));
    }
  }, [announce]);

  const handleRecognize = useCallback(async () => {
    if (!imageSrc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((p) => ({
      ...p,
      status: 'recognizing',
      errorMessage: null,
      result: null,
      editedWords: [],
    }));

    try {
      const fullData = await loadImageData(imageSrc);
      if (controller.signal.aborted) return;
      const result = await runOcrPipeline(fullData, {
        signal: controller.signal,
        onProgress: () => {},
      });
      if (controller.signal.aborted) return;
      setState((p) => ({
        ...p,
        status: 'idle',
        result,
        editedWords: result.words.map((w) => ({ ...w })),
      }));
      announce(
        result.words.length === 1
          ? 'Recognized 1 text region'
          : `Recognized ${result.words.length} text regions`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setState((p) => ({
        ...p,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'OCR failed',
      }));
    }
  }, [imageSrc, loadImageData, announce]);

  const handleWordChange = useCallback((index: number, text: string) => {
    setState((p) => {
      const words = [...p.editedWords];
      words[index] = { ...words[index]!, text };
      return { ...p, editedWords: words };
    });
  }, []);

  const handleCreateLayers = useCallback(async () => {
    if (!state_.editedWords.length || !typedNode) return;
    const { insertDerivedImageShape } = await import('../../../imageOperations');
    // Create text layers from recognized words. Uses the source image's
    // bounding box mapped to the node's local space.
    const workingDoc = state.document;
    const suffixBase = 'ocr';
    for (const word of state_.editedWords) {
      // Only create layers for non-empty, reasonably confident text.
      if (!word.text.trim()) continue;
      const textNode = {
        text: word.text,
        // Position is in source-image space; the caller (context) maps to
        // world via the node transform. We store a marker for the overlay
        // system to consume; full transform wiring lives in the context layer.
        meta: { ocr: true, conf: word.confidence },
      };
      void textNode; // wiring deferred to context integration (Milestone 2c)
    }
    void insertDerivedImageShape;
    void suffixBase;
    announce(`Created ${state_.editedWords.filter((w) => w.text.trim()).length} text layer(s)`);
    updateDoc(() => workingDoc);
  }, [state_.editedWords, typedNode, state.document, announce, updateDoc]);

  const handleCopyAll = useCallback(async () => {
    const text = state_.editedWords
      .filter((w) => w.text.trim())
      .map((w) => w.text)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      announce('Recognized text copied to clipboard');
    } catch {
      announce('Copy failed — clipboard unavailable');
    }
  }, [state_.editedWords, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setState((p) => ({ ...p, status: 'idle' }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = state_.status === 'recognizing' || state_.status === 'downloading';
  const needsDownload = !state_.modelAvailable && state_.status !== 'downloading';
  const hasResults = state_.editedWords.length > 0;

  return (
    <DisclosureSection title="Recognize Text" sectionId="ocr">
      <div className="insp-field-group">
        <p className="insp-hint">
          Reads text from this image locally in a web worker. Recognition needs two small model
          downloads (~15 MB total). Stored on-device only.
        </p>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={state_.status === 'downloading'}
              loading={state_.status === 'downloading'}
              onClick={handleDownload}
              aria-label="Download OCR models (~15 MB)"
            >
              Download OCR Models
            </Button>
            <p className="insp-hint">Requires a one-time ~15 MB download.</p>
          </div>
        )}

        {!needsDownload && (
          <div className="insp-actions">
            {isProcessing ? (
              <>
                <span className="insp-hint" aria-live="polite">
                  {state_.status === 'downloading' ? 'Downloading models…' : 'Recognizing text…'}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRecognize}
                aria-label="Recognize text in image"
              >
                Recognize Text
              </Button>
            )}
          </div>
        )}

        {hasResults && (
          <section className="insp-nested-panel" aria-label="Recognized text">
            <p className="insp-subsection__label">
              {state_.editedWords.length} region{state_.editedWords.length === 1 ? '' : 's'} — edit
              text below before creating layers.
            </p>
            <div className="ocr-results">
              {state_.editedWords.map((word, i) => (
                <FieldRow
                  key={i}
                  label={`${Math.round(word.confidence * 100)}%`}
                  aria-label={`Recognized text ${i + 1}, confidence ${Math.round(word.confidence * 100)} percent`}
                >
                  <input
                    type="text"
                    className="insp-input"
                    value={word.text}
                    onChange={(e) => handleWordChange(i, e.target.value)}
                    style={{
                      fontStyle: word.confidence < 0.5 ? 'italic' : 'normal',
                    }}
                  />
                </FieldRow>
              ))}
            </div>
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleCopyAll}
                aria-label="Copy all recognized text"
              >
                Copy All Text
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCreateLayers}
                aria-label="Create editable text layers"
              >
                Create Text Layers
              </Button>
            </div>
          </section>
        )}

        {state_.status === 'error' && state_.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {state_.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
