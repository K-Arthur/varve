import type {
  AreaSelection,
  PromptedProviderFact,
  PromptedProviderPreference,
  PromptedSelectionExecutionProvider,
} from '@varve/engine';
import {
  assessImageInferenceResources,
  cachedImageDims,
  EFFICIENT_SAM_CAPABILITIES,
  EFFICIENT_SAM_DECODER_ID,
  EFFICIENT_SAM_ENCODER_ID,
  EFFICIENT_SAM_PROVIDER_ID,
  EFFICIENT_SAM_QUALITY_VALIDATION,
  EmbeddingCache,
  getImageCache,
  getInferenceWorkerHost,
  getModelById,
  getModelLoader,
  getNativeGenerativeModelStatus,
  getRuntimeCapabilitiesSync,
  MOBILE_SAM_CAPABILITIES,
  MOBILE_SAM_DECODER_ID,
  MOBILE_SAM_ENCODER_ID,
  MOBILE_SAM_PROVIDER_ID,
  MOBILE_SAM_QUALITY_VALIDATION,
  PROMPTED_PROVIDER_LATENCY_PROXY,
  routePromptedSelection,
  SAM2_CAPABILITIES,
  SAM2_DECODER_ID,
  SAM2_ENCODER_ID,
  SAM2_PROVIDER_ID,
  SAM2_QUALITY_VALIDATION,
} from '@varve/engine';
import { type Document, imageShapeSrc, type NodeId } from '@varve/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { commitRasterMask } from '../backgroundRemoval/commitRasterMask';
import type { CanvasAnnouncer } from '../canvas/CanvasAnnouncer';
import { setCollapsed } from '../components/Inspector/sectionState';
import { prepareImageMaskMapper } from '../tools/imageMaskCoordinates';
import { normalizeSam2Prompts } from '../tools/sam2PromptCoordinates';
import { areaSelectionFromMaskCoverage } from '../tools/selectionMask';
import { fingerprintImageData } from './imageFingerprint';
import {
  type ObjectSelectionSession,
  objectSelectionCandidateMaskFingerprint,
  objectSelectionCandidateReviewKey,
} from './objectSelectionTypes';
import {
  rankPromptedMaskCandidates,
  validatePromptedImageAnchors,
  validatePromptedMaskCandidate,
} from './promptedMaskValidation';
import {
  type PromptedEmbedding,
  type PromptedMaskCandidate,
  type PromptedWorkerTensor,
  runPromptedSegmentation,
} from './promptedSegmentationProvider';
import type { EditorState } from './types';

const SAM2_SOFT_DEADLINE_MS = 15_000;
const EMBEDDING_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const EMBEDDING_CACHE_MIN_BYTES = 16 * 1024 * 1024;
const MOBILE_SAM_FALLBACK_PEAK_BYTES = 1_200_000_000;
const EFFICIENT_SAM_FALLBACK_PEAK_BYTES = 760_000_000;

function promptedEncoderPeakBytes(encoderId: string): number {
  return (
    getModelById(encoderId)?.peakMemoryBytes ??
    (encoderId === MOBILE_SAM_ENCODER_ID
      ? MOBILE_SAM_FALLBACK_PEAK_BYTES
      : encoderId === EFFICIENT_SAM_ENCODER_ID
        ? EFFICIENT_SAM_FALLBACK_PEAK_BYTES
        : 600_000_000)
  );
}

/**
 * Keep embeddings proportional to the runtime's safe working budget. This is
 * a cache allowance, not a claim that the model fits; resource preflight still
 * decides whether a request may allocate its source and model buffers.
 */
function embeddingCacheBudgetBytes(): number {
  const safePeakBytes = getRuntimeCapabilitiesSync().wasmSafePeakBytes;
  if (!Number.isFinite(safePeakBytes) || safePeakBytes <= 0) {
    return 128 * 1024 * 1024;
  }
  return Math.min(
    EMBEDDING_CACHE_MAX_BYTES,
    Math.max(EMBEDDING_CACHE_MIN_BYTES, Math.floor(safePeakBytes * 0.15)),
  );
}

function promptedExecutionProvider(
  runtime: ReturnType<typeof getRuntimeCapabilitiesSync>,
): PromptedSelectionExecutionProvider {
  // A WebGPU-capable browser is not the same thing as a WebGPU-validated
  // graph. The currently pinned prompted artifacts are catalogued for WASM;
  // the inference worker also forces that provider for these model ids. Keep
  // the routing explanation truthful until a graph-specific WebGPU gate exists.
  void runtime;
  return 'wasm';
}

