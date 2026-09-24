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
  buildGroundingDinoInputsFromModelImage,
  decodeGroundingDinoOutput,
  estimateInferenceReservation,
  GROUNDING_DINO_INPUT_SIZE,
  GROUNDING_DINO_MODEL_ID,
  GROUNDING_DINO_MODEL_IMAGE_PREPROCESSING_VERSION,
  GROUNDING_DINO_TOKENIZER_ID,
  type GroundingDetection,
  getImageCache,
  getInferenceWorkerHost,
  getModelById,
  getModelLoaderReady,
  locatePhraseSpans,
  normalizeGroundingQuery,
  parseBertVocab,
  type WorkerInferTimings,
} from '@varve/engine';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyDiscoveryFailure } from './textDiscoveryFailure';

type PanelState =
  | 'checking'
  | 'missing'
  | 'downloading'
  | 'running'
  | 'ready'
  | 'empty'
  | 'refused'
  | 'error';

/** Measured stage breakdown for the last completed discovery run. */
interface DiscoveryTimings {
  sourceMs: number;
  sessionMs: number;
  preprocessMs: number;
  inferMs: number;
  postprocessMs: number;
  releaseMs: number;
  totalMs: number;
  releaseStatus: 'released' | 'recycled' | 'unchanged' | 'failed' | 'busy';
  releaseDetail: string;
}

const THRESHOLD_OPTIONS = [
  { value: 0.2, label: 'Loose — more regions' },
  { value: 0.3, label: 'Balanced (default)' },
  { value: 0.45, label: 'Strict — fewer regions' },
] as const;

type NormalizedSourceBox = { x1: number; y1: number; x2: number; y2: number };

