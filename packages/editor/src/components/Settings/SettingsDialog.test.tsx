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

  it('filters sections by name and follows the first match', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    const filter = screen.getByLabelText('Filter settings sections');

    fireEvent.change(filter, { target: { value: 'keyboard' } });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Keyboard Shortcuts']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');

    // Arrow navigation moves within the filtered set, not the full list.
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Keyboard Shortcuts' })).toBeTruthy();
  });

  it('reports when no settings match the filter', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Filter settings sections'), {
      target: { value: 'zzz-no-section' },
    });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByText(/No settings match/)).toBeTruthy();
  });

  it('exposes a reachable drawing input policy and persists it', async () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} initialSection="input" />);
    const mode = screen.getByRole('combobox', { name: 'Finger / unknown contact' });
    expect(mode).toHaveTextContent('Finger draws');
    fireEvent.click(mode);
    fireEvent.click(await screen.findByRole('option', { name: /Finger navigates/ }));
    expect(mode).toHaveTextContent('Finger navigates');
    expect(JSON.parse(localStorage.getItem('varve-editor-settings')!).drawingInput.fingerMode).toBe(
      'navigate',
    );

    const wheel = screen.getByRole('combobox', { name: 'Wheel behavior' });
    expect(wheel).toHaveTextContent('Standard: wheel pans');
    fireEvent.click(wheel);
    fireEvent.click(await screen.findByRole('option', { name: /Always zoom/ }));
    expect(JSON.parse(localStorage.getItem('varve-editor-settings')!).viewport.wheelMode).toBe(
      'zoom',
    );

    const sensitivity = screen.getByLabelText('Wheel sensitivity') as HTMLInputElement;
    fireEvent.change(sensitivity, { target: { value: '1.5' } });
    fireEvent.blur(sensitivity);
    expect(
      JSON.parse(localStorage.getItem('varve-editor-settings')!).viewport.wheelSensitivity,
    ).toBe(1.5);
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

  it('validates, persists, and resets nudge amounts', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} initialSection="nudge" />);

    const small = screen.getByLabelText('Small nudge') as HTMLInputElement;
    const big = screen.getByLabelText('Big nudge') as HTMLInputElement;
    expect(small.value).toBe('1');
    expect(big.value).toBe('10');

    fireEvent.change(small, { target: { value: '0.25' } });
    fireEvent.blur(small);
    expect(JSON.parse(localStorage.getItem('varve-editor-settings')!).nudge.small).toBe(0.25);

    fireEvent.change(big, { target: { value: '0' } });
    fireEvent.blur(big);
    expect(screen.getByText(/finite value between/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset nudge values' }));
    expect((screen.getByLabelText('Small nudge') as HTMLInputElement).value).toBe('1');
    expect((screen.getByLabelText('Big nudge') as HTMLInputElement).value).toBe('10');
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

describe('AppearanceSettingsTab', () => {
  it('renders the theme and appearance controls from current settings', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));

    expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveTextContent('System');
    expect(screen.getByLabelText('UI font size')).toBeTruthy();
    expect(
      screen.getByLabelText('Show all menu items (bypass workspace mode filtering)'),
    ).toBeTruthy();
  });

  it('renders the density control with the two pro modes and the active contract', () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));

    const density = screen.getByRole('combobox', { name: 'Interface density' });
    expect(density).toHaveTextContent('Default Pro');
    expect(screen.getByText('Comfortable 34px rows for pointer-first work.')).toBeTruthy();
  });

  it('persists Compact Pro and announces the compact contract', async () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));

    fireEvent.click(screen.getByRole('combobox', { name: 'Interface density' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Compact Pro' }));

    expect(screen.getByRole('combobox', { name: 'Interface density' })).toHaveTextContent(
      'Compact Pro',
    );
    expect(
      screen.getByText(
        '28px rows show more of the stack at once; text and targets keep their readable floor.',
      ),
    ).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem('varve-editor-settings')!);
    expect(stored.appearance.uiDensity).toBe('compact');
    expect(document.documentElement.dataset.density).toBe('compact');
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

  it('opens export dropdowns in the dialog and persists a selection', async () => {
    renderWithProvider(<SettingsDialog open={true} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Export'));

    const format = screen.getByRole('combobox', { name: 'Default format' });
    fireEvent.click(format);
    const svg = await screen.findByRole('option', { name: 'SVG' });
    expect(svg.closest('dialog')).toBeTruthy();
    fireEvent.click(svg);

    expect(format).toHaveTextContent('SVG');
    expect(JSON.parse(localStorage.getItem('varve-editor-settings')!).export.defaultFormat).toBe(
      'svg',
    );
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
    expect(screen.getByLabelText('Interactive preview quality')).toBeTruthy();
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

  it('exposes the capability report as an on-demand diagnostic', () => {
    openPerformanceTab();
    expect(screen.getByRole('heading', { name: 'Platform capability report' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collect capability report' })).toBeTruthy();
    expect(screen.queryByText('View report JSON')).toBeNull();
  });

  it('copy diagnostics button does not throw when clicked', () => {
    openPerformanceTab();
    const copyBtn = screen.getByText('Copy performance diagnostics');
    expect(() => fireEvent.click(copyBtn)).not.toThrow();
  });
});
