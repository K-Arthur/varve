import { describe, expect, it } from 'vitest';
import {
  createLayoutPresentationController,
  type LayoutCapabilities,
  resolveLayoutPresentation,
} from './layoutPresentation';

/** A touchscreen laptop: coarse and fine pointers are both present. */
const touchLaptop: LayoutCapabilities = {
  viewportWidth: 1200,
  anyPointerCoarse: true,
  anyPointerFine: true,
  maxTouchPoints: 10,
};

/** A tablet: touch is the only input the browser exposes. */
const tablet: LayoutCapabilities = {
  viewportWidth: 1200,
  anyPointerCoarse: true,
  anyPointerFine: false,
  maxTouchPoints: 10,
};

const noTouch: LayoutCapabilities = {
  viewportWidth: 1200,
  anyPointerCoarse: false,
  anyPointerFine: true,
  maxTouchPoints: 0,
};

describe('responsive layout presentation', () => {
  it('answers tablet only when touch is the only input', () => {
    expect(resolveLayoutPresentation('auto', tablet)).toBe('tablet');
    expect(resolveLayoutPresentation('auto', { ...tablet, viewportWidth: 1440 })).toBe('tablet');
    expect(resolveLayoutPresentation('auto', { ...tablet, viewportWidth: 899 })).toBe('tablet');

    // A touchscreen laptop or pen display is a computer. Using its touchscreen
    // or pen must not move the user into the tablet layout.
    expect(resolveLayoutPresentation('auto', touchLaptop)).toBe('desktop');
    expect(resolveLayoutPresentation('auto', { ...touchLaptop, viewportWidth: 899 })).toBe(
      'compact',
    );

    expect(resolveLayoutPresentation('auto', noTouch)).toBe('desktop');
    expect(resolveLayoutPresentation('auto', { ...noTouch, viewportWidth: 899 })).toBe('compact');
  });

  it('keeps manual overrides authoritative while preserving compact reflow at narrow widths', () => {
    expect(resolveLayoutPresentation('tablet', { ...touchLaptop, viewportWidth: 1600 })).toBe(
      'tablet',
    );
    expect(resolveLayoutPresentation('desktop', { ...tablet, viewportWidth: 600 })).toBe('desktop');
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
    let capabilities = tablet;
    const root = { dataset: {} as DOMStringMap };
    const controller = createLayoutPresentationController(root, () => capabilities, 'auto');
    expect(root.dataset.layoutMode).toBe('tablet');

    controller.contactStart(3);
    capabilities = {
      viewportWidth: 800,
      anyPointerCoarse: false,
      anyPointerFine: false,
      maxTouchPoints: 0,
    };
    controller.updateCapabilities();
    expect(root.dataset.layoutMode).toBe('tablet');
    controller.contactEnd(3);
    expect(root.dataset.layoutMode).toBe('compact');

    controller.compositionStart();
    capabilities = tablet;
    controller.updateCapabilities();
    expect(root.dataset.layoutMode).toBe('compact');
    controller.compositionEnd();
    expect(root.dataset.layoutMode).toBe('tablet');
  });

  it('lets an observed touch or pen reveal touch capability without hijacking a desktop session', () => {
    // A pen display on a desktop reports a fine pointer and may hide touch from
    // the media queries entirely; the contact makes the device touch-capable but
    // must not select the tablet layout, because a fine pointer is in use.
    const root = { dataset: {} as DOMStringMap };
    const controller = createLayoutPresentationController(
      root,
      () => ({ ...noTouch, viewportWidth: 1440 }),
      'auto',
    );
    expect(root.dataset.layoutMode).toBe('desktop');
    controller.contactStart(4, 'pen');
    controller.contactEnd(4);
    expect(root.dataset.layoutMode).toBe('desktop');

    // On a device the browser reports as touch-only through neither media query,
    // the observed contact is what identifies it as a tablet.
    const hiddenTouchRoot = { dataset: {} as DOMStringMap };
    const hiddenTouch = createLayoutPresentationController(
      hiddenTouchRoot,
      () => ({
        viewportWidth: 1440,
        anyPointerCoarse: false,
        anyPointerFine: false,
        maxTouchPoints: 0,
      }),
      'auto',
    );
    expect(hiddenTouchRoot.dataset.layoutMode).toBe('desktop');
    hiddenTouch.contactStart(5, 'touch');
    hiddenTouch.contactEnd(5);
    expect(hiddenTouchRoot.dataset.layoutMode).toBe('tablet');
  });

  it('keeps a coarse-only tablet in tablet mode when a keyboard or mouse is attached', () => {
    const root = { dataset: {} as DOMStringMap };
    createLayoutPresentationController(root, () => ({ ...tablet, viewportWidth: 1440 }), 'auto');
    expect(root.dataset.layoutMode).toBe('tablet');
  });

  it('defers mirrored control placement until contacts and IME composition end', () => {
    const root = { dataset: {} as DOMStringMap };
    const controller = createLayoutPresentationController(root, () => touchLaptop, 'tablet');
    expect(root.dataset.tabletControlsMirrored).toBe('false');

    controller.contactStart(9, 'pen');
    controller.setControlsMirrored(true);
    expect(root.dataset.tabletControlsMirrored).toBe('false');
    controller.contactEnd(9);
    expect(root.dataset.tabletControlsMirrored).toBe('true');

    controller.compositionStart();
    controller.setControlsMirrored(false);
    expect(root.dataset.tabletControlsMirrored).toBe('true');
    controller.compositionEnd();
    expect(root.dataset.tabletControlsMirrored).toBe('false');
  });
});
