import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../Accordion';

afterEach(cleanup);

function AccordionExample({
  mode = 'multiple',
  collapsible,
  defaultValue,
  value,
  onValueChange,
}: {
  mode?: 'multiple' | 'single';
  collapsible?: boolean;
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: (value: string | string[]) => void;
} = {}) {
  return (
    <Accordion
      mode={mode}
      collapsible={collapsible}
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      label="Test accordion"
    >
      <AccordionItem value="item-1">
        <AccordionTrigger>First Section</AccordionTrigger>
        <AccordionContent>Content 1</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>Second Section</AccordionTrigger>
        <AccordionContent>Content 2</AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>Third Section</AccordionTrigger>
        <AccordionContent>Content 3</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

describe('Accordion', () => {
  describe('multiple mode (default)', () => {
    it('renders all items collapsed by default', () => {
      render(<AccordionExample />);
      expect(screen.getByRole('button', { name: 'First Section' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.getByRole('button', { name: 'Second Section' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
    });

    it('opens items independently', async () => {
      const user = userEvent.setup();
      render(<AccordionExample />);

      await user.click(screen.getByRole('button', { name: 'First Section' }));
      expect(screen.getByText('Content 1')).toBeInTheDocument();
      expect(screen.queryByText('Content 2')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Second Section' }));
      expect(screen.getByText('Content 1')).toBeInTheDocument();
      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });

    it('supports defaultValue for multiple items', () => {
      render(<AccordionExample defaultValue={['item-1', 'item-3']} />);
      expect(screen.getByText('Content 1')).toBeInTheDocument();
      expect(screen.queryByText('Content 2')).not.toBeInTheDocument();
      expect(screen.getByText('Content 3')).toBeInTheDocument();
    });
  });

  describe('single mode', () => {
    it('opens only one item at a time', async () => {
      const user = userEvent.setup();
      render(<AccordionExample mode="single" defaultValue="item-1" />);

      expect(screen.getByText('Content 1')).toBeInTheDocument();
      expect(screen.queryByText('Content 2')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Second Section' }));
      expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });

    it('does not collapse in non-collapsible mode', async () => {
      const user = userEvent.setup();
      render(<AccordionExample mode="single" defaultValue="item-1" />);

      await user.click(screen.getByRole('button', { name: 'First Section' }));
      // Item stays open because collapsible is false
      expect(screen.getByText('Content 1')).toBeInTheDocument();
    });

    it('collapses when collapsible is true', async () => {
      const user = userEvent.setup();
      render(<AccordionExample mode="single" collapsible defaultValue="item-1" />);

      await user.click(screen.getByRole('button', { name: 'First Section' }));
      expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
    });
  });

  describe('controlled', () => {
    it('renders according to value prop', () => {
      render(<AccordionExample value="item-2" />);
      expect(screen.queryByText('Content 1')).not.toBeInTheDocument();
      expect(screen.getByText('Content 2')).toBeInTheDocument();
    });

    it('calls onValueChange on toggle', async () => {
      const onValueChange = vi.fn();
      const user = userEvent.setup();
      render(<AccordionExample onValueChange={onValueChange} />);

      await user.click(screen.getByRole('button', { name: 'First Section' }));
      expect(onValueChange).toHaveBeenCalledWith(['item-1']);
    });

    it('single mode calls onValueChange with string', async () => {
      const onValueChange = vi.fn();
      const user = userEvent.setup();
      render(<AccordionExample mode="single" onValueChange={onValueChange} />);

      await user.click(screen.getByRole('button', { name: 'First Section' }));
      expect(onValueChange).toHaveBeenCalledWith('item-1');
    });
  });

  describe('disabled items', () => {
    it('prevents toggling a disabled item', async () => {
      const user = userEvent.setup();
      render(
        <Accordion>
          <AccordionItem value="item-1" disabled>
            <AccordionTrigger>Disabled Section</AccordionTrigger>
            <AccordionContent>Content</AccordionContent>
          </AccordionItem>
        </Accordion>,
      );

      const trigger = screen.getByRole('button', { name: 'Disabled Section' });
      expect(trigger).toBeDisabled();
      await user.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('accessibility', () => {
    it('wires aria-controls to content for each item', () => {
      render(<AccordionExample defaultValue="item-1" />);
      const trigger = screen.getByRole('button', { name: 'First Section' });
      const contentId = trigger.getAttribute('aria-controls');
      expect(contentId).toBeTruthy();
      const content = document.getElementById(contentId!);
      expect(content).toBeTruthy();
      expect(content).toHaveTextContent('Content 1');
    });

    it('sets aria-expanded correctly', () => {
      render(<AccordionExample defaultValue="item-1" />);
      expect(screen.getByRole('button', { name: 'First Section' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByRole('button', { name: 'Second Section' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('reports mode on root', () => {
      render(<AccordionExample mode="single" />);
      const accordion = document.querySelector('.varve-accordion');
      expect(accordion).toHaveAttribute('data-mode', 'single');
    });
  });

  describe('data attributes', () => {
    it('sets data-state on items', () => {
      render(<AccordionExample defaultValue="item-1" />);
      const items = document.querySelectorAll('.varve-accordion__item');
      expect(items[0]).toHaveAttribute('data-state', 'open');
      expect(items[1]).toHaveAttribute('data-state', 'closed');
    });

    it('sets data-disabled on disabled items', () => {
      render(
        <Accordion>
          <AccordionItem value="a" disabled>
            <AccordionTrigger>A</AccordionTrigger>
            <AccordionContent>...</AccordionContent>
          </AccordionItem>
        </Accordion>,
      );
      expect(document.querySelector('.varve-accordion__item')).toHaveAttribute(
        'data-disabled',
        'true',
      );
    });
  });
});
