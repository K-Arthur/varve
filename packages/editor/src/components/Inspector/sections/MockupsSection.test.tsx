// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import {
  addMockupTemplate,
  createDocument,
  createMockupInstanceData,
  type Document,
  type FrameNode,
  getBuiltinMockupTemplates,
  makeFrameNode,
  nextNodeId,
  setMockupBinding,
} from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorContextValue } from '../../../context';
import { MockupsSection } from './MockupsSection';

const editorMock = vi.fn<() => Partial<EditorContextValue>>();

function fixture(): { doc: Document; frame: FrameNode; sourceId: string } {
  let doc = createDocument('section-test', { flat: true });
  const template = getBuiltinMockupTemplates().find((t) => t.id === 'builtin:phone-flat')!;
  doc = addMockupTemplate(doc, template).document;
  const f = nextNodeId(doc);
  doc = f.doc;
  const frameId = f.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: makeFrameNode(frameId, { transform: [1, 0, 0, 1, 10, 10], w: 375, h: 600 }),
    },
    rootChildren: [...doc.rootChildren, frameId],
  };
  const s = nextNodeId(doc);
  doc = s.doc;
  const sourceId = s.id;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [sourceId]: makeFrameNode(sourceId, { transform: [1, 0, 0, 1, 0, 0], w: 390, h: 844 }),
    },
    rootChildren: [...doc.rootChildren, sourceId],
  };
  const frame = doc.nodes[frameId] as FrameNode;
  doc = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [frameId]: { ...frame, mockup: createMockupInstanceData(template.id, {}) },
    },
  };
  doc = setMockupBinding(doc, frameId, 'screen', { mode: 'live', nodeId: sourceId });
  return { doc, frame: doc.nodes[frameId] as FrameNode, sourceId };
}

function mockEditor(doc: Document): Partial<EditorContextValue> {
  return {
    state: {
      document: doc,
      selection: [] as EditorContextValue['state']['selection'],
      libraryPanelVisible: true,
      sectionVisibility: {},
    } as EditorContextValue['state'],
    updateDoc: vi.fn((fn: (d: Document) => Document) => fn(doc)),
    beginTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    abortTransaction: vi.fn(),
    setSelection: vi.fn(),
    toggleLibraryPanel: vi.fn(),
    getWorldBounds: vi.fn(() => ({ x: 0, y: 0, w: 100, h: 100 })),
  };
}

vi.mock('../../../context', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../context')>();
  return { ...original, useEditor: () => editorMock() };
});

describe('MockupsSection', () => {
  beforeEach(() => {
    editorMock.mockReset();
  });

  it('lists surfaces and expands per-surface controls', () => {
    const { doc, frame } = fixture();
    editorMock.mockReturnValue(mockEditor(doc));
    render(<MockupsSection node={frame} />);
    expect(screen.getByText('Phone — Front')).toBeTruthy();
    expect(screen.getByText('Screen')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Screen/ }));
    // Surface editor shows binding, fit, artwork, appearance and geometry.
    expect(screen.getByRole('button', { name: 'Contain' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Snapshot/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Clip from selection/ })).toBeTruthy();
    expect(screen.getByLabelText('x')).toBeTruthy();
    expect(screen.getByLabelText('width')).toBeTruthy();
  });

  it('reports a missing source honestly', () => {
    const { doc, frame } = fixture();
    const nodes = { ...doc.nodes };
    for (const [id, node] of Object.entries(nodes)) {
      if (id !== frame.id && node?.kind === 'frame') delete nodes[id];
    }
    editorMock.mockReturnValue(mockEditor({ ...doc, nodes } as Document));
    render(<MockupsSection node={frame} />);
    expect(screen.getByText('Missing source')).toBeTruthy();
  });

  it('opens the template picker with a slot-identity remap plan', () => {
    const { doc, frame } = fixture();
    editorMock.mockReturnValue(mockEditor(doc));
    render(<MockupsSection node={frame} />);
    fireEvent.click(screen.getByRole('button', { name: /Replace/ }));
    expect(screen.getByRole('group', { name: 'Replace template' })).toBeTruthy();
    // Selecting a template shows how many surfaces matched by slot.
    fireEvent.click(screen.getByRole('button', { name: 'Browser Window' }));
    expect(screen.getByText(/matched by slot/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply Browser Window/ })).toBeTruthy();
  });

  it('offers variant export and duplicate/flatten actions', () => {
    const { doc, frame } = fixture();
    editorMock.mockReturnValue(mockEditor(doc));
    render(<MockupsSection node={frame} />);
    expect(screen.getByRole('button', { name: /Export variants/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Duplicate linked/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Duplicate independent/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Flatten to image/ })).toBeTruthy();
  });
});
