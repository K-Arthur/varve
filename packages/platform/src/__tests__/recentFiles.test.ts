import { describe, expect, it } from 'vitest';
import { createMemoryPlatform } from '../memory';
import {
  compareRecentBy,
  filterRecentByWorkspace,
  recentFileSections,
  recentRelevanceScore,
} from '../pure';
import type { EditorWorkspaceMode, RecentFileRecord } from '../types';
import {
  DEFAULT_RECENT_WORKSPACE_FILTER,
  MAX_RECENT_FILES,
  RECENT_FILE_SCHEMA_VERSION,
} from '../types';

function makeRecord(
  overrides: Partial<RecentFileRecord> & { id: string; name: string },
): RecentFileRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    lastOpenedAt: overrides.lastOpenedAt ?? Date.now(),
    openedCount: overrides.openedCount ?? 1,
    pinned: overrides.pinned ?? false,
    hidden: overrides.hidden ?? false,
    workspaceRelevance: overrides.workspaceRelevance ?? [],
    userWorkspaceTag: overrides.userWorkspaceTag ?? null,
    encrypted: overrides.encrypted ?? false,
    missing: overrides.missing ?? false,
    version: RECENT_FILE_SCHEMA_VERSION,
    sourceWorkspaceId: overrides.sourceWorkspaceId,
    contentHash: overrides.contentHash,
  };
}

describe('RecentFileRecord schema', () => {
  it('creates a valid record', () => {
    const r: RecentFileRecord = {
      id: 'uuid-1',
      name: 'My Design',
      lastOpenedAt: 1000,
      openedCount: 3,
      pinned: true,
      hidden: false,
      workspaceRelevance: ['design', 'drawing'],
      userWorkspaceTag: null,
      encrypted: false,
      missing: false,
      version: 1,
    };
    expect(r.id).toBe('uuid-1');
    expect(r.name).toBe('My Design');
    expect(r.pinned).toBe(true);
    expect(r.workspaceRelevance).toContain('design');
  });

  it('version is set correctly', () => {
    expect(RECENT_FILE_SCHEMA_VERSION).toBe(1);
  });

  it('MAX_RECENT_FILES is reasonable', () => {
    expect(MAX_RECENT_FILES).toBe(100);
  });

  it('DEFAULT_RECENT_WORKSPACE_FILTER shows all', () => {
    expect(DEFAULT_RECENT_WORKSPACE_FILTER.mode).toBe('all');
  });
});

describe('compareRecentBy', () => {
  const a = makeRecord({ id: 'a', name: 'Alpha', lastOpenedAt: 100, openedCount: 2 });
  const b = makeRecord({ id: 'b', name: 'Beta', lastOpenedAt: 200, openedCount: 5 });

  it('sorts by lastOpenedAt descending', () => {
    const cmp = compareRecentBy('lastOpenedAt', 'desc');
    expect(cmp(a, b)).toBeGreaterThan(0); // b was opened later, so a < b desc
    expect(cmp(b, a)).toBeLessThan(0);
  });

  it('sorts by lastOpenedAt ascending', () => {
    const cmp = compareRecentBy('lastOpenedAt', 'asc');
    expect(cmp(a, b)).toBeLessThan(0);
    expect(cmp(b, a)).toBeGreaterThan(0);
  });

  it('sorts by openedCount descending', () => {
    const cmp = compareRecentBy('openedCount', 'desc');
    expect(cmp(a, b)).toBeGreaterThan(0);
  });

  it('sorts by name case-insensitive', () => {
    const cmp = compareRecentBy('name', 'asc');
    expect(cmp(a, b)).toBeLessThan(0);
  });
});

