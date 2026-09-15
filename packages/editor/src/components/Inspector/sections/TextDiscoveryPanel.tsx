/**
 * TextDiscoveryPanel — "find objects by description" inside Object Selection.
 *
 * Runs Grounding DINO Tiny locally (explicit download, no cloud fallback),
 * shows the real detections for the user to review, and sends a chosen
 * detection's box into the shared prompted-segmentation session. It never
 * applies a mask by itself and never automatically accepts the top-scoring
 * box: detection is a discovery stage, and the ordinary candidate review
 * remains the commit gate.
 */

import {
  bertTokenize,
  buildGroundingDinoInputs,
  decodeGroundingDinoOutput,
  estimateInferenceReservation,
  GROUNDING_DINO_MODEL_ID,
  GROUNDING_DINO_TOKENIZER_ID,
  type GroundingDetection,
  getImageCache,
  getInferenceWorkerHost,
  getModelById,
  getModelLoaderReady,
  locatePhraseSpans,
  normalizeGroundingQuery,
  parseBertVocab,
} from '@varve/engine';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

type PanelState = 'checking' | 'missing' | 'downloading' | 'running' | 'ready' | 'empty' | 'error';

const THRESHOLD_OPTIONS = [
  { value: 0.2, label: 'Loose — more regions' },
  { value: 0.3, label: 'Balanced (default)' },
  { value: 0.45, label: 'Strict — fewer regions' },
] as const;

