const STORAGE_KEY = 'strata:actions';
const WINDOW_30_DAYS = 30 * 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 100;

export interface ActionRecord {
  actionId: string;
  timestamp: number;
  context?: Record<string, string>;
}

export class ActionTracker {
  private records: ActionRecord[] = [];
  private lastRecordTime = 0;
  private lastActionId = '';

  constructor() {
    this.load();
  }

  record(actionId: string, context?: Record<string, string>): void {
    const now = Date.now();
    if (actionId === this.lastActionId && now - this.lastRecordTime < DEBOUNCE_MS) {
      return;
    }
    this.records.push({ actionId, timestamp: now, context });
    this.lastActionId = actionId;
    this.lastRecordTime = now;
    this.save();
  }

  getCount(actionId: string, windowMs?: number): number {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    return this.records.filter((r) => r.actionId === actionId && r.timestamp >= cutoff).length;
  }

  getRecentActions(windowMs: number): ActionRecord[] {
    const cutoff = Date.now() - windowMs;
    return this.records.filter((r) => r.timestamp >= cutoff);
  }

  getFrequencyMap(): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of this.records) {
      map.set(r.actionId, (map.get(r.actionId) ?? 0) + 1);
    }
    return map;
  }

  getTotalCount(): number {
    return this.records.length;
  }

  getActionSequence(windowMs?: number): string[] {
    const window = windowMs ?? 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - window;
    return this.records
      .filter((r) => r.timestamp >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((r) => r.actionId);
  }

  getCoOccurrenceMap(windowMs?: number): Map<string, number> {
    const window = windowMs ?? 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - window;
    const windowRecords = this.records
      .filter((r) => r.timestamp >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);

    const coOccurrence = new Map<string, number>();
    const CO_OCCURRENCE_WINDOW_MS = 5000;

    for (let i = 0; i < windowRecords.length; i++) {
      for (let j = i + 1; j < windowRecords.length; j++) {
        const diff = windowRecords[j].timestamp - windowRecords[i].timestamp;
        if (diff > CO_OCCURRENCE_WINDOW_MS) break;
        const key = [windowRecords[i].actionId, windowRecords[j].actionId].sort().join('::');
        coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
      }
    }

    return coOccurrence;
  }

  clear(): void {
    this.records = [];
    this.lastActionId = '';
    this.lastRecordTime = 0;
    this.save();
  }

  toJSON(): string {
    return JSON.stringify(this.records);
  }

  fromJSON(json: string): void {
    try {
      const parsed: ActionRecord[] = JSON.parse(json);
      if (Array.isArray(parsed)) {
        this.records = parsed;
        this.prune();
      }
    } catch {
      this.records = [];
    }
  }

  private load(): void {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      this.fromJSON(stored);
    }
  }

  private save(): void {
    this.prune();
    localStorage.setItem(STORAGE_KEY, this.toJSON());
  }

  private prune(): void {
    const cutoff = Date.now() - WINDOW_30_DAYS;
    this.records = this.records.filter((r) => r.timestamp >= cutoff);
  }
}

let _instance: ActionTracker | null = null;

export function getActionTracker(): ActionTracker {
  if (!_instance) {
    _instance = new ActionTracker();
  }
  return _instance;
}