function promptedProviderFacts(
  mobileInstalled: boolean,
  sam2Installed: boolean,
  efficientSamInstalled = false,
): PromptedProviderFact[] {
  const mobileLatency = PROMPTED_PROVIDER_LATENCY_PROXY[MOBILE_SAM_PROVIDER_ID];
  const sam2Latency = PROMPTED_PROVIDER_LATENCY_PROXY[SAM2_PROVIDER_ID];
  const efficientSamLatency = PROMPTED_PROVIDER_LATENCY_PROXY[EFFICIENT_SAM_PROVIDER_ID];
  return [
    {
      id: MOBILE_SAM_PROVIDER_ID,
      label: 'Faster prompted selection',
      encoderId: MOBILE_SAM_ENCODER_ID,
      decoderId: MOBILE_SAM_DECODER_ID,
      installed: mobileInstalled,
      workingSetBytes: promptedEncoderPeakBytes(MOBILE_SAM_ENCODER_ID),
      warmPromptP50Ms: mobileLatency?.p50Ms,
      warmPromptP95Ms: mobileLatency?.p95Ms,
      warmPromptP95Source: mobileLatency?.source ?? 'estimated',
      // Real-photo browser validation found a recoverable but important
      // ambiguity: a boundary click can receive a high predicted-IoU score
      // for an expansive background patch. Keep MobileSAM explicit until a
      // broader browser-quality corpus proves that automatic promotion is safe.
      experimental: true,
      capabilities: MOBILE_SAM_CAPABILITIES,
      validation: MOBILE_SAM_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
    {
      id: SAM2_PROVIDER_ID,
      label: 'Higher-detail prompted selection',
      encoderId: SAM2_ENCODER_ID,
      decoderId: SAM2_DECODER_ID,
      installed: sam2Installed,
      workingSetBytes: getModelById(SAM2_ENCODER_ID)?.peakMemoryBytes ?? 700_000_000,
      warmPromptP50Ms: sam2Latency?.p50Ms,
      warmPromptP95Ms: sam2Latency?.p95Ms,
      warmPromptP95Source: sam2Latency?.source ?? 'estimated',
      capabilities: SAM2_CAPABILITIES,
      validation: SAM2_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
    {
      id: EFFICIENT_SAM_PROVIDER_ID,
      label: 'Lightweight experimental selection',
      encoderId: EFFICIENT_SAM_ENCODER_ID,
      decoderId: EFFICIENT_SAM_DECODER_ID,
      installed: efficientSamInstalled,
      workingSetBytes: promptedEncoderPeakBytes(EFFICIENT_SAM_ENCODER_ID),
      warmPromptP50Ms: efficientSamLatency?.p50Ms,
      warmPromptP95Ms: efficientSamLatency?.p95Ms,
      warmPromptP95Source: efficientSamLatency?.source ?? 'estimated',
      // The 2026-09-14 A/B measured quality equivalent to MobileSAM with a
      // larger peak working set and no mask-prompt input. It stays
      // explicit-only: automatic routing must never pick it, and selecting it
      // says so in the UI.
      experimental: true,
      capabilities: EFFICIENT_SAM_CAPABILITIES,
      validation: EFFICIENT_SAM_QUALITY_VALIDATION,
      supportedExecutionProviders: ['wasm'],
    },
  ];
}

function promptedRequiredCapabilities(prompts: {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
}): { pointPrompts: boolean; boxPrompts: boolean } {
  return {
    pointPrompts: (prompts.points?.length ?? 0) > 0,
    boxPrompts: prompts.box != null,
  };
}

function promptedEmbeddingCacheKey({
  documentId,
  nodeId,
  src,
  width,
  height,
  sourceFingerprint,
  providerId,
  encoderId,
  encoderArtifact,
  decoderId,
  decoderArtifact,
}: {
  documentId: string;
  nodeId: NodeId;
  src: string;
  width: number;
  height: number;
  sourceFingerprint: string;
  providerId: string;
  encoderId: string;
  encoderArtifact: string;
  decoderId: string;
  decoderArtifact: string;
}): string {
  return [
    documentId,
    nodeId,
    src,
    width,
    height,
    sourceFingerprint,
    providerId,
    encoderId,
    encoderArtifact,
    decoderId,
    decoderArtifact,
    providerId === MOBILE_SAM_PROVIDER_ID
      ? 'mobilesam-acly-v1'
      : providerId === EFFICIENT_SAM_PROVIDER_ID
        ? 'efficientsam-ti-yunyangx-v1'
        : 'sam2-v1',
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}

export interface Sam2SegmentationAPI {
  applySam2Segmentation: (params: {
    nodeId: NodeId;
    prompts: {
      points?: Array<{ x: number; y: number; label: 0 | 1 }>;
      box?: { x1: number; y1: number; x2: number; y2: number };
    };
    signal?: AbortSignal;
    operation: 'preview' | 'mask' | 'selection';
    candidateIndex?: number;
  }) => Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null>;
  cancelSam2Segmentation: () => void;
  selectSam2Candidate: (index: number) => void;
  /** Mark the currently selected model candidate as reviewed or unreviewed. */
  reviewSam2Candidate: (reviewed: boolean) => void;
  promptedProviderPreference: PromptedProviderPreference;
  setPromptedProviderPreference: (preference: PromptedProviderPreference) => void;
}

export function useSam2Segmentation(
  state: EditorState,
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  updateDoc: (fn: (doc: Document) => Document) => void,
  announcerRef: React.MutableRefObject<CanvasAnnouncer | null>,
  enabled = true,
  setAreaSelection?: (selection: AreaSelection | null) => void,
): Sam2SegmentationAPI {
  const abortRef = useRef<AbortController | null>(null);
  const softDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const embeddingCacheRef = useRef<EmbeddingCache<{
    nodeId: NodeId;
    src: string;
    providerId: string;
    embeddings: Record<string, PromptedWorkerTensor>;
    // The letterbox transform the encoder's *own* preprocessing applied to
    // this image (scale-to-fit + center + pad for non-square images).
    // Prompt encoding must reuse this exact transform — see sam2.ts — so
    // it's cached alongside the embeddings it was computed from, not
    // recomputed from the image dimensions independently.
    letterbox?: { offsetX: number; offsetY: number };
    naturalW: number;
    naturalH: number;
    sourceFingerprint: string;
  }> | null>(null);
  if (enabled && !embeddingCacheRef.current) {
    embeddingCacheRef.current = new EmbeddingCache<{
      nodeId: NodeId;
      src: string;
      providerId: string;
      embeddings: Record<string, PromptedWorkerTensor>;
      // The letterbox transform the encoder's *own* preprocessing applied to
      // this image (scale-to-fit + center + pad for non-square images).
      // Prompt encoding must reuse this exact transform — see sam2.ts — so
      // it's cached alongside the embeddings it was computed from, not
      // recomputed from the image dimensions independently.
      letterbox?: { offsetX: number; offsetY: number };
      naturalW: number;
      naturalH: number;
      sourceFingerprint: string;
    }>({
      maxEntries: 2,
      maxBytes: embeddingCacheBudgetBytes(),
      estimateBytes: (entry) =>
        Object.values(entry.embeddings).reduce(
          (total, tensor) => total + tensor.data.byteLength,
          0,
        ),
    });
  }
  const [promptedProviderPreference, setPromptedProviderPreferenceState] =
    useState<PromptedProviderPreference>('auto');

  const writeTransientSession = useCallback(
    (session: ObjectSelectionSession | null, extra: Partial<EditorState> = {}): void => {
      stateRef.current = {
        ...stateRef.current,
        ...extra,
        objectSelectionSession: session,
      };
      setState((prev) => ({ ...prev, ...extra, objectSelectionSession: session }));
    },
    [setState, stateRef],
  );

  const cancelSam2Segmentation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (softDeadlineRef.current !== null) {
      clearTimeout(softDeadlineRef.current);
      softDeadlineRef.current = null;
    }
    generationRef.current += 1;
    writeTransientSession(null, { maskPreviewMode: 'none' });
  }, [writeTransientSession]);

  const setPromptedProviderPreference = useCallback(
    (preference: PromptedProviderPreference) => {
      if (preference === promptedProviderPreference) return;
      const session = stateRef.current.objectSelectionSession;
      if (
        session &&
        (session.status === 'preparing' ||
          session.status === 'encoding' ||
          session.status === 'decoding')
      ) {
        cancelSam2Segmentation();
      }
      setPromptedProviderPreferenceState(preference);
    },
    [cancelSam2Segmentation, promptedProviderPreference, stateRef],
  );

  const selectSam2Candidate = useCallback(
    (index: number) => {
      const session = stateRef.current.objectSelectionSession;
      const candidate = session?.candidates[index];
      if (!session || !candidate) return;
      writeTransientSession({
        ...session,
        selectedCandidate: index,
        confidence: candidate.confidence,
        reviewedCandidateKey: undefined,
        reviewedCandidateAt: undefined,
      });
    },
    [stateRef, writeTransientSession],
  );

  const reviewSam2Candidate = useCallback(
    (reviewed: boolean) => {
      const session = stateRef.current.objectSelectionSession;
      if (session?.status !== 'ready') return;
      const candidateKey = objectSelectionCandidateReviewKey(session, session.selectedCandidate, {
        verifyMask: true,
      });
      if (reviewed && !candidateKey) {
        announcerRef.current?.announce(
          'This Object Selection preview is too old to review safely. Create a new preview first.',
        );
        return;
      }
      writeTransientSession({
        ...session,
        reviewedCandidateKey: reviewed ? (candidateKey ?? undefined) : undefined,
        reviewedCandidateAt: reviewed ? Date.now() : undefined,
      });
      announcerRef.current?.announce(
        reviewed ? 'Object Selection target reviewed' : 'Object Selection target review cleared',
      );
    },
    [announcerRef, stateRef, writeTransientSession],
  );

  useEffect(() => {
    const session = stateRef.current.objectSelectionSession;
    if (!session) return;
    const selected = state.selection;
    if (
      (session.documentId && session.documentId !== state.document.id) ||
      selected.length !== 1 ||
      selected[0] !== session.nodeId ||
      (session.sourceLocator &&
        currentNodeSource(state.document.nodes[session.nodeId]) !== session.sourceLocator)
    ) {
      cancelSam2Segmentation();
    }
  }, [cancelSam2Segmentation, state.document, state.document.id, state.selection, stateRef]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (softDeadlineRef.current !== null) {
        clearTimeout(softDeadlineRef.current);
        softDeadlineRef.current = null;
      }
      generationRef.current += 1;
    };
  }, []);

  const applySam2Segmentation = useCallback(
    async ({
      nodeId,
      prompts,
      signal: externalSignal,
      operation,
      candidateIndex,
    }: {
      nodeId: NodeId;
      prompts: {
        points?: Array<{ x: number; y: number; label: 0 | 1 }>;
        box?: { x1: number; y1: number; x2: number; y2: number };
      };
      signal?: AbortSignal;
      operation: 'preview' | 'mask' | 'selection';
      candidateIndex?: number;
    }): Promise<{ mask: Uint8Array; width: number; height: number; confidence: number } | null> => {
      if (!enabled) {
        announcerRef.current?.announce('Subject selection is available in the main editor window.');
        return null;
      }
      const generation = ++generationRef.current;
      const currentDoc = stateRef.current.document;
      const node = currentDoc.nodes[nodeId] as import('@varve/scene').ShapeNode | undefined;

      if (node?.kind !== 'shape') {
        announcerRef.current?.announce('Select a shape node first');
        return null;
      }

      const { isImageShape, imageShapeSrc } = await import('@varve/scene');
      if (!isImageShape(node)) {
        announcerRef.current?.announce('The selected node does not have an image fill');
        return null;
      }

      const src = imageShapeSrc(node);
      if (!src) {
        announcerRef.current?.announce('Could not determine image source');
        return null;
      }

      // Refuse a pixel-selection output before any model work when the editor
      // surface has no area-selection setter. Otherwise a full encode/decode
      // would run only to fail at the final conversion step.
      if (operation === 'selection' && !setAreaSelection) {
        announcerRef.current?.announce(
          'Pixel selection output is unavailable in this editor surface.',
        );
        return null;
      }

      const previousSession = stateRef.current.objectSelectionSession;
      const sameSessionTarget =
        previousSession?.nodeId === nodeId &&
        (!previousSession.documentId || previousSession.documentId === currentDoc.id) &&
        (!previousSession.sourceLocator || previousSession.sourceLocator === src);

      // Applying a visible candidate must be a commit, not a second model
      // run. This makes Apply/Enter and Use as selection deterministic and
      // keeps the exact mask the user inspected as the committed output.
      const isCommitOperation = operation === 'mask' || operation === 'selection';
      if (isCommitOperation && sameSessionTarget && previousSession?.status === 'ready') {
        // A ready session is a visible, user-reviewable candidate set. Never
        // fall through to a fresh inference for an Apply/Use action: doing so
        // could commit a different mask than the one the user inspected, or
        // bypass review entirely when the preview metadata is incomplete.
        if (
          !previousSession.sourceFingerprint ||
          previousSession.width <= 0 ||
          previousSession.height <= 0
        ) {
          announcerRef.current?.announce(
            'This Object Selection preview is incomplete. Create a new preview before applying it.',
          );
          return null;
        }
        const selectedCandidate = candidateIndex ?? previousSession.selectedCandidate;
        const candidate = previousSession.candidates[selectedCandidate];
        if (!candidate) {
          announcerRef.current?.announce(
            'The selected Object Selection candidate is unavailable. Create a new preview before applying it.',
          );
          return null;
        }
        const requiredReviewKey = objectSelectionCandidateReviewKey(
          previousSession,
          selectedCandidate,
          { verifyMask: true },
        );
        if (!requiredReviewKey) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'candidate_changed',
                message:
                  'The reviewed Object Selection candidate changed after it was inspected. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          const message =
            'The reviewed Object Selection candidate is invalid. Create a new preview before applying it.';
          announcerRef.current?.announce(message);
          return null;
        }
        if (!previousSession.reviewedCandidateKey) {
          announcerRef.current?.announce(
            'Review the highlighted Object Selection target before applying it. Choose the candidate you want, inspect the overlay, then confirm the review.',
          );
          return null;
        }
        if (previousSession.reviewedCandidateKey !== requiredReviewKey) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'candidate_changed',
                message:
                  'The reviewed Object Selection candidate changed after it was inspected. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The reviewed Object Selection candidate changed after it was inspected. Create a new preview before applying it.',
          );
          return null;
        }
        const freshSource = await readImageSourceIdentity(src);
        if (generation !== generationRef.current || externalSignal?.aborted) return null;
        if (!isCurrentSelectionTarget(stateRef, currentDoc.id, nodeId, node)) {
          const live = stateRef.current;
          const sameSelectedNodeSlot =
            live.document.id === currentDoc.id &&
            live.selection.length === 1 &&
            live.selection[0] === nodeId &&
            live.document.nodes[nodeId] !== node;
          if (sameSelectedNodeSlot && live.objectSelectionSession?.nodeId === nodeId) {
            writeTransientSession({
              ...live.objectSelectionSession,
              status: 'error',
              error: {
                code: 'mapping_changed',
                message:
                  'The image placement changed after the preview. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The selected image changed after the preview. Create a new preview before applying it.',
          );
          return null;
        }
        if (
          !freshSource ||
          freshSource.width !== previousSession.width ||
          freshSource.height !== previousSession.height ||
          freshSource.fingerprint !== previousSession.sourceFingerprint
        ) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              width: 0,
              height: 0,
              candidates: [],
              status: 'error',
              error: {
                code: 'source_changed',
                message:
                  'The image changed after the preview. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The image changed after the preview. Create a new preview before applying it.',
          );
          return null;
        }
        const currentMapper = prepareImageMaskMapper({
          document: stateRef.current.document,
          node,
          sourceWidth: previousSession.width,
          sourceHeight: previousSession.height,
        });
        if (
          !previousSession.mappingFingerprint ||
          !currentMapper ||
          currentMapper.fingerprint !== previousSession.mappingFingerprint
        ) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'mapping_changed',
                message:
                  'The image placement changed after the preview. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The image placement changed after the preview. Create a new preview before applying it.',
          );
          return null;
        }
        const reviewedPrompts = normalizeSam2Prompts(
          {
            points: previousSession.points,
            box: previousSession.box ?? undefined,
          },
          currentMapper,
          previousSession.width,
          previousSession.height,
        );
        if (reviewedPrompts.unmappedPointCount > 0 || reviewedPrompts.unmappedBoxCornerCount > 0) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'prompt_out_of_bounds',
                message:
                  'The reviewed prompt geometry is no longer inside the image. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The reviewed prompt geometry is no longer inside the image. Create a new preview before applying it.',
          );
          return null;
        }
        if (!maskMatchesDimensions(candidate.mask, previousSession.width, previousSession.height)) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'invalid_mask_geometry',
                message:
                  'The reviewed mask no longer matches the image dimensions. Create a new preview before applying it.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The reviewed mask no longer matches the image dimensions. Create a new preview before applying it.',
          );
          return null;
        }
        if (countMaskCoverage(candidate.mask) === 0) {
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'empty_result',
                message:
                  'The reviewed candidate contains no pixels. Adjust or remove prompts and create a new preview.',
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(
            'The reviewed candidate contains no pixels. Adjust the prompts and try again.',
          );
          return null;
        }
        const reviewedCandidateValidation = validatePromptedMaskCandidate(
          {
            mask: candidate.mask,
            width: previousSession.width,
            height: previousSession.height,
            score: candidate.confidence,
          },
          {
            points: reviewedPrompts.points,
            box: reviewedPrompts.box,
          },
          previousSession.width,
          previousSession.height,
        );
        if (!reviewedCandidateValidation.valid) {
          const live = stateRef.current.objectSelectionSession;
          const message =
            reviewedCandidateValidation.reason === 'positive-anchor-required'
              ? 'Add an include point or a box before applying this selection; exclude points only refine an identified object.'
              : reviewedCandidateValidation.reason === 'ambiguous-unanchored-region'
                ? 'This candidate contains disconnected coverage that is not anchored to the target. Add an include point on the intended object or exclude the extra region before applying it.'
                : 'This candidate does not honor the reviewed prompts. Create a new preview before applying it.';
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'prompt_not_honored',
                message,
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(message);
          return null;
        }
        if (reviewedCandidateValidation.diagnostics?.requiresRefinement) {
          const message =
            reviewedCandidateValidation.diagnostics.warnings.find(
              (warning) =>
                warning.includes('extent prompt') || warning.includes('candidate boundary'),
            ) ??
            'Refine the highlighted Object Selection extent with another include point or a box before applying it.';
          const live = stateRef.current.objectSelectionSession;
          if (generation === generationRef.current && live?.nodeId === nodeId) {
            writeTransientSession({
              ...live,
              status: 'error',
              error: {
                code: 'prompt_needs_refinement',
                message,
                retryable: true,
              },
            });
          }
          announcerRef.current?.announce(message);
          return null;
        }
        const normalizedReviewedCandidate = rankPromptedMaskCandidates(
          [
            {
              mask: candidate.mask,
              width: previousSession.width,
              height: previousSession.height,
              score: candidate.confidence,
            },
          ],
          {
            points: reviewedPrompts.points,
            box: reviewedPrompts.box,
          },
          previousSession.width,
          previousSession.height,
        ).candidates[0];
        if (!normalizedReviewedCandidate) {
          announcerRef.current?.announce(
            'The reviewed candidate is no longer a focused match for the prompts. Create a new preview before applying it.',
          );
          return null;
        }
        const candidateToCommit =
          normalizedReviewedCandidate.mask === candidate.mask
            ? candidate
            : { ...candidate, mask: normalizedReviewedCandidate.mask };
        abortRef.current?.abort();
        abortRef.current = null;
        generationRef.current += 1;
        if (softDeadlineRef.current !== null) {
          clearTimeout(softDeadlineRef.current);
          softDeadlineRef.current = null;
        }

        if (operation === 'selection') {
          const areaSelection = areaSelectionFromMaskCoverage(
            currentDoc,
            nodeId,
            candidateToCommit.mask,
            previousSession.width,
            previousSession.height,
            'source-image-pixels',
          );
          if (!areaSelection || !setAreaSelection) {
            announcerRef.current?.announce(
              'The subject mask could not be converted into a pixel selection.',
            );
            return null;
          }
          setAreaSelection(areaSelection);
          writeTransientSession(null, { maskPreviewMode: 'none' });
          announcerRef.current?.announce(
            `Selected subject (${formatSelectionScore(candidateToCommit.confidence, candidateToCommit.scoreSource ?? previousSession.confidenceSource)})`,
          );
          return {
            mask: candidateToCommit.mask,
            width: previousSession.width,
            height: previousSession.height,
            confidence: candidateToCommit.confidence,
          };
        }

        const maskDataUrl = await maskToDataUrl(
          candidateToCommit.mask,
          previousSession.width,
          previousSession.height,
        );
        if (!isCurrentSelectionTarget(stateRef, currentDoc.id, nodeId, node)) {
          announcerRef.current?.announce(
            'The selected image changed after the preview. Create a new preview before applying it.',
          );
          return null;
        }
        let committed = false;
        updateDoc((doc) => {
          const liveNode = doc.nodes[nodeId];
          if (doc.id !== currentDoc.id || liveNode !== node) return doc;
          const updated = commitRasterMask(doc, nodeId, {
            dataUrl: maskDataUrl,
            width: previousSession.width,
            height: previousSession.height,
            method: 'ai-quality',
            modelId: previousSession.modelId || 'sam2-hiera-tiny',
            score: candidateToCommit.confidence,
            scoreSource: candidateToCommit.scoreSource ?? previousSession.confidenceSource,
            generatedAt: Date.now(),
            sourceLocator: src,
          });
          committed = updated !== doc;
          return updated;
        });
        if (committed) {
          // The committed confidence and method are rendered in the
          // Background Removal disclosure. Reveal it when Object Selection
          // applies a mask so the result is immediately reviewable from
          // every entry point (toolbar, inspector, or keyboard).
          writeTransientSession(null, {
            maskPreviewMode: 'none',
            sectionVisibility: setCollapsed(
              stateRef.current.sectionVisibility,
              'background-removal',
              false,
            ),
          });
          announcerRef.current?.announce(
            `Selection applied as a mask (${formatSelectionScore(candidateToCommit.confidence, candidateToCommit.scoreSource ?? previousSession.confidenceSource)})`,
          );
          return {
            mask: candidateToCommit.mask,
            width: previousSession.width,
            height: previousSession.height,
            confidence: candidateToCommit.confidence,
          };
        }
        return null;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const combinedSignal = externalSignal
        ? combineAbortSignals(controller.signal, externalSignal)
        : controller.signal;

      if (combinedSignal.aborted) {
        announcerRef.current?.announce('Segmentation cancelled');
        return null;
      }

      const promptSession: ObjectSelectionSession = {
        ...(sameSessionTarget ? previousSession : null),
        nodeId,
        documentId: currentDoc.id,
        candidateSetId: `${currentDoc.id}:${nodeId}:${generation}`,
        width: 0,
        height: 0,
        candidates: [],
        rejectedCandidateCount: undefined,
        selectedCandidate: sameSessionTarget ? (previousSession?.selectedCandidate ?? 0) : 0,
        points: prompts.points ?? [],
        box: prompts.box ?? null,
        draftPoint: null,
        draftBox: null,
        confidence: sameSessionTarget ? (previousSession?.confidence ?? 0) : 0,
        status: 'preparing',
        modelId: sameSessionTarget
          ? (previousSession?.modelId ?? 'sam2-hiera-tiny')
          : 'sam2-hiera-tiny',
        sourceLocator: src,
        sourceFingerprint: undefined,
        startedAt: Date.now(),
        slow: false,
        stageTimingsMs: {},
        error: undefined,
      };
      const markFailure = (failure: {
        code: string;
        message: string;
        retryable: boolean;
      }): void => {
        // A superseded request may fail after a newer prompt has already
        // published its own session. Never turn that newer session into an
        // error or announce a stale failure.
        if (generation !== generationRef.current) return;
        if (softDeadlineRef.current !== null) {
          clearTimeout(softDeadlineRef.current);
          softDeadlineRef.current = null;
        }
        const live = stateRef.current.objectSelectionSession;
        if (live?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
          writeTransientSession({ ...live, status: 'error', error: failure });
        }
        announcerRef.current?.announce(failure.message);
      };
      writeTransientSession(promptSession, { maskPreviewMode: 'overlay' });
      announcerRef.current?.announce('Preparing object selection…');
      softDeadlineRef.current = setTimeout(() => {
        const live = stateRef.current.objectSelectionSession;
        if (
          live?.nodeId === nodeId &&
          stateRef.current.document.id === currentDoc.id &&
          live.status !== 'ready' &&
          live.status !== 'error'
        ) {
          writeTransientSession({ ...live, slow: true });
          announcerRef.current?.announce('Object selection is taking longer than expected.');
        }
      }, SAM2_SOFT_DEADLINE_MS);

      let img: HTMLImageElement | ImageBitmap | null = null;
      try {
        // A locator is not a content identity. Evict it before reading so a
        // document asset replaced behind the same handle cannot be hashed or
        // embedded from stale decoded pixels.
        getImageCache().evict(src);
        img = await getImageCache().load(src);
      } catch {
        markFailure({
          code: 'image_load_failed',
          message:
            'Could not load the image pixels. Check the file or its permissions and try again.',
          retryable: true,
        });
        return null;
      }

      if (!img) {
        markFailure({
          code: 'image_load_failed',
          message:
            'Could not load the image pixels. Check the file or its permissions and try again.',
          retryable: true,
        });
        return null;
      }

      if (combinedSignal.aborted) return null;

      const naturalW =
        typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
          ? img.naturalWidth || img.width
          : img.width;
      const naturalH =
        typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement
          ? img.naturalHeight || img.height
          : img.height;

      if (
        !Number.isSafeInteger(naturalW) ||
        !Number.isSafeInteger(naturalH) ||
        naturalW <= 0 ||
        naturalH <= 0
      ) {
        markFailure({
          code: 'image_pixels_unavailable',
          message: 'The image has invalid dimensions and cannot be used for object selection.',
          retryable: true,
        });
        return null;
      }

      // Validate the user's geometry against the canonical image-placement
      // inverse before model lookup, memory probing, or a full-resolution
      // source allocation. A pointer outside the visible image is an input
      // error, not a reason to spend device resources and then fail late.
      const imageMapper = prepareImageMaskMapper({
        document: currentDoc,
        node,
        sourceWidth: naturalW,
        sourceHeight: naturalH,
      });
      if (!imageMapper) {
        markFailure({
          code: 'placement_invalid',
          message:
            'The image placement is not valid for object selection. Reset the image bounds and try again.',
          retryable: true,
        });
        return null;
      }
      const normPrompts = normalizeSam2Prompts(prompts, imageMapper, naturalW, naturalH);
      if (normPrompts.unmappedPointCount > 0 || normPrompts.unmappedBoxCornerCount > 0) {
        const unmappedParts = [
          normPrompts.unmappedPointCount > 0
            ? `${normPrompts.unmappedPointCount} point${normPrompts.unmappedPointCount === 1 ? '' : 's'}`
            : null,
          normPrompts.unmappedBoxCornerCount > 0
            ? `${normPrompts.unmappedBoxCornerCount} box corner${normPrompts.unmappedBoxCornerCount === 1 ? '' : 's'}`
            : null,
        ].filter((part): part is string => part !== null);
        markFailure({
          code: 'prompt_out_of_bounds',
          message: `Object Selection could not map ${unmappedParts.join(' and ')} to visible image pixels. Place every prompt inside the image and try again.`,
          retryable: true,
        });
        return null;
      }
      if (
        !normPrompts.points?.length &&
        (!normPrompts.box ||
          normPrompts.box.x2 <= normPrompts.box.x1 ||
          normPrompts.box.y2 <= normPrompts.box.y1)
      ) {
        markFailure({
          code: 'invalid_prompt_geometry',
          message: 'Object Selection needs a point or a box with positive area.',
          retryable: true,
        });
        return null;
      }
      if (!normPrompts.box && !(normPrompts.points ?? []).some((point) => point.label === 1)) {
        markFailure({
          code: 'positive_prompt_required',
          message:
            'Add an include point or a box before running Object Selection; exclude points only refine an identified object.',
          retryable: true,
        });
        return null;
      }

      const loader = getModelLoader();
      const modelIds = [
        MOBILE_SAM_ENCODER_ID,
        MOBILE_SAM_DECODER_ID,
        SAM2_ENCODER_ID,
        SAM2_DECODER_ID,
        EFFICIENT_SAM_ENCODER_ID,
        EFFICIENT_SAM_DECODER_ID,
      ] as const;
      let paths: Array<string | null>;
      try {
        paths = await Promise.all(
          modelIds.map((modelId) => loader.getModelPath(modelId, combinedSignal)),
        );
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (isCancellationError(raw)) return null;
        markFailure(mapSegmentationFailure(raw));
        return null;
      }

      const mobileInstalled = Boolean(paths[0] && paths[1]);
      const sam2Installed = Boolean(paths[2] && paths[3]);
      const efficientSamInstalled = Boolean(paths[4] && paths[5]);
      const runtime = getRuntimeCapabilitiesSync();
      let safePeakBytes = runtime.wasmSafePeakBytes;
      if (runtime.isTauri) {
        // Tauri WebViews commonly omit navigator.deviceMemory. Reuse the
        // desktop process' cgroup/OS snapshot when it is available so a
        // capable ARM or x86 desktop is not mistaken for a 2 GB browser.
        const nativeResources = await getNativeGenerativeModelStatus();
        if (
          nativeResources.memoryAvailableBytes != null &&
          nativeResources.memoryAvailableBytes > 0
        ) {
          safePeakBytes = nativeResources.memoryAvailableBytes;
        }
      }
      const executionProvider = promptedExecutionProvider(runtime);
      const providers = promptedProviderFacts(
        mobileInstalled,
        sam2Installed,
        efficientSamInstalled,
      );
      const embeddingCache = embeddingCacheRef.current;
      if (!embeddingCache) return null;
      // Route once from dimensions before allocating a full-resolution source
      // buffer. The cache-aware route is resolved below, after the decoded
      // source fingerprint exists; this keeps the memory gate ahead of the
      // largest allocation while still allowing a warm provider to win.
      let decision = routePromptedSelection({
        preference: 'auto',
        preferredProviderId: promptedProviderPreference,
        allowExperimentalProvider: promptedProviderPreference !== 'auto',
        sourceWidth: naturalW,
        sourceHeight: naturalH,
        executionProvider,
        safeWorkingSetBytes: safePeakBytes,
        requiredCapabilities: promptedRequiredCapabilities(prompts),
        providers,
      });
      if (!decision.providerId || !decision.encoderId || !decision.decoderId) {
        const liveSession = stateRef.current.objectSelectionSession;
        if (liveSession?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
          writeTransientSession({
            ...liveSession,
            routingReason: decision.reason,
            routingRejections: decision.rejected,
          });
        }
        markFailure(mapPromptedRoutingFailure(decision));
        return null;
      }
      let providerId: string = decision.providerId;
      let encoderId: string = decision.encoderId;
      let decoderId: string = decision.decoderId;
      let encoderIndex = modelIds.indexOf(encoderId as (typeof modelIds)[number]);
      let decoderIndex = modelIds.indexOf(decoderId as (typeof modelIds)[number]);
      let resolvedEncoderPath = paths[encoderIndex] ?? null;
      let resolvedDecoderPath = paths[decoderIndex] ?? null;
      if (!resolvedEncoderPath || !resolvedDecoderPath) {
        markFailure({
          code: 'model_not_installed',
          message:
            'Prompted object selection needs an optional local model. Download it from this panel, then try again.',
          retryable: true,
        });
        return null;
      }
      const liveSession = stateRef.current.objectSelectionSession;
      if (liveSession?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
        writeTransientSession({
          ...liveSession,
          modelId: providerId,
          routingReason: decision.reason,
          routingRejections: decision.rejected,
        });
      }
      const encoderPeakBytes = promptedEncoderPeakBytes(encoderId);
      let resourceAssessment = assessImageInferenceResources({
        width: naturalW,
        height: naturalH,
        modelPeakBytes: encoderPeakBytes,
        runtime: { wasmSafePeakBytes: safePeakBytes },
        operation: 'Object Selection',
      });
      if (combinedSignal.aborted) return null;
      if (!resourceAssessment.allowed) {
        markFailure({
          code: 'out_of_memory',
          message:
            resourceAssessment.reason ?? 'Object Selection needs more memory on this device.',
          retryable: false,
        });
        return null;
      }

      // Do not allocate a full-resolution canvas or ImageData until the
      // model-plus-source working set has passed the runtime's safe budget.
      writeCurrentSam2Stage(stateRef, setState, nodeId, 'encoding');

      let imageData: ImageData;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = naturalW;
        canvas.height = naturalH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.drawImage(img, 0, 0, naturalW, naturalH);
        imageData = ctx.getImageData(0, 0, naturalW, naturalH);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const allocationFailure = /memory|allocation|too large|invalid state/i.test(raw);
        markFailure({
          code: allocationFailure ? 'out_of_memory' : 'image_pixels_unavailable',
          message: allocationFailure
            ? 'Object Selection could not allocate a safe working buffer for this image. Use the brush or Fast cutout path, or work on a smaller image.'
            : 'The image pixels could not be read. Check the file permissions and try again.',
          retryable: true,
        });
        return null;
      }

      if (combinedSignal.aborted) return null;

      const sourceFingerprint = await fingerprintImageData(imageData);
      if (combinedSignal.aborted) return null;

      const providerCacheKey = (provider: PromptedProviderFact): string => {
        const providerEncoderIndex = modelIds.indexOf(
          provider.encoderId as (typeof modelIds)[number],
        );
        const providerDecoderIndex = modelIds.indexOf(
          provider.decoderId as (typeof modelIds)[number],
        );
        return `${promptedEmbeddingCacheKey({
          documentId: currentDoc.id,
          nodeId,
          src,
          width: naturalW,
          height: naturalH,
          sourceFingerprint,
          providerId: provider.id,
          encoderId: provider.encoderId,
          encoderArtifact: getModelById(provider.encoderId)?.checksum || provider.encoderId,
          decoderId: provider.decoderId,
          decoderArtifact: getModelById(provider.decoderId)?.checksum || provider.decoderId,
        })}|${paths[providerEncoderIndex] ?? ''}|${paths[providerDecoderIndex] ?? ''}`;
      };
      const cachedEmbeddingProvider = providers.find((provider) =>
        embeddingCache.get(providerCacheKey(provider)),
      )?.id;
      if (cachedEmbeddingProvider && cachedEmbeddingProvider !== providerId) {
        const warmDecision = routePromptedSelection({
          preference: 'auto',
          preferredProviderId: promptedProviderPreference,
          allowExperimentalProvider: promptedProviderPreference !== 'auto',
          sourceWidth: naturalW,
          sourceHeight: naturalH,
          executionProvider,
          safeWorkingSetBytes: safePeakBytes,
          cachedEmbeddingProvider,
          requiredCapabilities: promptedRequiredCapabilities(prompts),
          providers,
        });
        if (warmDecision.providerId && warmDecision.encoderId && warmDecision.decoderId) {
          decision = warmDecision;
          providerId = warmDecision.providerId;
          encoderId = warmDecision.encoderId;
          decoderId = warmDecision.decoderId;
          encoderIndex = modelIds.indexOf(encoderId as (typeof modelIds)[number]);
          decoderIndex = modelIds.indexOf(decoderId as (typeof modelIds)[number]);
          resolvedEncoderPath = paths[encoderIndex] ?? null;
          resolvedDecoderPath = paths[decoderIndex] ?? null;
          const warmResourceAssessment = assessImageInferenceResources({
            width: naturalW,
            height: naturalH,
            modelPeakBytes: promptedEncoderPeakBytes(encoderId),
            runtime: { wasmSafePeakBytes: safePeakBytes },
            operation: 'Object Selection',
          });
          if (!warmResourceAssessment.allowed) {
            markFailure({
              code: 'out_of_memory',
              message:
                warmResourceAssessment.reason ??
                'Object Selection needs more memory on this device.',
              retryable: false,
            });
            return null;
          }
          resourceAssessment = warmResourceAssessment;
          const live = stateRef.current.objectSelectionSession;
          if (live?.nodeId === nodeId && stateRef.current.document.id === currentDoc.id) {
            writeTransientSession({
              ...live,
              modelId: providerId,
              routingReason: decision.reason,
              routingRejections: decision.rejected,
            });
          }
        }
      }

      // A warm-provider reroute can change the model ids and paths. Recheck
      // the resolved handles after that branch so a partial installation can
      // never reach the worker with a nullable path.
      if (!resolvedEncoderPath || !resolvedDecoderPath) {
        markFailure({
          code: 'model_not_installed',
          message:
            'Prompted object selection needs an optional local model. Download it from this panel, then try again.',
          retryable: true,
        });
        return null;
      }

      const imageAnchors = validatePromptedImageAnchors(imageData, normPrompts.points);
      if (!imageAnchors.valid) {
        markFailure({
          code: 'prompt_on_transparent',
          message:
            'The include point is on a fully transparent part of the image. Place it on the visible object or use a box hint, then try again.',
          retryable: true,
        });
        return null;
      }
      try {
        const host = getInferenceWorkerHost();
        const encoderArtifact = getModelById(encoderId)?.checksum || resolvedEncoderPath;
        const decoderArtifact = getModelById(decoderId)?.checksum || resolvedDecoderPath;
        const cacheKey = `${promptedEmbeddingCacheKey({
          documentId: currentDoc.id,
          nodeId,
          src,
          width: naturalW,
          height: naturalH,
          sourceFingerprint,
          providerId,
          encoderId,
          encoderArtifact,
          decoderId,
          decoderArtifact,
        })}|${resolvedEncoderPath}|${resolvedDecoderPath}`;
        const cached = embeddingCache.get(cacheKey);
        const cachedEmbedding: PromptedEmbedding | undefined = cached
          ? {
              providerId: cached.providerId,
              tensors: cached.embeddings,
              letterbox: cached.letterbox,
            }
          : undefined;

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const liveNode = stateRef.current.document.nodes[nodeId];
        if (
          stateRef.current.document.id !== currentDoc.id ||
          stateRef.current.selection.length !== 1 ||
          stateRef.current.selection[0] !== nodeId ||
          liveNode !== node
        ) {
          return null;
        }

        writeCurrentSam2Stage(stateRef, setState, nodeId, 'decoding');
        const prediction = await runPromptedSegmentation({
          host,
          decision,
          encoderPath: resolvedEncoderPath,
          decoderPath: resolvedDecoderPath,
          imageData,
          sourceWidth: naturalW,
          sourceHeight: naturalH,
          points: normPrompts.points,
          box: normPrompts.box,
          embedding: cachedEmbedding,
          signal: combinedSignal,
          reservationBytes: resourceAssessment.estimatedPeakBytes,
        });
        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        // A long encoder/decoder run can outlive a source replacement or an
        // image transform change. Do not publish a preview for a mapping that
        // no longer describes the live node, even though the request itself
        // was not explicitly cancelled yet.
        const liveDocument = stateRef.current.document;
        const liveNodeAfterInference = liveDocument.nodes[nodeId];
        const liveMapperAfterInference =
          liveNodeAfterInference?.kind === 'shape'
            ? prepareImageMaskMapper({
                document: liveDocument,
                node: liveNodeAfterInference,
                sourceWidth: naturalW,
                sourceHeight: naturalH,
              })
            : null;
        if (
          liveDocument.id !== currentDoc.id ||
          !liveMapperAfterInference ||
          liveMapperAfterInference.fingerprint !== imageMapper.fingerprint
        ) {
          markFailure({
            code: 'mapping_changed',
            message:
              'The image placement changed while processing. Create a new preview and try again.',
            retryable: true,
          });
          return null;
        }
        const freshSourceAfterInference = await readImageSourceIdentity(src);
        if (
          generation !== generationRef.current ||
          combinedSignal.aborted ||
          !freshSourceAfterInference ||
          freshSourceAfterInference.width !== naturalW ||
          freshSourceAfterInference.height !== naturalH ||
          freshSourceAfterInference.fingerprint !== sourceFingerprint
        ) {
          markFailure({
            code: 'source_changed',
            message: 'The image changed while processing. Create a new preview and try again.',
            retryable: true,
          });
          return null;
        }
        if (!cachedEmbedding) {
          embeddingCache.set(cacheKey, {
            nodeId,
            src,
            providerId,
            embeddings: prediction.embedding.tensors,
            letterbox: prediction.embedding.letterbox,
            naturalW,
            naturalH,
            sourceFingerprint,
          });
        }

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const ranked = rankPromptedMaskCandidates(
          prediction.candidates,
          { points: normPrompts.points, box: normPrompts.box },
          naturalW,
          naturalH,
        );
        if (ranked.selectedIndex < 0) {
          markFailure({
            code: 'prompt_not_honored',
            message:
              'No candidate produced a focused mask that honors the prompts. Add an include point on the target and exclude any extra object or region, then try again.',
            retryable: true,
          });
          return null;
        }
        const decoded = {
          masks: ranked.candidates.map(
            (
              candidate: PromptedMaskCandidate & {
                promptContainment: number;
                promptDiagnostics?: import('./promptedMaskValidation').PromptedMaskDiagnostics;
              },
            ) => ({
              mask: candidate.mask,
              width: candidate.width,
              height: candidate.height,
              iouScore: candidate.score,
              scoreSource: candidate.scoreSource,
              promptContainment: candidate.promptContainment,
              promptDiagnostics: candidate.promptDiagnostics,
              confidenceSource:
                candidate.scoreSource === 'predicted-iou'
                  ? ('predicted-iou' as const)
                  : ('heuristic' as const),
            }),
          ),
          selectedIndex: ranked.selectedIndex,
          confidence: ranked.selectedScore,
          confidenceSource: prediction.scoreSource,
        };

        // Hash each source-resolution candidate once at publication time.
        // Review-key checks run during ordinary React renders, so re-scanning
        // a large photograph there would make the safety guard itself block
        // the editor. Production candidates are immutable after this point;
        // legacy/test sessions without this metadata use the exact fallback
        // in objectSelectionCandidateReviewKey.
        const publishedCandidates = decoded.masks.map((candidate) => ({
          mask: candidate.mask,
          confidence: candidate.iouScore,
          scoreSource: candidate.scoreSource,
          promptContainment: candidate.promptContainment,
          promptDiagnostics: candidate.promptDiagnostics,
        }));
        const candidateFingerprintSession = {
          width: naturalW,
          height: naturalH,
          candidates: publishedCandidates,
        };
        const publishedCandidatesWithIdentity = publishedCandidates.map((candidate, index) => ({
          ...candidate,
          maskFingerprint:
            objectSelectionCandidateMaskFingerprint(candidateFingerprintSession, index) ??
            undefined,
        }));

        if (generation !== generationRef.current || combinedSignal.aborted) return null;

        const selectedCandidate = Math.max(
          0,
          Math.min(decoded.masks.length - 1, candidateIndex ?? decoded.selectedIndex),
        );
        const bestMask = decoded.masks[selectedCandidate]!;
        const hasPromptConstraints =
          (normPrompts.points?.length ?? 0) > 0 || normPrompts.box !== undefined;
        if (hasPromptConstraints && bestMask.promptContainment !== 1) {
          markFailure({
            code: 'prompt_not_honored',
            message:
              'The selected candidate did not produce a focused mask for the supplied prompts. Add an include point on the target and exclude any extra region before creating a new preview.',
            retryable: true,
          });
          return null;
        }
        const selectedConfidence = bestMask.iouScore;
        const maskResult = {
          mask: bestMask.mask,
          width: naturalW,
          height: naturalH,
          confidence: selectedConfidence,
        };
        const coveragePixels = countMaskCoverage(bestMask.mask);

        switch (operation) {
          case 'preview':
            writeTransientSession(
              {
                ...promptSession,
                nodeId,
                width: naturalW,
                height: naturalH,
                candidates: publishedCandidatesWithIdentity,
                rejectedCandidateCount: ranked.rejectedCount,
                selectedCandidate,
                reviewedCandidateKey: undefined,
                reviewedCandidateAt: undefined,
                points: prompts.points ?? [],
                box: prompts.box ?? null,
                draftPoint: null,
                draftBox: null,
                confidence: selectedConfidence,
                confidenceSource: decoded.confidenceSource,
                status: 'ready' as const,
                modelId: providerId,
                executionProvider: prediction.executionProvider,
                routingReason: decision.reason,
                routingRejections: decision.rejected,
                sourceLocator: src,
                sourceFingerprint,
                mappingFingerprint: imageMapper.fingerprint,
                startedAt: promptSession.startedAt,
                slow: false,
                stageTimingsMs: {
                  ...promptSession.stageTimingsMs,
                  ready: promptSession.startedAt ? Date.now() - promptSession.startedAt : undefined,
                },
                error: undefined,
              },
              { maskPreviewMode: 'overlay' },
            );
            announcerRef.current?.announce(
              coveragePixels === 0
                ? `No pixels were selected for these prompts (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)}). Adjust the prompts and try again.`
                : `Subject preview ready (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)}). Press Enter to apply as a mask, Escape to cancel.`,
            );
            return maskResult;

          case 'mask': {
            if (coveragePixels === 0) {
              markFailure({
                code: 'empty_result',
                message:
                  'The model did not find any pixels for these prompts. Adjust the prompts and create a new preview.',
                retryable: true,
              });
              return null;
            }
            const liveBeforeCommit = stateRef.current.document.nodes[nodeId];
            if (
              stateRef.current.document.id !== currentDoc.id ||
              stateRef.current.selection.length !== 1 ||
              stateRef.current.selection[0] !== nodeId ||
              liveBeforeCommit !== node
            ) {
              return null;
            }
            const freshSource = await readImageSourceIdentity(src);
            if (
              !freshSource ||
              freshSource.width !== naturalW ||
              freshSource.height !== naturalH ||
              freshSource.fingerprint !== sourceFingerprint
            ) {
              markFailure({
                code: 'source_changed',
                message: 'The image changed while processing. Create a new preview and try again.',
                retryable: true,
              });
              return null;
            }
            const maskDataUrl = await maskToDataUrl(bestMask.mask, naturalW, naturalH);
            let committed = false;
            updateDoc((doc) => {
              const liveNode = doc.nodes[nodeId];
              if (doc.id !== currentDoc.id || liveNode !== node) return doc;
              const updated = commitRasterMask(doc, nodeId, {
                dataUrl: maskDataUrl,
                width: naturalW,
                height: naturalH,
                method: 'ai-quality',
                modelId: providerId,
                score: selectedConfidence,
                scoreSource: bestMask.scoreSource,
                generatedAt: Date.now(),
                sourceLocator: src,
              });
              committed = updated !== doc;
              return updated;
            });
            if (committed) {
              writeTransientSession(null, { maskPreviewMode: 'none' });
              announcerRef.current?.announce(
                `Selection applied as a mask (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)})`,
              );
            }
            return maskResult;
          }

          case 'selection': {
            if (coveragePixels === 0) {
              markFailure({
                code: 'empty_result',
                message:
                  'The model did not find any pixels for these prompts. Adjust the prompts and create a new preview.',
                retryable: true,
              });
              return null;
            }
            if (!setAreaSelection) {
              markFailure({
                code: 'selection_output_unavailable',
                message: 'Pixel selection output is unavailable in this editor surface.',
                retryable: false,
              });
              return null;
            }
            const areaSelection = areaSelectionFromMaskCoverage(
              currentDoc,
              nodeId,
              bestMask.mask,
              naturalW,
              naturalH,
              'source-image-pixels',
            );
            if (!areaSelection) {
              markFailure({
                code: 'selection_output_unavailable',
                message: 'The subject mask could not be converted into a pixel selection.',
                retryable: true,
              });
              return null;
            }
            setAreaSelection(areaSelection);
            writeTransientSession(null, { maskPreviewMode: 'none' });
            announcerRef.current?.announce(
              `Selected subject (${formatSelectionScore(selectedConfidence, bestMask.scoreSource)})`,
            );
            return maskResult;
          }
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        if (isCancellationError(raw)) return null;
        const failure = mapSegmentationFailure(raw);
        markFailure(failure);
        return null;
      } finally {
        if (generation === generationRef.current) {
          abortRef.current = null;
          if (softDeadlineRef.current !== null) {
            clearTimeout(softDeadlineRef.current);
            softDeadlineRef.current = null;
          }
        }
      }

      return null;
    },
    [
      enabled,
      stateRef,
      setState,
      updateDoc,
      announcerRef,
      setAreaSelection,
      writeTransientSession,
      promptedProviderPreference,
    ],
  );

  return {
    applySam2Segmentation,
    cancelSam2Segmentation,
    selectSam2Candidate,
    reviewSam2Candidate,
    promptedProviderPreference,
    setPromptedProviderPreference,
  };
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function currentNodeSource(node: import('@varve/scene').SceneNode | undefined): string {
  return node?.kind === 'shape' ? imageShapeSrc(node) : '';
}

