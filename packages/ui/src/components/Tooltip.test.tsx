/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';

afterEach(cleanup);

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
}));

const pointerEnter = (el: Element, init?: PointerEventInit) => {
  if (typeof window.PointerEvent !== 'undefined') {
    return fireEvent.pointerEnter(el, init);
  }
  return fireEvent.mouseEnter(el);
};

const pointerLeave = (el: Element, init?: PointerEventInit) => {
  if (typeof window.PointerEvent !== 'undefined') {
    return fireEvent.pointerLeave(el, init);
  }
  return fireEvent.mouseLeave(el);
};

const pointerDown = (el: Element, init?: PointerEventInit) => {
  if (typeof window.PointerEvent !== 'undefined') {
    return fireEvent.pointerDown(el, init);
  }
  return fireEvent.mouseDown(el);
};

describe('Tooltip', () => {
  it('does not render tooltip initially', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders tooltip on hover after delay', async () => {
    render(
      <Tooltip label="Helpful tip" delay={200}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    pointerEnter(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 500 });
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Helpful tip');
  });

  it('shows immediately on focus', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
  });

  it('hides on Escape', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('places aria-describedby on the trigger, not a wrapper', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(button);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveAttribute('id');
    expect(button).toHaveAttribute('aria-describedby', tooltip.id);
    expect(button.parentElement).not.toHaveAttribute('aria-describedby');
  });

  it('does not render when label is empty', () => {
    render(
      <Tooltip label="">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders shortcut badge when shortcut prop is provided', () => {
    render(
      <Tooltip label="Select" shortcut="V">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    const shortcut = tooltip.querySelector('.varve-tip__shortcut');
    expect(shortcut).toBeInTheDocument();
    expect(shortcut).toHaveTextContent('V');
  });

  it('hides on pointer leave', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    pointerLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hides on blur', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cleans up timer on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const { unmount } = render(
      <Tooltip label="Helpful tip" delay={300}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    pointerEnter(trigger);
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('does not show tooltip after trigger unmounts', async () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Tooltip label="Helpful tip" delay={100}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    pointerEnter(trigger);
    unmount();
    vi.advanceTimersByTime(200);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does not open on hover while a pointer button is held', () => {
    render(
      <Tooltip label="Helpful tip" delay={0}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    pointerEnter(trigger, { buttons: 1 });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes and suppresses open on pointer down', () => {
    render(
      <Tooltip label="Helpful tip">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    pointerDown(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('can be controlled', () => {
    const { rerender } = render(
      <Tooltip label="Controlled" open={false} onOpenChange={() => {}}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    rerender(
      <Tooltip label="Controlled" open onOpenChange={() => {}}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('TooltipProvider warm-up timing', () => {
  it('uses warm delay for subsequent tooltips within window', async () => {
    vi.useFakeTimers();
    render(
      <TooltipProvider>
        <Tooltip label="First" delay={300}>
          <button type="button">One</button>
        </Tooltip>
        <Tooltip label="Second" delay={300}>
          <button type="button">Two</button>
        </Tooltip>
      </TooltipProvider>,
    );

    const buttonOne = screen.getByRole('button', { name: 'One' });
    const buttonTwo = screen.getByRole('button', { name: 'Two' });

    act(() => {
      fireEvent.focus(buttonOne);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('First');

    act(() => {
      fireEvent.keyDown(buttonOne, { key: 'Escape' });
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      pointerEnter(buttonTwo);
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second');

    vi.useRealTimers();
  });
});

describe('Tooltip truncation-only mode', () => {
  it('does not show tooltip when content is not truncated', () => {
    render(
      <Tooltip label="Full text" truncationOnly>
        <button type="button">Short</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Short' });
    fireEvent.focus(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('observes the trigger with ResizeObserver in truncation-only mode', () => {
    const roSpy = vi.spyOn(global, 'ResizeObserver').mockImplementation(
      // Vitest 4: constructor mocks need a constructible implementation.
      () =>
        ({
          observe: vi.fn(),
          disconnect: vi.fn(),
          unobserve: vi.fn(),
        }) as unknown as ResizeObserver,
    );
    const { container } = render(
      <Tooltip label="Full text" truncationOnly>
        <span
          style={{
            display: 'inline-block',
            width: '20px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Very long truncated text
        </span>
      </Tooltip>,
    );
    const trigger = container.querySelector('span') as HTMLElement;
    fireEvent.focus(trigger);
    expect(roSpy).toHaveBeenCalled();
    roSpy.mockRestore();
  });
});

describe('Tooltip close delay', () => {
  it('waits for closeDelay before hiding', () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Helpful tip" closeDelay={100}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    pointerLeave(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('Tooltip disabled wrapper', () => {
  it('wraps a disabled trigger and shows disabledReason as tooltip content', () => {
    render(
      <Tooltip label="Default" disabledReason="Select 2+ shapes for boolean">
        <button type="button" disabled>
          Boolean
        </button>
      </Tooltip>,
    );
    const wrapper = screen.getByRole('button', { name: 'Boolean' }).parentElement;
    expect(wrapper).toHaveAttribute('tabIndex', '0');
    fireEvent.focus(wrapper!);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Select 2+ shapes for boolean');
  });
});

describe('Tooltip aria-describedby merging', () => {
  it('merges with an existing aria-describedby on the trigger', () => {
    render(
      <Tooltip label="Extra description">
        <button type="button" aria-describedby="existing-id">
          Trigger
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    const tooltip = screen.getByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', expect.stringContaining('existing-id'));
    expect(trigger).toHaveAttribute('aria-describedby', expect.stringContaining(tooltip.id));
  });
});

describe('Tooltip controlled mode', () => {
  it('calls onOpenChange when opened via focus', () => {
    const onOpenChange = vi.fn();
    render(
      <Tooltip label="Controlled" open={false} onOpenChange={onOpenChange}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

describe('Tooltip touch suppression', () => {
  it('does not open on touch pointer enter', () => {
    render(
      <Tooltip label="Helpful tip" delay={0}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    pointerEnter(trigger, { pointerType: 'touch' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
