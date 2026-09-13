/**
 * BackupService automatic-backup deduplication.
 *
 * Automatic backups previously rewrote the full document JSON every interval
 * for unchanged content because the dirty map outlives a manual save. These
 * tests pin the content-dedup contract and its logical write counter.
 */

import 'fake-indexeddb/auto';
import { getStorageWriteMetrics, resetStorageWriteMetrics } from '@varve/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupService } from './backupService';

function uniqueProjectId(): string {
  return `dedup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('BackupService automatic dedup', () => {
  let service: BackupService | null = null;

  beforeEach(() => {
    resetStorageWriteMetrics();
  });

  afterEach(async () => {
    await service?.shutdown();
    service = null;
  });

  it('skips an identical automatic backup and writes when content changes', async () => {
    service = new BackupService({ intervalMs: 0 });
    await service.initialize();
    const projectId = uniqueProjectId();
    const first = JSON.stringify({ v: 1 });

    service.markDirty(projectId, first, 'Untitled', 1);
    await service.checkAndBackup(projectId, first, 'Untitled', 1);
    expect((await service.getBackups(projectId)).length).toBe(1);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(1);

    await service.checkAndBackup(projectId, first, 'Untitled', 1);
    expect((await service.getBackups(projectId)).length).toBe(1);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(1);

    const second = JSON.stringify({ v: 2 });
    service.markDirty(projectId, second, 'Untitled', 2);
    await service.checkAndBackup(projectId, second, 'Untitled', 2);
    expect((await service.getBackups(projectId)).length).toBe(2);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(2);
  });

  it('does not rewrite saved content when it becomes dirty again unchanged', async () => {
    service = new BackupService({ intervalMs: 0 });
    await service.initialize();
    const projectId = uniqueProjectId();
    const json = JSON.stringify({ saved: true });

    await service.markSaved(projectId, json, 'Untitled', 1);
    service.markDirty(projectId, json, 'Untitled', 1);
    await service.checkAndBackup(projectId, json, 'Untitled', 1);

    expect((await service.getBackups(projectId)).length).toBe(0);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(0);
  });
});
