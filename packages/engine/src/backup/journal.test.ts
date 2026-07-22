import { beforeEach, describe, expect, it } from 'vitest';
import { CrashJournal, type JournalStorage } from './journal';

function createMemoryJournalStorage(): JournalStorage {
  const store = new Map<string, string>();
  return {
    async read(path: string) {
      return store.get(path) ?? null;
    },
    async write(path: string, data: string) {
      store.set(path, data);
    },
    async append(path: string, data: string) {
      const existing = store.get(path) ?? '';
      store.set(path, existing + data);
    },
    async delete(path: string) {
      store.delete(path);
    },
    async list(dir: string) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      return Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    async size(path: string) {
      return new TextEncoder().encode(store.get(path) ?? '').length;
    },
  };
}

describe('CrashJournal', () => {
  let storage: JournalStorage;
  const projectId = 'test-proj';
  const journalDir = '/journals';

  beforeEach(() => {
    storage = createMemoryJournalStorage();
  });

  it('opens and appends entries', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    expect(journal.isEmpty).toBe(true);
    await journal.append('save', 'abc123', 1, 1024);
    expect(journal.isEmpty).toBe(false);
    expect(journal.entryCount).toBe(1);
    expect(journal.lastEntryTimestamp).toBeGreaterThan(0);
  });

  it('persists entries across open/close cycles', async () => {
    const j1 = new CrashJournal(storage, projectId, journalDir);
    await j1.open();
    await j1.append('save', 'hash1', 1, 100);
    await j1.close();
    const j2 = new CrashJournal(storage, projectId, journalDir);
    await j2.open();
    expect(j2.entryCount).toBe(1);
    const last = j2.getLastEntry();
    expect(last).not.toBeNull();
    expect(last!.documentChecksum).toBe('hash1');
  });

  it('clears entries', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    await journal.append('save', 'hash1', 1, 100);
    await journal.clear();
    expect(journal.isEmpty).toBe(true);
  });

  it('returns last entry', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    await journal.append('save', 'hash1', 1, 100);
    await journal.append('auto-save', 'hash2', 2, 200);
    const last = journal.getLastEntry();
    expect(last).not.toBeNull();
    expect(last!.documentChecksum).toBe('hash2');
  });

  it('returns null for empty journal', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    expect(journal.getLastEntry()).toBeNull();
  });

  it('filters entries since timestamp', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    await journal.append('save', 'hash1', 1, 100);
    await new Promise((r) => setTimeout(r, 5));
    const mid = Date.now();
    await journal.append('save', 'hash2', 2, 200);
    const since = journal.getEntriesSince(mid);
    expect(since.length).toBe(1);
    expect(since[0]!.documentChecksum).toBe('hash2');
  });

  it('rejects append after close', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    await journal.close();
    await expect(journal.append('save', 'hash', 1, 100)).rejects.toThrow('Journal is closed');
  });

  it('detects unrecovered writes', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    await journal.append('save', 'hash1', 1, 100);
    expect(await journal.hasUnrecoveredWrites()).toBe(true);
  });

  it('marks clean with pre-close', async () => {
    const journal = new CrashJournal(storage, projectId, journalDir);
    await journal.open();
    await journal.append('pre-close', 'hash1', 1, 100);
    expect(await journal.hasUnrecoveredWrites()).toBe(false);
  });

  it('cleans up old journals', async () => {
    const j1 = new CrashJournal(storage, 'old-proj', journalDir);
    await j1.open();
    await j1.append('save', 'old', 1, 100);
    await j1.close();
    await new Promise((r) => setTimeout(r, 10));
    expect(await CrashJournal.cleanup(storage, journalDir, 0)).toBeGreaterThanOrEqual(1);
  });

  it('finds all journals in a directory', async () => {
    const j1 = new CrashJournal(storage, 'proj-a', journalDir);
    await j1.open();
    await j1.append('save', 'a', 1, 100);
    await j1.close();
    const j2 = new CrashJournal(storage, 'proj-b', journalDir);
    await j2.open();
    await j2.append('save', 'b', 1, 100);
    await j2.close();
    const journals = await CrashJournal.findJournals(storage, journalDir);
    expect(journals.length).toBe(2);
  });
});
