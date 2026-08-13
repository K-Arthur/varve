/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('WorkspaceTabs', () => {
  beforeEach(() => {
    requestWorkspaceSwitch.mockClear();
  });

  it('renders every workspace as a labelled radio', () => {
    render(<WorkspaceTabs />);
    const group = screen.getByRole('radiogroup', { name: 'Workspace' });
    for (const label of ['Design', 'Print', 'Draw', 'Photo', 'Motion', 'Codegen & Audit', 'Logo']) {
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

  it('keeps an accessible label even when the visual label is hidden', () => {
    render(<WorkspaceTabs />);
    // The aria-label carries the workspace name in addition to the visible
    // label span, so icon-only narrow strips stay accessible.
    expect(screen.getByRole('radio', { name: 'Design workspace' })).toBeTruthy();
  });

  it('uses a distinct Hugeicons concept for every workspace mode', () => {
    render(<WorkspaceTabs />);
    const icons = [...document.querySelectorAll('[data-workspace-icon]')].map((icon) =>
      icon.getAttribute('data-workspace-icon'),
    );
    expect(icons).toEqual(['Layout', 'Brush', 'Image', 'Printer', 'Play', 'Code', 'Pen']);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
