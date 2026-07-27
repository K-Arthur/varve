/**
 * Icon download manager — fetches and caches icon SVGs from online providers.
 */

import type { IconProviderResult } from '@strata/engine';
import { sanitizeSvg } from '@strata/engine';
import { getStoredIcon, type IconStorageRecord, storeIcon } from './iconStorage';

export type IconDownloadStatus =
  | 'idle'
  | 'downloading'
  | 'sanitising'
  | 'storing'
  | 'complete'
  | 'failed';

export interface IconDownloadJob {
  id: string;
  icon: IconProviderResult;
  status: IconDownloadStatus;
  progress: number;
  svg?: string;
  error?: string;
  abortController: AbortController;
  createdAt: number;
}

export interface IconDownloadManagerEvents {
  onJobComplete?: (job: IconDownloadJob, record: IconStorageRecord) => void;
  onJobFailed?: (job: IconDownloadJob) => void;
  onJobProgress?: (job: IconDownloadJob) => void;
}

export class IconDownloadManager {
  private jobs = new Map<string, IconDownloadJob>();
  private events: IconDownloadManagerEvents;

  constructor(events: IconDownloadManagerEvents = {}) {
    this.events = events;
  }

  async downloadIcon(
    icon: IconProviderResult,
    fetchSvg: (id: string) => Promise<string | null>,
  ): Promise<IconStorageRecord | null> {
    const existing = await getStoredIcon(icon.id);
    if (existing) return existing;

    const abortController = new AbortController();
    const job: IconDownloadJob = {
      id: icon.id,
      icon,
      status: 'downloading',
      progress: 0,
      abortController,
      createdAt: Date.now(),
    };

    this.jobs.set(job.id, job);

    try {
      this.activeCount++;
      this.events.onJobProgress?.(job);

      const rawSvg = await fetchSvg(icon.id);
      if (abortController.signal.aborted || !rawSvg) {
        job.status = 'failed';
        job.error = abortController.signal.aborted ? 'Cancelled' : 'No SVG returned';
        this.events.onJobFailed?.(job);
        return null;
      }

      job.progress = 50;
      job.status = 'sanitising';
      this.events.onJobProgress?.(job);

      let sanitisedSvg: string;
      try {
        sanitisedSvg = sanitizeSvg(rawSvg).svg;
      } catch {
        job.status = 'failed';
        job.error = 'Failed to sanitise SVG';
        this.events.onJobFailed?.(job);
        return null;
      }

      job.progress = 75;
      job.status = 'storing';
      job.svg = sanitisedSvg;
      this.events.onJobProgress?.(job);

      const record: IconStorageRecord = {
        id: icon.id,
        name: icon.name,
        providerId: icon.prefix,
        prefix: icon.prefix,
        svg: sanitisedSvg,
        licence: icon.license.name,
        category: icon.category,
        styles: icon.styles,
        storedAt: Date.now(),
        byteSize: new TextEncoder().encode(sanitisedSvg).byteLength,
      };

      await storeIcon(record);
      job.progress = 100;
      job.status = 'complete';
      this.events.onJobProgress?.(job);
      this.events.onJobComplete?.(job, record);
      return record;
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'Unknown error';
      this.events.onJobFailed?.(job);
      return null;
    } finally {
      this.activeCount--;
      this.jobs.delete(job.id);
    }
  }

  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.abortController.abort();
  }

  getJob(iconId: string): IconDownloadJob | undefined {
    return this.jobs.get(iconId);
  }

  isDownloading(iconId: string): boolean {
    return this.jobs.has(iconId);
  }
}

let defaultManager: IconDownloadManager | null = null;
export function getIconDownloadManager(): IconDownloadManager {
  if (!defaultManager) defaultManager = new IconDownloadManager();
  return defaultManager;
}
