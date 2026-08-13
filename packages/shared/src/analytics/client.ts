import { sanitizeAnalyticsEvent } from './privacy';
import {
  ANALYTICS_EVENT_CATEGORIES,
  type AnalyticsCategory,
  type AnalyticsConsent,
  type AnalyticsContext,
  type AnalyticsEvent,
  type AnalyticsEventMap,
  type AnalyticsEventName,
  DEFAULT_ANALYTICS_CONSENT,
} from './schema';

export interface AnalyticsProvider {
  initialize(): Promise<void>;
  track(event: AnalyticsEvent): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export class NoopAnalyticsProvider implements AnalyticsProvider {
  async initialize(): Promise<void> {}
  track(_event: AnalyticsEvent): void {}
  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export interface HttpAnalyticsProviderOptions {
  /** Null is the safe default and means the provider never sends. */
  endpoint: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Minimal provider for a Varve-owned aggregate ingestion endpoint. */
export class HttpAnalyticsProvider implements AnalyticsProvider {
  private readonly endpoint: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly pending: AnalyticsEvent[] = [];

  constructor(options: HttpAnalyticsProviderOptions) {
    this.endpoint = safeAnalyticsEndpoint(options.endpoint);
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async initialize(): Promise<void> {}

  track(event: AnalyticsEvent): void {
    if (this.endpoint && this.pending.length < 50) this.pending.push(event);
  }

  async flush(): Promise<void> {
    if (!this.endpoint || this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, events: batch }),
        signal: controller.signal,
        keepalive: false,
      });
      if (!response.ok) return;
    } catch {
      // Analytics failure is intentionally silent and non-functional.
    } finally {
      clearTimeout(timer);
    }
  }

  async shutdown(): Promise<void> {
    this.pending.length = 0;
  }
}

export function safeAnalyticsEndpoint(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface AnalyticsClientOptions {
  context: AnalyticsContext;
  consent?: AnalyticsConsent;
  provider?: AnalyticsProvider;
  now?: () => number;
  maxQueueSize?: number;
}

/**
 * Consent-gated client. The queue is memory-only, bounded, and deliberately
 * not persisted: offline events expire with the process instead of becoming a
 * second sensitive local data store.
 */
export class AnalyticsClient {
  private consent: AnalyticsConsent;
  private readonly context: AnalyticsContext;
  private readonly provider: AnalyticsProvider;
  private readonly now: () => number;
  private readonly maxQueueSize: number;
  private readonly queue: AnalyticsEvent[] = [];
  private initialized = false;

  constructor(options: AnalyticsClientOptions) {
    this.context = options.context;
    this.consent = options.consent ?? DEFAULT_ANALYTICS_CONSENT;
    this.provider = options.provider ?? new NoopAnalyticsProvider();
    this.now = options.now ?? Date.now;
    this.maxQueueSize = Math.max(1, Math.min(options.maxQueueSize ?? 50, 200));
  }

  updateConsent(consent: AnalyticsConsent): void {
    this.consent = { ...consent };
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.consent[this.queue[i]!.category] !== 'granted') this.queue.splice(i, 1);
    }
    if (!this.hasGrantedCategory()) void this.provider.shutdown();
  }

  track<N extends AnalyticsEventName>(name: N, payload: AnalyticsEventMap[N]): boolean {
    const category = ANALYTICS_EVENT_CATEGORIES[name] as AnalyticsCategory;
    if (this.consent[category] !== 'granted') return false;
    const event = sanitizeAnalyticsEvent(name, payload, this.context, this.now());
    if (!event) return false;
    if (this.queue.length >= this.maxQueueSize) this.queue.shift();
    this.queue.push(event);
    return true;
  }

  async flush(): Promise<void> {
    this.dropUnconsented();
    if (this.queue.length === 0) return;
    if (!this.initialized) {
      await this.provider.initialize().catch(() => undefined);
      this.initialized = true;
    }
    const batch = this.queue.splice(0, this.queue.length);
    for (const event of batch) this.provider.track(event);
    await this.provider.flush().catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    this.queue.length = 0;
    await this.provider.shutdown().catch(() => undefined);
    this.initialized = false;
  }

  getQueueSize(): number {
    this.dropUnconsented();
    return this.queue.length;
  }

  private dropUnconsented(): void {
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (this.consent[this.queue[i]!.category] !== 'granted') this.queue.splice(i, 1);
    }
  }

  private hasGrantedCategory(): boolean {
    return Object.values(this.consent).some((state) => state === 'granted');
  }
}
