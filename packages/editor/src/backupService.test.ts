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
import { createPersistenceRevision } from './persistence/documentRevision';

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

    service.markDirty(projectId, () => first, 'Untitled', 1);
    await service.checkAndBackup(projectId, first, 'Untitled', 1);
    expect((await service.getBackups(projectId)).length).toBe(1);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(1);

    await service.checkAndBackup(projectId, first, 'Untitled', 1);
    expect((await service.getBackups(projectId)).length).toBe(1);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(1);

    const second = JSON.stringify({ v: 2 });
    service.markDirty(projectId, () => second, 'Untitled', 2);
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
    service.markDirty(projectId, () => json, 'Untitled', 1);
    await service.checkAndBackup(projectId, json, 'Untitled', 1);

    expect((await service.getBackups(projectId)).length).toBe(0);
    expect(getStorageWriteMetrics().byKind.backup.writes).toBe(0);
  });

  it('does not encode repeated dirty registrations until a backup is due', async () => {
    service = new BackupService({ intervalMs: 0 });
    await service.initialize();
    const projectId = uniqueProjectId();
    let encodes = 0;
    const first = () => {
      encodes++;
      return '{"revision":1}';
    };
    const latest = () => {
      encodes++;
      return '{"revision":2}';
    };

    service.markDirty(projectId, first, 'Untitled', 1);
    service.markDirty(projectId, latest, 'Untitled', 2);
    expect(encodes).toBe(0);

    await service.backupAllDirty();
    expect(encodes).toBe(1);
    await service.backupAllDirty();
    expect(encodes).toBe(1);
  });

  it('retains a failed lazy serialization for a later retry', async () => {
    service = new BackupService({ intervalMs: 0 });
    await service.initialize();
    const projectId = uniqueProjectId();
    let attempts = 0;
    service.markDirty(
      projectId,
      () => {
        attempts++;
        if (attempts === 1) throw new Error('encode failed');
        return '{"retry":true}';
      },
      'Untitled',
      1,
    );

    expect((await service.backupAllDirty()).failed).toBe(1);
    expect((await service.backupAllDirty()).backedUp).toBe(1);
    expect(attempts).toBe(2);
  });

  it('queues automatic serialization instead of starting during an interaction', async () => {
    const queued: Array<() => void> = [];
    service = new BackupService(
      { intervalMs: 0 },
      { scheduleBackground: (job) => queued.push(job) },
    );
    await service.initialize();
    const projectId = uniqueProjectId();
    let encodes = 0;
    service.markDirty(
      projectId,
      () => {
        encodes++;
        return '{"background":true}';
      },
      'Untitled',
      1,
    );

    await (service as unknown as { tick: () => Promise<void> }).tick();
    expect(encodes).toBe(0);
    expect(queued).toHaveLength(1);
    queued.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(encodes).toBe(1);
  });

  it('does not clear a newer revision when an older backup completes', async () => {
    service = new BackupService({ intervalMs: 0 });
    await service.initialize();
    const projectId = uniqueProjectId();
    const first = {
      ...createPersistenceRevision({
        sessionId: `${projectId}-session`,
        projectId,
        fileName: 'Untitled',
        revision: 1,
        document: {} as never,
      }),
      materialize: () => '{"revision":1}',
    };
    const latest = {
      ...createPersistenceRevision({
        sessionId: `${projectId}-session`,
        projectId,
        fileName: 'Untitled',
        revision: 2,
        document: {} as never,
      }),
      materialize: () => '{"revision":2}',
    };
    service.markDirty(first);
    const oldBackup = service.backupAllDirty();
    service.markDirty(latest);
    expect((await oldBackup).backedUp).toBe(1);
    expect((await service.backupAllDirty()).backedUp).toBe(1);
    expect((await service.getBackups(projectId)).length).toBe(2);
  });

  it('keeps manual Backup Now available when automatic backups are disabled', async () => {
    service = new BackupService({ enabled: false, intervalMs: 0 });
    await service.initialize();
    const projectId = uniqueProjectId();
    service.markDirty(projectId, () => '{"manual":true}', 'Untitled', 1);
    expect((await service.backupAllDirty()).backedUp).toBe(1);
    expect((await service.getBackups(projectId)).length).toBe(1);
  });

  it('discards only the closed session revision', async () => {
    service = new BackupService({ enabled: false });
    await service.initialize();
    const first = {
      ...createPersistenceRevision({
        sessionId: 'closed-session',
        projectId: uniqueProjectId(),
        fileName: 'Closed',
        revision: 1,
        document: {} as never,
      }),
      materialize: () => '{"closed":true}',
    };
    const second = {
      ...createPersistenceRevision({
        sessionId: 'open-session',
        projectId: uniqueProjectId(),
        fileName: 'Open',
        revision: 1,
        document: {} as never,
      }),
      materialize: () => '{"open":true}',
    };
    service.markDirty(first);
    service.markDirty(second);
    service.discardSession(first.sessionId);
    expect(await service.backupAllDirty()).toEqual({ backedUp: 1, failed: 0 });
  });
});
