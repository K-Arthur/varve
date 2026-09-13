import { areaSelectionCoverageAt, createAreaSelection } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  imageFill,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promptDialog } from '../components/PromptDialog';
import type { EditorContextValue } from '../context';
import { setStartTextEditingHandler } from '../context';
import { setImportReportHandler } from '../context/sessionGlobals';
import { createActionHandlers } from './createActionHandlers';

vi.mock('../components/PromptDialog', () => ({
  promptDialog: vi.fn(),
}));

function makeEditorMock(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    setInspectorTab: vi.fn(),
    setTool: vi.fn(),
    enterIsolation: vi.fn(),
    announce: vi.fn(),
    openEffectStudioDialog: vi.fn(),
    ...overrides,
  } as unknown as EditorContextValue;
}

function nudgeRect(id: string, x: number, y: number) {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
    { name: id, transform: [1, 0, 0, 1, x, y] },
  );
}

describe('createActionHandlers — tool actions', () => {
  it.each([
    ['toolScale', 'scale'],
    ['toolSlice', 'slice'],
    ['toolCloneStamp', 'cloneStamp'],
  ] as const)('%s switches to its tool', (action, tool) => {
    const editor = makeEditorMock();
    createActionHandlers(editor)[action]?.();
    expect(editor.setTool).toHaveBeenCalledWith(tool);
  });
});

describe('createActionHandlers — document export', () => {
  it('delegates whole-document SVG export to the live export layer', () => {
    const onExportSvg = vi.fn();

    createActionHandlers(makeEditorMock(), { onExportSvg }).exportSvg?.();

    expect(onExportSvg).toHaveBeenCalledOnce();
  });
});

