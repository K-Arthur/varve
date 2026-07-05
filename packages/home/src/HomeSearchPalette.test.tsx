/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import type { Platform } from '@strata/platform';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeSearchPalette } from './HomeSearchPalette';

const mockPlatform: Platform = {
  searchFileContent: vi.fn().mockResolvedValue([]),
} as unknown as Platform;

const mockFiles = [
  {
    id: 'f1',
    name: 'Design System',
    kind: 'strata' as const,
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: '',
  },
  {
    id: 'f2',
    name: 'Landing Page',
    kind: 'strata' as const,
    projectId: null,
    createdAt: 0,
    updatedAt: 0,
    openedAt: 0,
    size: 0,
    pinned: false,
    trashedAt: null,
    ordering: '',
    contentHash: '',
  },
];

const mockProjects = [
  { id: 'p1', name: 'Marketing Site', createdAt: 0, updatedAt: 0, pinned: false, trashedAt: null },
];

const mockTemplates = [
  {
    id: 't1',
    name: 'Blank Canvas',
    category: 'General',
    description: '',
    previewHash: '',
    source: 'builtin' as const,
    documentJson: '{}',
    tags: [],
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe('HomeSearchPalette', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <HomeSearchPalette
        open={false}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders search input when open', () => {
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    expect(screen.getByPlaceholderText(/Search/)).toBeInTheDocument();
  });

  it('filters results by query', () => {
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    const input = screen.getByPlaceholderText(/Search/);
    fireEvent.change(input, { target: { value: 'Design' } });
    expect(screen.getByText('Design System')).toBeInTheDocument();
    expect(screen.queryByText('Landing Page')).not.toBeInTheDocument();
  });

  it('shows grouped results', () => {
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    const input = screen.getByPlaceholderText(/Search/);
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Templates')).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <HomeSearchPalette
        open={true}
        onClose={onClose}
        onOpenFile={vi.fn()}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onOpenFile on Enter for selected result', async () => {
    const onOpenFile = vi.fn();
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={onOpenFile}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const input = screen.getByPlaceholderText(/Search/);
    fireEvent.change(input, { target: { value: 'Design' } });
    await waitFor(() => {
      expect(screen.getByText('Design System')).toBeInTheDocument();
    });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onOpenFile).toHaveBeenCalledWith('f1');
  });
});
