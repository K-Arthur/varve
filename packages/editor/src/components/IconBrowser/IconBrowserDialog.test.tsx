// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../context';
import { IconBrowserDialog } from './IconBrowserDialog';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

const mockedUseEditor = vi.mocked(useEditor);

function editorMock() {
  const insertIconAsset = vi.fn().mockResolvedValue('n9');
  const replaceIconAsset = vi.fn().mockResolvedValue('n9');
  const detachIconNodes = vi.fn();
  const getIconAsset = vi.fn();
  const getIconAssetForNode = vi.fn();
  mockedUseEditor.mockReturnValue({
    insertIconAsset,
    replaceIconAsset,
    detachIconNodes,
    getIconAsset,
    getIconAssetForNode,
  } as unknown as ReturnType<typeof useEditor>);
  return { insertIconAsset, replaceIconAsset };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('IconBrowserDialog', () => {
  it('renders the browser and does not insert without a selection', async () => {
    const { insertIconAsset } = editorMock();
    const onClose = vi.fn();
    render(<IconBrowserDialog open onClose={onClose} />);

    // The browser renders a search input and the empty state (no network,
    // no stored icons in the test environment).
    const input = await screen.findByLabelText('Search icons');
    fireEvent.change(input, { target: { value: 'home' } });
    expect(await screen.findByText('No icons found')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(insertIconAsset).not.toHaveBeenCalled();
  });

  it('closes on dialog dismiss', async () => {
    editorMock();
    const onClose = vi.fn();
    render(<IconBrowserDialog open onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Close dialog'));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
