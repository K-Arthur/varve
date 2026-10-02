/** @vitest-environment jsdom */

import * as floatingUI from '@floating-ui/dom';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingPortal } from './FloatingPortal';
import { pointAnchor, viewportPoint } from './overlayGeometry';

vi.mock('@floating-ui/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/dom')>();
  return { ...actual, computePosition: vi.fn(actual.computePosition) };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface AnimationFixtureOptions {
  width?: number;
  height?: number;
  layoutWidth?: number;
  layoutHeight?: number;
  scale?: number;
  scrollOwner?: 'portal' | 'content';
  rejectPosition?: boolean;
}

function mountMeasuredPortal({
  width = 240,
  height = 680,
  layoutWidth = width,
  layoutHeight = height,
  scale = 0.97,
  scrollOwner = 'portal',
  rejectPosition = false,
}: AnimationFixtureOptions = {}) {
  const position = vi.mocked(floatingUI.computePosition);
  position.mockImplementation(async (_reference, floating) => {
    Object.defineProperties(floating, {
      offsetWidth: { configurable: true, value: layoutWidth },
      offsetHeight: { configurable: true, value: layoutHeight },
    });
    floating.getBoundingClientRect = () => new DOMRect(0, 0, width * scale, height * scale);
    if (rejectPosition) throw new Error('fixture: placement provider unavailable');
    floating.style.overflowY = scrollOwner === 'content' ? 'visible' : 'auto';
    if (scrollOwner === 'content') {
      floating.style.setProperty('--varve-floating-max-height', '600px');
    }
    return { x: 1200, y: 650, placement: 'bottom-start', strategy: 'fixed', middlewareData: {} };
  });
  render(
    <FloatingPortal
      anchor={pointAnchor(viewportPoint(1200, 650), document)}
      open
      scrollOwner={scrollOwner}
      className="animated-float"
    >
      <div role="menu">Menu contents</div>
    </FloatingPortal>,
  );
  return document.querySelector('.animated-float') as HTMLElement;
}

async function positioned(panel: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(panel.style.visibility).toBe('visible'));
}

describe('FloatingPortal entry-animation collision bounds', () => {
  it('contains the final unscaled menu box in both axes', async () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    const panel = mountMeasuredPortal();
    await positioned(panel);
    expect(Number.parseFloat(panel.style.top) + 680).toBeLessThanOrEqual(712);
    expect(Number.parseFloat(panel.style.left) + 240).toBeLessThanOrEqual(1272);
    expect(panel.style.overflowY).toBe('auto');
  });

  it('retains the visual viewport cap and content-owned scrolling', async () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    vi.stubGlobal('visualViewport', { width: 1280, height: 420, scale: 1 });
    const panel = mountMeasuredPortal({ scrollOwner: 'content' });
    await positioned(panel);
    expect(Number.parseFloat(panel.style.left) + 240).toBeLessThanOrEqual(1272);
    expect(panel.style.top).toBe('8px');
    expect(panel.style.maxHeight).toBe('');
    expect(panel.style.getPropertyValue('--varve-floating-max-height')).toBe('404px');
    expect(panel.style.overflowY).toBe('visible');
  });

  it('falls back to measured rect dimensions when layout sizes are zero', async () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    const panel = mountMeasuredPortal({
      width: 300,
      height: 180,
      layoutWidth: 0,
      layoutHeight: 0,
      scale: 1,
    });
    await positioned(panel);
    expect(panel.style.left).toBe('972px');
    expect(panel.style.top).toBe('532px');
  });

  it('also contains the final layout box when provider positioning rejects', async () => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    const panel = mountMeasuredPortal({ rejectPosition: true });
    await positioned(panel);
    expect(Number.parseFloat(panel.style.top) + 680).toBeLessThanOrEqual(712);
    expect(Number.parseFloat(panel.style.left) + 240).toBeLessThanOrEqual(1272);
  });
});
