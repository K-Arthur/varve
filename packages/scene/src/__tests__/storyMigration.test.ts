/**
 * v2.18 story migration (M9, ADR-0159): text chains become authoritative
 * stories with thread bindings on every frame.
 */
import { describe, expect, it } from 'vitest';
import { validateStoryThreads } from '../storyOps';
import { migrateV217ToV218 } from '../version-migrations-v218';

function chainDocRaw() {
  return {
    formatVersion: '2.17',
    id: 'doc',
    name: 'T',
    nextId: 10,
    rootChildren: ['f1', 'f2'],
    nodes: {
      f1: {
        id: 'f1',
        kind: 'text',
        text: 'fallback',
        transform: [1, 0, 0, 1, 0, 0],
        fontSize: 12,
        richText: { paragraphs: [{ runs: [{ text: 'Chain rich text' }] }] },
      },
      f2: { id: 'f2', kind: 'text', text: 'Second', transform: [1, 0, 0, 1, 0, 0], fontSize: 12 },
    },
    textChains: {
      'chain-1': { id: 'chain-1', name: 'Body', frameIds: ['f1', 'f2'] },
    },
  };
}

describe('v2.18 story migration', () => {
  it('promotes chains to stories with thread bindings', () => {
    const migrated = migrateV217ToV218(chainDocRaw());
    expect(migrated.formatVersion).toBe('2.18');
    const stories = migrated.stories as Record<
      string,
      { id: string; name: string; content: { paragraphs: unknown[] }; thread: string[] }
    >;
    expect(Object.keys(stories)).toEqual(['chain-1']);
    expect(stories['chain-1']!.name).toBe('Body');
    expect(stories['chain-1']!.thread).toEqual(['f1', 'f2']);
    // Content comes from the chain's richText when present.
    expect(stories['chain-1']!.content.paragraphs).toHaveLength(1);
    // Frames are bound.
    const f1 = (migrated.nodes as Record<string, { storyBinding?: unknown }>).f1;
    expect(f1!.storyBinding).toEqual({ storyId: 'chain-1', threadIndex: 0 });
    const f2 = (migrated.nodes as Record<string, { storyBinding?: unknown }>).f2;
    expect(f2!.storyBinding).toEqual({ storyId: 'chain-1', threadIndex: 1 });
    // Legacy chains are dropped — stories are authoritative.
    expect('textChains' in migrated).toBe(false);
  });

  it('falls back to the first frame richText, then plain text', () => {
    const raw = chainDocRaw() as Record<string, unknown> & {
      textChains?: Record<string, { richText?: unknown }>;
    };
    delete raw.textChains!['chain-1']!.richText;
    const migrated = migrateV217ToV218(raw);
    const stories = migrated.stories as Record<string, { content: { paragraphs: unknown[] } }>;
    expect(stories['chain-1']!.content.paragraphs).toHaveLength(1);

    // Strip the frame richText too: plain text becomes a single run.
    const raw2 = chainDocRaw() as Record<string, unknown> & {
      textChains?: Record<string, { richText?: unknown }>;
      nodes: Record<string, { richText?: unknown }>;
    };
    delete raw2.textChains!['chain-1']!.richText;
    const nodes = raw2.nodes;
    delete nodes.f1!.richText;
    const migrated2 = migrateV217ToV218(raw2);
    const s2 = migrated2.stories as Record<
      string,
      { content: { paragraphs: { runs: { text: string }[] }[] } }
    >;
    expect(s2['chain-1']!.content.paragraphs[0]!.runs[0]!.text).toBe('fallback');
  });

  it('stamps documents without chains and is idempotent', () => {
    const raw = { ...chainDocRaw() } as Record<string, unknown> & {
      textChains?: unknown;
    };
    delete raw.textChains;
    const migrated = migrateV217ToV218(raw);
    expect(migrated.formatVersion).toBe('2.18');
    expect('stories' in migrated).toBe(false);

    const migrated2 = migrateV217ToV218(chainDocRaw());
    const again = migrateV217ToV218(migrated2 as Record<string, unknown>);
    expect(again.formatVersion).toBe('2.18');
    expect(validateStoryThreads(again as never)).toEqual([]);
  });
});
