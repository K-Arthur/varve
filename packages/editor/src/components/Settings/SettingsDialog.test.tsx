// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableDrawDiagnostics, isDiagnosticsEnabled } from '../../canvas/drawDiagnostics';
import { EditorProvider } from '../../context';
import { SettingsProvider } from './SettingsContext';
import { SettingsDialog } from './SettingsDialog';

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <EditorProvider>
      <SettingsProvider>{ui}</SettingsProvider>
    </EditorProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  enableDrawDiagnostics(false);
});
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

  it('keeps usage, diagnostics, and crash consent in separate controls', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} initialSection="privacy" />);
    expect(screen.getByLabelText('Usage analytics consent')).toBeTruthy();
    expect(screen.getByLabelText('Diagnostics telemetry consent')).toBeTruthy();
    expect(screen.getByText('Crash reporting')).toBeTruthy();
  });
});

describe('GeneralSection canvas background', () => {
  it('renders a compact swatch trigger rather than an inline picker', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const swatch = screen.getByRole('button', { name: 'Canvas background' });
    expect(swatch.getAttribute('aria-haspopup')).toBe('dialog');
    expect(swatch.getAttribute('aria-expanded')).toBe('false');
    // The outer Settings <dialog> itself has an implicit role=dialog, so scope
    // by accessible name to confirm the *picker's* dialog isn't in the DOM yet.
    expect(screen.queryByRole('dialog', { name: /pick canvas background/i })).toBeNull();
  });

  it('opens the picker dialog on click', async () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Canvas background' }));
    const dialog = await screen.findByRole('dialog', { name: /pick canvas background/i });
    expect(dialog).toBeTruthy();
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

describe('PerformanceSettingsTab', () => {
  function openPerformanceTab() {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    const performanceTab = tabs.find((t) => t.textContent === 'Performance');
    expect(performanceTab).toBeTruthy();
    fireEvent.click(performanceTab!);
  }

  it('shows the memory budget and reduce motion selectors', () => {
    openPerformanceTab();
    expect(screen.getByLabelText('Memory / cache budget')).toBeTruthy();
    expect(screen.getByLabelText('Reduce motion')).toBeTruthy();
  });

  it('performance overlay toggle is off by default and enabling it flips the live overlay immediately', () => {
    expect(isDiagnosticsEnabled()).toBe(false);
    openPerformanceTab();
    const toggle = screen.getByLabelText('Show performance overlay') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    // No reload/remount needed — the module-level HUD flag flips synchronously.
    expect(isDiagnosticsEnabled()).toBe(true);
    fireEvent.click(toggle);
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it('shows read-only diagnostics stats', () => {
    openPerformanceTab();
    expect(screen.getByText('Adaptive quality tier')).toBeTruthy();
    expect(screen.getByText('Avg. frame time')).toBeTruthy();
  });

  it('copy diagnostics button does not throw when clicked', () => {
    openPerformanceTab();
    const copyBtn = screen.getByText('Copy performance diagnostics');
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });
});
