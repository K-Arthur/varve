// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getIconProviderRegistry, resetIconProviderRegistry } from '@varve/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.unstubAllGlobals();
  resetIconProviderRegistry();
});

beforeEach(() => {
  // Deterministic provider (no network) + hard network ban: unit tests must
  // never hit the live Iconify API.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network disabled in icon tests');
    }),
  );
  const fakeProvider = {
    id: 'test',
    name: 'Test Provider',
    kind: 'public-api' as const,
    enabled: true,
    requiresNetwork: true,
    capabilities: ['search', 'fetch-svg'] as const,
    search: vi.fn(async () => ({ items: [], total: 0, start: 0, exhausted: true })),
    getSvg: vi.fn(async () => null),
  };
  getIconProviderRegistry().register(fakeProvider);
});

describe('IconBrowserDialog', () => {
  it('renders the browser, searches deterministically, and does not insert without a selection', async () => {
    const { insertIconAsset } = editorMock();
    const onClose = vi.fn();
    render(<IconBrowserDialog open onClose={onClose} />);

    const input = await screen.findByLabelText('Search icons');
    fireEvent.change(input, { target: { value: 'home' } });
    expect(await screen.findByText(/no icons match/i)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(insertIconAsset).not.toHaveBeenCalled();
  });

  it('shows an actionable error state when the icon service is unreachable', async () => {
    resetIconProviderRegistry();
    editorMock();
    const onClose = vi.fn();
    render(<IconBrowserDialog open onClose={onClose} />);
    const input = await screen.findByLabelText('Search icons');
    fireEvent.change(input, { target: { value: 'home' } });
    // ensureIconProviders() bootstraps the built-in provider, so an empty
    // registry can never silently return zero results — the failure must be
    // surfaced as an actionable network error.
    expect(
      (await screen.findAllByText(/could not reach the icon service/i, {}, { timeout: 15000 }))
        .length,
    ).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /retry/i })).toBeTruthy();
  }, 20000);

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
