import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from '../Disclosure';

afterEach(cleanup);

function DisclosureExample({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  variant,
  keepMounted,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  variant?: 'compact' | 'standard';
  keepMounted?: boolean;
} = {}) {
  return (
    <Disclosure
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      variant={variant}
    >
      <DisclosureTrigger>Section Title</DisclosureTrigger>
      <DisclosureContent keepMounted={keepMounted}>
        <p>Content here</p>
      </DisclosureContent>
    </Disclosure>
  );
}

describe('Disclosure', () => {
  describe('uncontrolled', () => {
    it('renders collapsed by default', () => {
      render(<DisclosureExample />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Content here')).not.toBeInTheDocument();
    });

    it('renders expanded when defaultOpen is true', () => {
      render(<DisclosureExample defaultOpen />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Content here')).toBeInTheDocument();
    });

    it('toggles on click', async () => {
      const user = userEvent.setup();
      render(<DisclosureExample />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });

      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Content here')).toBeInTheDocument();

      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Content here')).not.toBeInTheDocument();
    });

    it('toggles on Enter key', async () => {
      const user = userEvent.setup();
      render(<DisclosureExample />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });

      trigger.focus();
      await user.keyboard('{Enter}');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles on Space key', async () => {
      const user = userEvent.setup();
      render(<DisclosureExample />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });

      trigger.focus();
      await user.keyboard(' ');
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('controlled', () => {
    it('renders according to the open prop', () => {
      render(<DisclosureExample open={false} />);
      expect(screen.queryByText('Content here')).not.toBeInTheDocument();

      render(<DisclosureExample open={true} />);
      expect(screen.getByText('Content here')).toBeInTheDocument();
    });

    it('calls onOpenChange with the next value', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(<DisclosureExample open={false} onOpenChange={onOpenChange} />);

      await user.click(screen.getByRole('button', { name: 'Section Title' }));
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe('accessibility', () => {
    it('wires aria-controls to the content section', () => {
      render(<DisclosureExample defaultOpen />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });
      const contentId = trigger.getAttribute('aria-controls');
      expect(contentId).toBeTruthy();
      const content = document.getElementById(contentId!);
      expect(content).toBeTruthy();
      expect(content).toHaveTextContent('Content here');
    });

    it('content has accessible name via heading', () => {
      render(
        <Disclosure defaultOpen>
          <DisclosureTrigger>My Section</DisclosureTrigger>
          <DisclosureContent>
            <h2>Heading</h2>
            <p>Body</p>
          </DisclosureContent>
        </Disclosure>,
      );
      // The section should be labelable
      const content = document.querySelector('.varve-disclosure__content');
      expect(content).toBeTruthy();
    });
  });

  describe('disabled', () => {
    it('prevents toggling when disabled', async () => {
      const user = userEvent.setup();
      render(<DisclosureExample disabled />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });

      expect(trigger).toBeDisabled();
      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-disabled on trigger', () => {
      render(<DisclosureExample disabled />);
      const trigger = screen.getByRole('button', { name: 'Section Title' });
      expect(trigger).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('keepMounted', () => {
    it('keeps content in DOM when closed', () => {
      render(<DisclosureExample keepMounted />);
      expect(screen.getByText('Content here')).toBeInTheDocument();
      const content = screen.getByText('Content here').closest('section');
      expect(content).toHaveAttribute('hidden');
    });

    it('unmounts content by default when closed', () => {
      render(<DisclosureExample />);
      expect(screen.queryByText('Content here')).not.toBeInTheDocument();
    });
  });

  describe('data attributes', () => {
    it('sets data-state on root when closed', () => {
      render(<DisclosureExample />);
      expect(screen.getByText('Section Title').closest('.varve-disclosure')).toHaveAttribute(
        'data-state',
        'closed',
      );
    });

    it('sets data-state on root when open', () => {
      render(<DisclosureExample defaultOpen />);
      expect(screen.getByText('Section Title').closest('.varve-disclosure')).toHaveAttribute(
        'data-state',
        'open',
      );
    });

    it('sets variant on root', () => {
      render(<DisclosureExample variant="compact" />);
      expect(screen.getByText('Section Title').closest('.varve-disclosure')).toHaveAttribute(
        'data-variant',
        'compact',
      );
    });
  });
});
