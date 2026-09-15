import { describe, expect, it } from 'vitest';
import { CURRENT_DOCUMENT_VERSION, migrateDocument } from '../version';

describe('version 1.8 → 1.9 migration (mask fillRule)', () => {
  it('adds fillRule to existing clip masks', () => {
    const raw = {
      formatVersion: '1.8',
      nodes: {
        f1: {
          kind: 'frame',
          children: ['n1'],
          mask: { type: 'clip', sourceNodeId: 'n1', visible: true },
        },
        n1: { kind: 'shape', name: 'rect', shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 } },
      },
    };
    const result = migrateDocument(raw);
    const nodes = result?.nodes as Record<string, Record<string, unknown>>;
    const mask = nodes?.f1?.mask as Record<string, unknown> | undefined;
    expect(mask?.fillRule).toBe('nonzero');
    expect(mask?.type).toBe('clip');
  });

  it('does not overwrite existing fillRule', () => {
    const raw = {
      formatVersion: '1.8',
      nodes: {
        f1: {
          kind: 'frame',
          children: ['n1'],
          mask: { type: 'clip', sourceNodeId: 'n1', visible: true, fillRule: 'evenodd' },
        },
        n1: { kind: 'shape', name: 'rect', shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 } },
      },
    };
    const result = migrateDocument(raw);
    const nodes = result?.nodes as Record<string, Record<string, unknown>>;
    const mask = nodes?.f1?.mask as Record<string, unknown> | undefined;
    expect(mask?.fillRule).toBe('evenodd');
  });

  it('preserves vectorMask data during migration', () => {
    const raw = {
      formatVersion: '1.8',
      nodes: {
        f1: {
          kind: 'frame',
          children: [],
          mask: {
            type: 'clip',
            visible: true,
            vectorMask: {
              points: [{ x: 0, y: 0 }],
              closed: true,
            },
          },
        },
      },
    };
    const result = migrateDocument(raw);
    const nodes = result?.nodes as Record<string, Record<string, unknown>>;
    const vm = (nodes?.f1?.mask as Record<string, unknown>)?.vectorMask as
      | Record<string, unknown>
      | undefined;
    expect(vm).toBeDefined();
    expect((vm as { fillRule?: string })?.fillRule).toBe('nonzero');
  });

  it('sets formatVersion to 1.9', () => {
    const raw = { formatVersion: '1.8' };
    const result = migrateDocument(raw);
    expect(result?.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });
});
