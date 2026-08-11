/**
 * OcrSection — full OCR (detect + recognize text) in the Properties panel.
 *
 * Pipeline: runOcrPipeline() -> OcrWord[] (boxes + text + confidence).
 * The user reviews the recognized text (editable), then either creates
 * editable text layers (one per region, mapped to world coordinates)
 * or copies the merged text to the clipboard.
 *
 * Coordinate flow:
 *   1. OCR pipeline returns words in source-image pixel coordinates.
 *   2. sourcePixelToLocal() maps source pixels through fill placement
 *      (fit/fill/crop/scale/offset) to node-local space.
 *   3. nodeWorldTransform() maps node-local to world coordinates.
 *   4. createTextNodeAt() places the text layer at the correct world
 *      position in a single undoable transaction.
 */
import type { OcrResult, OcrWord } from '@varve/engine';
import {
  computeImagePlacement,
  getModelLoader,
  getOcrModelConfig,
  runOcrPipeline,
  sourcePixelToLocal,
} from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import {
  addNode,
  imageShapeSrc,
  isImageShape,
  makeTextNode,
  nextNodeId,
  nodeWorldTransform,
} from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

const DET_MODEL_ID = 'paddleocr-det-v4';

type Status = 'idle' | 'downloading' | 'recognizing' | 'error';

interface OcrState {
  status: Status;
  errorMessage: string | null;
  result: OcrResult | null;
  editedWords: OcrWord[];
  detModelAvailable: boolean;
  recModelAvailable: boolean;
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
    detModelAvailable: false,
    recModelAvailable: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      try {
        const loader = getModelLoader();
        const detOk = await loader.isModelAvailable(DET_MODEL_ID);
        const recConfig = getOcrModelConfig('paddleocr-rec-v4');
        const recOk = recConfig ? await loader.isModelAvailable(recConfig.modelId) : false;
        if (!cancelled)
          setState((p) => ({ ...p, detModelAvailable: detOk, recModelAvailable: recOk }));
      } catch {
        if (!cancelled)
          setState((p) => ({ ...p, detModelAvailable: false, recModelAvailable: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  const loadImageData = useCallback(async (src: string): Promise<ImageData> => {
    const { cachedImageDims, getImageCache } = await import('@varve/engine');
    const img = await getImageCache().load(src);
    const { width: w, height: h } = cachedImageDims(img);
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
      const loader = getModelLoader(controller.signal);
      await loader.downloadModel(DET_MODEL_ID, () => {}, controller.signal);
      const recConfig = getOcrModelConfig('paddleocr-rec-v4');
      if (recConfig) {
        await loader.downloadModel(recConfig.modelId, () => {}, controller.signal);
      }
      setState((p) => ({ ...p, status: 'idle', detModelAvailable: true, recModelAvailable: true }));
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
        autoRotate: true,
        language: 'en',
        onProgress: () => {},
      });

      if (controller.signal.aborted) return;

      const words = result.words.map((w) => ({
        ...w,
        orientationCorrected: result.orientationCorrected ? result.detectedOrientation : undefined,
      }));

      setState((p) => ({
        ...p,
        status: 'idle',
        result,
        editedWords: words,
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

    const nonEmptyWords = state_.editedWords.filter((w) => w.text.trim());
    if (nonEmptyWords.length === 0) {
      announce('No non-empty text to create layers from');
      return;
    }

    const doc = state.document;
    const fill = typedNode.fills?.find((f) => f.type === 'image')?.image;
    if (!fill) return;

    const sourceW = fill.imageWidth ?? 100;
    const sourceH = fill.imageHeight ?? 100;
    const nodeBounds = { x: 0, y: 0, w: 1, h: 1 };

    if (typedNode.shape.kind === 'rect') {
      nodeBounds.w = typedNode.shape.w;
      nodeBounds.h = typedNode.shape.h;
    } else {
      const bounds = typedNode.shape as unknown as { w?: number; h?: number };
      nodeBounds.w = bounds.w ?? 200;
      nodeBounds.h = bounds.h ?? 160;
    }

    const placement = computeImagePlacement({
      fit: fill.fit ?? 'crop',
      sourceWidth: sourceW,
      sourceHeight: sourceH,
      bounds: nodeBounds,
      x: fill.x ?? 0,
      y: fill.y ?? 0,
      scale: fill.scale ?? 1,
    });

    if (!placement) {
      announce('Could not compute image placement — crop/fit configuration may be incompatible');
      return;
    }

    const worldTx = nodeWorldTransform(doc, typedNode.id);
    const fontSize = Math.max(8, Math.min(nodeBounds.h * 0.08, 48));

    updateDoc((s) => {
      let workingDoc = s;

      for (const word of nonEmptyWords) {
        const localPt = sourcePixelToLocal(placement, { x: word.x, y: word.y });
        if (!localPt) continue;

        const worldX = worldTx[0] * localPt.x + worldTx[2] * localPt.y + worldTx[4];
        const worldY = worldTx[1] * localPt.x + worldTx[3] * localPt.y + worldTx[5];

        const wordW = (word.width / sourceW) * nodeBounds.w;
        const wordH = (word.height / sourceH) * nodeBounds.h;
        const estimatedFontSize = Math.max(8, Math.min(wordH, fontSize));

        const { id, doc: afterAlloc } = nextNodeId(workingDoc);
        const textNode = makeTextNode(id, word.text, {
          name: `OCR: ${word.text.slice(0, 20)}`,
          transform: [1, 0, 0, 1, worldX, worldY],
          fontSize: estimatedFontSize,
          w: Math.max(wordW, 10),
          h: Math.max(wordH, estimatedFontSize * 1.4),
        });
        workingDoc = addNode(afterAlloc, textNode);
      }

      return workingDoc;
    });

    announce(`Created ${nonEmptyWords.length} text layer(s) from OCR`);
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
  const needsDownload = !state_.detModelAvailable && state_.status !== 'downloading';
  const hasResults = state_.editedWords.length > 0;
  const hasOrientation = state_.result?.orientationCorrected;
  const orientationAngle = state_.result?.detectedOrientation;
  const orientationConf = state_.result?.orientationConfidence;

  return (
    <DisclosureSection title="Recognize Text" sectionId="ocr">
      <div className="insp-field-group">
        <p className="insp-hint">
          Reads text from this image locally. Uses orientation detection (auto-rotate) and AI-based
          recognition in a web worker. Supports English and Chinese text.
        </p>

        {hasOrientation && (
          <div className="insp-info-row" role="status">
            <span className="insp-badge insp-badge--info">
              Rotated {orientationAngle}° (conf: {Math.round((orientationConf ?? 0) * 100)}%)
            </span>
          </div>
        )}

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

        {state_.result?.recognitionModelId && (
          <p className="insp-hint">
            Recognition model: {state_.result.recognitionModelId}
            {state_.result.orientationCorrected && ' (orientation corrected)'}
          </p>
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
                  key={`ocr-${word.x}-${word.y}-${word.width}-${word.height}`}
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