export function TextDiscoveryPanel({
  source,
  onSegmentBox,
  announce,
  disabled = false,
}: {
  /** Resolved source URL for the single selected image layer. */
  source: string | null;
  onSegmentBox: (box: { x1: number; y1: number; x2: number; y2: number }) => void;
  announce: (message: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<PanelState>('checking');
  const [query, setQuery] = useState('');
  const [threshold, setThreshold] = useState<number>(0.3);
  const [detections, setDetections] = useState<GroundingDetection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'preparing' | 'loading' | 'detecting' | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timedOutRef = useRef(false);

  /**
   * Browser WASM inference for this graph is a background-scale operation:
   * measured Node CPU runs take 16-31 s, and WASM adds a large multiplier. A
   * hung session compile must not leave the panel "searching" forever, so the
   * job has a soft deadline and the failure message points at the fast paths.
   */
  const TEXT_DISCOVERY_SOFT_DEADLINE_MS = 8 * 60_000;

  useEffect(() => {
    if (state !== 'running') {
      setElapsedSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  const refreshModelState = useCallback(async () => {
    const loader = await getModelLoaderReady();
    const available = await loader.isModelAvailable(GROUNDING_DINO_MODEL_ID);
    const vocab = await loader.isModelAvailable(GROUNDING_DINO_TOKENIZER_ID);
    setState(available && vocab ? 'ready' : 'missing');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshModelState().then(() => {
      if (cancelled) return;
    });
    let unsubscribe: (() => void) | undefined;
    void getModelLoaderReady().then((loader) => {
      unsubscribe = loader.subscribe(() => {
        if (!cancelled) void refreshModelState();
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      abortRef.current?.abort();
    };
  }, [refreshModelState]);

  const installModels = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setState('downloading');
    setError(null);
    setProgress(0);
    try {
      const loader = await getModelLoaderReady();
      const ids = [GROUNDING_DINO_TOKENIZER_ID, GROUNDING_DINO_MODEL_ID];
      for (const [index, modelId] of ids.entries()) {
        if (await loader.isModelAvailable(modelId)) {
          setProgress(Math.round(((index + 1) / ids.length) * 100));
          continue;
        }
        await loader.downloadModel(
          modelId,
          (loaded, total) => {
            const part = total > 0 ? loaded / total : 0;
            setProgress(Math.round(((index + part) / ids.length) * 100));
          },
          controller.signal,
        );
      }
      setProgress(100);
      setState('ready');
      announce('Text discovery model installed. Descriptions never leave this device.');
    } catch (installError) {
      if (controller.signal.aborted) return;
      const message = installError instanceof Error ? installError.message : String(installError);
      setState('error');
      setError(
        /checksum|integrity|corrupt/i.test(message)
          ? 'The text-discovery model failed its integrity check. Remove it in Settings > Offline Models and install it again.'
          : `Could not install the text-discovery model: ${message}`,
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(0);
    }
  }, [announce]);

  const runDiscovery = useCallback(async () => {
    if (!source) {
      setError('Select a single image layer before searching by description.');
      setState('error');
      return;
    }
    const normalized = normalizeGroundingQuery(query);
    if (normalized.phrases.length === 0) {
      setError('Type a description first, for example "red mug" or "person. dog."');
      setState('error');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    timedOutRef.current = false;
    const deadline = window.setTimeout(() => {
      timedOutRef.current = true;
      controller.abort();
    }, TEXT_DISCOVERY_SOFT_DEADLINE_MS);
    setState('running');
    setStage('preparing');
    setError(null);
    setDetections([]);
    setSelectedId(null);
    try {
      const loader = await getModelLoaderReady();
      const graphPath = await loader.getModelPath(GROUNDING_DINO_MODEL_ID, controller.signal);
      const vocabPath = await loader.getModelPath(GROUNDING_DINO_TOKENIZER_ID, controller.signal);
      if (!graphPath || !vocabPath) {
        setState('missing');
        return;
      }
      const vocabResponse = await fetch(vocabPath, { signal: controller.signal });
      if (!vocabResponse.ok) throw new Error('The tokenizer vocabulary could not be read.');
      const vocab = parseBertVocab(await vocabResponse.text());
      const tokenization = bertTokenize(normalized.normalized, vocab);
      const spans = locatePhraseSpans(tokenization, normalized.phrases, vocab);

      const image = await getImageCache().load(source);
      const width =
        typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement
          ? image.naturalWidth || image.width
          : image.width;
      const height =
        typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement
          ? image.naturalHeight || image.height
          : image.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable for discovery.');
      ctx.drawImage(image, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);
      if (controller.signal.aborted) return;

      const inputs = buildGroundingDinoInputs(imageData, tokenization);
      setStage('loading');
      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'grounding-dino',
          modelPath: graphPath,
          modelId: GROUNDING_DINO_MODEL_ID,
          tensors: inputs,
          reuseSession: true,
        },
        {
          signal: controller.signal,
          reservationBytes: estimateInferenceReservation({
            width,
            height,
            // Reserve the catalog's measured working set (2.6 GB), not just the
            // 194 MB graph: the text tower, fusion decoder, and 900x256 logits
            // dominate peak memory. A low-memory session must be refused here,
            // before the 194 MB download is spent, rather than OOMing mid-run.
            modelBytes: getModelById(GROUNDING_DINO_MODEL_ID)?.peakMemoryBytes ?? 2_600_000_000,
          }),
        },
      );
      if (controller.signal.aborted) return;
      setStage('detecting');
      const outputs = result.outputs as Record<string, unknown>;
      const logits = outputs.logits as { data: Float32Array; dims: number[] } | undefined;
      const boxes = outputs.pred_boxes as { data: Float32Array; dims: number[] } | undefined;
      if (!logits || !boxes) throw new Error('The detection model returned no boxes.');
      const decoded = decodeGroundingDinoOutput(
        logits.data,
        logits.dims,
        boxes.data,
        boxes.dims,
        tokenization,
        width,
        height,
        { boxThreshold: threshold, textThreshold: threshold, phraseSpans: spans },
      );
      if (decoded.length === 0) {
        setState('empty');
        announce(
          `No region matched "${normalized.normalized}". Try looser matching or another description.`,
        );
        return;
      }
      setDetections(decoded);
      setSelectedId(decoded[0]!.id);
      setState('ready');
      announce(
        `Found ${decoded.length} matching region${decoded.length === 1 ? '' : 's'}. Review one, then segment it.`,
      );
    } catch (discoveryError) {
      if (timedOutRef.current) {
        setState('error');
        setError(
          `Text discovery did not finish within ${Math.round(TEXT_DISCOVERY_SOFT_DEADLINE_MS / 60_000)} minutes on this device. The detector is a background-scale model; use point or box Object Selection for an immediate result.`,
        );
        return;
      }
      if (controller.signal.aborted) return;
      const message =
        discoveryError instanceof Error ? discoveryError.message : String(discoveryError);
      setState('error');
      setError(
        /memory|allocation|out of memory/i.test(message)
          ? 'Text discovery needs more memory than this device can spare. Use point or box Object Selection instead.'
          : `Text discovery failed: ${message}`,
      );
    } finally {
      window.clearTimeout(deadline);
      setStage(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [announce, source, query, threshold]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(detections.length > 0 ? 'ready' : 'missing');
    announce('Text discovery cancelled.');
  }, [announce, detections.length]);

  const selected = detections.find((detection) => detection.id === selectedId) ?? null;

  return (
    <section className="insp-field-group" aria-label="Find objects by description">
      <p className="insp-subsection__label">Find by description</p>
      <p className="insp-field__hint">
        Local text-conditioned discovery (Grounding DINO). Finds regions matching a description;
        detection does not commit anything — you still review the candidate mask before applying it.
        Scores are model similarity, not proof the object is present: measured controls show a
        confident box can appear even when the described object is absent, so verify the highlighted
        region before segmenting it.
      </p>
      {state === 'missing' || state === 'downloading' ? (
        <div className="insp-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void installModels()}
            disabled={state === 'downloading'}
          >
            {state === 'downloading'
              ? `Installing… ${progress}%`
              : 'Install text discovery model (204 MB)'}
          </Button>
          <p className="insp-field__hint">
            One-time download stored on this device. Needs about 2.6 GB of free memory while
            running; unavailable on low-memory sessions.
          </p>
        </div>
      ) : (
        <>
          <div className="insp-field">
            <label className="insp-field__label" htmlFor="text-discovery-query">
              Description
            </label>
            <div className="insp-field__control">
              <input
                id="text-discovery-query"
                className="insp-input"
                type="text"
                value={query}
                placeholder="red mug. person. dog."
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void runDiscovery();
                }}
                disabled={state === 'running' || disabled}
              />
            </div>
          </div>
          <div className="insp-field">
            <Select
              label="Match strictness"
              value={String(threshold)}
              options={THRESHOLD_OPTIONS.map((option) => ({
                value: String(option.value),
                label: option.label,
              }))}
              onChange={(value) => setThreshold(Number(value))}
              disabled={state === 'running' || disabled}
            />
          </div>
          <div className="insp-actions">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => void runDiscovery()}
              disabled={state === 'running' || disabled || query.trim().length === 0}
            >
              {state === 'running' ? 'Searching…' : 'Find regions'}
            </Button>
            {state === 'running' && (
              <>
                <span className="insp-field__hint" role="status" aria-live="polite">
                  {stage === 'preparing'
                    ? 'Preparing image'
                    : stage === 'loading'
                      ? 'Loading detector model (first run can take minutes)'
                      : 'Detecting regions'}{' '}
                  · {elapsedSeconds}s
                </span>
                <button type="button" className="insp-btn-sm" onClick={cancel}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="insp-hint insp-hint--error" role="alert">
          {error}
        </p>
      )}

      {state === 'empty' && !error && (
        <p className="insp-hint" role="status">
          No region matched this description. Try a looser setting or a different phrase.
        </p>
      )}

      {detections.length > 0 && (
        <>
          <p className="insp-field__hint" role="status">
            {detections.length} matching region{detections.length === 1 ? '' : 's'} · review, then
            segment
          </p>
          <div
            className="insp-field-group"
            role="radiogroup"
            aria-label="Discovered regions"
            style={{ maxHeight: 180, overflowY: 'auto' }}
          >
            {detections.map((detection) => (
              <label
                key={detection.id}
                className="insp-field__hint"
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
              >
                <input
                  type="radio"
                  name="text-discovery-region"
                  checked={detection.id === selectedId}
                  onChange={() => setSelectedId(detection.id)}
                />
                <span>
                  {detection.phrase || 'region'} · {Math.round(detection.score * 100)}% ·{' '}
                  {Math.round(detection.box.x2 - detection.box.x1)} x{' '}
                  {Math.round(detection.box.y2 - detection.box.y1)} px
                  {detection.phraseIndex !== null ? ` · phrase ${detection.phraseIndex + 1}` : ''}
                </span>
              </label>
            ))}
          </div>
          <div className="insp-actions">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!selected || disabled}
              onClick={() => {
                if (!selected) return;
                onSegmentBox(selected.box);
                announce(
                  'Detection sent to Object Selection. Review the candidate mask before applying it.',
                );
              }}
            >
              Segment selected region
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