describe('recentRelevanceScore', () => {
  const designRecord = makeRecord({
    id: 'd1',
    name: 'Design',
    workspaceRelevance: ['design'],
    userWorkspaceTag: null,
  });
  const taggedRecord = makeRecord({
    id: 'd2',
    name: 'Tagged',
    workspaceRelevance: [],
    userWorkspaceTag: 'print',
  });
  const emptyRecord = makeRecord({
    id: 'd3',
    name: 'Empty',
    workspaceRelevance: [],
    userWorkspaceTag: null,
  });

  it('exact user tag match scores 1', () => {
    expect(recentRelevanceScore(taggedRecord, 'print')).toBe(1);
  });

  it('user tag mismatch scores 0 even if relevance matches', () => {
    // taggedRecord has userWorkspaceTag='print', so 'design' gets 0
    expect(recentRelevanceScore(taggedRecord, 'design')).toBe(0);
  });

  it('inferred relevance scores 0.5', () => {
    expect(recentRelevanceScore(designRecord, 'design')).toBe(0.5);
  });

  it('no relevance scores 0', () => {
    expect(recentRelevanceScore(designRecord, 'motion')).toBe(0);
  });

  it('empty record scores 0 for any mode', () => {
    expect(recentRelevanceScore(emptyRecord, 'design')).toBe(0);
  });
});

describe('filterRecentByWorkspace', () => {
  const records = [
    makeRecord({ id: 'r1', name: 'Design', workspaceRelevance: ['design'] }),
    makeRecord({
      id: 'r2',
      name: 'Print',
      workspaceRelevance: ['print'],
      userWorkspaceTag: 'print',
    }),
    makeRecord({ id: 'r3', name: 'Drawing', workspaceRelevance: ['drawing'] }),
    makeRecord({ id: 'r4', name: 'General', workspaceRelevance: [] }),
    makeRecord({ id: 'r5', name: 'Pinned', workspaceRelevance: ['design'], pinned: true }),
  ];

  it('mode=all returns all records', () => {
    const result = filterRecentByWorkspace(records, { mode: 'all' });
    expect(result).toHaveLength(5);
  });

  it('mode=relevant returns matching + unclassified for design', () => {
    const result = filterRecentByWorkspace(records, { mode: 'relevant', editorMode: 'design' });
    const ids = result.map((r) => r.id);
    // r1 (design relevance) + r4 (unclassified) + r5 (design relevance)
    expect(ids).toContain('r1');
    expect(ids).toContain('r4');
    expect(ids).toContain('r5');
    expect(ids).not.toContain('r2');
    expect(ids).not.toContain('r3');
  });

  it('mode=workspace-tagged returns only tagged + relevant for print', () => {
    const result = filterRecentByWorkspace(records, {
      mode: 'workspace-tagged',
      editorMode: 'print',
    });
    const ids = result.map((r) => r.id);
    expect(ids).toContain('r2');
    expect(ids).not.toContain('r1');
    expect(ids).not.toContain('r4'); // unclassified not included
  });

  it('mode=pinned returns only pinned records', () => {
    const result = filterRecentByWorkspace(records, { mode: 'pinned' });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('r5');
  });

  it('returns all when no filter is provided', () => {
    const result = filterRecentByWorkspace(records, undefined, 'design');
    expect(result).toHaveLength(5);
  });

  it('returns all when no editorMode is provided', () => {
    const result = filterRecentByWorkspace(records, { mode: 'relevant' });
    expect(result).toHaveLength(5);
  });
});

describe('recentFileSections', () => {
  const records = [
    makeRecord({ id: 'r1', name: 'Design', workspaceRelevance: ['design'], pinned: true }),
    makeRecord({ id: 'r2', name: 'Print', workspaceRelevance: ['print'] }),
    makeRecord({ id: 'r3', name: 'Hidden', hidden: true }),
    makeRecord({ id: 'r4', name: 'General', workspaceRelevance: [] }),
  ];

  const sections = recentFileSections(records);

  it('all counts non-hidden', () => {
    expect(sections.all).toBe(3);
  });

  it('pinned counts pinned non-hidden', () => {
    expect(sections.pinned).toBe(1);
  });

  it('relevant counts by mode', () => {
    expect(sections.relevant('design')).toBe(1);
    expect(sections.relevant('print')).toBe(1);
    expect(sections.relevant('motion')).toBe(0);
  });

  it('hidden counts hidden entries', () => {
    expect(sections.hidden).toBe(1);
  });
});

