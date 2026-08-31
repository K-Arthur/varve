// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { SectionManagerTrigger } from '../SectionManagerTrigger';

describe('SectionManagerTrigger', () => {
  it('hides and restores an optional section from its checkbox', () => {
    render(
      <EditorProvider>
        <SectionManagerTrigger />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize sections' }));
    expect(screen.getByRole('button', { name: 'Show all sections' })).toHaveFocus();
    const typography = screen.getByRole('checkbox', { name: 'Typography' });
    expect(typography).toBeChecked();

    fireEvent.click(typography);
    expect(typography).not.toBeChecked();

    fireEvent.click(typography);
    expect(typography).toBeChecked();
  });

  it('exposes stable, keyboard-labeled section reordering within the surface', () => {
    render(
      <EditorProvider>
        <SectionManagerTrigger />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize sections' }));
    expect(screen.getByRole('button', { name: 'Reset order' })).toBeInTheDocument();

    const items = () =>
      screen
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-section-id'))
        .filter((id): id is string => id !== null);
    const before = items();
    const firstItem = screen.getAllByRole('listitem')[0]!;

    fireEvent.click(within(firstItem).getByRole('button', { name: / down$/i }));
    expect(items().slice(0, 2)).toEqual([before[1], before[0]]);
  });
});