function isCurrentSelectionTarget(
  stateRef: React.MutableRefObject<EditorState>,
  documentId: string,
  nodeId: NodeId,
  node: import('@varve/scene').ShapeNode,
): boolean {
  const live = stateRef.current;
  return (
    live.document.id === documentId &&
    live.selection.length === 1 &&
    live.selection[0] === nodeId &&
    live.document.nodes[nodeId] === node
  );
}

async function readImageSourceIdentity(
  src: string,
): Promise<{ width: number; height: number; fingerprint: string } | null> {
  if (typeof document === 'undefined') return null;
  try {
    const cache = getImageCache();
    cache.evict(src);
    const image = await cache.load(src);
    const { width, height } = cachedImageDims(image);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { width, height, fingerprint: await fingerprintImageData(imageData) };
  } catch {
    return null;
  }
}

/**
 * Map backend/worker failures to user-facing messages (error taxonomy in
 * the object-selection docs). Never leak raw tensor/backtrace text.
 */
function writeCurrentSam2Stage(
  stateRef: React.MutableRefObject<EditorState>,
  setState: React.Dispatch<React.SetStateAction<EditorState>>,
  nodeId: NodeId,
  status: 'preparing' | 'encoding' | 'decoding',
): void {
  const current = stateRef.current.objectSelectionSession;
  if (!current || current.nodeId !== nodeId) return;
  const elapsed = current.startedAt ? Math.max(0, Date.now() - current.startedAt) : undefined;
  const next = {
    ...current,
    status,
    error: undefined,
    stageTimingsMs:
      elapsed === undefined
        ? current.stageTimingsMs
        : { ...current.stageTimingsMs, [status]: elapsed },
  } as ObjectSelectionSession;
  stateRef.current = { ...stateRef.current, objectSelectionSession: next };
  setState((prev) => ({ ...prev, objectSelectionSession: next }));
}

