// @ts-nocheck
/**
 * InspectorColorPopover — portaled colour dialog for inspector swatches.
 *
 * Floats beside the trigger (prefer left so properties stay readable), with
 * Esc / outside-click / Done dismiss, focus return, and role=dialog.
 *
 * Research basis: APG Dialog (Modal); Floating UI placement; WCAG 2.2 target size.
 */
// @vitest-environment jsdom

import type { ManagedColor } from '@strata/scene';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorColorPopover } from './InspectorColorPopover';

afterEach(cleanup);

const WHITE: ManagedColor = { space: 'rgb', r: 255, g: 255, b: 255, a: 255 };

describe('InspectorColorPopover', () => {
  it('keeps the picker closed until the swatch is activated', () => {
    render(
      <InspectorColorPopover
        label="Fill colour"
        value={WHITE}
        onChange={() => {}}
        swatchStyle={{ background: '#fff' }}
      />,
    );
    expect(screen.queryByRole('dialog', { name: /fill colour/i })).toBeNull();
    expect(screen.getByRole('button', { name: /fill colour/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens a portaled dialog and closes on Done', async () => {
    render(
      <InspectorColorPopover
        label="Fill colour"
        value={WHITE}
        onChange={() => {}}
        swatchStyle={{ background: '#fff' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /fill colour/i }));
    const dialog = await screen.findByRole('dialog', { name: /pick fill colour/i });
    expect(dialog).toBeTruthy();
    // Portaled to document.body — not nested under the trigger's parent panel flow.
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog.closest('.insp-picker-popover--portaled')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /pick fill colour/i })).toBeNull();
    });
  });

  it('closes on Escape and restores focus to the swatch', async () => {
    render(
      <InspectorColorPopover
        label="Stroke colour"
        value={WHITE}
        onChange={() => {}}
        swatchStyle={{ background: '#000' }}
      />,
    );
    const swatch = screen.getByRole('button', { name: /stroke colour/i });
    fireEvent.click(swatch);
    await screen.findByRole('dialog', { name: /pick stroke colour/i });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(swatch);
  });

  it('calls onChange when the picker emits a colour', async () => {
    const onChange = vi.fn();
    render(
      <InspectorColorPopover
        label="Effect colour"
        value={WHITE}
        onChange={onChange}
        swatchStyle={{ background: '#fff' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /effect colour/i }));
    await screen.findByRole('dialog');
    // Theme swatch selection exercises ColorPicker → onChange
    const teal = screen.getByRole('option', { name: /teal 500/i });
    fireEvent.click(teal);
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]?.[0] as ManagedColor;
    expect(next.space).toBe('rgb');
  });

  it('stays open when switching colour space inside the picker', async () => {
    render(
      <InspectorColorPopover
        label="Fill colour"
        value={WHITE}
        onChange={() => {}}
        swatchStyle={{ background: '#fff' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /fill colour/i }));
    await screen.findByRole('dialog', { name: /pick fill colour/i });
    // Switch to CMYK mode
    const cmykBtn = screen.getAllByRole('radio', { name: 'CMYK' })[0];
    fireEvent.click(cmykBtn);
    // The dialog should still be open
    expect(screen.getByRole('dialog', { name: /pick fill colour/i })).toBeTruthy();
    // The CMYK button should now be active
    expect(cmykBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('stays open when switching between RGB and CMYK multiple times', async () => {
    render(
      <InspectorColorPopover
        label="Fill colour"
        value={WHITE}
        onChange={() => {}}
        swatchStyle={{ background: '#fff' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /fill colour/i }));
    await screen.findByRole('dialog', { name: /pick fill colour/i });
    // Switch RGB → CMYK → RGB → CMYK
    const rgbBtn = screen.getAllByRole('radio', { name: 'RGB' })[0];
    const cmykBtn = screen.getAllByRole('radio', { name: 'CMYK' })[0];
    fireEvent.click(cmykBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(rgbBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(cmykBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
