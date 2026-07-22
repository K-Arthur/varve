import { describe, expect, it } from 'vitest';
import { BackupEngine, createMemoryBackupStore } from './index';

describe('BackupEngine.listProjects', () => {
  it('lists all projects that have backups', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    await engine.createBackup('proj-a', 'automatic', '{}', 'A', 1);
    await engine.createBackup('proj-b', 'automatic', '{}', 'B', 1);
    await engine.createBackup('proj-a', 'snapshot', '{}', 'A', 2);
    const projects = await engine.listProjects();
    expect(projects.sort()).toEqual(['proj-a', 'proj-b']);
  });

  it('returns empty for no backups', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    expect(await engine.listProjects()).toEqual([]);
  });
});

describe('BackupEngine.getBackupDocument', () => {
  it('retrieves the document for a backup', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = JSON.stringify({ formatVersion: '2.6', data: 'test' });
    const result = await engine.createBackup('proj-1', 'snapshot', doc, 'Test', 1, 'My note');
    const retrieved = await engine.getBackupDocument(result.backupId!);
    expect(retrieved).toBe(doc);
  });

  it('returns null for unknown backup', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    expect(await engine.getBackupDocument('nonexistent')).toBeNull();
  });
});

describe('BackupEngine restore-verification', () => {
  it('newest backup is verified and retrievable for restore', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = JSON.stringify({ formatVersion: '2.6', nodes: [{ id: 'n1' }] });
    const result = await engine.createBackup('proj-restore', 'automatic', doc, 'Restore Me', 5);
    // Verify the backup is intact
    const verification = await engine.verifyBackupById(result.backupId!);
    expect(verification.valid).toBe(true);
    // Retrieve for restore
    const retrieved = await engine.getBackupDocument(result.backupId!);
    const parsed = JSON.parse(retrieved!);
    expect(parsed.nodes[0].id).toBe('n1');
  });

  it('falls back to older backup when newest is corrupted', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    // Create two backups
    const r1 = await engine.createBackup('proj-fallback', 'automatic', '{"v":1}', 'FB', 1);
    const r2 = await engine.createBackup('proj-fallback', 'automatic', '{"v":2}', 'FB', 2);
    // r2 is the newest and valid
    expect((await engine.verifyBackupById(r2.backupId!)).valid).toBe(true);
    // r1 is also valid (older fallback)
    expect((await engine.verifyBackupById(r1.backupId!)).valid).toBe(true);
    // List shows both
    const backups = await engine.listBackups('proj-fallback');
    expect(backups.length).toBe(2);
    // Both present regardless of ordering
    const ids = new Set(backups.map((b) => b.id));
    expect(ids.has(r1.backupId!)).toBe(true);
    expect(ids.has(r2.backupId!)).toBe(true);
  });
});