describe('Memory platform recent-file operations', () => {
  it('starts with empty recent files', async () => {
    const p = createMemoryPlatform();
    const recent = await p.listRecentFiles();
    expect(recent).toHaveLength(0);
  });

  it('touchRecentFile creates a new record', async () => {
    const p = createMemoryPlatform();
    const record = await p.touchRecentFile('uuid-1', 'My Design');
    expect(record.id).toBe('uuid-1');
    expect(record.name).toBe('My Design');
    expect(record.openedCount).toBe(1);
    expect(record.lastOpenedAt).toBeGreaterThan(0);
    expect(record.version).toBe(RECENT_FILE_SCHEMA_VERSION);
  });

  it('touchRecentFile updates existing record', async () => {
    const p = createMemoryPlatform();
    await p.touchRecentFile('uuid-1', 'My Design');
    const record = await p.touchRecentFile('uuid-1', 'Updated Name');
    expect(record.name).toBe('Updated Name');
    expect(record.openedCount).toBe(2);
  });

  it('touchRecentFile with workspace and content hash', async () => {
    const p = createMemoryPlatform();
    const record = await p.touchRecentFile('uuid-1', 'My Design', 'workspace-1', 'abc123');
    expect(record.sourceWorkspaceId).toBe('workspace-1');
    expect(record.contentHash).toBe('abc123');
  });

  it('listRecentFiles returns sorted by lastOpenedAt desc', async () => {
    const p = createMemoryPlatform();
    await p.touchRecentFile('a', 'Alpha');
    await sleep(10);
    await p.touchRecentFile('b', 'Beta');
    const recent = await p.listRecentFiles();
    expect(recent[0]?.id).toBe('b');
    expect(recent[1]?.id).toBe('a');
  });

  it('patchRecentFile updates editable fields', async () => {
    const p = createMemoryPlatform();
    await p.touchRecentFile('uuid-1', 'My Design');
    await p.patchRecentFile('uuid-1', { pinned: true, hidden: false, userWorkspaceTag: 'print' });
    const recent = await p.listRecentFiles();
    expect(recent[0]?.pinned).toBe(true);
    expect(recent[0]?.userWorkspaceTag).toBe('print');
  });

  it('patchRecentFile is no-op for missing id', async () => {
    const p = createMemoryPlatform();
    await expect(p.patchRecentFile('nonexistent', { pinned: true })).resolves.toBeUndefined();
  });

  it('removeRecentFile removes entry', async () => {
    const p = createMemoryPlatform();
    await p.touchRecentFile('uuid-1', 'My Design');
    await p.removeRecentFile('uuid-1');
    const recent = await p.listRecentFiles();
    expect(recent).toHaveLength(0);
  });

  it('clearRecentHistory removes all entries', async () => {
    const p = createMemoryPlatform();
    await p.touchRecentFile('a', 'Alpha');
    await p.touchRecentFile('b', 'Beta');
    await p.clearRecentHistory();
    const recent = await p.listRecentFiles();
    expect(recent).toHaveLength(0);
  });

  it('enforces MAX_RECENT_FILES limit', async () => {
    const p = createMemoryPlatform();
    // Fill to MAX_RECENT_FILES + 10
    for (let i = 0; i < MAX_RECENT_FILES + 10; i++) {
      await p.touchRecentFile(`id-${i}`, `File ${i}`);
      await sleep(1);
    }
    const recent = await p.listRecentFiles();
    expect(recent.length).toBeLessThanOrEqual(MAX_RECENT_FILES);
    // Oldest entries should be evicted
    const ids = recent.map((r) => r.id);
    expect(ids).not.toContain('id-0');
    expect(ids).not.toContain('id-1');
  });

  it('does not affect non-recent file operations', async () => {
    const p = createMemoryPlatform();
    await p.touchRecentFile('uuid-1', 'My Design');
    const files = await p.listFiles();
    expect(files).toHaveLength(0); // Recent is separate from file index
  });
});

describe('Workspace mode type', () => {
  it('has expected modes', () => {
    const modes: EditorWorkspaceMode[] = [
      'design',
      'print',
      'drawing',
      'image',
      'motion',
      'codegen',
    ];
    expect(modes).toHaveLength(6);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
