// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrototypePresenter } from './PrototypePresenter';

afterEach(cleanup);

const mockScreens = [
  { id: 's1', name: 'Home' },
  { id: 's2', name: 'Details' },
  { id: 's3', name: 'Settings' },
];

describe('PrototypePresenter', () => {
  it('renders when isOpen is true', () => {
    const { container } = render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    expect(container.querySelector('.prototype-presenter')).toBeTruthy();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <PrototypePresenter
        isOpen={false}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    expect(container.querySelector('.prototype-presenter')).toBeNull();
  });

  it('shows exit button', () => {
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /exit|close/i })).toBeTruthy();
  });

  it('calls onClose when exit button clicked', () => {
    const onClose = vi.fn();
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={onClose}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /exit|close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no screens', () => {
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={[]}
        currentScreenId=""
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    expect(screen.getByText(/no screens/i)).toBeTruthy();
  });

  it('shows screen name in toolbar', () => {
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s2"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    expect(screen.getByText('Details')).toBeTruthy();
    expect(screen.getByText(/2.*3/)).toBeTruthy();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={onClose}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates forward on ArrowRight', () => {
    const onNavigate = vi.fn();
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={onNavigate}
        onEvent={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenCalledWith('s2');
  });

  it('navigates backward on ArrowLeft', () => {
    const onNavigate = vi.fn();
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s2"
        onNavigate={onNavigate}
        onEvent={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNavigate).toHaveBeenCalledWith('s1');
  });

  it('does not navigate past first screen on ArrowLeft', () => {
    const onNavigate = vi.fn();
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={onNavigate}
        onEvent={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate past last screen on ArrowRight', () => {
    const onNavigate = vi.fn();
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s3"
        onNavigate={onNavigate}
        onEvent={() => {}}
      />,
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders device frame when device config is provided', () => {
    const { container } = render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={() => {}}
        deviceConfig={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844, dpr: 3 }}
      />,
    );
    expect(container.querySelector('.prototype-presenter__device-frame')).toBeTruthy();
    expect(container.querySelector('.device-frame--phone')).toBeTruthy();
  });

  it('forwards click events to onEvent handler', () => {
    const onEvent = vi.fn();
    const { container } = render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s1"
        onNavigate={() => {}}
        onEvent={onEvent}
      />,
    );
    const content = container.querySelector('.prototype-presenter__content');
    if (content) fireEvent.click(content);
    expect(onEvent).toHaveBeenCalled();
  });

  it('shows navigation buttons', () => {
    render(
      <PrototypePresenter
        isOpen={true}
        onClose={() => {}}
        screens={mockScreens}
        currentScreenId="s2"
        onNavigate={() => {}}
        onEvent={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });
});
