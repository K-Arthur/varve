import { describe, expect, it } from 'vitest';
import { BackupEngine, createMemoryBackupStore, DEFAULT_RETENTION } from './index';

function makeDocumentJson(name: string): string {
  return JSON.stringify({ formatVersion: '2.6', name, nodes: [], id: `doc-${name}` });
}

describe('BackupEngine', () => {
  it('creates and lists backups', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('test-project');
    const result = await engine.createBackup('proj-1', 'automatic', doc, 'Test Project', 1);
    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy();
    const backups = await engine.listBackups('proj-1');
    expect(backups.length).toBe(1);
    expect(backups[0]!.id).toBe(result.backupId);
    expect(backups[0]!.type).toBe('automatic');
  });

  it('creates and lists snapshots', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('snap-project');
    await engine.createBackup('proj-2', 'snapshot', doc, 'Snap Project', 1, 'Initial design');
    await engine.createBackup('proj-2', 'snapshot', doc, 'Snap Project', 2, 'After layout change');
    const backups = await engine.listBackups('proj-2');
    expect(backups.length).toBe(2);
  });

  it('retrieves manifest and document', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('retrieve-test');
    const result = await engine.createBackup('proj-3', 'automatic', doc, 'Retrieve Test', 1);
    const manifest = await engine.getBackupManifest(result.backupId!);
    expect(manifest).toBeTruthy();
    expect(manifest!.sourceName).toBe('Retrieve Test');
    const document = await engine.getBackupDocument(result.backupId!);
    expect(document).toBe(doc);
  });

  it('deletes a backup', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('delete-test');
    const r1 = await engine.createBackup('proj-4', 'automatic', doc, 'Delete Test', 1);
    const r2 = await engine.createBackup('proj-4', 'snapshot', doc, 'Delete Test', 2);
    expect((await engine.listBackups('proj-4')).length).toBe(2);
    await engine.deleteBackup('proj-4', r1.backupId!);
    const backups = await engine.listBackups('proj-4');
    expect(backups.length).toBe(1);
    expect(backups[0]!.id).toBe(r2.backupId);
  });

  it('filters backups by type', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('filter-test');
    await engine.createBackup('proj-5', 'automatic', doc, 'Filter Test', 1);
    await engine.createBackup('proj-5', 'snapshot', doc, 'Filter Test', 2, 'My snapshot');
    const autoBackups = await engine.listBackups('proj-5', { types: ['automatic'] });
    expect(autoBackups.length).toBe(1);
    expect(autoBackups[0]!.type).toBe('automatic');
    const snapBackups = await engine.listBackups('proj-5', { types: ['snapshot'] });
    expect(snapBackups.length).toBe(1);
  });

  it('applies retention', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('retention-test');
    for (let i = 0; i < 10; i++) {
      await engine.createBackup('proj-6', 'automatic', doc, `Retention ${i}`, i);
    }
    const config = { ...DEFAULT_RETENTION, maxEntryCount: 5, maxTotalBytes: 1_000_000_000 };
    const removed = await engine.applyRetention('proj-6', config);
    expect(removed).toBeGreaterThan(0);
    expect((await engine.listBackups('proj-6')).length).toBeLessThanOrEqual(5);
  });

  it('verifies backups', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('verify-test');
    const result = await engine.createBackup('proj-7', 'automatic', doc, 'Verify Test', 1);
    const verification = await engine.verifyBackupById(result.backupId!);
    expect(verification.valid).toBe(true);
    expect(verification.status).toBe('verified');
  });

  it('verifies all backups for a project', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('verify-all');
    for (let i = 0; i < 3; i++) {
      await engine.createBackup('proj-9', 'automatic', doc, 'Verify All', i);
    }
    const result = await engine.verifyAllBackups('proj-9');
    expect(result.total).toBe(3);
    expect(result.valid).toBe(3);
  });

  it('exports and imports archives', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('archive-test');
    const r1 = await engine.createBackup('proj-10', 'snapshot', doc, 'Archive Test', 1);
    const r2 = await engine.createBackup('proj-10', 'automatic', doc, 'Archive Test', 2);
    const archiveData = await engine.exportBackups([r1.backupId!, r2.backupId!]);
    expect(archiveData.length).toBeGreaterThan(0);

    const destStore = createMemoryBackupStore();
    const destEngine = new BackupEngine(destStore);
    const importResult = await destEngine.importArchive(archiveData);
    expect(importResult.success).toBe(true);
    expect(importResult.importedCount).toBeGreaterThan(0);

    const projects = await destStore.listProjects();
    expect(projects.length).toBe(1);
    expect(projects[0]).toBe('proj-10');

    const allDocs = await destStore.readBackupDocument(r1.backupId!);
    expect(allDocs).not.toBeNull();

    const index = await destStore.getProjectIndex('proj-10');
    expect(index).not.toBeNull();
    expect(index!.backups.length).toBe(2);

    const imported = await destEngine.listBackups('proj-10');
    expect(imported.length).toBe(2);
  });

  it('generates unique backup IDs', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('unique-ids');
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const result = await engine.createBackup('proj-11', 'automatic', doc, `Unique ${i}`, i);
      ids.add(result.backupId!);
    }
    expect(ids.size).toBe(10);
  });

  it('handles multiple projects', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc1 = makeDocumentJson('proj-a');
    const doc2 = makeDocumentJson('proj-b');
    await engine.createBackup('proj-a', 'automatic', doc1, 'Project A', 1);
    await engine.createBackup('proj-a', 'automatic', doc1, 'Project A', 2);
    await engine.createBackup('proj-b', 'automatic', doc2, 'Project B', 1);
    expect((await engine.listBackups('proj-a')).length).toBe(2);
    expect((await engine.listBackups('proj-b')).length).toBe(1);
  });

  it('reports storage info', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = makeDocumentJson('storage-info');
    await engine.createBackup('proj-12', 'automatic', doc, 'Storage Info', 1);
    const info = await engine.getStorageInfo();
    expect(info.projectCount).toBe(1);
    expect(info.entryCount).toBe(1);
    expect(info.totalBytes).toBeGreaterThan(0);
  });

  it('returns empty for unknown project', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const backups = await engine.listBackups('nonexistent');
    expect(backups).toEqual([]);
  });

  it('produces sha256-prefixed checksums', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = JSON.stringify({ formatVersion: '2.6', data: 'hello' });
    const result = await engine.createBackup('proj-sha', 'automatic', doc, 'SHA Test', 1);
    const manifest = await engine.getBackupManifest(result.backupId!);
    expect(manifest!.documentChecksum.startsWith('sha256-')).toBe(true);
    expect(manifest!.documentChecksum.length).toBe(71); // 'sha256-' + 64 hex
  });
});
