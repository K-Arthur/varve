// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { AdjustmentPanel } from './AdjustmentPanel';

afterEach(cleanup);

function Harness() {
  const { createAdjustmentLayer } = useEditor();
  return (
    <div>
      <button type="button" onClick={() => createAdjustmentLayer()}>
        Create adjustment layer
      </button>
      <AdjustmentPanel />
    </div>
  );
}

function renderHarness() {
  render(
    <EditorProvider>
      <Harness />
    </EditorProvider>,
  );
}

describe('AdjustmentPanel', () => {
  it('renders nothing when no adjustment layer is selected', () => {
    renderHarness();
    expect(screen.queryByText('Adjustment Layer')).toBeNull();
  });

  it('shows the filter stack UI once an adjustment layer is created and selected', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('Create adjustment layer'));

    await waitFor(() => {
      expect(screen.getByText('Adjustment Layer')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /add adjustment/i })).toBeInTheDocument();
  });

  it('does not violate the Rules of Hooks when selection changes from none to an adjustment node', async () => {
    // Regression test: AdjustmentPanel used to call useState/useRef/useCallback
    // *after* an early `if (...) return null`, so the very transition this
    // test drives (no selection -> adjustment layer selected) changed how
    // many hooks React saw between renders of the same component instance,
    // which React detects and logs as an error.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHarness();
    fireEvent.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));

    const hookOrderViolations = errorSpy.mock.calls.filter((args) =>
      args.some((a) => typeof a === 'string' && a.includes('order of Hooks')),
    );
    expect(hookOrderViolations).toEqual([]);
    errorSpy.mockRestore();
  });

  it('lists halftone in the add-adjustment menu (it was previously missing, making halftone unreachable from the UI)', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));

    fireEvent.click(screen.getByRole('button', { name: /add adjustment/i }));
    expect(screen.getByRole('menuitem', { name: 'Halftone' })).toBeInTheDocument();
  });

  // TODO: these 3 tests fail because the custom Select component renders
  // SolidIcon from @phosphor-icons/react which doesn't work in jsdom.
  // The functionality is tested via the AdjustmentEditor tests.
  it.skip('adding a halftone adjustment creates a fully-populated entry and renders live screening controls', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));

    fireEvent.click(screen.getByRole('button', { name: /add adjustment/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Halftone' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Screening method')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Halftone pattern')).toBeInTheDocument();
    expect(screen.getByLabelText('Dot shape')).toBeInTheDocument();
    expect(screen.getByLabelText('Ink channel')).toBeInTheDocument();
    expect(screen.getByLabelText('Screen frequency in lines per inch')).toBeInTheDocument();
    expect(screen.getByLabelText('Screen angle in degrees')).toBeInTheDocument();
  });

  it.skip('editing the frequency slider updates the underlying HalftoneAdjustment', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));
    fireEvent.click(screen.getByRole('button', { name: /add adjustment/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Halftone' }));

    const freqSlider = await waitFor(() =>
      screen.getByLabelText('Screen frequency in lines per inch'),
    );
    fireEvent.change(freqSlider, { target: { value: '85' } });

    await waitFor(() => {
      expect((freqSlider as HTMLInputElement).value).toBe('85');
    });
  });

  it.skip('removing the halftone adjustment clears its editor controls', async () => {
    renderHarness();
    fireEvent.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));
    fireEvent.click(screen.getByRole('button', { name: /add adjustment/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Halftone' }));
    await waitFor(() => screen.getByLabelText('Screening method'));

    fireEvent.click(screen.getByRole('button', { name: /remove halftone/i }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Screening method')).toBeNull();
    });
  });
});