export function TextDiscoveryPanel({
  source,
  onSegmentBox,
  announce,
  disabled = false,
}: {
  /** Resolved source URL for the single selected image layer. */
  source: string | null;
  /** Receives normalized source-image coordinates, not document/world units. */
  onSegmentBox: (box: NormalizedSourceBox) => void;
  announce: (message: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<PanelState>('checking');
  const [query, setQuery] = useState('');
  const [threshold, setThreshold] = useState<number>(0.3);
  const [detections, setDetections] = useState<GroundingDetection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewedDetectionId, setReviewedDetectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'preparing' | 'loading' | 'detecting' | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timings, setTimings] = useState<DiscoveryTimings | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [releaseNote, setReleaseNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timedOutRef = useRef(false);
  /**
   * Compact detections are cached per exact source + query + threshold. Editing
   * the review order or choosing another detected box must not rerun the
   * detector, and a repeated identical search within the session should not
   * pay the tens-of-seconds inference cost again.
   */
  const detectionCacheRef = useRef(new Map<string, GroundingDetection[]>());

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
    const cacheKey = `${source}|${normalized.normalized}|${threshold}|${GROUNDING_DINO_MODEL_IMAGE_PREPROCESSING_VERSION}`;
    const cachedDetections = detectionCacheRef.current.get(cacheKey);
    if (cachedDetections) {
      setState(cachedDetections.length > 0 ? 'ready' : 'empty');
      setDetections(cachedDetections);
      setSelectedId(cachedDetections[0]?.id ?? null);
      setReviewedDetectionId(null);
      setError(null);
      setFromCache(true);
      setTimings(null);
      setReleaseNote(null);
      announce(
        cachedDetections.length === 0
          ? `No region matched "${normalized.normalized}" earlier in this session; no new model run.`
          : `Loaded ${cachedDetections.length} cached detection${cachedDetections.length === 1 ? '' : 's'} from this session; the detector was not run again.`,
      );
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
    setReviewedDetectionId(null);
    setFromCache(false);
    setTimings(null);
    setReleaseNote(null);
    const detectorPeakBytes =
      getModelById(GROUNDING_DINO_MODEL_ID)?.peakMemoryBytes ?? 2_600_000_000;
    // Time-to-first-usable-result spans path/vocab resolution, image load,
    // preprocessing, session load, inference, postprocessing, and detector
    // release; it is the number the review list first becomes interactive.
    const runStarted = performance.now();
    const sourceStarted = performance.now();
    let sourceMs = 0;
    let workerTimings: WorkerInferTimings | null = null;
    let releaseMs = 0;
    let releaseStatus: DiscoveryTimings['releaseStatus'] = 'unchanged';
    let releaseDetail = '';
    let resolvedGraphPath: string | null = null;
    let detectorReleased = false;
    try {
      const loader = await getModelLoaderReady();
      const graphPath = await loader.getModelPath(GROUNDING_DINO_MODEL_ID, controller.signal);
      resolvedGraphPath = graphPath;
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
      // Draw straight to the model resolution instead of reading the full
      // source into an ImageData copy and resampling in JS. The stretch is the
      // reference preprocessing (no aspect preservation), and the browser's
      // smoothing is closer to the reference antialiased resize than the
      // previous nearest-neighbour sample. A 24 MP photo now copies 2.6 MB
      // instead of ~96 MB before inference starts.
      const canvas = document.createElement('canvas');
      canvas.width = GROUNDING_DINO_INPUT_SIZE;
      canvas.height = GROUNDING_DINO_INPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable for discovery.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, GROUNDING_DINO_INPUT_SIZE, GROUNDING_DINO_INPUT_SIZE);
      const modelImage = ctx.getImageData(
        0,
        0,
        GROUNDING_DINO_INPUT_SIZE,
        GROUNDING_DINO_INPUT_SIZE,
      );
      if (controller.signal.aborted) return;

      const inputs = buildGroundingDinoInputsFromModelImage(modelImage, tokenization);
      sourceMs = performance.now() - sourceStarted;
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
          // Recorded on the cached session so release diagnostics can report
          // residency instead of equating cache removal with reclaimed memory.
          sessionPeakBytes: detectorPeakBytes,
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
            modelBytes: detectorPeakBytes,
          }),
        },
      );
      workerTimings = result.timings ?? null;
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

      // Materialize compact detections before releasing anything: the array
      // below owns source-space boxes and phrase associations and holds no
      // reference to the worker's output tensors.
      const cache = detectionCacheRef.current;
      cache.set(cacheKey, decoded);
      while (cache.size > 8) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      setDetections(decoded);
      setSelectedId(decoded[0]?.id ?? null);
      setReviewedDetectionId(null);

      // Detection is finished; release the detector before segmentation
      // admission so the segmenter is not loaded on top of a resident
      // 2.6 GB-scale graph. A failed release stays accounted and is re-reserved
      // by the host for the next heavy stage unless the idle worker was
      // recycled.
      const releaseStarted = performance.now();
      try {
        const report = await host.releaseModel('grounding-dino', graphPath);
        if (report.failed.length > 0) {
          releaseStatus = 'failed';
          releaseDetail = `Detector session release was not confirmed; about ${Math.round((report.possiblyResidentBytes || detectorPeakBytes) / 1_000_000)} MB stays reserved for the next step.`;
          if (host.recycleWorkerIfIdle()) {
            releaseStatus = 'recycled';
            releaseDetail =
              'Detector session release failed, so the idle inference worker was recycled to return its memory.';
          }
        } else if (report.inUse.length > 0) {
          releaseStatus = 'busy';
          releaseDetail =
            'The detector session is still finishing another request; it stays cached for now.';
        } else if (report.released.length > 0) {
          releaseStatus = 'released';
          releaseDetail = `Detector session released (about ${Math.round(detectorPeakBytes / 1_000_000)} MB working set; the runtime may retain allocator capacity).`;
        }
      } catch (releaseError) {
        releaseStatus = 'failed';
        releaseDetail = `Detector session release failed: ${
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        }`;
      }
      detectorReleased = releaseStatus !== 'failed';
      releaseMs = performance.now() - releaseStarted;
      const totalMs = performance.now() - runStarted;
      setTimings({
        sourceMs,
        sessionMs: workerTimings?.sessionMs ?? 0,
        preprocessMs: workerTimings?.preprocessMs ?? 0,
        inferMs: workerTimings?.inferMs ?? 0,
        postprocessMs: workerTimings?.postprocessMs ?? 0,
        releaseMs,
        totalMs,
        releaseStatus,
        releaseDetail,
      });
      setReleaseNote(releaseDetail || null);

      if (decoded.length === 0) {
        setState('empty');
        announce(
          `No region matched "${normalized.normalized}". Try looser matching or another description.`,
        );
        return;
      }
      setState('ready');
      announce(
        `Found ${decoded.length} matching region${decoded.length === 1 ? '' : 's'}. Review one, then segment it.`,
      );
    } catch (discoveryError) {
      const message =
        discoveryError instanceof Error ? discoveryError.message : String(discoveryError);
      const failure = classifyDiscoveryFailure({
        message,
        aborted: controller.signal.aborted,
        timedOut: timedOutRef.current,
        deadlineMinutes: Math.round(TEXT_DISCOVERY_SOFT_DEADLINE_MS / 60_000),
      });
      if (failure.kind === 'cancelled') return;
      setState(failure.kind === 'refused' ? 'refused' : 'error');
      setError(failure.message);
    } finally {
      window.clearTimeout(deadline);
      setStage(null);
      if (abortRef.current === controller) abortRef.current = null;
      // A terminal path must not leave the 2.6 GB-scale detector resident just
      // because the UI moved on, including a user cancellation: ORT has no
      // portable mid-graph cancel, so the graph may still be running and the
      // idle-only release reports it as in use instead of freeing it.
      if (!detectorReleased && resolvedGraphPath) {
        void getInferenceWorkerHost()
          .releaseModel('grounding-dino', resolvedGraphPath)
          .catch(() => undefined);
      }
    }
  }, [announce, source, query, threshold]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // Cancelling returns to the pre-run panel, not to the install prompt: the
    // detector model is already installed whenever the search form is visible.
    setError(null);
    setState('ready');
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
        <p
          className="insp-hint insp-hint--error"
          role="alert"
          data-testid={state === 'refused' ? 'text-discovery-refusal' : 'text-discovery-error'}
        >
          {error}
        </p>
      )}

      {state === 'empty' && !error && (
        <p className="insp-hint" role="status">
          No region matched this description. Try a looser setting or a different phrase.
        </p>
      )}

      {fromCache && detections.length > 0 && (
        <p className="insp-field__hint" role="status">
          Cached from this session — the detector did not run again.
        </p>
      )}

      {timings && (
        <p className="insp-field__hint" role="status" data-testid="text-discovery-timings">
          Last run:{' '}
          {timings.sessionMs === 0
            ? 'model load warm'
            : `model load ${(timings.sessionMs / 1000).toFixed(1)}s`}{' '}
          · image prep {(timings.sourceMs / 1000).toFixed(1)}s · tensor build{' '}
          {(timings.preprocessMs / 1000).toFixed(1)}s · detection{' '}
          {(timings.inferMs / 1000).toFixed(1)}s · release {(timings.releaseMs / 1000).toFixed(1)}s
          · total {(timings.totalMs / 1000).toFixed(1)}s
        </p>
      )}
      {releaseNote && (
        <p className="insp-field__hint" data-testid="text-discovery-release">
          {releaseNote}
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
                style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}
              >
                <input
                  type="radio"
                  name="text-discovery-region"
                  checked={detection.id === selectedId}
                  onChange={() => {
                    setSelectedId(detection.id);
                    setReviewedDetectionId(null);
                  }}
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
          {selected && (
            <>
              <div
                className="insp-text-discovery-preview"
                data-testid="text-discovery-selection-preview"
                role="img"
                aria-label={`Selected ${selected.phrase || 'region'} detection preview`}
              >
                <img src={source ?? undefined} alt="" />
                <span
                  className="insp-text-discovery-preview__box"
                  style={{
                    left: `${selected.normalizedBox.x1 * 100}%`,
                    top: `${selected.normalizedBox.y1 * 100}%`,
                    width: `${(selected.normalizedBox.x2 - selected.normalizedBox.x1) * 100}%`,
                    height: `${(selected.normalizedBox.y2 - selected.normalizedBox.y1) * 100}%`,
                  }}
                />
              </div>
              <p className="insp-field__hint">
                The outline is the exact region that will be sent as the segmentation hint. Verify
                it is on the object you mean; detector scores are not proof of object identity.
              </p>
              <label className="insp-check">
                <input
                  type="checkbox"
                  checked={reviewedDetectionId === selected.id}
                  onChange={(event) =>
                    setReviewedDetectionId(event.currentTarget.checked ? selected.id : null)
                  }
                  disabled={disabled}
                />
                I verified the highlighted region is the intended object
              </label>
            </>
          )}
          <div className="insp-actions">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!selected || disabled || reviewedDetectionId !== selected?.id}
              onClick={() => {
                if (!selected) return;
                // Keep the detector's normalized source geometry. The parent
                // maps it separately for the world-space canvas prompt and
                // passes this exact box to the model.
                onSegmentBox(selected.normalizedBox);
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
