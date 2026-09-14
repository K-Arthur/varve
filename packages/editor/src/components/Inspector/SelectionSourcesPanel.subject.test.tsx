// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockProposeSubjects, mockListInstalled, mockRuntime, mockDownload, mockMaskToDataUrl } =
  vi.hoisted(() => ({
    mockProposeSubjects: vi.fn(),
    mockListInstalled: vi.fn(),
    mockRuntime: vi.fn(),
    mockDownload: vi.fn(),
    mockMaskToDataUrl: vi.fn(
      () =>
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
    ),
  }));

vi.mock('@varve/engine/subjectProposal', () => ({
  proposeSubjects: mockProposeSubjects,
  listInstalledSubjectModels: mockListInstalled,
  resolveSubjectRuntimeCapabilities: mockRuntime,
  downloadSubjectModel: mockDownload,
  subjectModelLabel: (source: string) =>
    source === 'u2netp'
      ? 'U²-Net Light'
      : source === 'isnet-general-use'
        ? 'IS-Net'
        : source === 'birefnet-general-lite'
          ? 'BiRefNet Lite'
          : 'Model-free estimate',
}));

vi.mock('@varve/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/engine')>();
  return {
    ...actual,
    // jsdom has no canvas encoder; the commit path validates real PNG
    // structure, so return a known-good 1x1 PNG data URL.
    maskArrayToDataUrl: mockMaskToDataUrl,
  };
});

vi.mock('../../tools/selectionMask', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools/selectionMask')>();
  return {
    ...actual,
    decodeRasterMaskDataUrl: vi.fn(async () => ({
      data: new Uint8ClampedArray(16 * 16 * 4),
      width: 16,
      height: 16,
    })),
  };
});

afterEach(() => cleanup());

import { EditorProvider, useEditor } from '../../context';
import { SelectionSourcesPanel } from './SelectionSourcesPanel';
import { resetSubjectProposals } from './subjectProposalStore';

function candidateSet() {
  const size = 1;
  const mask = new Uint8Array(size);
  const alpha = new Uint8Array(size);
  mask[0] = 255;
  alpha[0] = 255;
  return {
    width: 1,
    height: 1,
    analysisWidth: 1,
    analysisHeight: 1,
    candidates: [
      {
        mask,
        alpha,
        label: 'All foreground',
        coverage: 1,
        score: 1,
        centroid: { x: 0, y: 0 },
        edgeAlignment: 0,
      },
    ],
  };
}

function proposalResult(overrides: Record<string, unknown> = {}) {
  return {
    source: 'u2netp',
    quality: 'fast',
    modelId: 'u2netp',
    set: candidateSet(),
    plan: {
      quality: 'fast',
      attempts: [
        {
          modelId: 'u2netp',
          estimatedPeakBytes: 330_000_000,
          reason: 'fits the runtime memory budget',
          native: false,
          steppedDown: false,
        },
      ],
      fallbackSource: null,
      install: undefined,
      rejected: [],
    },
    attempts: [{ modelId: 'u2netp', outcome: 'used' }],
    elapsedMs: 12,
    ...overrides,
  };
}

function SubjectSetup() {
  const editor = useEditor();
  useEffect(() => {
    editor.setSelection('photo');
  }, []);
  return null;
}

async function renderPanel() {
  let document = createDocument('subject-panel');
  document = addNode(
    document,
    makeImageShapeNode('photo', {
      src: 'data:image/png;base64,mock',
      w: 64,
      h: 64,
      imageWidth: 1,
      imageHeight: 1,
    }),
  );
  document = addNode(
    document,
    makeImageShapeNode('other', {
      src: 'data:image/png;base64,mock',
      w: 32,
      h: 32,
      imageWidth: 1,
      imageHeight: 1,
    }),
  );

  const editor: { current: ReturnType<typeof useEditor> | undefined } = { current: undefined };
  function CaptureEditor() {
    editor.current = useEditor();
    return null;
  }

  render(
    <EditorProvider initialDocumentJson={JSON.stringify(document)}>
      <CaptureEditor />
      <SubjectSetup />
      <SelectionSourcesPanel />
    </EditorProvider>,
  );

  await waitFor(() => expect(editor.current?.state.selection).toEqual(['photo']));
  fireEvent.click(screen.getByRole('button', { name: 'Selection Sources' }));
  return editor;
}

