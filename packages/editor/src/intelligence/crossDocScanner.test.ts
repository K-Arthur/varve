// @ts-nocheck
import type { Platform } from '@varve/platform';
import type { Document } from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { scanCrossDocument } from './crossDocScanner';

function makeMinDoc(overrides?: Partial<Document>): Document {
  return {
    id: 'doc1',
    name: 'Current Doc',
    formatVersion: '2.0',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
    ...overrides,
  };
}

describe('scanCrossDocument', () => {
  it('returns empty when no platform provided', async () => {
    const doc = makeMinDoc();
    const issues = await scanCrossDocument(doc, undefined);
    expect(issues).toEqual([]);
  });

  it('returns empty when platform has no searchFileContent', async () => {
    const platform = { kind: 'memory' } as unknown as Platform;
    const doc = makeMinDoc();
    const issues = await scanCrossDocument(doc, platform);
    expect(issues).toEqual([]);
  });

  it('returns empty when no related files exist', async () => {
    const platform: Platform = {
      kind: 'memory',
      listFiles: vi.fn().mockResolvedValue([]),
      searchFileContent: vi.fn().mockResolvedValue([]),
    } as unknown as Platform;

    const doc = makeMinDoc();
    const issues = await scanCrossDocument(doc, platform);
    expect(issues).toEqual([]);
  });

  it('detects color drift from swatches', async () => {
    const platform: Platform = {
      kind: 'memory',
      listFiles: vi.fn().mockResolvedValue([
        {
          id: 'f2',
          name: 'Other File',
          projectId: null,
          kind: 'document',
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
      searchFileContent: vi.fn().mockImplementation((fileId: string, _query: string) => {
        if (fileId === 'f2') return Promise.resolve(['line 1']);
        return Promise.resolve([]);
      }),
    } as unknown as Platform;

    const doc = makeMinDoc({
      swatches: [
        {
          id: 'sw1',
          name: 'Primary',
          color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
        },
      ],
    });

    const issues = await scanCrossDocument(doc, platform);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.issueType).toBe('color-drift');
    expect(issues[0]!.fileId).toBe('f2');
  });

  it('detects component misuse', async () => {
    const platform: Platform = {
      kind: 'memory',
      listFiles: vi.fn().mockResolvedValue([
        {
          id: 'f2',
          name: 'Other File',
          projectId: null,
          kind: 'document',
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
      searchFileContent: vi.fn().mockResolvedValue(['line 1']),
    } as unknown as Platform;

    const doc = makeMinDoc({
      components: {
        c1: {
          id: 'c1',
          name: 'Button',
          slots: [],
          propertySets: [],
          variants: [],
        },
      },
    });

    const issues = await scanCrossDocument(doc, platform);
    const compIssues = issues.filter((i) => i.issueType === 'component-misuse');
    expect(compIssues.length).toBeGreaterThan(0);
    expect(compIssues[0]!.message).toContain('Button');
  });

  it('detects style duplication', async () => {
    const platform: Platform = {
      kind: 'memory',
      listFiles: vi.fn().mockResolvedValue([
        {
          id: 'f2',
          name: 'Other File',
          projectId: null,
          kind: 'document',
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
      searchFileContent: vi.fn().mockResolvedValue(['line 1']),
    } as unknown as Platform;

    const doc = makeMinDoc({
      styles: {
        s1: {
          id: 's1',
          type: 'color',
          name: 'primary-teal',
          fill: {
            type: 'solid',
            color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
          },
        },
      },
    });

    const issues = await scanCrossDocument(doc, platform);
    const styleIssues = issues.filter((i) => i.issueType === 'style-duplication');
    expect(styleIssues.length).toBeGreaterThan(0);
    expect(styleIssues[0]!.message).toContain('primary-teal');
  });

  it('handles platform.searchFileContent rejection gracefully', async () => {
    const platform: Platform = {
      kind: 'memory',
      listFiles: vi.fn().mockResolvedValue([
        {
          id: 'f2',
          name: 'Other File',
          projectId: null,
          kind: 'document',
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
      searchFileContent: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as Platform;

    const doc = makeMinDoc({
      swatches: [
        { id: 'sw1', name: 'Primary', color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      ],
    });

    const issues = await scanCrossDocument(doc, platform);
    expect(issues).toEqual([]);
  });

  it('is deterministic across calls', async () => {
    const platform: Platform = {
      kind: 'memory',
      listFiles: vi.fn().mockResolvedValue([
        {
          id: 'f2',
          name: 'Other File',
          projectId: null,
          kind: 'document',
          createdAt: 0,
          updatedAt: 0,
        },
      ]),
      searchFileContent: vi.fn().mockResolvedValue(['line 1']),
    } as unknown as Platform;

    const doc = makeMinDoc({
      swatches: [
        { id: 'sw1', name: 'Primary', color: { space: 'rgb', r: 57, g: 208, b: 198, a: 255 } },
      ],
    });

    const r1 = await scanCrossDocument(doc, platform);
    const r2 = await scanCrossDocument(doc, platform);
    expect(r1).toEqual(r2);
  });
});
