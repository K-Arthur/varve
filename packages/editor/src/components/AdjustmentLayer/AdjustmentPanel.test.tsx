// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditor } from '../../context';
import { AdjustmentPanel } from './AdjustmentPanel';

afterEach(cleanup);

function Harness() {
  const { createAdjustmentLayer, undo } = useEditor();
  return (
    <div>
      <button type="button" onClick={() => createAdjustmentLayer()}>
        Create adjustment layer
      </button>
      <button type="button" onClick={undo}>
        Undo
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

  it('adds the non-first adjustment selected with a real pointer interaction', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));

    await user.click(screen.getByRole('button', { name: /add adjustment/i }));
    const contrastOption = screen.getByRole('menuitem', { name: 'Contrast' });
    contrastOption.focus();
    expect(contrastOption).toHaveFocus();
    await user.click(contrastOption);

    expect(screen.getByRole('slider', { name: 'Contrast' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Brightness' })).toBeNull();
  });

  it('supports arrow-key selection without snapping focus back to Brightness', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));

    await user.click(screen.getByRole('button', { name: /add adjustment/i }));
    expect(screen.getByRole('menuitem', { name: 'Brightness' })).toHaveFocus();
    const adjustmentItems = screen.getAllByRole('menuitem');
    const levelsIndex = adjustmentItems.findIndex((item) => item.textContent === 'Levels');
    expect(levelsIndex).toBeGreaterThan(0);
    await user.keyboard(`${'{ArrowDown}'.repeat(levelsIndex)}{Enter}`);

    expect(screen.getByLabelText(/histogram with level sliders/i)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Brightness' })).toBeNull();
  });

  it('returns focus to the add button when the menu is dismissed', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('Create adjustment layer'));
    await waitFor(() => screen.getByText('Adjustment Layer'));

    const addButton = screen.getByRole('button', { name: /add adjustment/i });
    await user.click(addButton);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(addButton).toHaveFocus();
  });

  it('edits effect opacity and resets effect parameters without changing the layer opacity', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('Create adjustment layer'));
    await user.click(screen.getByRole('button', { name: /add adjustment/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Brightness' }));

    const brightness = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.change(brightness, { target: { value: '40' } });
    const effectOpacity = screen.getByRole('slider', { name: 'Brightness effect opacity' });
    fireEvent.change(effectOpacity, {
      target: { value: '35' },
    });
    expect(effectOpacity).toHaveValue('35');

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('0');
    expect(screen.getByRole('spinbutton', { name: 'Opacity' })).toHaveValue('1');
  });

  it('duplicates and reorders effects in the stack', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('Create adjustment layer'));

    await user.click(screen.getByRole('button', { name: /add adjustment/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Brightness' }));
    await user.click(screen.getByRole('button', { name: /add adjustment/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Contrast' }));

    await user.click(screen.getByRole('button', { name: 'Move Contrast up' }));
    expect(
      Array.from(document.querySelectorAll('.adj-panel__item-name')).map(
        (element) => element.textContent,
      ),
    ).toEqual(['Contrast', 'Brightness']);

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(document.querySelectorAll('.adj-panel__item-name')).toHaveLength(3);
  });

  it('coalesces a slider scrub into one undo operation', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('Create adjustment layer'));
    await user.click(screen.getByRole('button', { name: /add adjustment/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Brightness' }));

    const brightness = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.pointerDown(brightness);
    fireEvent.change(brightness, { target: { value: '10' } });
    fireEvent.change(brightness, { target: { value: '25' } });
    fireEvent.change(brightness, { target: { value: '40' } });
    fireEvent.pointerUp(brightness);
    expect(brightness).toHaveValue('40');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('0');
  });

  it('adding a halftone adjustment creates a fully-populated entry and renders live screening controls', async () => {
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

  it('editing the frequency slider updates the underlying HalftoneAdjustment', async () => {
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

  it('removing the halftone adjustment clears its editor controls', async () => {
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
