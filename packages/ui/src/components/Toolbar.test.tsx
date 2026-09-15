/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Toolbar } from './Toolbar';

afterEach(() => {
  cleanup();
});

function RenderToolbar() {
  return (
    <div>
      <button type="button" aria-label="before" />
      <Toolbar label="Drawing tools">
        <button type="button" aria-label="Select" />
        <button type="button" aria-label="Rect" />
        <button type="button" aria-label="Ellipse" />
        <button type="button" aria-label="Text" />
        <button type="button" aria-label="Move" disabled />
      </Toolbar>
      <button type="button" aria-label="after" />
    </div>
  );
}

describe('Toolbar', () => {
  it('gives exactly one item tabindex=0 (roving tabindex)', () => {
    render(<RenderToolbar />);
    const buttons = screen.getAllByRole('button');
    const zero = buttons.filter((b) => b.getAttribute('tabindex') === '0');
    expect(zero).toHaveLength(1);
    expect(zero[0]).toHaveAccessibleName('Select');
  });

  it('does not steal focus on mount', () => {
    render(<RenderToolbar />);
    expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Select');
    expect(document.activeElement).toBe(document.body);
  });

  it('moves focus with arrow keys when focus is inside the toolbar', async () => {
    const user = userEvent.setup();
    render(<RenderToolbar />);
    const select = screen.getByRole('button', { name: 'Select' });
    await user.click(select);
    expect(select).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Rect' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Rect' })).toHaveAttribute('tabindex', '0');
    expect(select).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowLeft}');
    expect(select).toHaveFocus();
  });

  it('skips disabled buttons when navigating', async () => {
    const user = userEvent.setup();
    render(<RenderToolbar />);
    const text = screen.getByRole('button', { name: 'Text' });
    await user.click(text);
    await user.keyboard('{ArrowRight}');
    // Next after Text is Move (disabled) — must wrap to Select.
    expect(screen.getByRole('button', { name: 'Select' })).toHaveFocus();
  });

  it('supports Home and End', async () => {
    const user = userEvent.setup();
    render(<RenderToolbar />);
    await user.click(screen.getByRole('button', { name: 'Ellipse' }));
    await user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Select' })).toHaveFocus();
    await user.keyboard('{End}');
    // Last enabled item (Move is disabled and must be skipped).
    expect(screen.getByRole('button', { name: 'Text' })).toHaveFocus();
  });

  it('keeps the roving tabindex consistent after a disabled tool toggles enabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Toolbar label="t">
        <button type="button" aria-label="A" />
        <button type="button" aria-label="B" disabled />
      </Toolbar>,
    );
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('tabindex', '-1');
    rerender(
      <Toolbar label="t">
        <button type="button" aria-label="A" />
        <button type="button" aria-label="B" />
      </Toolbar>,
    );
    await user.click(screen.getByRole('button', { name: 'A' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'B' })).toHaveFocus();
  });

  it('applies the roving tabindex when children arrive after the first commit', () => {
    // The floating palette mounts before the workspace config hydrates, so its
    // buttons appear in a later commit than the Toolbar itself. The old
    // focusIdx-only effect never re-ran for that commit and every button kept
    // the browser default tabIndex=0 — 15 tab stops instead of one.
    const { rerender } = render(<Toolbar label="late" />);
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
    rerender(
      <Toolbar label="late">
        <button type="button" aria-label="Select" />
        <button type="button" aria-label="Rect" />
        <button type="button" aria-label="Pen" />
      </Toolbar>,
    );
    const zero = Array.from(document.querySelectorAll('[aria-label]')).filter(
      (b) => b.getAttribute('tabindex') === '0',
    );
    expect(zero).toHaveLength(1);
    expect(zero[0]).toHaveAccessibleName('Select');
  });

  it('restores one tab stop when a child mutates the subtree without a re-render', async () => {
    render(
      <Toolbar label="mutating">
        <button type="button" aria-label="Select" />
        <button type="button" aria-label="Rect" />
      </Toolbar>,
    );
    const toolbar = document.querySelector('.varve-toolbar');
    if (!toolbar) throw new Error('toolbar missing');
    const late = document.createElement('button');
    late.setAttribute('aria-label', 'Late');
    toolbar.appendChild(late);
    await Promise.resolve();
    const zero = Array.from(toolbar.querySelectorAll('button')).filter(
      (b) => b.getAttribute('tabindex') === '0',
    );
    expect(zero).toHaveLength(1);
  });

  it('yields arrow keys to a text-entry widget inside the toolbar', async () => {
    // The quick bars embed composite widgets (a font-size field, a weight
    // select). Arrow keys there must edit the widget, not hop to another
    // toolbar control — APG: the toolbar yields to keys a widget owns.
    const user = userEvent.setup();
    render(
      <Toolbar label="mixed">
        <button type="button" aria-label="Bold" />
        <input type="number" aria-label="Font size" defaultValue={12} />
        <button type="button" aria-label="Italic" />
      </Toolbar>,
    );
    const input = screen.getByRole('spinbutton', { name: 'Font size' });
    await user.click(input);
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveFocus();
  });

  it('lets a consumer class replace the default surface class', () => {
    render(
      <Toolbar label="custom" className="my-bar">
        <button type="button" aria-label="A" />
      </Toolbar>,
    );
    const bar = screen.getByRole('toolbar', { name: 'custom' });
    expect(bar).toHaveClass('my-bar');
    expect(bar).not.toHaveClass('varve-toolbar');
  });
});
