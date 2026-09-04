// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { SectionManagerTrigger } from '../SectionManagerTrigger';

describe('SectionManagerTrigger', () => {
  it('hides and restores an optional section from its checkbox', async () => {
    render(
      <EditorProvider>
        <SectionManagerTrigger />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize sections' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show all sections', hidden: true })).toHaveFocus(),
    );
    const typography = screen.getByRole('checkbox', { name: 'Typography' });
    expect(typography).toBeChecked();

    fireEvent.click(typography);
    expect(typography).not.toBeChecked();

    fireEvent.click(typography);
    expect(typography).toBeChecked();
  });

  it('exposes stable, keyboard-labeled section reordering within the surface', async () => {
    render(
      <EditorProvider>
        <SectionManagerTrigger />
      </EditorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize sections' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset order', hidden: true })).toBeInTheDocument(),
    );

    const items = () =>
      screen
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-section-id'))
        .filter((id): id is string => id !== null);
    let before: string[] = [];
    await waitFor(() => {
      before = items();
      expect(before.length).toBeGreaterThan(1);
    });
    const firstItem = screen.getAllByRole('listitem')[0]!;

    fireEvent.click(within(firstItem).getByRole('button', { name: / down$/i }));
    await waitFor(() => expect(items().slice(0, 2)).toEqual([before[1], before[0]]));
  });
});
