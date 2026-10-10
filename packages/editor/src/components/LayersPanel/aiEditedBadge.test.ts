/**
 * Tests for AI-edited badge helpers.
 */

import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { formatAiEditTimestamp, getNodeAiEditInfo } from './aiEditedBadge';

describe('getNodeAiEditInfo', () => {
  it('returns null when document has no generative edits', () => {
    const doc = createDocument();
    const result = getNodeAiEditInfo(doc, 'n1');
    expect(result).toBeNull();
  });

  it('returns null when node has no AI provenance', () => {
    const doc = createDocument();
    doc.generativeEdits = {
      'edit-1': {
        schemaVersion: 2,
        id: 'edit-1',
        mode: 'fill',
        sourceNodeId: 'n1',
        resultNodeId: 'n2', // Different node
        sourceLocator: 'n1/fill.0',
        sourceRevision: 1,
        placementRevision: '1',
        masks: {
          userMaskAssetId: 'mask-1',
          width: 100,
          height: 100,
          offsetX: 0,
          offsetY: 0,
          coordinateSpace: 'source-image-pixels',
        },
        outputFrame: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          sourceWidth: 100,
          sourceHeight: 100,
          coordinateSpace: 'source-image-pixels',
        },
        maskAssetId: 'mask-1',
        maskWidth: 100,
        maskHeight: 100,
        maskCoordinateSpace: 'source-image-pixels',
        settings: {
          quality: 'balanced',
          contextPadding: 32,
          maskExpansion: 0,
          feather: 0,
        },
        provider: {
          kind: 'local',
          id: 'lama',
          modelId: 'lama',
          runtime: 'native-cpu',
        },
        variations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };

    const result = getNodeAiEditInfo(doc, 'n3'); // Unrelated node
    expect(result).toBeNull();
  });

  it('detects AI edit when node is result of generative edit', () => {
    const doc = createDocument();
    const now = Date.now();
    doc.generativeEdits = {
      'edit-1': {
        schemaVersion: 2,
        id: 'edit-1',
        mode: 'fill',
        sourceNodeId: 'n1',
        resultNodeId: 'n2',
        sourceLocator: 'n1/fill.0',
        sourceRevision: 1,
        placementRevision: '1',
        masks: {
          userMaskAssetId: 'mask-1',
          width: 100,
          height: 100,
          offsetX: 0,
          offsetY: 0,
          coordinateSpace: 'source-image-pixels',
        },
        outputFrame: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          sourceWidth: 100,
          sourceHeight: 100,
          coordinateSpace: 'source-image-pixels',
        },
        maskAssetId: 'mask-1',
        maskWidth: 100,
        maskHeight: 100,
        maskCoordinateSpace: 'source-image-pixels',
        settings: {
          quality: 'balanced',
          contextPadding: 32,
          maskExpansion: 0,
          feather: 0,
        },
        provider: {
          kind: 'local',
          id: 'lama',
          modelId: 'lama-fp32',
          runtime: 'native-cpu',
        },
        variations: [],
        createdAt: now,
        updatedAt: now,
      },
    };

    const result = getNodeAiEditInfo(doc, 'n2');
    expect(result).not.toBeNull();
    expect(result?.label).toBe('AI Fill');
    expect(result?.model).toBe('lama-fp32');
    expect(result?.mode).toBe('fill');
    expect(result?.timestamp).toBe(now);
  });

  it('detects AI edit with PatchMatch runtime', () => {
    const doc = createDocument();
    const now = Date.now();
    doc.generativeEdits = {
      'edit-1': {
        schemaVersion: 2,
        id: 'edit-1',
        mode: 'remove',
        sourceNodeId: 'n1',
        resultNodeId: 'n2',
        sourceLocator: 'n1/fill.0',
        sourceRevision: 1,
        placementRevision: '1',
        masks: {
          userMaskAssetId: 'mask-1',
          width: 100,
          height: 100,
          offsetX: 0,
          offsetY: 0,
          coordinateSpace: 'source-image-pixels',
        },
        outputFrame: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          sourceWidth: 100,
          sourceHeight: 100,
          coordinateSpace: 'source-image-pixels',
        },
        maskAssetId: 'mask-1',
        maskWidth: 100,
        maskHeight: 100,
        maskCoordinateSpace: 'source-image-pixels',
        settings: {
          quality: 'draft',
          contextPadding: 32,
          maskExpansion: 0,
          feather: 0,
        },
        provider: {
          kind: 'local',
          id: 'patchmatch',
          runtime: 'patchmatch',
        },
        variations: [],
        createdAt: now,
        updatedAt: now,
      },
    };

    const result = getNodeAiEditInfo(doc, 'n2');
    expect(result).not.toBeNull();
    expect(result?.label).toBe('AI Remove');
    expect(result?.model).toBe('PatchMatch');
  });
});

describe('formatAiEditTimestamp', () => {
  it('formats recent edits as relative time', () => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const result = formatAiEditTimestamp(fiveMinutesAgo);
    expect(result).toBe('5m ago');
  });

  it('formats edits within an hour as minutes', () => {
    const now = Date.now();
    const thirtyMinutesAgo = now - 30 * 60 * 1000;
    const result = formatAiEditTimestamp(thirtyMinutesAgo);
    expect(result).toBe('30m ago');
  });

  it('formats edits within a day as hours', () => {
    const now = Date.now();
    const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
    const result = formatAiEditTimestamp(fiveHoursAgo);
    expect(result).toBe('5h ago');
  });

  it('formats recent edits within a week as days', () => {
    const now = Date.now();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const result = formatAiEditTimestamp(threeDaysAgo);
    expect(result).toBe('3d ago');
  });

  it('formats old edits as absolute date', () => {
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const result = formatAiEditTimestamp(twoWeeksAgo);
    // Should be a formatted date like "Oct 25, 2026"
    expect(result).toMatch(/\w+ \d{1,2}, \d{4}/);
  });

  it('handles invalid timestamps gracefully', () => {
    const result = formatAiEditTimestamp(Number.NaN);
    expect(result).toBe('unknown');
  });
});
