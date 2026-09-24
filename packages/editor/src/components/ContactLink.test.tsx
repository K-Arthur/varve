import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContactLink } from './ContactLink';

vi.mock('../actions/registerAll', () => ({
  openVarveContact: vi.fn(),
}));

const { openVarveContact } = await import('../actions/registerAll');

/**
 * ContactLink exists because a plain `mailto:` anchor is silently dropped by
 * the Tauri webview. These tests pin the three properties that made it
 * necessary: it stays a real link, a plain click goes through the opener, and
 * the user's own modifier keys are left alone.
 */
describe('ContactLink', () => {
  it('renders the visible address as a real mail link', () => {
    render(<ContactLink channel="support" />);
    const link = screen.getByRole('link');
    // The address must be readable and copyable with no mail client at all.
    expect(link).toHaveTextContent('support@varve.studio');
    expect(link).toHaveAttribute('href', 'mailto:support@varve.studio?subject=Varve%20support');
  });

  it('names the channel for assistive technology', () => {
    render(<ContactLink channel="privacy" />);
    // Not "Email us" — several of these can sit next to each other.
    expect(screen.getByRole('link', { name: 'Email Varve privacy questions' })).toBeInTheDocument();
  });

  it('routes a plain click through the platform-aware opener', async () => {
    vi.mocked(openVarveContact).mockClear();
    render(<ContactLink channel="security" />);

    await userEvent.click(screen.getByRole('link'));

    expect(openVarveContact).toHaveBeenCalledWith('security');
  });

  it('leaves modified clicks to the browser', async () => {
    vi.mocked(openVarveContact).mockClear();
    render(<ContactLink channel="feedback" />);
    const link = screen.getByRole('link');
    let preventedBeforeBrowserHandoff: boolean | undefined;
    // jsdom cannot open the new tab implied by Ctrl/Cmd-click. Observe the
    // event after React, record whether the component intercepted it, then
    // stop jsdom's unsupported navigation at the browser boundary.
    document.addEventListener(
      'click',
      (event) => {
        if (event.target !== link) return;
        preventedBeforeBrowserHandoff = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );

    // Ctrl/Cmd-click means "open this yourself" — intercepting it would
    // break a behaviour the user explicitly asked for. fireEvent is used
    // here because the modifier has to be set on the click event itself.
    fireEvent.click(link, { ctrlKey: true });

    expect(openVarveContact).not.toHaveBeenCalled();
    expect(preventedBeforeBrowserHandoff).toBe(false);
  });

  it('supports custom label text while keeping the mail target', () => {
    render(
      <ContactLink channel="support" className="settings-about__link">
        Support
      </ContactLink>,
    );
    const link = screen.getByRole('link', { name: 'Email Varve product support' });
    expect(link).toHaveTextContent('Support');
    expect(link).toHaveClass('settings-about__link');
  });
});