describe('createActionHandlers — clipboard dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the accessible prompt dialog for PNG scale selection', async () => {
    vi.mocked(promptDialog).mockResolvedValue('3');
    const onCopyAsPng = vi.fn();
    const editor = makeEditorMock();

    createActionHandlers(editor, { onCopyAsPng }).copyAsPng?.();

    await vi.waitFor(() => {
      expect(promptDialog).toHaveBeenCalledWith('PNG scale (1, 2, or 3)', '1');
      expect(onCopyAsPng).toHaveBeenCalledWith(3);
    });
  });

  it('captures the PNG selection before the scale dialog resolves', async () => {
    let resolvePrompt!: (value: string | null) => void;
    vi.mocked(promptDialog).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolvePrompt = resolve;
      }),
    );
    const node = nudgeRect('png-snapshot', 20, 30);
    const document = addNode(createDocument('png snapshot'), node);
    const onCopyAsPng = vi.fn();
    const initialState = {
      selection: [node.id],
      document,
      activeId: 'png-snapshot',
      revision: 0,
      selectionRevision: 0,
    } as unknown as EditorContextValue['state'];
    const editor = makeEditorMock({ state: initialState });

    createActionHandlers(editor, { onCopyAsPng }).copyAsPng?.();
    editor.state = { ...initialState, selection: [] };
    resolvePrompt('2');

    await vi.waitFor(() => expect(onCopyAsPng).toHaveBeenCalledTimes(1));
    expect(onCopyAsPng).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ document, nodes: [expect.objectContaining({ id: node.id })] }),
    );
  });

  it('does not import cancelled SVG markup', async () => {
    vi.mocked(promptDialog).mockResolvedValue(null);
    const batchImportNodes = vi.fn();
    const editor = makeEditorMock({ batchImportNodes });

    createActionHandlers(editor).pasteSvgMarkup?.();

    await vi.waitFor(() => expect(promptDialog).toHaveBeenCalledWith('Paste SVG markup'));
    expect(batchImportNodes).not.toHaveBeenCalled();
  });

  it('cancels SVG markup when the destination changes while the dialog is open', async () => {
    let resolvePrompt!: (value: string | null) => void;
    vi.mocked(promptDialog).mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolvePrompt = resolve;
      }),
    );
    const commitPreparedFragment = vi.fn();
    const initialState = {
      selection: [],
      document: createDocument('svg race'),
      activeId: 'svg-race',
      revision: 0,
      selectionRevision: 0,
    } as unknown as EditorContextValue['state'];
    const editor = makeEditorMock({
      state: initialState,
      canvasToWorld: vi.fn(() => ({ x: 0, y: 0 })),
      commitPreparedFragment,
    });
    createActionHandlers(editor).pasteSvgMarkup?.();
    await vi.waitFor(() => expect(promptDialog).toHaveBeenCalledWith('Paste SVG markup'));
    editor.state = { ...initialState, revision: 1 };
    resolvePrompt('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    await vi.waitFor(() =>
      expect(editor.announce).toHaveBeenCalledWith(
        'SVG paste cancelled because the document changed',
      ),
    );
    expect(commitPreparedFragment).not.toHaveBeenCalled();
  });

  it('publishes SVG fidelity changes through the Import Results bridge', async () => {
    vi.mocked(promptDialog).mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="blur"/></defs><rect width="10" height="10"/></svg>',
    );
    const reportHandler = vi.fn();
    const commitPreparedFragment = vi.fn(() => ['svg-root']);
    const document = createDocument('svg report');
    const editor = makeEditorMock({
      state: {
        selection: [],
        document,
        activeId: 'svg-report',
        revision: 0,
        selectionRevision: 0,
      } as unknown as EditorContextValue['state'],
      canvasToWorld: vi.fn(() => ({ x: 0, y: 0 })),
      commitPreparedFragment,
    });
    setImportReportHandler(reportHandler);
    try {
      createActionHandlers(editor).pasteSvgMarkup?.();
      await vi.waitFor(() => expect(reportHandler).toHaveBeenCalledTimes(1));
      expect(reportHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'paste',
          documentId: document.id,
          insertedCount: 1,
          committedRootIds: ['svg-root'],
        }),
      );
    } finally {
      setImportReportHandler(null);
    }
  });

  it('exports multiple SVG roots in selection order with their world-space arrangement', async () => {
    let document = createDocument('svg export');
    const first = makeShapeNode(
      'first',
      { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
      {
        name: 'first',
        transform: [1, 0, 0, 1, 100, 200],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      },
    );
    const second = makeShapeNode(
      'second',
      { kind: 'rect', x: 0, y: 0, w: 30, h: 40 },
      {
        name: 'second',
        transform: [1, 0, 0, 1, -30, 50],
        fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
      },
    );
    document = addNode(addNode(document, first), second);
    let written: Array<{ getType: (type: string) => Promise<Blob> }> | undefined;
    class TestClipboardItem {
      constructor(private readonly entries: Record<string, Blob>) {}
      async getType(type: string): Promise<Blob> {
        return this.entries[type]!;
      }
    }
    const originalClipboardItem = globalThis.ClipboardItem;
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn(async (items) => {
          written = items;
        }),
        writeText: vi.fn(),
      },
    });
    try {
      const editor = makeEditorMock({
        state: { selection: [first.id, second.id], document } as EditorContextValue['state'],
        platform: undefined,
      });
      createActionHandlers(editor).copyAsSvg?.();
      await vi.waitFor(() => expect(written).toHaveLength(1));
      const svg = await written![0]!.getType('image/svg+xml').then((blob) => blob.text());
      expect(svg).toContain('viewBox="-30 50 150 160"');
      expect(svg.indexOf('rgba(255,0,0,1.000)')).toBeLessThan(svg.indexOf('rgba(0,0,255,1.000)'));
    } finally {
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('exports a nested selection with its accumulated world transform', async () => {
    let document = createDocument('nested svg export');
    const parent = makeFrameNode('parent', {
      w: 200,
      h: 120,
      transform: [1, 0, 0, 1, 100, 50],
    });
    const child = makeShapeNode(
      'nested-child',
      {
        kind: 'rect',
        x: 0,
        y: 0,
        w: 20,
        h: 10,
      },
      {
        name: 'nested child',
        transform: [1, 0, 0, 1, 20, 30],
      },
    );
    document = addChild(addNode(document, parent), parent.id, child);
    const originalClipboardItem = globalThis.ClipboardItem;
    const originalClipboard = navigator.clipboard;
    let written: Array<{ getType: (type: string) => Promise<Blob> }> | undefined;
    class TestClipboardItem {
      constructor(private readonly entries: Record<string, Blob>) {}
      async getType(type: string): Promise<Blob> {
        return this.entries[type]!;
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      value: TestClipboardItem,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn(async (items) => {
          written = items;
        }),
        writeText: vi.fn(),
      },
    });
    try {
      const editor = makeEditorMock({
        state: { selection: [child.id], document } as EditorContextValue['state'],
        getWorldTransform: vi.fn(() => [1, 0, 0, 1, 120, 80] as Affine),
      });
      createActionHandlers(editor).copyAsSvg?.();
      await vi.waitFor(() => expect(written).toHaveLength(1));
      const svg = await written![0]!.getType('image/svg+xml').then((blob) => blob.text());
      expect(svg).toContain('viewBox="120 80 20 10"');
      expect(svg).toContain('transform="matrix(1,0,0,1,120,80)"');
    } finally {
      Object.defineProperty(globalThis, 'ClipboardItem', {
        configurable: true,
        value: originalClipboardItem,
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('inserts plain text through the shared prepared-fragment path', async () => {
    const readText = vi.fn(async () => 'Editable clipboard text');
    const commitPreparedFragment = vi.fn(() => ['pasted-text']);
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });
    try {
      const editor = makeEditorMock({
        state: {
          selection: [],
          document: createDocument('plain text'),
          activeId: 'plain-text',
          revision: 0,
          selectionRevision: 0,
        } as unknown as EditorContextValue['state'],
        canvasToWorld: vi.fn(() => ({ x: 0, y: 0 })),
        commitPreparedFragment,
      });
      createActionHandlers(editor).pastePlainText?.();
      await vi.waitFor(() => expect(commitPreparedFragment).toHaveBeenCalledTimes(1));
      expect(commitPreparedFragment).toHaveBeenCalledWith({
        route: 'paste',
        items: [],
        targetParentId: null,
        center: { x: 0, y: 0 },
        text: { plainText: 'Editable clipboard text' },
      });
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('cancels plain text when the document changes during the clipboard read', async () => {
    let resolveRead!: (value: string) => void;
    const readText = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const commitPreparedFragment = vi.fn();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    });
    try {
      const state = {
        selection: [],
        document: createDocument('plain text race'),
        activeId: 'plain-text-race',
        revision: 0,
        selectionRevision: 0,
      } as unknown as EditorContextValue['state'];
      const editor = makeEditorMock({
        state,
        canvasToWorld: vi.fn(() => ({ x: 0, y: 0 })),
        commitPreparedFragment,
      });
      createActionHandlers(editor).pastePlainText?.();
      editor.state = { ...state, revision: 1 };
      resolveRead('stale text');
      await vi.waitFor(() =>
        expect(editor.announce).toHaveBeenCalledWith(
          'Plain text paste cancelled because the document changed',
        ),
      );
      expect(commitPreparedFragment).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });
});

describe('createActionHandlers — object nudge actions', () => {
  it('batches a world-space nudge into one undo transaction', () => {
    let document = createDocument('menu nudge');
    const first = nudgeRect('first', 10, 20);
    const second = nudgeRect('second', 80, -5);
    document = addNode(document, first);
    document = addNode(document, second);
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const setNodePosition = vi.fn();
    const setNodePositions = vi.fn();
    const editor = makeEditorMock({
      state: { selection: [first.id, second.id], document } as EditorContextValue['state'],
      beginTransaction,
      commitTransaction,
      setNodePosition,
      setNodePositions,
    });

    createActionHandlers(editor).nudgeRight?.();

    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(setNodePositions).toHaveBeenCalledWith([
      { id: first.id, x: 11, y: 20 },
      { id: second.id, x: 81, y: -5 },
    ]);
    expect(setNodePosition).not.toHaveBeenCalled();
    expect(commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not write an empty undo entry when every selected root is ineligible', () => {
    let document = createDocument('locked menu nudge');
    const parent = makeFrameNode('parent', {
      w: 200,
      h: 100,
      locked: true,
      transform: [1, 0, 0, 1, 10, 10],
    });
    const child = nudgeRect('child', 20, 20);
    document = addNode(document, parent);
    document = addChild(document, parent.id, child);
    const beginTransaction = vi.fn();
    const commitTransaction = vi.fn();
    const setNodePosition = vi.fn();
    const setNodePositions = vi.fn();
    const editor = makeEditorMock({
      state: { selection: [child.id], document } as EditorContextValue['state'],
      beginTransaction,
      commitTransaction,
      setNodePosition,
      setNodePositions,
    });

    createActionHandlers(editor).nudgeRight?.();

    expect(beginTransaction).not.toHaveBeenCalled();
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(setNodePosition).not.toHaveBeenCalled();
    expect(setNodePositions).not.toHaveBeenCalled();
  });
});

describe('createActionHandlers — generative editing', () => {
  it('opens Generative Edit for exactly one selected image and routes to Adjustments', () => {
    const image = {
      ...makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }),
      fills: [imageFill('data:image/png;base64,AA==')],
    };
    const document = addNode(createDocument('generative-edit'), image);
    const openCafDialog = vi.fn();
    const setInspectorTab = vi.fn();
    const editor = makeEditorMock({
      state: { selection: [image.id], document } as EditorContextValue['state'],
      openCafDialog,
      setInspectorTab,
    });

    createActionHandlers(editor).contentAwareFill?.();

    expect(setInspectorTab).toHaveBeenCalledWith('adjustments');
    expect(openCafDialog).toHaveBeenCalledWith(image.id);
  });

  it('does not open Generative Edit for a mixed or multi-selection', () => {
    const editor = makeEditorMock({
      state: {
        selection: ['shape-a', 'shape-b'],
        document: createDocument('generative-edit'),
      } as EditorContextValue['state'],
      openCafDialog: vi.fn(),
    });

    createActionHandlers(editor).contentAwareFill?.();

    expect(editor.openCafDialog).not.toHaveBeenCalled();
    expect(editor.announce).toHaveBeenCalledWith('Select one image layer to open Generative Edit');
  });
});

describe('createActionHandlers — enterFrame', () => {
  it('calls enterIsolation when a frame is selected', () => {
    const frameId = 'f1';
    const editor = makeEditorMock({
      state: {
        selection: [frameId],
        document: {
          nodes: {
            [frameId]: { id: frameId, kind: 'frame', name: 'Frame 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).toHaveBeenCalledWith(frameId);
    expect(editor.announce).toHaveBeenCalled();
  });

  it('calls enterIsolation when a group is selected', () => {
    const groupId = 'g1';
    const editor = makeEditorMock({
      state: {
        selection: [groupId],
        document: {
          nodes: {
            [groupId]: { id: groupId, kind: 'group', name: 'Group 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).toHaveBeenCalledWith(groupId);
  });

  it('does nothing for non-container nodes', () => {
    const editor = makeEditorMock({
      state: {
        selection: ['r1'],
        document: {
          nodes: {
            r1: { id: 'r1', kind: 'shape', name: 'Rect 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).not.toHaveBeenCalled();
  });

  it('does nothing for multi-selection', () => {
    const editor = makeEditorMock({
      state: {
        selection: ['f1', 'f2'],
        document: {
          nodes: {
            f1: { id: 'f1', kind: 'frame' },
            f2: { id: 'f2', kind: 'frame' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).enterFrame?.();
    expect(editor.enterIsolation).not.toHaveBeenCalled();
  });
});

describe('createActionHandlers — editText', () => {
  it('calls startTextEditing when a text node is selected', () => {
    const textId = 't1';
    const startTextEdit = vi.fn();
    setStartTextEditingHandler(startTextEdit);
    const editor = makeEditorMock({
      state: {
        selection: [textId],
        document: {
          nodes: {
            [textId]: { id: textId, kind: 'text', name: 'Text 1' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).editText?.();
    expect(startTextEdit).toHaveBeenCalledWith(textId);
    setStartTextEditingHandler(null);
  });

  it('does nothing for non-text nodes', () => {
    const startTextEdit = vi.fn();
    setStartTextEditingHandler(startTextEdit);
    const editor = makeEditorMock({
      state: {
        selection: ['r1'],
        document: {
          nodes: {
            r1: { id: 'r1', kind: 'shape' },
          },
        },
      } as unknown as EditorContextValue['state'],
    });
    createActionHandlers(editor).editText?.();
    expect(startTextEdit).not.toHaveBeenCalled();
    setStartTextEditingHandler(null);
  });
});

describe('createActionHandlers — intelligence menu actions', () => {
  it('runAudit opens the audit tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.runAudit?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'audit');
  });

  it('scanDebt opens the debt tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.scanDebt?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'debt');
  });

  it('suggestNames opens the naming tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.suggestNames?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'naming');
  });

  it('detectDuplicates opens the components tab', () => {
    const editor = makeEditorMock();
    const handlers = createActionHandlers(editor);
    handlers.detectDuplicates?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith('audit', 'components');
  });

  it.each([
    ['openInspectorProperties', 'properties'],
    ['openAdjustmentsPanel', 'adjustments'],
    ['openPrototypePanel', 'prototype'],
    ['openFontsPanel', 'fonts'],
    ['openExportPanel', 'export'],
    ['openAuditPanel', 'audit'],
  ] as const)('%s deep-links to its inspector workflow', (action, tab) => {
    const editor = makeEditorMock();
    createActionHandlers(editor)[action]?.();
    expect(editor.setInspectorTab).toHaveBeenCalledWith(tab);
  });

  it('opens the controlled Effect Studio dialog instead of routing to Appearance', () => {
    const announce = vi.fn();
    const openEffectStudioDialog = vi.fn();
    const editor = makeEditorMock({
      announce,
      openEffectStudioDialog,
    });

    createActionHandlers(editor).openAppearancePanel?.();

    expect(openEffectStudioDialog).toHaveBeenCalledExactlyOnceWith();
    expect(announce).toHaveBeenCalledExactlyOnceWith('Effect Studio opened.');
    expect(editor.setInspectorTab).not.toHaveBeenCalledWith('appearance');
  });

  it('opens document settings at the canonical empty-selection Properties surface', () => {
    const editor = makeEditorMock({ setSelection: vi.fn() });
    createActionHandlers(editor).openDocumentPanel?.();
    expect(editor.setSelection).toHaveBeenCalledWith(null);
    expect(editor.setInspectorTab).toHaveBeenCalledWith('properties');
  });

  it('opens inspection through the real inspect tool and Export surface', () => {
    const editor = makeEditorMock();
    createActionHandlers(editor).openInspectPanel?.();
    expect(editor.setTool).toHaveBeenCalledWith('inspect');
    expect(editor.setInspectorTab).toHaveBeenCalledWith('export');
  });
});

describe('createActionHandlers — text formatting', () => {
  it('updates text immutably and toggles numeric font weight', () => {
    const originalNode = {
      id: 't1',
      kind: 'text',
      text: 'Hello',
      fontSize: 16,
      fontWeight: 400,
    };
    const document = {
      nodes: { t1: originalNode },
    };
    let updatedDocument: typeof document | undefined;
    const editor = makeEditorMock({
      state: {
        selection: ['t1'],
        document,
      } as unknown as EditorContextValue['state'],
      updateDoc: vi.fn((update) => {
        updatedDocument = update(document as never) as unknown as typeof document;
      }),
    });

    createActionHandlers(editor).textBold?.();

    expect(updatedDocument).not.toBe(document);
    expect(updatedDocument?.nodes).not.toBe(document.nodes);
    expect(updatedDocument?.nodes.t1).not.toBe(originalNode);
    expect(updatedDocument?.nodes.t1.fontWeight).toBe(700);
    expect(originalNode.fontWeight).toBe(400);
  });
});

describe('createActionHandlers — pixel selection refine & transform', () => {
  const rectSelection = () =>
    createAreaSelection({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      feather: 0,
      antialias: false,
    });

  it('refuses to refine with no active pixel selection', () => {
    const setAreaSelection = vi.fn();
    const editor = makeEditorMock({
      state: {} as unknown as EditorContextValue['state'],
      setAreaSelection,
    });
    createActionHandlers(editor).areaSelectionGrow?.();
    expect(editor.announce).toHaveBeenCalledWith('Make a pixel selection first');
    expect(setAreaSelection).not.toHaveBeenCalled();
  });

  it('grows the active selection outward by one pixel', () => {
    const setAreaSelection = vi.fn();
    const editor = makeEditorMock({
      state: { areaSelection: rectSelection() } as unknown as EditorContextValue['state'],
      setAreaSelection,
    });
    createActionHandlers(editor).areaSelectionGrow?.();
    expect(setAreaSelection).toHaveBeenCalledTimes(1);
    const next = setAreaSelection.mock.calls[0]![0];
    expect(areaSelectionCoverageAt(next, { x: 5, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(next, { x: -1, y: 5 })).toBe(1);
  });

  it('shrinks the active selection inward by one pixel', () => {
    const setAreaSelection = vi.fn();
    const editor = makeEditorMock({
      state: { areaSelection: rectSelection() } as unknown as EditorContextValue['state'],
      setAreaSelection,
    });
    createActionHandlers(editor).areaSelectionShrink?.();
    const next = setAreaSelection.mock.calls[0]![0];
    // Core stays fully covered; the original 1px edge erodes to a soft boundary.
    expect(areaSelectionCoverageAt(next, { x: 5, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(next, { x: 0.5, y: 5 })).toBeLessThan(1);
  });

  it('nudges the active selection by translating it', () => {
    const setAreaSelection = vi.fn();
    const editor = makeEditorMock({
      state: { areaSelection: rectSelection() } as unknown as EditorContextValue['state'],
      setAreaSelection,
    });
    createActionHandlers(editor).areaSelectionNudgeRight?.();
    const next = setAreaSelection.mock.calls[0]![0];
    expect(areaSelectionCoverageAt(next, { x: 10.5, y: 5 })).toBe(1);
    expect(areaSelectionCoverageAt(next, { x: -0.5, y: 5 })).toBe(0);
  });

  it('hardens a feathered selection through threshold', () => {
    const selection = createAreaSelection({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      feather: 2,
      antialias: false,
    });
    const setAreaSelection = vi.fn();
    const editor = makeEditorMock({
      state: { areaSelection: selection } as unknown as EditorContextValue['state'],
      setAreaSelection,
    });
    createActionHandlers(editor).areaSelectionThreshold?.();
    const next = setAreaSelection.mock.calls[0]![0];
    expect(areaSelectionCoverageAt(next, { x: 2, y: 2 })).toBe(1);
  });

  it('uses the undoable selection commit path when it is available', () => {
    const commitAreaSelection = vi.fn();
    const setAreaSelection = vi.fn();
    const editor = makeEditorMock({
      state: { areaSelection: rectSelection() } as unknown as EditorContextValue['state'],
      commitAreaSelection,
      setAreaSelection,
    });

    createActionHandlers(editor).areaSelectionGrow?.();

    expect(commitAreaSelection).toHaveBeenCalledTimes(1);
    expect(setAreaSelection).not.toHaveBeenCalled();
  });
});
