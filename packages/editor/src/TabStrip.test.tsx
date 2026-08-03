import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('TabStrip focus behavior', () => {
  it('roving tabindex follows focus, not selection', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    // Ctrl+T once: one more document; the last is active.
    const newBtn = screen.getByLabelText(/new document/i);
    fireEvent.click(newBtn);
    fireEvent.click(newBtn);
    void newBtn;

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    // Active (last) tab owns tabindex=0 initially.
    expect(tabs[2]).toHaveAttribute('tabindex', '0');

    // Move focus left with the arrow key: roving index must follow the
    // focused tab, even though selection stays on the last tab.
    fireEvent.keyDown(tabs[2]!, { key: 'ArrowLeft' });
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
  });

  it('closing a tab moves focus to the replacement tab', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    const newBtn = screen.getByLabelText(/new document/i);
    fireEvent.click(newBtn);
    const tabs = screen.getAllByRole('tab');
    // Focus the first tab, then close it via Delete.
    fireEvent.keyDown(tabs[0]!, { key: 'Delete' });
    // Focus lands on the tab that took its place.
    const after = screen.getAllByRole('tab');
    expect(after).toHaveLength(1);
    expect(after[0]).toHaveFocus();
    expect(after[0]).toHaveAttribute('tabindex', '0');
  });

  it('creating a document moves focus to the new tab', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    const newBtn = screen.getByLabelText(/new document/i);
    fireEvent.click(newBtn);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
  });
});
