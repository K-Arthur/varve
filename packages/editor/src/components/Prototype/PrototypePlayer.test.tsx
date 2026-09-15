// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrototypePlayer } from './PrototypePlayer';

afterEach(cleanup);

const mockScreens = [
  { id: 's1', name: 'Home' },
  { id: 's2', name: 'Details' },
  { id: 's3', name: 'Settings' },
];

describe('PrototypePlayer', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <PrototypePlayer
        currentScreenId="s1"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(container.querySelector('.prototype-player')).toBeTruthy();
  });

  it('forwards click events to onEvent handler', () => {
    const onEvent = vi.fn();
    const { container } = render(
      <PrototypePlayer
        currentScreenId="s1"
        screens={mockScreens}
        onEvent={onEvent}
        onNavigate={() => {}}
      />,
    );
    const area = container.querySelector('.prototype-player__interaction-area');
    if (area) fireEvent.click(area);
    expect(onEvent).toHaveBeenCalled();
  });

  it('renders device frame when device config is provided', () => {
    const { container } = render(
      <PrototypePlayer
        currentScreenId="s1"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
        deviceConfig={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844, dpr: 3 }}
      />,
    );
    expect(container.querySelector('.device-frame')).toBeTruthy();
  });

  it('shows current screen name', () => {
    render(
      <PrototypePlayer
        currentScreenId="s2"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('shows interaction hints overlay when showHints is true', () => {
    const { container } = render(
      <PrototypePlayer
        currentScreenId="s1"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
        showHints={true}
      />,
    );
    expect(container.querySelector('.prototype-player__hints-overlay')).toBeTruthy();
  });

  it('hides interaction hints overlay when showHints is false', () => {
    const { container } = render(
      <PrototypePlayer
        currentScreenId="s1"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
        showHints={false}
      />,
    );
    expect(container.querySelector('.prototype-player__hints-overlay')).toBeNull();
  });

  it('shows empty state when no screens', () => {
    render(
      <PrototypePlayer currentScreenId="" screens={[]} onEvent={() => {}} onNavigate={() => {}} />,
    );
    expect(screen.getByText(/no screens/i)).toBeTruthy();
  });

  it('applies reduced motion class when reducedMotion is true', () => {
    const { container } = render(
      <PrototypePlayer
        currentScreenId="s1"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
        reducedMotion={true}
      />,
    );
    expect(container.querySelector('.prototype-player--reduced-motion')).toBeTruthy();
  });

  it('shows "Unknown" when currentScreenId is not in screens', () => {
    render(
      <PrototypePlayer
        currentScreenId="nonexistent"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('shows screen counter when multiple screens', () => {
    render(
      <PrototypePlayer
        currentScreenId="s2"
        screens={mockScreens}
        onEvent={() => {}}
        onNavigate={() => {}}
      />,
    );
    expect(screen.getByText(/2.*3/)).toBeTruthy();
  });
});
