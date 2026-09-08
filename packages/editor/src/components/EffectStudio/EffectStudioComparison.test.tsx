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

function outcome(dataUrl: string, metadata: Record<string, unknown> = {}) {
  return {
    result: { dataUrl, metadata },
    status: 'ready',
    qualityTier: 'editing-preview',
    renderer: 'canonical-engine',
    warnings: [],
    fallbackApplied: false,
  } as unknown as Awaited<ReturnType<typeof renderDocThumbnail>>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('EffectStudioComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders canonical original and effect variants in a real split preview', async () => {
    const node = { ...effectNode(), smartFiltersEnabled: true };
    const acceptedNode = {
      ...node,
      smartFilters: [makeAdjustment('accepted-1', 'grain')],
      smartFiltersEnabled: undefined,
    };
    mockedRenderDocThumbnail
      .mockResolvedValueOnce(outcome('data:image/png;base64,b3JpZ2luYWw='))
      .mockResolvedValueOnce(outcome('data:image/png;base64,ZWZmZWN0cw=='));

    render(
      <EffectStudioComparison
        document={testDocument(node)}
        baselineDocument={testDocument(acceptedNode)}
        node={node}
        hasEffects
        isDraftPreview
      />,
    );

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
    expect(screen.getByText('72% before')).toBeInTheDocument();

    const [originalDocument, effectsDocument] = mockedRenderDocThumbnail.mock.calls.map(
      ([rendered]) => rendered,
    );
    expect(originalDocument?.nodes[node.id]?.smartFiltersEnabled).toBeUndefined();
    expect(originalDocument?.nodes[node.id]?.smartFilters).toHaveLength(1);
    expect(effectsDocument?.nodes[node.id]?.smartFiltersEnabled).toBe(true);
    expect(effectsDocument?.nodes[node.id]?.smartFilters).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Before this edit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Current candidate' })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: 'Accepted result' })).toBeDisabled();
    expect(mockedRenderDocThumbnail).toHaveBeenCalledTimes(1);
  });

  it('does not discard the original when the effects variant fails to render', async () => {
    const node = effectNode();
    mockedRenderDocThumbnail
      .mockResolvedValueOnce(outcome('data:image/png;base64,b3JpZ2luYWw='))
      .mockRejectedValueOnce(new Error('effects renderer unavailable'));

    render(<EffectStudioComparison document={testDocument(node)} node={node} hasEffects />);

    expect(
      await screen.findByAltText('Original selected object without Object Filters'),
    ).toBeInTheDocument();
    expect(screen.getByText(/accepted result preview failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare before and after' })).toBeDisabled();
  });

  it('keeps a legacy vector path intact in both thumbnail-rendered variants', async () => {
    const node = effectPathNode();
    const acceptedNode = makePathNode('path-1', {
      closed: true,
      points: node.points,
    });
    mockedRenderDocThumbnail
      .mockResolvedValueOnce(outcome('data:image/png;base64,cGF0aC1vcmlnaW5hbA=='))
      .mockResolvedValueOnce(outcome('data:image/png;base64,cGF0aC1lZmZlY3M'));

    render(
      <EffectStudioComparison
        document={testDocument(node)}
        baselineDocument={testDocument(acceptedNode)}
        node={node}
        hasEffects
        isDraftPreview
      />,
    );

    await screen.findByAltText('Original selected object without Object Filters');
    const [originalDocument, originalOptions] = mockedRenderDocThumbnail.mock.calls[0]!;
    const [effectsDocument, effectsOptions] = mockedRenderDocThumbnail.mock.calls[1]!;
    const originalPath = originalDocument.nodes[node.id]!;
    const effectsPath = effectsDocument.nodes[node.id]!;

    expect(originalPath).toMatchObject({
      kind: 'path',
      points: node.points,
    });
    expect(effectsPath).toMatchObject({
      kind: 'path',
      points: node.points,
    });
    expect(effectsPath.smartFilters).toHaveLength(1);
    expect(originalOptions.source).toEqual({ type: 'selection', nodeIds: [node.id] });
    expect(effectsOptions.source).toEqual({ type: 'selection', nodeIds: [node.id] });
  });

  it('discloses provisional results without treating them as authoritative', async () => {
    const node = effectNode();
    mockedRenderDocThumbnail.mockResolvedValueOnce({
      ...outcome('data:image/png;base64,cHJvdmlzaW9uYWw=', {
        isProvisional: true,
        warnings: ['font-pending'],
      }),
      status: 'provisional',
      warnings: ['font-pending'],
    });

    render(<EffectStudioComparison document={testDocument(node)} node={node} hasEffects={false} />);

    expect(
      await screen.findByAltText('Original selected object without Object Filters'),
    ).toHaveAttribute('src', 'data:image/png;base64,cHJvdmlzaW9uYWw=');
    expect(screen.getByText(/accepted state preview is provisional/i)).toBeInTheDocument();
  });

  it('shows the latest matching render when an older request resolves later', async () => {
    const firstNode = effectNode();
    const nextNode = { ...firstNode, name: 'Updated shape' };
    const firstDocument = testDocument(firstNode);
    const nextDocument = testDocument(nextNode);
    const first = deferred<Awaited<ReturnType<typeof renderDocThumbnail>>>();
    const next = deferred<Awaited<ReturnType<typeof renderDocThumbnail>>>();
    mockedRenderDocThumbnail.mockImplementation((document) =>
      Promise.resolve(document === firstDocument ? first.promise : next.promise),
    );

    const view = render(
      <EffectStudioComparison document={firstDocument} node={firstNode} hasEffects={false} />,
    );
    view.rerender(
      <EffectStudioComparison document={nextDocument} node={nextNode} hasEffects={false} />,
    );

    next.resolve(outcome('data:image/png;base64,bmV3'));
    expect(
      await screen.findByAltText('Original selected object without Object Filters'),
    ).toHaveAttribute('src', 'data:image/png;base64,bmV3');
    first.resolve(outcome('data:image/png;base64,b2xk'));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByAltText('Original selected object without Object Filters')).toHaveAttribute(
      'src',
      'data:image/png;base64,bmV3',
    );
  });
});
