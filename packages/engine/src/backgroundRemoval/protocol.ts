/**
 * Revision-safe worker protocol — request IDs, generation tracking,
 * and immutable buffer management.
 *
 * Every command, progress event, result, and error carries a request ID
 * and worker generation. Cancelling or timing out an active inference
 * terminates and replaces that worker; abort listeners are removed when
 * a request settles.
 */
import type { BackgroundRemovalResult, WorkerModelId } from './types';

export type RequestId = string;

let nextId = 0;

/** Generate a unique request ID for a worker inference job. */
export function generateRequestId(): RequestId {
  return `req_${++nextId}_${Date.now().toString(36)}`;
}

export type WorkerGeneration = number;

/** Command sent to a worker. */
export interface ProtocolCommand {
  type: 'infer';
  requestId: RequestId;
  imageData: ImageData;
  modelPath: string;
  modelId: WorkerModelId;
  method: 'ai-balanced' | 'ai-quality';
  feather?: number;
  decontaminate?: boolean;
  previewMaxDimension?: number;
  reuseSession?: boolean;
}

/** Successful inference result from a worker. */
export interface ProtocolResult {
  type: 'result';
  requestId: RequestId;
  result: BackgroundRemovalResult;
}

/** Error from a worker. */
export interface ProtocolError {
  type: 'error';
  requestId: RequestId;
  message: string;
}

/** Progress update from a worker. */
export interface ProtocolProgress {
  type: 'progress';
  requestId: RequestId;
  stage: string;
  progress: number;
}

/** Worker ready signal (no request ID — it's a lifecycle event). */
export interface ProtocolReady {
  type: 'ready';
}

export type ProtocolMessage = ProtocolResult | ProtocolError | ProtocolProgress | ProtocolReady;

/** Create a result message for testing. */
export function resultMessage(
  requestId: RequestId,
  result: BackgroundRemovalResult,
): ProtocolResult {
  return { type: 'result', requestId, result };
}

/** Create an error message for testing. */
export function errorMessage(requestId: RequestId, message: string): ProtocolError {
  return { type: 'error', requestId, message };
}

/** Create a progress message for testing. */
export function progressMessage(
  requestId: RequestId,
  stage: string,
  progress: number,
): ProtocolProgress {
  return { type: 'progress', requestId, stage, progress };
}

/**
 * Create an immutable clone of ImageData suitable for provider dispatch.
 * The original buffer is never detached; each provider receives its own copy.
 */
export function cloneImageData(imageData: ImageData): ImageData {
  const cloned = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  return cloned;
}
