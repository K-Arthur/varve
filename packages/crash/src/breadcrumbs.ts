/**
 * Bounded in-memory breadcrumb ring buffer.
 *
 * Breadcrumbs describe technical actions, never user content:
 *   document.open.started, renderer.backend.selected, worker.started,
 *   export.started, autosave.completed, webgpu.device.lost, command.failed.
 * The typed-event gate (`isKnownCrumbEvent`) rejects anything that does not
 * match a known `subsystem.action` namespace, so document names, layer names,
 * URLs, prompts, or clipboard values cannot enter structurally.
 *
 * Stored only in memory; drained into a report only when consent permits.
 */

import { type CrashBreadcrumb, isKnownCrumbEvent, LIMITS } from './schema';

export interface BreadcrumbSink {
  record(event: string, category?: string, ts?: number): void;
  drain(): CrashBreadcrumb[];
  clear(): void;
  size(): number;
}

export class RingBreadcrumbBuffer implements BreadcrumbSink {
  private readonly buffer: CrashBreadcrumb[] = [];

  constructor(private readonly max: number = LIMITS.maxBreadcrumbs) {}

  record(event: string, category?: string, ts: number = Date.now()): void {
    if (!isKnownCrumbEvent(event)) return;
    if (event.length > LIMITS.maxCrumbLength) return;
    const crumb: CrashBreadcrumb = {
      ts,
      event,
      category: category && category.length > 0 ? category.slice(0, 40) : undefined,
    };
    this.buffer.push(crumb);
    if (this.buffer.length > this.max) this.buffer.shift();
  }

  drain(): CrashBreadcrumb[] {
    const out = this.buffer.slice();
    this.buffer.length = 0;
    return out;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  size(): number {
    return this.buffer.length;
  }
}

/** No-op sink used when breadcrumbs are disabled. */
export const NOOP_BREADCRUMB_SINK: BreadcrumbSink = {
  record() {},
  drain: () => [],
  clear() {},
  size: () => 0,
};
