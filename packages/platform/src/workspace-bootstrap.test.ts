import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Workspace bootstrap contract (design-system audit 2026-09-27).
 *
 * The first boot auto-creates a "Personal" workspace. With a random uuid and
 * a check-then-put sequence, two concurrent boots (dev StrictMode double
 * init, two windows opening together) each saw an empty store and each
 * created their own row — the Home switcher then listed two workspaces both
 * named "Personal" (observed live: 5 options where 3 were seeded). A fixed
 * key makes the write idempotent, and it is the id HomeShell already uses as
 * its fallback (`view.activeWorkspaceId ?? 'personal'`).
 */
describe('workspace bootstrap', () => {
  beforeEach(async () => {
    const fdb = await import('fake-indexeddb');
    vi.stubGlobal('indexedDB', new fdb.IDBFactory());
    for (const name of [
      'IDBKeyRange',
      'IDBRequest',
      'IDBOpenDBRequest',
      'IDBDatabase',
      'IDBTransaction',
      'IDBObjectStore',
      'IDBIndex',
      'IDBCursor',
      'IDBCursorWithValue',
      'IDBVersionChangeEvent',
    ] as const) {
      vi.stubGlobal(name, fdb[name]);
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('memory platform bootstraps one Personal workspace with the stable id', async () => {
    const { createMemoryPlatform } = await import('./memory');
    const workspaces = await createMemoryPlatform().listWorkspaces();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).toBe('personal');
    expect(workspaces[0]?.name).toBe('Personal');
  });

  it('concurrent web boots converge on a single Personal row', async () => {
    const { createWebPlatform } = await import('./web');
    const [first, second] = await Promise.all([createWebPlatform(), createWebPlatform()]);

    const rows = await first.listWorkspaces();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('personal');
    expect(rows[0]?.name).toBe('Personal');

    // The second boot sees the same store (both opened the same database).
    expect(await second.listWorkspaces()).toHaveLength(1);
  });
});
