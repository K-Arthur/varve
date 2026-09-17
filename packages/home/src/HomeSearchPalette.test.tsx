/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Platform } from '@varve/platform';
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

  it('shows recent files, most recently opened first, when the query is empty', () => {
    const files = [
      { ...mockFiles[0]!, id: 'old', name: 'Older', openedAt: 100 },
      { ...mockFiles[1]!, id: 'new', name: 'Newer', openedAt: 200 },
    ];
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        files={files}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    expect(screen.getByText('Recent files')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Newer');
    expect(options[1]).toHaveTextContent('Older');
  });

  it('opens the first recent file on Enter with an empty query', () => {
    const onOpenFile = vi.fn();
    const files = [
      { ...mockFiles[0]!, id: 'old', name: 'Older', openedAt: 100 },
      { ...mockFiles[1]!, id: 'new', name: 'Newer', openedAt: 200 },
    ];
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={onOpenFile}
        files={files}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onOpenFile).toHaveBeenCalledWith('new');
  });

  it('explains the empty state when no files exist', () => {
    render(
      <HomeSearchPalette
        open={true}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        files={[]}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    expect(screen.getByText(/Type to search files and document contents/)).toBeInTheDocument();
  });
});
