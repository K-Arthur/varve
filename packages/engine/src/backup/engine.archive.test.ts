import { describe, expect, it } from 'vitest';
import { BackupEngine, createMemoryBackupStore } from './index';

describe('BackupEngine.createPortableArchive', () => {
  it('creates an archive with manifest and document entries', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = JSON.stringify({ formatVersion: '2.6', data: 'portable' });
    const result = await engine.createBackup('proj-1', 'snapshot', doc, 'Portable', 1);
    const archiveBytes = await engine.createPortableArchive(result.backupId!);
    const pkg = JSON.parse(new TextDecoder().decode(archiveBytes));
    expect(pkg.archiveType).toBe('project-backup');
    expect(pkg.entries.length).toBe(2);
    expect(pkg.entries[0]!.contentType).toBe('manifest');
    expect(pkg.entries[1]!.contentType).toBe('document');
    expect(pkg.schemaVersion).toBe('2.6');
  });

  it('includes embedded assets when provided', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    const doc = JSON.stringify({ formatVersion: '2.6' });
    const result = await engine.createBackup('proj-asset', 'snapshot', doc, 'With Assets', 1);
    const assets = new Map<string, { data: string; mimeType: string }>([
      ['abc123', { data: 'base64imagedata', mimeType: 'image/png' }],
    ]);
    const archiveBytes = await engine.createPortableArchive(result.backupId!, assets);
    const pkg = JSON.parse(new TextDecoder().decode(archiveBytes));
    const assetEntry = pkg.entries.find((e: { contentType: string }) => e.contentType === 'asset');
    expect(assetEntry).toBeTruthy();
    expect(assetEntry!.mimeType).toBe('image/png');
    expect(assetEntry!.data).toBe('base64imagedata');
    expect(assetEntry!.path).toBe('assets/abc123');
  });

  it('throws for unknown backup', async () => {
    const store = createMemoryBackupStore();
    const engine = new BackupEngine(store);
    await expect(engine.createPortableArchive('nonexistent')).rejects.toThrow();
  });
});
