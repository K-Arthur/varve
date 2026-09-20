import { describe, expect, it } from 'vitest';
import {
  applyComicWorkflowProfile,
  estimatePanelSplitRasterBytes,
  panelMetadata,
  rebaseRubyAnnotations,
  upsertStoryOutlineEntry,
  validateComicPublisherArtifacts,
  validateComicWorkflow,
} from './comicWorkflow';
import { addChild, addNode, createDocument, makeFrameNode } from './document';
import { resolveEditorSceneScope } from './editorSceneScope';
import { makeRasterLayerNode } from './rasterLayer';

describe('comic workflow metadata', () => {
  it('applies a profile without changing page geometry', () => {
    const doc = createDocument('manga');
    const page = doc.pages?.[0];
    const result = applyComicWorkflowProfile(doc, 'manga');
    expect(result.workflowProfile).toBe('manga');
    expect(result.paintingPpi).toBe(600);
    expect(result.pages?.[0]?.width).toBe(page?.width);
    expect(result.pages?.[0]?.height).toBe(page?.height);
  });

  it('validates outline references independently from layer order', () => {
    const doc = createDocument('outline');
    const pageId = doc.pages?.[0]?.id;
    expect(pageId).toBeTruthy();
    const withEntry = upsertStoryOutlineEntry(doc, {
      pageId: pageId!,
      status: 'planned',
      panelIds: ['missing-panel'],
      dialogueStoryIds: ['missing-story'],
    });
    const issues = validateComicWorkflow(withEntry);
    expect(issues.map((issue) => issue.code)).toEqual(['missing-panel', 'missing-story']);
  });

  it('estimates duplicated raster allocation before a split', () => {
    const base = createDocument('split');
    const raster = makeRasterLayerNode('raster', { width: 128, height: 128 });
    const frame = makeFrameNode('panel-source', {
      w: 400,
      h: 300,
      children: [],
      panel: panelMetadata('panel-source'),
    });
    const doc = addChild(addNode(base, frame), frame.id, raster);
    expect(estimatePanelSplitRasterBytes(doc, ['raster'], 4)).toBe(128 * 128 * 4 * 3);
  });

  it('marks ruby ranges stale when an edit overlaps their base text', () => {
    const shifted = rebaseRubyAnnotations('漢字', '新漢字', [
      { start: 0, end: 2, text: 'かんじ', language: 'ja' },
    ]);
    expect(shifted[0]).toMatchObject({ start: 1, end: 3 });
    expect(shifted[0]?.stale).toBeUndefined();
    const stale = rebaseRubyAnnotations('漢字', '新字', [
      { start: 0, end: 2, text: 'かんじ', language: 'ja' },
    ]);
    expect(stale[0]).toMatchObject({ start: 0, end: 2, stale: true });
  });

  it('validates encoded publisher artifacts against editable limits', () => {
    const issues = validateComicPublisherArtifacts(
      {
        id: 'webtoon',
        label: 'WEBTOON',
        source: 'test',
        sourcePublicationDate: '2024',
        verifiedAt: '2026-09-19',
        maxSliceWidth: 800,
        maxSliceHeight: 1280,
        maxFileBytes: 100,
      },
      [{ width: 801, height: 1281, byteLength: 101 }],
    );
    expect(issues.map((issue) => issue.code)).toEqual(['width', 'height', 'file-bytes']);
  });

  it('keeps a comic Draw document on its publishing page surface', () => {
    const doc = applyComicWorkflowProfile(createDocument('comic'), 'webtoon-vertical');
    const scope = resolveEditorSceneScope(doc, {
      workspaceMode: 'drawing',
      activePageId: doc.activePageId,
      activeDesignCanvasId: null,
    });
    expect(scope.context.base.kind).toBe('publishing');
  });
});
