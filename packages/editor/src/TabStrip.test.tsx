import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorProvider } from './context';
import { TabStrip } from './TabStrip';

describe('TabStrip', () => {
  it('renders a Home tab at the beginning of the tablist', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]?.textContent).toContain('Home');
  });

  it('calls onBackToHome when Home tab is clicked', async () => {
    const onBackToHome = vi.fn();
    render(
      <EditorProvider>
        <TabStrip onBackToHome={onBackToHome} />
      </EditorProvider>,
    );
    const tabs = screen.getAllByRole('tab');
    const homeTab = tabs[0];
    if (homeTab) await userEvent.click(homeTab);
    expect(onBackToHome).toHaveBeenCalledTimes(1);
  });

  it('does not call onBackToHome when not provided', async () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    const tabs = screen.getAllByRole('tab');
    const homeTab = tabs[0];
    if (homeTab) await userEvent.click(homeTab);
  });

  it('renders Home tab with correct title attribute', () => {
    render(
      <EditorProvider>
        <TabStrip />
      </EditorProvider>,
    );
    const tabs = screen.getAllByRole('tab');
    const homeTab = tabs[0];
    expect(homeTab?.getAttribute('title')).toBe('Home (Ctrl+Shift+H)');
  });
});
