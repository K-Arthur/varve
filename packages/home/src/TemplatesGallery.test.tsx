/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import type { TemplateLibrary } from '@varve/platform';
import { describe, expect, it, vi } from 'vitest';
import { TemplatesGallery } from './TemplatesGallery';

const MOCK_TEMPLATES: TemplateLibrary[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    category: 'General',
    description: 'Start empty.',
    previewHash: '',
    source: 'builtin',
    documentJson: '{}',
    tags: [],
    usageCount: 42,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'marketing-hero',
    name: 'Marketing Hero',
    category: 'Marketing',
    description: 'Hero section.',
    previewHash: '',
    source: 'user',
    documentJson: '{}',
    tags: ['hero', 'landing'],
    usageCount: 12,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'social-post',
    name: 'Social Post',
    category: 'Social',
    description: 'Instagram post.',
    previewHash: '',
    source: 'workspace',
    documentJson: '{}',
    tags: ['instagram', 'social'],
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
  },
];

describe('TemplatesGallery', () => {
  it('renders templates grouped by category', () => {
    const { container } = render(
      <TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('General')).toBeDefined();
    expect(screen.getByText('Marketing')).toBeDefined();
    expect(screen.getByText('Social')).toBeDefined();
    expect(screen.getByText('Blank Canvas')).toBeDefined();
    expect(screen.getByText('Marketing Hero')).toBeDefined();
    expect(screen.getByText('Social Post')).toBeDefined();
    const cats = container.querySelectorAll('.templates-gallery__cat');
    expect(cats.length).toBe(3);
  });

  it('shows category counts', () => {
    const { container } = render(
      <TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} />,
    );
    const counts = container.querySelectorAll('.templates-gallery__count');
    expect(counts.length).toBe(3);
    expect(counts[0]?.textContent).toBe('1');
  });

  it('filters templates by search query', () => {
    render(<TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} showSearch />);
    const input = screen.getByPlaceholderText('Search templates...');
    fireEvent.change(input, { target: { value: 'marketing' } });
    expect(screen.queryByText('Blank Canvas')).toBeNull();
    expect(screen.queryByText('Marketing Hero')).toBeDefined();
    expect(screen.queryByText('Social Post')).toBeNull();
  });

  it('filters templates by tags', () => {
    render(<TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} showSearch />);
    const input = screen.getByPlaceholderText('Search templates...');
    fireEvent.change(input, { target: { value: 'instagram' } });
    expect(screen.queryByText('Blank Canvas')).toBeNull();
    expect(screen.queryByText('Marketing Hero')).toBeNull();
    expect(screen.queryByText('Social Post')).toBeDefined();
  });

  it('displays source badges', () => {
    const { container } = render(
      <TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} />,
    );
    const badges = container.querySelectorAll('.template-card__source');
    expect(badges.length).toBe(3);
    expect(badges[0]?.textContent).toBe('Built-in');
    expect(badges[1]?.textContent).toBe('User');
    expect(badges[2]?.textContent).toBe('Workspace');
  });

  it('displays usage count when > 0', () => {
    const { container } = render(
      <TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} />,
    );
    const usageBadges = container.querySelectorAll('.template-card__usage');
    expect(usageBadges.length).toBe(2);
    expect(usageBadges[0]?.textContent).toContain('42');
    expect(usageBadges[1]?.textContent).toContain('12');
  });

  it('hides usage count when 0', () => {
    const { container } = render(
      <TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} />,
    );
    const usageBadges = container.querySelectorAll('.template-card__usage');
    usageBadges.forEach((badge) => {
      expect(badge.textContent).not.toContain('0');
    });
  });

  it('shows empty state when no results', () => {
    render(<TemplatesGallery templates={MOCK_TEMPLATES} onSelect={vi.fn()} showSearch />);
    const input = screen.getByPlaceholderText('Search templates...');
    fireEvent.change(input, { target: { value: 'zzzzznotexist' } });
    expect(screen.getByText(/No results for/)).toBeDefined();
  });

  it('calls onSelect when a template is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TemplatesGallery templates={MOCK_TEMPLATES} onSelect={onSelect} />,
    );
    const buttons = container.querySelectorAll('button.template-card');
    fireEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith(MOCK_TEMPLATES[0]);
  });
});
