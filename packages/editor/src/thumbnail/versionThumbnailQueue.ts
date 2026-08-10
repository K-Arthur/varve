/**
 * VersionThumbnailQueue — non-blocking, bounded thumbnail generation for
 * version-history entries, routed through the canonical thumbnail pipeline
 * and the shared scheduler.
 *
 * createVersion() in VersionHistoryService never awaits thumbnail work:
 * 1. Persist the immutable version snapshot and metadata
 * 2. Enqueue low-priority canonical thumbnail generation
 * 3. Attach the thumbnail only if the version still exists AND its document
 *    hash still matches (stale-result guard)
 * 4. Retain a placeholder when generation fails
 *
 * The queue is a thin adapter: concurrency, dedup, cancellation and
 * priority ordering come from `ThumbnailScheduler`.
 */

import type { Platform, VersionEntry } from '@varve/platform';
import type { Document } from '@varve/scene';
import { THUMBNAIL_VARIANTS } from '@varve/shared';
import { getThumbnailScheduler } from './scheduler';
import { renderDocThumbnail } from './thumbnailService';

export interface VersionThumbnailJob {
  versionId: string;
  fileId: string;
  document: Document;
  revisionHash: string;
}

export class VersionThumbnailQueue {
  private maxQueueSize = 50;

  constructor(private readonly platform: Platform) {}

  /** Enqueue a version thumbnail job. Returns false when the queue is full. */
  enqueue(job: VersionThumbnailJob): boolean {
    const scheduler = getThumbnailScheduler();
    if (scheduler.isShutdown) return false;
    if (scheduler.pendingCount >= this.maxQueueSize) return false;

    scheduler.enqueue({
      key: `version-thumb:${job.versionId}:${job.revisionHash}`,
      priority: 'idle',
      run: async (signal) => {
        if (signal.aborted) return;
        await this.processJob(job, signal);
      },
    });
    return true;
  }

  /** Cancel all pending jobs and prevent new ones. */
  shutdown(): void {
    getThumbnailScheduler().shutdown();
  }

  get pending(): number {
    return getThumbnailScheduler().pendingCount;
  }

  setMaxQueueSize(n: number): void {
    this.maxQueueSize = Math.max(1, n);
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private async processJob(job: VersionThumbnailJob, signal: AbortSignal): Promise<void> {
    // 1. Verify the version still exists before spending time generating.
    let versions: VersionEntry[];
    try {
      versions = await this.platform.listVersions(job.fileId);
    } catch {
      return;
    }
    if (!versions.some((v) => v.id === job.versionId)) return;
    if (signal.aborted) return;

    // 2. Generate through the canonical pipeline (version-history profile).
    const outcome = await renderDocThumbnail(job.document, {
      fileId: job.fileId,
      source: { type: 'automatic' },
      variant: THUMBNAIL_VARIANTS['version-history'],
      signal,
    });
    if (signal.aborted) return;
    if (!outcome.result?.dataUrl || outcome.result.metadata.isPlaceholder) return;

    // 3. Re-verify version identity AFTER generation (stale-result guard):
    //    the entry must still exist and still carry the same document hash.
    try {
      versions = await this.platform.listVersions(job.fileId);
    } catch {
      return;
    }
    if (signal.aborted) return;
    const current = versions.find(
      (v) => v.id === job.versionId && v.documentHash === job.revisionHash,
    );
    if (!current) return;

    // 4. Attach the thumbnail to the version row.
    try {
      await this.platform.updateVersionThumbnail(job.versionId, outcome.result.dataUrl);
    } catch {
      // Best-effort: thumbnail update failure is non-fatal
    }
  }
}
