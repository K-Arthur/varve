import { describe, expect, it } from 'vitest';
import {
  createLayoutPresentationController,
  type LayoutCapabilities,
  resolveLayoutPresentation,
} from './layoutPresentation';

const touchLaptop: LayoutCapabilities = {
  viewportWidth: 1200,
  anyPointerCoarse: true,
  anyPointerFine: true,
  maxTouchPoints: 10,
};

describe('responsive layout presentation', () => {
  it('uses compact width first, tablet for touch through 1280px, and desktop otherwise', () => {
    expect(resolveLayoutPresentation('auto', { ...touchLaptop, viewportWidth: 899 })).toBe(
      'tablet',
    );
    expect(
      resolveLayoutPresentation('auto', {
        ...touchLaptop,
        viewportWidth: 899,
        anyPointerCoarse: false,
        maxTouchPoints: 0,
      }),
    ).toBe('compact');
    expect(resolveLayoutPresentation('auto', touchLaptop)).toBe('tablet');
    expect(
      resolveLayoutPresentation('auto', {
        ...touchLaptop,
        viewportWidth: 1440,
        anyPointerFine: false,
      }),
    ).toBe('tablet');
    expect(
      resolveLayoutPresentation('auto', {
        ...touchLaptop,
        viewportWidth: 1440,
        maxTouchPoints: 0,
        anyPointerCoarse: false,
      }),
    ).toBe('desktop');
  });

  it('keeps manual overrides authoritative while preserving compact reflow at narrow widths', () => {
    expect(resolveLayoutPresentation('tablet', { ...touchLaptop, viewportWidth: 1600 })).toBe(
      'tablet',
    );
    expect(resolveLayoutPresentation('desktop', { ...touchLaptop, viewportWidth: 600 })).toBe(
      'desktop',
    );
    expect(
      resolveLayoutPresentation('auto', {
        ...touchLaptop,
        viewportWidth: 600,
        anyPointerCoarse: false,
        maxTouchPoints: 0,
      }),
    ).toBe('compact');
  });

  it('defers viewport-driven presentation changes during pointer contacts and IME composition', () => {
    let capabilities = touchLaptop;
    const root = { dataset: {} as DOMStringMap };
    const controller = createLayoutPresentationController(root, () => capabilities, 'auto');
    expect(root.dataset.layoutMode).toBe('tablet');

    controller.contactStart(3);
    capabilities = {
      ...touchLaptop,
      viewportWidth: 800,
      anyPointerCoarse: false,
      maxTouchPoints: 0,
    };
    controller.updateCapabilities();
    expect(root.dataset.layoutMode).toBe('tablet');
    controller.contactEnd(3);
    expect(root.dataset.layoutMode).toBe('compact');

    controller.compositionStart();
    capabilities = touchLaptop;
    controller.updateCapabilities();
    expect(root.dataset.layoutMode).toBe('compact');
    controller.compositionEnd();
    expect(root.dataset.layoutMode).toBe('tablet');
  });

  it('uses an observed pen contact when media capabilities do not reveal touch input', () => {
    const root = { dataset: {} as DOMStringMap };
    const controller = createLayoutPresentationController(
      root,
      () => ({
        viewportWidth: 1440,
        anyPointerCoarse: false,
        anyPointerFine: true,
        maxTouchPoints: 0,
      }),
      'auto',
    );
    expect(root.dataset.layoutMode).toBe('desktop');
    controller.contactStart(4, 'pen');
    controller.contactEnd(4);
    expect(root.dataset.layoutMode).toBe('tablet');
  });
});
