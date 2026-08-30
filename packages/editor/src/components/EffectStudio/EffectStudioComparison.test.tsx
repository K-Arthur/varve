// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeAdjustment } from '@varve/engine';
import { createDocument, makePathNode, makeShapeNode, type SceneNode } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../thumbnail/thumbnailService', () => ({
  renderDocThumbnail: vi.fn(),
}));

import { renderDocThumbnail } from '../../thumbnail/thumbnailService';
import { EffectStudioComparison } from './EffectStudioComparison';

const mockedRenderDocThumbnail = vi.mocked(renderDocThumbnail);

function effectNode(): SceneNode {
  return {
    ...makeShapeNode(
      'shape-1',
      { kind: 'rect', x: 0, y: 0, w: 160, h: 100 },
      { name: 'Selected shape' },
    ),
    smartFilters: [makeAdjustment('grain-1', 'grain')],
  } as SceneNode;
}

function effectPathNode() {
  return {
    ...makePathNode('path-1', {
      closed: true,
      points: [
        { x: 0, y: 0, handleIn: null, handleOut: null },
        { x: 160, y: 0, handleIn: null, handleOut: null },
        { x: 80, y: 120, handleIn: null, handleOut: null },
      ],
    }),
    smartFilters: [makeAdjustment('grain-1', 'grain')],
  };
}

function testDocument(node: SceneNode) {
  return {
    ...createDocument('Test', true),
    nodes: { [node.id]: node },
    rootChildren: [node.id],
  };
}

describe('EffectStudioComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders canonical original and effect variants in a real split preview', async () => {
    const node = effectNode();
    mockedRenderDocThumbnail
      .mockResolvedValueOnce({
        result: { dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
      } as Awaited<ReturnType<typeof renderDocThumbnail>>)
      .mockResolvedValueOnce({
        result: { dataUrl: 'data:image/png;base64,ZWZmZWN0cw==' },
      } as Awaited<ReturnType<typeof renderDocThumbnail>>);

    render(<EffectStudioComparison document={testDocument(node)} node={node} hasEffects />);

    expect(
      await screen.findByAltText('Original selected object without Object Filters'),
    ).toHaveAttribute('src', 'data:image/png;base64,b3JpZ2luYWw=');
    expect(screen.getByAltText('Selected object with its Object Filters')).toHaveAttribute(
      'src',
      'data:image/png;base64,ZWZmZWN0cw==',
    );
    expect(screen.getByTestId('effect-studio-preview-stage')).toHaveAttribute(
      'data-view',
      'compare',
    );

    fireEvent.change(screen.getByRole('slider', { name: 'Before and after split' }), {
      target: { value: '72' },
    });
    expect(screen.getByText('72% original')).toBeInTheDocument();

    const [originalDocument, effectsDocument] = mockedRenderDocThumbnail.mock.calls.map(
      ([rendered]) => rendered,
    );
    expect(originalDocument?.nodes[node.id]?.smartFiltersEnabled).toBe(false);
    expect(effectsDocument?.nodes[node.id]?.smartFiltersEnabled).toBe(true);
  });

  it('keeps the original preview available when no treatment is applied yet', async () => {
    const node = effectNode();
    mockedRenderDocThumbnail.mockResolvedValueOnce({
      result: { dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
    } as Awaited<ReturnType<typeof renderDocThumbnail>>);

    render(<EffectStudioComparison document={testDocument(node)} node={node} hasEffects={false} />);

    expect(
      await screen.findByAltText('Original selected object without Object Filters'),
    ).toHaveAttribute('src', 'data:image/png;base64,b3JpZ2luYWw=');
    expect(screen.getByRole('button', { name: 'Effects' })).toBeDisabled();
    expect(mockedRenderDocThumbnail).toHaveBeenCalledTimes(1);
  });

  it('does not discard the original when the effects variant fails to render', async () => {
    const node = effectNode();
    mockedRenderDocThumbnail
      .mockResolvedValueOnce({
        result: { dataUrl: 'data:image/png;base64,b3JpZ2luYWw=' },
      } as Awaited<ReturnType<typeof renderDocThumbnail>>)
      .mockRejectedValueOnce(new Error('effects renderer unavailable'));

    render(<EffectStudioComparison document={testDocument(node)} node={node} hasEffects />);

    expect(
      await screen.findByAltText('Original selected object without Object Filters'),
    ).toBeInTheDocument();
    expect(screen.getByText(/effects render could not be generated/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare before and after' })).toBeDisabled();
  });

  it('keeps a legacy vector path intact in both thumbnail-rendered variants', async () => {
    const node = effectPathNode();
    mockedRenderDocThumbnail
      .mockResolvedValueOnce({
        result: { dataUrl: 'data:image/png;base64,cGF0aC1vcmlnaW5hbA==' },
      } as Awaited<ReturnType<typeof renderDocThumbnail>>)
      .mockResolvedValueOnce({
        result: { dataUrl: 'data:image/png;base64,cGF0aC1lZmZlY3Rz' },
      } as Awaited<ReturnType<typeof renderDocThumbnail>>);

    render(<EffectStudioComparison document={testDocument(node)} node={node} hasEffects />);

    await screen.findByAltText('Original selected object without Object Filters');
    const [originalDocument, originalOptions] = mockedRenderDocThumbnail.mock.calls[0]!;
    const [effectsDocument, effectsOptions] = mockedRenderDocThumbnail.mock.calls[1]!;
    const originalPath = originalDocument.nodes[node.id];
    const effectsPath = effectsDocument.nodes[node.id];

    expect(originalPath).toMatchObject({
      kind: 'path',
      points: node.points,
      smartFiltersEnabled: false,
    });
    expect(effectsPath).toMatchObject({
      kind: 'path',
      points: node.points,
      smartFiltersEnabled: true,
    });
    expect(originalOptions.source).toEqual({ type: 'selection', nodeIds: [node.id] });
    expect(effectsOptions.source).toEqual({ type: 'selection', nodeIds: [node.id] });
  });
});
