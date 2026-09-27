import type { RenderRevision } from '@varve/shared';
import { closeImageBitmapMap, type collectImageBitmaps } from './collectImageBitmaps';
import type { RenderWorkerHost, WorkerRenderCommand } from './workerHost';

type CollectedImages = Awaited<ReturnType<typeof collectImageBitmaps>>;
export const WORKER_IMAGE_COLLECTION_TIMEOUT_MS = 500;

export interface WorkerFrameSubmissionArgs {
  collection: Promise<CollectedImages>;
  host: () => RenderWorkerHost | null;
  currentRevision: () => number;
  renderRevision: RenderRevision;
  fallbackRevision: { current: number | null };
  command: Omit<WorkerRenderCommand, 'type' | 'images' | 'imageSources' | 'renderRevision'>;
  requestFallback: (source: string) => void;
}

/** Post a collected frame only while its pixel identity remains current. */
export async function submitWorkerFrame({
  collection,
  host,
  currentRevision,
  renderRevision,
  fallbackRevision,
  command,
  requestFallback,
}: WorkerFrameSubmissionArgs): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const outcome = await Promise.race([
    collection.then(
      (collected) => ({ type: 'collected' as const, collected }),
      () => ({ type: 'error' as const }),
    ),
    new Promise<{ type: 'timeout' }>((resolve) => {
      timeout = setTimeout(() => resolve({ type: 'timeout' }), WORKER_IMAGE_COLLECTION_TIMEOUT_MS);
    }),
  ]);
  if (timeout !== null) clearTimeout(timeout);

  if (outcome.type === 'timeout') {
    // Collection can finish after the main-thread replay was scheduled. Keep
    // ownership of that late result explicit and dispose it when it arrives.
    void collection.then(
      (collected) => {
        if (collected) closeImageBitmapMap(collected.images);
      },
      () => undefined,
    );
    if (currentRevision() === renderRevision) {
      fallbackRevision.current = renderRevision;
      requestFallback('worker-collection-timeout');
    }
    return;
  }

  if (outcome.type === 'error') {
    if (currentRevision() === renderRevision) {
      fallbackRevision.current = renderRevision;
      requestFallback('worker-collection-error');
    }
    return;
  }
  const { collected } = outcome;

  if (currentRevision() !== renderRevision) {
    if (collected) closeImageBitmapMap(collected.images);
    return;
  }
  if (!collected) {
    fallbackRevision.current = renderRevision;
    requestFallback('worker-collection-fallback');
    return;
  }

  const renderWorker = host();
  if (!renderWorker) {
    closeImageBitmapMap(collected.images);
    fallbackRevision.current = renderRevision;
    requestFallback('worker-host-unavailable');
    return;
  }

  const posted = renderWorker.post(
    {
      ...command,
      type: 'render',
      renderRevision,
      images: collected.images,
      imageSources: collected.sources,
    },
    collected.transfer,
  );
  if (!posted && currentRevision() === renderRevision) {
    fallbackRevision.current = renderRevision;
    requestFallback('worker-admission-fallback');
  }
}
