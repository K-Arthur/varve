import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider } from './context';
import { TabStrip } from './TabStrip';

describe('TabStrip', () => {
  it('renders the initial document tab', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    // EditorProvider always starts with one session; no separate home tab.
    const tabs = screen.queryAllByRole('tab');
    expect(tabs).toHaveLength(1);
  });

  it('renders the new-document button', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    const newBtn = screen.getByLabelText(/new document/i);
    expect(newBtn).toBeTruthy();
  });
});
