// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { makeShapeNode } from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from '../../../context';
import { IconSection } from './IconSection';

vi.mock('../../../context', () => ({
  useEditor: vi.fn(),
}));

const mockedUseEditor = vi.mocked(useEditor);

function editorMock() {
  const detachIconNodes = vi.fn();
  mockedUseEditor.mockReturnValue({
    state: {
      document: { iconAssets: {} },
      sectionVisibility: {},
      workspaceMode: 'design',
      tool: 'select',
      prototypeMode: false,
    },
    getIconAsset: () => ({
      name: 'home',
      prefix: 'mdi',
      providerId: 'iconify',
      licence: 'Apache 2.0',
      attribution: 'Material Design Icons',
      storageMode: 'embedded',
    }),
    detachIconNodes,
  } as unknown as ReturnType<typeof useEditor>);
  return { detachIconNodes };
}

const iconNode = {
  ...makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 24, h: 24 }, { name: 'home' }),
  iconAssetId: 'icon-mdi-abc',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('IconSection', () => {
  it('renders provenance metadata', () => {
    editorMock();
    render(<IconSection node={iconNode} />);
    expect(screen.getByText('home')).toBeTruthy();
    expect(screen.getByText(/Pack: mdi · iconify/)).toBeTruthy();
    expect(screen.getByText('Licence: Apache 2.0')).toBeTruthy();
    expect(screen.getByText(/Attribution: Material Design Icons/)).toBeTruthy();
  });

  it('detaches the icon node', () => {
    const { detachIconNodes } = editorMock();
    render(<IconSection node={iconNode} />);
    fireEvent.click(screen.getByRole('button', { name: /detach/i }));
    expect(detachIconNodes).toHaveBeenCalledWith(['n1']);
  });

  it('returns null for nodes without an icon asset reference', () => {
    editorMock();
    const { container } = render(
      <IconSection
        node={makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'plain' })}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('opens the replace dialog', () => {
    editorMock();
    render(<IconSection node={iconNode} />);
    fireEvent.click(screen.getByRole('button', { name: /replace/i }));
    expect(screen.getByLabelText('Search icons')).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByLabelText('Close dialog'));
    });
  });
});
