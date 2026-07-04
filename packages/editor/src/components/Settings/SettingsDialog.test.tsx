// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsProvider } from './SettingsContext';
import { SettingsDialog } from './SettingsDialog';

function renderWithProvider(ui: React.ReactElement) {
  return render(<SettingsProvider>{ui}</SettingsProvider>);
}

afterEach(cleanup);

describe('SettingsDialog', () => {
  it('renders with tabs', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('tab switching works', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    const exportTab = tabs.find((t) => t.textContent === 'Export');
    expect(exportTab).toBeTruthy();
    fireEvent.click(exportTab!);
    expect(exportTab?.getAttribute('aria-selected')).toBe('true');
  });

  it('closes on close button', () => {
    const onClose = vi.fn();
    renderWithProvider(<SettingsDialog open={true} onClose={onClose} />);
    const closeBtn = screen.getByLabelText('Close dialog');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ExportSettingsTab', () => {
  it('shows format selector', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    const exportTab = tabs.find((t) => t.textContent === 'Export');
    fireEvent.click(exportTab!);
    expect(screen.getByLabelText('Default format')).toBeTruthy();
  });

  it('shows ICC profile selector', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    const exportTab = tabs.find((t) => t.textContent === 'Export');
    fireEvent.click(exportTab!);
    expect(screen.getByLabelText('ICC profile')).toBeTruthy();
  });
});
