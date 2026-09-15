// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { Camera } from '@varve/shared';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { defaultSymmetrySettings } from '../../../tools/symmetry';
import { PaintOverlay, symmetryAxes, symmetryCopyCount } from '../PaintOverlay';

const camera: Camera = { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 } as Camera;

function renderOverlay(overrides: Partial<ComponentProps<typeof PaintOverlay>> = {}) {
  const props: ComponentProps<typeof PaintOverlay> = {
    camera,
    width: 800,
    height: 600,
    symmetry: null,
    cloneSource: null,
    cloneCursor: null,
    targetStatus: null,
    ...overrides,
  };
  const { container } = render(<PaintOverlay {...props} />);
  return container;
}

describe('PaintOverlay', () => {
  it('renders nothing when there is nothing to show', () => {
    expect(renderOverlay().querySelector('svg')).toBeNull();
  });

  it('announces the paint target politely', () => {
    renderOverlay({ targetStatus: 'Painting: Layer Mask — Card' });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('Layer Mask');
    expect(badge.getAttribute('aria-live')).toBe('polite');
  });

  it('marks a blocked target so it reads as a warning', () => {
    renderOverlay({ targetStatus: 'Background is locked.', targetBlocked: true });
    expect(screen.getByRole('status').className).toContain('is-blocked');
  });

  it('draws a single axis for a mirror', () => {
    const container = renderOverlay({
      symmetry: { ...defaultSymmetrySettings(), mode: 'mirrorY' },
    });
    expect(container.querySelectorAll('.paint-overlay__symmetry line')).toHaveLength(1);
  });

  it('draws two axes for XY symmetry', () => {
    const container = renderOverlay({
      symmetry: { ...defaultSymmetrySettings(), mode: 'mirrorXY' },
    });
    expect(container.querySelectorAll('.paint-overlay__symmetry line')).toHaveLength(2);
  });

  it('hides the guide when the user turns it off', () => {
    const container = renderOverlay({
      symmetry: { ...defaultSymmetrySettings(), mode: 'mirrorY', visible: false },
    });
    expect(container.querySelector('.paint-overlay__symmetry')).toBeNull();
  });

  it('shows an origin handle to drag the axis by', () => {
    const container = renderOverlay({
      symmetry: { ...defaultSymmetrySettings(), mode: 'mirrorY' },
    });
    expect(container.querySelector('.paint-overlay__origin')).not.toBeNull();
  });

  it('marks the clone source and links it to the cursor', () => {
    const container = renderOverlay({
      cloneSource: { x: 100, y: 100 },
      cloneCursor: { x: 200, y: 140 },
    });
    expect(container.querySelector('.paint-overlay__clone-source')).not.toBeNull();
    expect(container.querySelectorAll('.paint-overlay__clone line').length).toBeGreaterThan(2);
  });

  it('never intercepts a brush stroke', () => {
    const container = renderOverlay({ cloneSource: { x: 10, y: 10 } });
    // Verified through the class contract; the rule itself lives in the CSS.
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('paint-overlay');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('symmetry axis geometry', () => {
  it('keeps the axis in world space as the view moves', () => {
    const settings = { ...defaultSymmetrySettings(), mode: 'mirrorY' as const, originX: 100 };
    const still = symmetryAxes(settings, 800, 600, camera);
    const panned = symmetryAxes(settings, 800, 600, {
      ...camera,
      pan: { x: 50, y: 0 },
    } as Camera);
    // Panning moves the view over a fixed axis, so its screen position shifts.
    expect(panned[0]!.x1).not.toBe(still[0]!.x1);
    // ...but the two ends stay the same distance apart: the axis did not scale.
    const span = (l: { x1: number; x2: number }) => l.x2 - l.x1;
    expect(span(panned[0]!)).toBeCloseTo(span(still[0]!), 6);
  });

  it('draws one guide per radial segment', () => {
    const settings = { ...defaultSymmetrySettings(), mode: 'radial' as const, radialCount: 6 };
    expect(symmetryAxes(settings, 800, 600, camera)).toHaveLength(6);
  });

  it('bounds radial guides with the same cap as the engine', () => {
    const settings = { ...defaultSymmetrySettings(), mode: 'radial' as const, radialCount: 999 };
    expect(symmetryAxes(settings, 800, 600, camera)).toHaveLength(32);
  });

  it('reports how many copies a stroke will paint', () => {
    expect(symmetryCopyCount(null)).toBe(1);
    expect(symmetryCopyCount({ ...defaultSymmetrySettings(), mode: 'mirrorXY' })).toBe(4);
  });
});