describe('SelectionSourcesPanel subject proposals', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetSubjectProposals();
    mockProposeSubjects.mockReset();
    mockListInstalled.mockReset().mockResolvedValue(['u2netp']);
    mockRuntime
      .mockReset()
      .mockResolvedValue({ isTauri: false, nativeReady: false, safePeakBytes: 4_000_000_000 });
    mockDownload.mockReset().mockResolvedValue(undefined);
  });

  it('runs the estimate, labels the provider, and applies the active candidate as a mask', async () => {
    mockProposeSubjects.mockResolvedValue(proposalResult());
    const editor = await renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    await screen.findByRole('button', { name: /^All foreground/ });

    expect(mockProposeSubjects).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 'fast', installedModelIds: ['u2netp'] }),
    );
    expect(editor.current?.state.areaSelection ?? null).toBeNull();
    const proposalsSection = screen.getByLabelText('Subject proposals');
    expect(within(proposalsSection).getByText(/U²-Net Light estimate/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use selected candidate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /^All foreground/ }));
    await waitFor(() => expect(editor.current?.state.areaSelection ?? null).toBeNull());
    expect(screen.getByRole('button', { name: 'Use selected candidate' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Apply as mask' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply as mask' }));
    await waitFor(() => {
      const node = editor.current?.state.document.nodes.photo;
      expect(node?.kind).toBe('shape');
      if (node?.kind !== 'shape') return;
      expect(node.mask?.rasterMask).toBeTruthy();
    });
  });

  it('offers an explicit optional-model download and retries after install', async () => {
    mockProposeSubjects
      .mockResolvedValueOnce(
        proposalResult({
          source: 'u2netp',
          quality: 'balanced',
          plan: {
            quality: 'balanced',
            attempts: [
              {
                modelId: 'u2netp',
                estimatedPeakBytes: 330_000_000,
                reason: 'IS-Net is not installed; using the installed U²-Net Light',
                native: false,
                steppedDown: true,
              },
            ],
            fallbackSource: null,
            install: {
              modelId: 'isnet-general-use',
              displayName: 'IS-Net',
              downloadBytes: 178_648_008,
            },
            rejected: [{ modelId: 'isnet-general-use', reason: 'not installed' }],
          },
          attempts: [{ modelId: 'u2netp', outcome: 'used' }],
        }),
      )
      .mockResolvedValueOnce(
        proposalResult({ source: 'isnet-general-use', modelId: 'isnet-general-use' }),
      );

    await renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    const download = await screen.findByRole('button', { name: /Download IS-Net/ });
    expect(screen.getByText(/170 MB/)).toBeTruthy();

    fireEvent.click(download);
    await waitFor(() =>
      expect(mockDownload).toHaveBeenCalledWith(
        'isnet-general-use',
        expect.any(Function),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(mockProposeSubjects).toHaveBeenCalledTimes(2));
  });

  it('does not apply a stale proposal when the target changes mid-run', async () => {
    let resolveProposal: ((value: unknown) => void) | undefined;
    mockProposeSubjects.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProposal = resolve;
        }),
    );
    const editor = await renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    await waitFor(() => expect(mockProposeSubjects).toHaveBeenCalled());

    // The user moves to another image while the estimate is still running.
    await act(async () => {
      editor!.current?.setSelection('other');
    });
    await act(async () => {
      resolveProposal?.(proposalResult());
    });

    expect(editor!.current?.state.areaSelection ?? null).toBeNull();
    expect(screen.queryByLabelText('Subject proposals')).toBeNull();
  });

  it('does not apply a proposal when the same node receives a new image', async () => {
    let resolveProposal: ((value: unknown) => void) | undefined;
    mockProposeSubjects.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProposal = resolve;
        }),
    );
    const editor = await renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    await waitFor(() => expect(mockProposeSubjects).toHaveBeenCalled());

    await act(async () => {
      editor.current?.beginTransaction();
      editor.current?.updateDoc((document) => ({
        ...document,
        nodes: {
          ...document.nodes,
          photo: makeImageShapeNode('photo', {
            src: 'data:image/png;base64,replaced-source',
            w: 64,
            h: 64,
            imageWidth: 1,
            imageHeight: 1,
          }),
        },
      }));
      editor.current?.commitTransaction();
    });
    await act(async () => {
      resolveProposal?.(proposalResult());
    });

    expect(editor.current?.state.areaSelection ?? null).toBeNull();
    expect(screen.queryByLabelText('Subject proposals')).toBeNull();
  });

  it('shows the model-free fallback honestly when no model ran', async () => {
    mockProposeSubjects.mockResolvedValue(
      proposalResult({
        source: 'model-free',
        modelId: null,
        plan: {
          quality: 'high',
          attempts: [],
          fallbackSource: 'model-free',
          fallbackReason: 'No automatic model could run: u2netp (budget)',
          install: {
            modelId: 'birefnet-general-lite',
            displayName: 'BiRefNet Lite',
            downloadBytes: 224_005_088,
          },
          rejected: [{ modelId: 'u2netp', reason: 'budget' }],
        },
        attempts: [
          { modelId: 'u2netp', outcome: 'failed', reason: 'budget' },
          { modelId: 'model-free', outcome: 'used' },
        ],
      }),
    );

    await renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    expect(await screen.findByText(/Model-free estimate estimate/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview all subjects' })).toBeTruthy();
  });
});
