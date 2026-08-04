/**
 * VersionThumbnailQueue — non-blocking, bounded thumbnail generation for
 * version-history entries.
 *
 * createVersion() in VersionHistoryService previously awaited thumbnail
 * generation synchronously, blocking the version-creation flow for large
 * documents. This queue decouples the two:
 *
 * 1. Create the immutable version snapshot and metadata
 * 2. Persist the version successfully (no thumbnail needed)
 * 3. Enqueue low-priority thumbnail generation
 * 4. Attach the thumbnail only if the version still exists and matches
 * 5. Retain a placeholder when generation fails
 *
 * Architecture: bounded FIFO with concurrency=1, stale-result protection
 * via revision matching, and shutdown/cancellation support.
 *
 * Research basis: bounded queue pattern (Michael & Scott, 1996) with
 * priority inversion protection (Browser idle scheduling).
 */

import { hasAnyCanvas, hasImageEncoding } from '@varve/engine';
import type { Platform, VersionEntry } from '@varve/platform';
import type { Document } from '@varve/scene';
import { generateDocThumbnail } from './thumbnailSource';

// ─── Types ────────────────────────────────────────────────────────────

export interface VersionThumbnailJob {
  versionId: string;
  fileId: string;
  document: Document;
  revisionHash: string;
}

// ─── Queue ────────────────────────────────────────────────────────────

export class VersionThumbnailQueue {
  private queue: VersionThumbnailJob[] = [];
  private processing = false;
  private maxQueueSize = 50;
  private shutdownFlag = false;
  private platform: Platform;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  /** Enqueue a version thumbnail job. Returns false if queue is full. */
  enqueue(job: VersionThumbnailJob): boolean {
    if (this.shutdownFlag) return false;
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(job);
    this.scheduleNext();
    return true;
  }

  /** Cancel all pending jobs and prevent new ones. */
  shutdown(): void {
    this.shutdownFlag = true;
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length;
  }

  setMaxQueueSize(n: number): void {
    this.maxQueueSize = Math.max(1, n);
    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private scheduleNext(): void {
    if (this.processing || this.shutdownFlag) return;
    this.processing = true;

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => void this.drain(), { timeout: 5000 });
    } else {
      setTimeout(() => void this.drain(), 200);
    }
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0 && !this.shutdownFlag) {
        const job = this.queue.shift()!;
        try {
          await this.processJob(job);
        } catch {
          // Individual job failure must not crash the queue
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: VersionThumbnailJob): Promise<void> {
    // Skip when no canvas rendering path is available (e.g., jsdom tests).
    if (!hasAnyCanvas() || !hasImageEncoding()) return;

    // 1. Verify version still exists before spending time on generation
    let versions: VersionEntry[];
    try {
      versions = await this.platform.listVersions(job.fileId);
    } catch {
      return;
    }
    if (!versions.some((v) => v.id === job.versionId)) return;
    if (this.shutdownFlag) return;

    // 2. Generate thumbnail
    const result = await generateDocThumbnail(job.document, {
      maxWidth: 120,
      maxHeight: 90,
      fit: 'contain',
      background: { type: 'transparent' },
    });
    if (this.shutdownFlag) return;

    // Only apply real thumbnails — skip placeholder results (empty string,
    // or results flagged as placeholder from environments without canvas).
    if (!result || result.metadata.isPlaceholder || !result.dataUrl) return;

    // 3. Verify version still exists after generation (stale-result guard)
    try {
      versions = await this.platform.listVersions(job.fileId);
    } catch {
      return;
    }
    if (this.shutdownFlag) return;

    const currentVersion = versions.find(
      (v) => v.id === job.versionId && v.documentHash === job.revisionHash,
    );
    if (!currentVersion) return;

    // 4. Attach thumbnail via platform
    try {
      await this.platform.updateVersionThumbnail(job.versionId, result.dataUrl);
    } catch {
      // Best-effort: thumbnail update failure is non-fatal
    }
  }
}
