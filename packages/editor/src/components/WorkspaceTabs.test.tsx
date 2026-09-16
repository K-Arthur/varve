/** @vitest-environment jsdom */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceTabs } from './WorkspaceTabs';

const { requestWorkspaceSwitch } = vi.hoisted(() => ({
  // Resolves like the real context method, so the post-switch focus
  // restoration actually runs instead of throwing on `undefined.then`.
  requestWorkspaceSwitch: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../context', () => ({
  useEditor: () => ({
    state: { workspaceMode: 'design' },
    requestWorkspaceSwitch,
  }),
}));

const { computeWorkspaceLayout } = vi.hoisted(() => ({
  computeWorkspaceLayout: vi.fn(),
}));

vi.mock('../workspace/workspaceOverflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workspace/workspaceOverflow')>();
  computeWorkspaceLayout.mockImplementation(actual.computeWorkspaceLayout);
  return { ...actual, computeWorkspaceLayout };
});

/** jsdom reports clientWidth 0, which short-circuits the layout measurement. */
function withLayoutWidth(width: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
}

describe('WorkspaceTabs', () => {
  beforeEach(() => {
    requestWorkspaceSwitch.mockClear();
    computeWorkspaceLayout.mockClear();
  });

  afterEach(() => {
    // Restore jsdom's default.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 0,
    });
  });

  it('renders every workspace as a labelled radio', () => {
    render(<WorkspaceTabs />);
    const group = screen.getByRole('radiogroup', { name: 'Workspace' });
    for (const label of ['Design', 'Print', 'Draw', 'Photo', 'Motion', 'Codegen', 'Logo']) {
      expect(within(group).getByRole('radio', { name: new RegExp(label) })).toBeTruthy();
    }
    expect(within(group).getByRole('radio', { name: /Design/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('switches workspace on click', async () => {
    const user = userEvent.setup();
    render(<WorkspaceTabs />);
    await user.click(screen.getByRole('radio', { name: /Photo workspace/i }));
    expect(requestWorkspaceSwitch).toHaveBeenCalledWith('image');
  });

  it('moves roving focus with keyboard activation', async () => {
    const user = userEvent.setup();
    render(<WorkspaceTabs />);
    screen.getByRole('radio', { name: 'Design workspace' }).focus();
    await user.keyboard('{ArrowRight}');
    const draw = screen.getByRole('radio', { name: 'Draw workspace' });
    // Without this, a second arrow press would be computed from the stale
    // focused tab and could wrap to the wrong neighbour.
    await waitFor(() => expect(document.activeElement).toBe(draw));
    expect(requestWorkspaceSwitch).toHaveBeenLastCalledWith('drawing');
  });

  it('keeps an accessible label even when the visual label is hidden', () => {
    render(<WorkspaceTabs />);
    // The aria-label carries the workspace name in addition to the visible
    // label span, so icon-only narrow strips stay accessible.
    expect(screen.getByRole('radio', { name: 'Design workspace' })).toBeTruthy();
  });

  it('uses a distinct heavy line icon for every workspace mode', () => {
    render(<WorkspaceTabs />);
    const icons = [...document.querySelectorAll('[data-workspace-icon]')].map((icon) =>
      icon.getAttribute('data-workspace-icon'),
    );
    expect(icons).toEqual([
      'LayoutDashboard',
      'Brush',
      'Photo',
      'Printer',
      'Play',
      'Code',
      'FileText',
      'Badge',
    ]);
    expect(new Set(icons).size).toBe(icons.length);
    expect(document.querySelectorAll('[data-icon-family="tabler"]').length).toBe(icons.length);
  });

  it('renders only the active workspace label in the DOM', () => {
    render(<WorkspaceTabs />);
    // A collapsed label on inactive tabs used to sit in the DOM at width 0,
    // which made their measured width ambiguous for the overflow math.
    const labels = [...document.querySelectorAll('.workspace-dock__label')].map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(['Design']);
  });

  it('keeps the overflow trigger outside the radiogroup', () => {
    // Force an overflow layout: the mocked measurement runs because
    // clientWidth is non-zero, and the real math will not fit eight tabs in
    // 220px.
    withLayoutWidth(220);
    render(<WorkspaceTabs />);

    const group = screen.getByRole('radiogroup', { name: 'Workspace' });
    expect(within(group).queryByRole('button', { name: /more workspaces/i })).toBeNull();
    // Only radios may be radiogroup children (APG ownership).
    expect(
      [...group.querySelectorAll('[role]')].every((el) => el.getAttribute('role') === 'radio'),
    ).toBe(true);

    const more = screen.getByRole('button', { name: /more workspaces/i });
    expect(group.contains(more)).toBe(false);
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    // The hidden count is part of the accessible name so a screen reader user
    // knows the menu is not empty before opening it.
    expect(more.getAttribute('aria-label')).toMatch(/^More workspaces \(\d+ hidden\)$/);
    expect(computeWorkspaceLayout).toHaveBeenCalled();
  });

  it('passes the measured CSS gap into the overflow math', () => {
    withLayoutWidth(220);
    render(<WorkspaceTabs />);
    const call = computeWorkspaceLayout.mock.calls.at(-1)?.[0];
    expect(call).toBeTruthy();
    // jsdom has no stylesheet, so the documented fallback is used — the point
    // is that the gap travels through the layout input instead of living as a
    // second constant inside the math.
    expect(call?.tabGap).toBe(5);
  });
});