function isCancellationError(raw: string): boolean {
  return /cancelled|canceled|abort/i.test(raw);
}

/** Count non-zero coverage pixels in a one-channel mask. */
function countMaskCoverage(mask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]! > 0) count += 1;
  }
  return count;
}

function maskMatchesDimensions(mask: Uint8Array, width: number, height: number): boolean {
  return (
    mask instanceof Uint8Array &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    mask.length === width * height
  );
}

/** Format score provenance without presenting a quality score as intent probability. */
function formatSelectionScore(
  score: number,
  source: ObjectSelectionSession['confidenceSource'],
): string {
  if (source === 'predicted-iou' || source === 'model-iou') {
    return `predicted IoU score ${score.toFixed(2)}`;
  }
  if (source === 'stability') {
    return `stability score ${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
  }
  if (source === 'heuristic' || source === 'activation-heuristic') {
    return `heuristic score ${score.toFixed(2)}`;
  }
  return `score ${score.toFixed(2)}`;
}

function mapSegmentationFailure(raw: string): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (raw.includes('safe WASM memory limit')) {
    return {
      code: 'out_of_memory',
      message:
        'Object selection needs more memory than this device can safely use without GPU acceleration. Close other documents or try again on a device with more memory.',
      retryable: false,
    };
  }
  if (raw.startsWith('Worker error:') || /worker.*(failed|undefined)/i.test(raw)) {
    return {
      code: 'worker_crash',
      message: 'The AI worker could not start. Reload the document and try again.',
      retryable: true,
    };
  }
  if (/model.*(exceeds|not downloaded|not installed|missing)/i.test(raw)) {
    return {
      code: 'model_not_installed',
      message:
        'The object-selection model is missing. Install it from Settings, Offline Models, then try again.',
      retryable: true,
    };
  }
  if (raw.includes('timed out') || raw.includes('Inference timed out')) {
    return {
      code: 'inference_timeout',
      message:
        'Object selection took too long to respond. Try again; the next run can reuse the model, or use a smaller image.',
      retryable: true,
    };
  }
  return {
    code: 'unknown',
    message: 'Object selection could not complete. Check the AI model installation and try again.',
    retryable: true,
  };
}

export function mapPromptedRoutingFailure(decision: {
  reason: string;
  rejected: ReadonlyArray<{ code: string; reason: string }>;
}): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const rejection = decision.rejected[0];
  if (rejection?.code === 'exceeds-hard-budget') {
    return {
      code: 'out_of_memory',
      message: rejection.reason,
      retryable: true,
    };
  }
  if (rejection?.code === 'not-installed') {
    return {
      code: 'model_not_installed',
      message: rejection.reason,
      retryable: true,
    };
  }
  if (rejection?.code === 'unsupported-runtime') {
    return {
      code: 'unsupported_runtime',
      message: rejection.reason,
      retryable: false,
    };
  }
  return {
    code: 'provider_unavailable',
    message: rejection?.reason ?? decision.reason,
    retryable: true,
  };
}

async function maskToDataUrl(mask: Uint8Array, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!;
    imageData.data[i * 4] = 255;
    imageData.data[i * 4 + 1] = 255;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
