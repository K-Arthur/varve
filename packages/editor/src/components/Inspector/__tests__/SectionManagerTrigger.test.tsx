// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
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
});
