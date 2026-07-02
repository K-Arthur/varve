// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DeviceFrame } from './DeviceFrame';

afterEach(cleanup);

describe('DeviceFrame', () => {
  it('renders phone frame with children', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844 }}>
        <div data-testid="child">Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame')).toBeTruthy();
    expect(container.querySelector('.device-frame--phone')).toBeTruthy();
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('shows notch when showNotch is true', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844, showNotch: true }}>
        <div>Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame__notch')).toBeTruthy();
  });

  it('hides notch when showNotch is false', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844, showNotch: false }}>
        <div>Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame__notch')).toBeNull();
  });

  it('shows home indicator when showHomeIndicator is true', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844, showHomeIndicator: true }}>
        <div>Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame__home-indicator')).toBeTruthy();
  });

  it('hides home indicator when showHomeIndicator is false', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'iPhone 15', width: 390, height: 844, showHomeIndicator: false }}>
        <div>Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame__home-indicator')).toBeNull();
  });

  it('renders tablet frame', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'tablet', name: 'iPad Pro', width: 1024, height: 1366 }}>
        <div>Tablet Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame')).toBeTruthy();
    expect(container.querySelector('.device-frame--tablet')).toBeTruthy();
  });

  it('renders desktop frame', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'desktop', name: 'MacBook Pro', width: 1440, height: 900 }}>
        <div>Desktop Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame')).toBeTruthy();
    expect(container.querySelector('.device-frame--desktop')).toBeTruthy();
    expect(container.querySelector('.device-frame__stand')).toBeTruthy();
  });

  it('renders custom frame with label', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'custom', name: 'My Custom Frame', width: 800, height: 600 }}>
        <div>Custom Content</div>
      </DeviceFrame>,
    );
    expect(container.querySelector('.device-frame')).toBeTruthy();
    expect(container.querySelector('.device-frame__label')).toBeTruthy();
    expect(screen.getByText('My Custom Frame')).toBeTruthy();
  });

  it('applies custom scale', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'Pixel', width: 412, height: 915 }} scale={0.5}>
        <div>Scaled Content</div>
      </DeviceFrame>,
    );
    const frame = container.querySelector('.device-frame') as HTMLElement;
    expect(frame).toBeTruthy();
    // Scale should be applied as CSS transform
    expect(frame.style.transform).toContain('scale');
  });

  it('applies custom frame color', () => {
    const { container } = render(
      <DeviceFrame device={{ type: 'phone', name: 'Pixel', width: 412, height: 915 }} frameColor="#ff0000">
        <div>Color</div>
      </DeviceFrame>,
    );
    const frame = container.querySelector('.device-frame') as HTMLElement;
    expect(frame.style.borderColor).toBe('rgb(255, 0, 0)');
  });
});
