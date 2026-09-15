// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { addNode, createDocument, makeImageShapeNode } from '@varve/scene';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockProposeSubjects,
  mockListInstalled,
  mockRuntime,
  mockDownload,
  mockWarmMaskRenderCache,
  mockMaskToDataUrl,
  mockDecodeMask,
} = vi.hoisted(() => ({
  mockProposeSubjects: vi.fn(),
  mockListInstalled: vi.fn(),
  mockRuntime: vi.fn(),
  mockDownload: vi.fn(),
  mockWarmMaskRenderCache: vi.fn().mockResolvedValue(undefined),
  mockMaskToDataUrl: vi.fn(
    () =>
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  ),
  mockDecodeMask: vi.fn(),
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
          : source === 'modnet-portrait'
            ? 'MODNet Portrait'
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
    decodeRasterMaskDataUrl: mockDecodeMask,
  };
});

vi.mock('../../backgroundRemoval/maskRenderCache', () => ({
  warmMaskRenderCache: mockWarmMaskRenderCache,
}));

afterEach(() => cleanup());

import { EditorProvider, useEditor } from '../../context';
import { SelectionSourcesPanel } from './SelectionSourcesPanel';
import { getSubjectProposalState, resetSubjectProposals } from './subjectProposalStore';

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

function multiCandidateSet() {
  return {
    width: 4,
    height: 1,
    analysisWidth: 4,
    analysisHeight: 1,
    candidates: [
      {
        mask: new Uint8Array([255, 255, 255, 255]),
        alpha: new Uint8Array([255, 255, 255, 255]),
        label: 'All foreground',
        coverage: 1,
        score: 1,
        centroid: { x: 0.5, y: 0.5 },
        edgeAlignment: 0,
      },
      {
        mask: new Uint8Array([255, 255, 0, 0]),
        alpha: new Uint8Array([255, 255, 0, 0]),
        label: 'Region 1',
        coverage: 0.5,
        score: 1,
        centroid: { x: 0.125, y: 0.5 },
        edgeAlignment: 0,
      },
      {
        mask: new Uint8Array([0, 0, 255, 255]),
        alpha: new Uint8Array([0, 0, 255, 255]),
        label: 'Region 2',
        coverage: 0.5,
        score: 1,
        centroid: { x: 0.875, y: 0.5 },
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

async function renderPanel(source = 'data:image/png;base64,mock') {
  let document = createDocument('subject-panel');
  document = addNode(
    document,
    makeImageShapeNode('photo', {
      src: source,
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
    mockWarmMaskRenderCache.mockReset().mockResolvedValue(undefined);
    mockDecodeMask.mockReset().mockImplementation(async () => ({
      data: new Uint8ClampedArray(16 * 16 * 4),
      width: 16,
      height: 16,
    }));
  });

  it('opens prompted Object Selection when one specific image object is the target', async () => {
    const editor = await renderPanel();

    expect(screen.getByRole('button', { name: 'Select specific object' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select specific object' }));

    await waitFor(() => expect(editor.current?.state.tool).toBe('sam2Segment'));
  });

  it('runs the explicit portrait specialist without silently stepping down', async () => {
    mockListInstalled.mockResolvedValue(['u2netp', 'modnet-portrait']);
    mockProposeSubjects.mockResolvedValue(
      proposalResult({
        source: 'modnet-portrait',
        quality: 'portrait',
        modelId: 'modnet-portrait',
        plan: {
          quality: 'portrait',
          attempts: [
            {
              modelId: 'modnet-portrait',
              estimatedPeakBytes: 400_000_000,
              reason: 'fits the runtime memory budget',
              native: false,
              steppedDown: false,
            },
          ],
          fallbackSource: null,
          install: undefined,
          rejected: [],
        },
        attempts: [{ modelId: 'modnet-portrait', outcome: 'used' }],
      }),
    );
    const editor = await renderPanel();

    fireEvent.click(screen.getByRole('combobox', { name: 'Subject estimate quality' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Portrait (MODNet)' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));

    await screen.findByRole('button', { name: /^All foreground/ });
    expect(mockProposeSubjects).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 'portrait',
        installedModelIds: ['u2netp', 'modnet-portrait'],
        allowModelFreeFallback: false,
      }),
    );
    expect(screen.getByText(/MODNet Portrait estimate/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^All foreground/ }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply as mask' }));
    await waitFor(() => {
      const node = editor.current?.state.document.nodes.photo;
      expect(node?.kind).toBe('shape');
      if (node?.kind !== 'shape') return;
      expect(node.mask?.rasterMask?.provenance?.method).toBe('portrait');
      expect(node.mask?.rasterMask?.provenance?.modelId).toBe('modnet-portrait');
    });
    expect(mockWarmMaskRenderCache).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('data:image/png;base64,'),
      1,
      1,
    );
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
    expect(
      screen.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Use selected candidate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    );
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

  it('rejects a reviewed candidate when its mask changes before commit', async () => {
    const result = proposalResult();
    mockProposeSubjects.mockResolvedValue(result);
    const editor = await renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^All foreground/ }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    );
    expect(getSubjectProposalState().reviewedCandidateKey).not.toBeNull();

    // Simulate a provider/refinement buffer being replaced after the visible
    // candidate was reviewed. The old approval must not transfer to the new
    // pixels merely because the candidate index stayed the same.
    result.set.candidates[0]!.mask[0] = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Use selected candidate' }));

    await waitFor(() => {
      expect(getSubjectProposalState().reviewedCandidate).toBeNull();
      expect(getSubjectProposalState().reviewedCandidateKey).toBeNull();
    });
    expect(editor.current?.state.areaSelection ?? null).toBeNull();
  });

  it('rejects a reviewed candidate when its soft alpha changes before mask commit', async () => {
    const result = proposalResult();
    mockProposeSubjects.mockResolvedValue(result);
    const editor = await renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^All foreground/ }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    );
    result.set.candidates[0]!.alpha![0] = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Apply as mask' }));

    await waitFor(() => {
      expect(getSubjectProposalState().reviewedCandidate).toBeNull();
      expect(getSubjectProposalState().reviewedCandidateKey).toBeNull();
    });
    expect(editor.current?.state.document.nodes.photo?.mask).toBeUndefined();
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

  it('rejects a reviewed proposal when a remote source changes at the same URL', async () => {
    let decodeCount = 0;
    mockDecodeMask.mockImplementation(async () => {
      decodeCount += 1;
      const data = new Uint8ClampedArray(16 * 16 * 4);
      if (decodeCount > 1) data[0] = 255;
      return { data, width: 16, height: 16 };
    });
    mockProposeSubjects.mockResolvedValue(proposalResult());
    const editor = await renderPanel('https://example.test/photo.png');

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^All foreground/ }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use selected candidate' }));

    await waitFor(() => expect(mockDecodeMask).toHaveBeenCalledTimes(2));
    expect(editor.current?.state.areaSelection ?? null).toBeNull();
  });

  it('requires a fresh proposal when image placement changes after review', async () => {
    mockProposeSubjects.mockResolvedValue(proposalResult());
    const editor = await renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^All foreground/ }));
    const review = screen.getByRole('checkbox', {
      name: 'I reviewed the highlighted subject before applying',
    });
    fireEvent.click(review);
    expect(screen.getByRole('button', { name: 'Use selected candidate' })).toBeEnabled();

    await act(async () => {
      editor.current?.beginTransaction();
      editor.current?.updateDoc((document) => {
        const node = document.nodes.photo;
        if (node?.kind !== 'shape') return document;
        return {
          ...document,
          nodes: {
            ...document.nodes,
            photo: { ...node, transform: [1, 0, 0, 1, 12, 0] },
          },
        };
      });
      editor.current?.commitTransaction();
    });

    expect(
      screen.getByText(/Image placement changed after this estimate; run Select subject again/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use selected candidate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();
    expect(editor.current?.state.areaSelection ?? null).toBeNull();
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

  it('previews the explicit union instead of the largest region', async () => {
    mockProposeSubjects.mockResolvedValue(
      proposalResult({
        source: 'model-free',
        modelId: null,
        set: multiCandidateSet(),
      }),
    );

    await renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Select subject$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview all subjects' }));

    await waitFor(() => {
      const proposalState = getSubjectProposalState();
      expect(proposalState.activeCandidate).toBe(0);
      expect(proposalState.reviewedCandidate).toBeNull();
      expect(proposalState.proposals?.candidates[proposalState.activeCandidate]?.label).toBe(
        'All foreground',
      );
    });
    const review = screen.getByRole('checkbox', {
      name: 'I reviewed the highlighted subject before applying',
    });
    expect(review).not.toBeChecked();
    fireEvent.click(review);
    expect(review).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Region 1, covers 50 percent/ }));
    await waitFor(() => {
      expect(getSubjectProposalState().activeCandidate).toBe(1);
      expect(getSubjectProposalState().reviewedCandidate).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Use selected candidate' })).toBeDisabled();
  });
});
