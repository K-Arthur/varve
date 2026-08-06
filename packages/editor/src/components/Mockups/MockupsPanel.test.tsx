// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { Document, NodeId } from '@varve/scene';
import { createDocument, getBuiltinMockupTemplates } from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type EditorContextValue, useEditor } from '../../context';
import { MockupsPanel } from './MockupsPanel';

const editorMock = vi.fn<() => Partial<EditorContextValue>>();

function mockEditor(): Partial<EditorContextValue> {
  const doc = createDocument('panel-test', { flat: true });
  return {
    state: {
      document: doc,
      selection: ['n1'] as NodeId[],
      libraryPanelVisible: false,
    } as EditorContextValue['state'],
    toggleLibraryPanel: vi.fn(),
    getWorldBounds: vi.fn(() => ({ x: 0, y: 0, w: 390, h: 844 })),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    updateDoc: vi.fn((fn: (d: Document) => Document) => fn(doc)),
    setSelection: vi.fn(),
  };
}

vi.mock('../../context', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../context')>();
  return {
    ...original,
    useEditor: () => editorMock(),
  };
});

describe('MockupsPanel', () => {
  beforeEach(() => {
    editorMock.mockReset();
    editorMock.mockReturnValue(mockEditor());
  });

  it('renders the built-in template catalog with accurate names', () => {
    render(<MockupsPanel />);
    const templates = getBuiltinMockupTemplates();
    expect(screen.getByText(templates[0]!.name)).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getByText('12 templates')).toBeTruthy();
  });

  it('filters by search query', () => {
    render(<MockupsPanel />);
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'browser' } });
    expect(screen.getByText('Browser Window')).toBeTruthy();
    expect(screen.queryByText('Phone — Front')).toBeNull();
  });

  it('filters by category chip', () => {
    render(<MockupsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Packaging' }));
    expect(screen.getByText('Packaging Box — Front')).toBeTruthy();
    expect(screen.queryByText('Phone — Front')).toBeNull();
  });

  it('shows a hint when nothing is selected', () => {
    editorMock.mockReturnValue({
      ...mockEditor(),
      state: { ...mockEditor().state!, selection: [] },
    });
    render(<MockupsPanel />);
    expect(screen.getByText(/Select a frame/)).toBeTruthy();
  });

  it('apply button is disabled without a selection', () => {
    editorMock.mockReturnValue({
      ...mockEditor(),
      state: { ...mockEditor().state!, selection: [] },
    });
    render(<MockupsPanel />);
    const apply = screen.getAllByRole('button', { name: /Apply/ })[0];
    expect((apply as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles favourites', () => {
    render(<MockupsPanel />);
    const star = screen.getAllByRole('button', { name: /favourites/i })[0]!;
    fireEvent.click(star);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(star);
    expect(star.getAttribute('aria-pressed')).toBe('false');
  });
});

void useEditor;
