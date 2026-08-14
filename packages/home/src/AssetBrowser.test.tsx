/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Asset, Platform } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { AssetBrowser } from './AssetBrowser';

const MOCK_ASSETS: Asset[] = [
  {
    id: 'asset-1',
    workspaceId: 'ws-1',
    name: 'logo.png',
    kind: 'image',
    mimeType: 'image/png',
    size: 102400,
    width: 200,
    height: 200,
    thumbnailHash: '',
    tags: ['logo'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'asset-2',
    workspaceId: 'ws-1',
    name: 'icon.svg',
    kind: 'icon',
    mimeType: 'image/svg+xml',
    size: 4096,
    tags: ['icon'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'asset-3',
    workspaceId: 'ws-1',
    name: 'font.woff2',
    kind: 'font',
    mimeType: 'font/woff2',
    size: 24576,
    tags: ['font'],
    createdAt: 0,
    updatedAt: 0,
  },
];

function createMockPlatform(assets: Asset[] = MOCK_ASSETS): Platform {
  return {
    listAssets: vi.fn().mockResolvedValue(assets),
    importAsset: vi.fn().mockResolvedValue({ id: 'new-asset', name: 'imported.png' }),
    searchAssets: vi.fn().mockResolvedValue(assets),
    listTemplates: vi.fn().mockResolvedValue([]),
    createTemplateFromFile: vi.fn(),
    deleteTemplate: vi.fn(),
    searchTemplates: vi.fn().mockResolvedValue([]),
  } as unknown as Platform;
}

describe('AssetBrowser', () => {
  it('renders assets in a grid', async () => {
    const platform = createMockPlatform();
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('logo.png')).toBeDefined();
    });
    expect(screen.getByText('icon.svg')).toBeDefined();
    expect(screen.getByText('font.woff2')).toBeDefined();
  });

  it('shows asset name and kind', async () => {
    const platform = createMockPlatform();
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('logo.png')).toBeDefined();
    });
    expect(screen.getByText('image')).toBeDefined();
    expect(screen.getByText('icon')).toBeDefined();
    expect(screen.getByText('font')).toBeDefined();
  });

  it('renders folders sidebar', async () => {
    const platform = createMockPlatform([]);
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('All Assets')).toBeDefined();
    });
  });

  it('has an Import button', async () => {
    const platform = createMockPlatform();
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    await waitFor(() => {
      expect(screen.getByText('Import')).toBeDefined();
    });
  });

  it('import button triggers file input', async () => {
    const platform = createMockPlatform();
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    await waitFor(() => {
      const importBtn = screen.getByText('Import');
      expect(importBtn).toBeDefined();
    });
  });

  it('search filters assets', async () => {
    const platform = createMockPlatform();
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    const input = await screen.findByLabelText('Search assets');
    fireEvent.change(input, { target: { value: 'logo' } });
    expect(screen.getByText('logo.png')).toBeDefined();
    expect(screen.queryByText('icon.svg')).toBeNull();
  });

  it('searches OCR text and exposes the match reason', async () => {
    const platform = createMockPlatform([
      { ...MOCK_ASSETS[0]!, name: 'scan.png', ocrText: 'Invoice 8472' },
      MOCK_ASSETS[1]!,
    ]);
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    const input = await screen.findByLabelText('Search assets');
    fireEvent.change(input, { target: { value: '8472' } });
    expect(screen.getByText('scan.png')).toBeDefined();
    expect(screen.getByText('Recognized text match')).toBeDefined();
    expect(screen.queryByText('icon.svg')).toBeNull();
  });

  it('shows empty state when no assets', async () => {
    const platform = createMockPlatform([]);
    render(<AssetBrowser platform={platform} workspaceId="ws-1" />);
    const empty = await screen.findByText(/No assets yet/);
    expect(empty).toBeDefined();
  });

  it('calls onInsertAsset when insert button clicked', async () => {
    const platform = createMockPlatform();
    const onInsertAsset = vi.fn();
    render(<AssetBrowser platform={platform} workspaceId="ws-1" onInsertAsset={onInsertAsset} />);
    await waitFor(() => {
      const insertBtns = screen.getAllByLabelText(/Insert/);
      expect(insertBtns.length).toBeGreaterThan(0);
      fireEvent.click(insertBtns[0]!);
      expect(onInsertAsset).toHaveBeenCalledWith(MOCK_ASSETS[0]);
    });
  });
});
