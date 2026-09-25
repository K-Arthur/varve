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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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

  it('opens a project result from the keyboard and exposes the active option', () => {
    const onOpenFile = vi.fn();
    const onOpenProject = vi.fn();
    const onClose = vi.fn();
    render(
      <HomeSearchPalette
        open
        onClose={onClose}
        onOpenFile={onOpenFile}
        onOpenProject={onOpenProject}
        onCreateFromTemplate={vi.fn()}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(input, { target: { value: 'Marketing' } });
    const option = screen.getByRole('option', { name: 'Marketing Site' });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onOpenProject).toHaveBeenCalledWith('p1');
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('selection');
  });

  it('creates from the selected template instead of treating its ID as a file', () => {
    const onCreateFromTemplate = vi.fn();
    const onOpenFile = vi.fn();
    render(
      <HomeSearchPalette
        open
        onClose={vi.fn()}
        onOpenFile={onOpenFile}
        onOpenProject={vi.fn()}
        onCreateFromTemplate={onCreateFromTemplate}
        files={mockFiles}
        projects={mockProjects}
        templates={mockTemplates}
        platform={mockPlatform}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Search' }), {
      target: { value: 'Blank Canvas' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Blank Canvas/i }));
    expect(onCreateFromTemplate).toHaveBeenCalledWith('t1');
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('prefers an exact template name over an earlier partial project match', () => {
    const onCreateFromTemplate = vi.fn();
    const onOpenProject = vi.fn();
    render(
      <HomeSearchPalette
        open
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenProject={onOpenProject}
        onCreateFromTemplate={onCreateFromTemplate}
        files={[]}
        projects={[{ ...mockProjects[0]!, name: 'Brand' }]}
        templates={[{ ...mockTemplates[0]!, name: 'Brand Starter' }]}
        platform={mockPlatform}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.change(input, { target: { value: 'Brand Starter' } });
    const option = screen.getByRole('option', { name: /Brand Starter/ });
    expect(input).toHaveAttribute('aria-activedescendant', option.id);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onCreateFromTemplate).toHaveBeenCalledWith('t1');
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('explains the empty state when no files exist', () => {
    render(
      <HomeSearchPalette
        onOpenProject={vi.fn()}
        onCreateFromTemplate={vi.fn()}
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
