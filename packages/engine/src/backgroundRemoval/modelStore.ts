/** Shared artifact storage for inference and background-removal model flows. */

import { sha256 } from '@noble/hashes/sha2.js';
import { getModelStorage } from '../inference/core/ModelStorage';

export interface PartialDownloadMeta {
  url: string;
  etag: string | null;
  loaded: number;
}

export interface PartialDownloadRecord {
  bytes: Uint8Array;
  meta: PartialDownloadMeta;
}

export class ModelStorageQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelStorageQuotaError';
  }
}

export async function sha256ReadableStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const hasher = sha256.create();
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Array.from(hasher.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyModelBlobChecksum(
  blob: Blob,
  expectedSha256: string,
): Promise<boolean> {
  return (await sha256ReadableStream(blob.stream())) === expectedSha256.toLowerCase();
}

function translateQuotaError(error: unknown): never {
  if (
    error instanceof Error &&
    (error.name === 'QuotaExceededError' || /insufficient disk space|quota/i.test(error.message))
  ) {
    throw new ModelStorageQuotaError(error.message);
  }
  throw error;
}

export async function saveModelBlob(id: string, blob: Blob): Promise<void> {
  const storage = getModelStorage();
  const writer = await storage.beginInstalledWrite(id, { expectedSizeBytes: blob.size });
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.commit();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await writer.abort();
    translateQuotaError(error);
  }
}

export async function loadModelBlob(id: string): Promise<Blob | null> {
  const artifact = await getModelStorage().openInstalledArtifact(id);
  return artifact?.toBlob() ?? null;
}

export async function hasModelBlob(id: string): Promise<boolean> {
  return getModelStorage().hasInstalled(id);
}

export async function deleteModelBlob(id: string): Promise<void> {
  return getModelStorage().deleteInstalled(id);
}

export async function savePartialDownload(
  id: string,
  record: PartialDownloadRecord,
): Promise<void> {
  try {
    await getModelStorage().savePartial(id, {
      bytes: record.bytes,
      url: record.meta.url,
      etag: record.meta.etag,
      loaded: record.meta.loaded,
    });
  } catch (error) {
    translateQuotaError(error);
  }
}

export async function loadPartialDownload(id: string): Promise<PartialDownloadRecord | null> {
  const record = await getModelStorage().loadPartial(id);
  if (!record) return null;
  return {
    bytes: record.bytes,
    meta: { url: record.url, etag: record.etag, loaded: record.loaded },
  };
}

export async function deletePartialDownload(id: string): Promise<void> {
  return getModelStorage().deletePartial(id);
}

export async function getModelBlobSize(id: string): Promise<number> {
  return (await getModelStorage().statInstalled(id))?.sizeBytes ?? 0;
}

export async function clearAllModelBlobs(): Promise<void> {
  return getModelStorage().clear();
}
