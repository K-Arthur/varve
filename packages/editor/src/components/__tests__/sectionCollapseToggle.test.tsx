import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionCollapseToggle } from '../SectionCollapseToggle';

/**
 * The left sidebar stacks several sections above the layers tree in one
 * fixed-height column, so each needs to be put away. This is the shared
 * affordance they all use, so its labelling and state reporting are pinned
 * here rather than in each section.
 */
describe('SectionCollapseToggle', () => {
  it('reports expanded state and offers to hide', () => {
    render(<SectionCollapseToggle collapsed={false} onToggle={() => {}} label="masters" />);
    const btn = screen.getByRole('button', { name: 'Hide masters' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('reports collapsed state and offers to show', () => {
    render(<SectionCollapseToggle collapsed onToggle={() => {}} label="masters" />);
    const btn = screen.getByRole('button', { name: 'Show masters' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('notifies on activation', () => {
    const onToggle = vi.fn();
    render(<SectionCollapseToggle collapsed={false} onToggle={onToggle} label="masters" />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide masters' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('associates itself with the region it controls', () => {
    render(
      <SectionCollapseToggle
        collapsed={false}
        onToggle={() => {}}
        label="masters"
        controls="masters-body"
      />,
    );
    expect(screen.getByRole('button', { name: 'Hide masters' }).getAttribute('aria-controls')).toBe(
      'masters-body',
    );
  });
});
