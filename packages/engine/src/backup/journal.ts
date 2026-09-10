import type { JournalEntry, JournalHeader } from './types';

const JOURNAL_VERSION = 1;
const DEFAULT_CLEANUP_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_JOURNAL_ENTRIES = 1000;

export interface JournalStorage {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  size(path: string): Promise<number>;
}

export class CrashJournal {
  private readonly path: string;
  private header: JournalHeader;
  private entries: JournalEntry[] = [];
  private dirty = false;
  private closed = false;

  constructor(
    private readonly storage: JournalStorage,
    private readonly projectId: string,
    journalDir: string,
  ) {
    this.path = `${journalDir}/${projectId}.journal`;
    this.header = {
      formatVersion: JOURNAL_VERSION,
      projectId,
      created: Date.now(),
      lastEntryTimestamp: 0,
      entryCount: 0,
      totalByteLength: 0,
    };
  }

  get entryCount(): number {
    return this.entries.length;
  }

  get lastEntryTimestamp(): number {
    return this.header.lastEntryTimestamp;
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  async open(): Promise<void> {
    const existing = await this.storage.read(this.path);
    if (existing) {
      this.parse(existing);
    }
  }

  async append(
    operation: JournalEntry['operation'],
    documentChecksum: string,
    documentRevision: number,
    documentSize: number,
  ): Promise<void> {
    if (this.closed) {
      throw new Error('Journal is closed');
    }
    const entry: JournalEntry = {
      timestamp: Date.now(),
      operation,
      documentChecksum,
      documentRevision,
      documentSize,
    };
    this.entries.push(entry);
    this.header.lastEntryTimestamp = entry.timestamp;
    this.header.entryCount = this.entries.length;
    this.header.totalByteLength += 64;
    this.dirty = true;
    if (this.entries.length > MAX_JOURNAL_ENTRIES) {
      this.entries = this.entries.slice(-MAX_JOURNAL_ENTRIES);
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    const serialized = this.serialize();
    await this.storage.write(this.path, serialized);
    this.dirty = false;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.dirty) {
      await this.flush();
    }
    this.closed = true;
  }

  async clear(): Promise<void> {
    this.entries = [];
    this.header = {
      formatVersion: JOURNAL_VERSION,
      projectId: this.projectId,
      created: Date.now(),
      lastEntryTimestamp: 0,
      entryCount: 0,
      totalByteLength: 0,
    };
    this.dirty = true;
    await this.flush();
    this.closed = false;
  }

  getLastEntry(): JournalEntry | null {
    if (this.entries.length === 0) return null;
    const last = this.entries[this.entries.length - 1];
    return last ?? null;
  }

  getEntriesSince(timestamp: number): JournalEntry[] {
    return this.entries.filter((e) => e.timestamp >= timestamp);
  }

  async delete(): Promise<void> {
    await this.storage.delete(this.path);
    this.entries = [];
    this.closed = true;
  }

  async hasUnrecoveredWrites(): Promise<boolean> {
    if (this.entries.length === 0) return false;
    const last = this.getLastEntry();
    if (!last) return false;
    return ['save', 'auto-save'].includes(last.operation);
  }

  async recoverLastDocument(getDocumentJson: () => Promise<string | null>): Promise<string | null> {
    const lastEntry = this.getLastEntry();
    if (!lastEntry) return null;
    if (lastEntry.operation === 'pre-close') return null;
    return getDocumentJson();
  }

  static async findJournals(
    storage: JournalStorage,
    dir: string,
  ): Promise<Array<{ projectId: string; header: JournalHeader; entryCount: number }>> {
    const files = await storage.list(dir);
    const journals: Array<{ projectId: string; header: JournalHeader; entryCount: number }> = [];
    for (const file of files) {
      if (!file.endsWith('.journal')) continue;
      const projectId = file.replace('.journal', '');
      const data = await storage.read(`${dir}/${file}`);
      if (!data) continue;
      try {
        const parsed: { header: JournalHeader; entries: JournalEntry[] } = JSON.parse(data);
        journals.push({ projectId, header: parsed.header, entryCount: parsed.entries.length });
      } catch {}
    }
    return journals;
  }

  static async cleanup(
    storage: JournalStorage,
    dir: string,
    maxAgeMs: number = DEFAULT_CLEANUP_AGE_MS,
  ): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const journals = await CrashJournal.findJournals(storage, dir);
    let cleaned = 0;
    for (const j of journals) {
      if (j.header.lastEntryTimestamp < cutoff) {
        await storage.delete(`${dir}/${j.projectId}.journal`);
        cleaned++;
      }
    }
    return cleaned;
  }

  private serialize(): string {
    return JSON.stringify({ header: this.header, entries: this.entries });
  }

  private parse(data: string): void {
    try {
      const parsed: { header: JournalHeader; entries: JournalEntry[] } = JSON.parse(data);
      this.header = parsed.header;
      this.entries = parsed.entries;
    } catch {
      this.entries = [];
    }
  }
}
