import { cleanup, render, waitFor } from '@testing-library/react';
import * as engineRuntime from '@varve/engine';
import { createDocument, makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetExportControls } from './AssetExportControls';

let restoreEngineSpy: (() => void) | undefined;

afterEach(() => {
  cleanup();
  restoreEngineSpy?.();
  restoreEngineSpy = undefined;
});

describe('AssetExportControls engine lifecycle', () => {
  it('announces engine initialization failure without an unhandled rejection', async () => {
    const engineSpy = vi
      .spyOn(engineRuntime, 'createEngine')
      .mockRejectedValueOnce(new Error('provider initialization failed'));
    restoreEngineSpy = () => engineSpy.mockRestore();

    const doc = createDocument('Export engine error', true);
    const node = makeShapeNode('export-engine-node', {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 20,
      h: 10,
    });
    const { container } = render(
      <AssetExportControls
        node={node}
        doc={{ ...doc, rootChildren: [node.id], nodes: { [node.id]: node } }}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.spec-export__message')).toHaveTextContent(
        'Could not initialize the export engine. Reload the editor and try again.',
      );
    });
    expect(engineSpy).toHaveBeenCalledWith('auto');
  });
});
