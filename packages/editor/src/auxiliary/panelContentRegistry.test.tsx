// @vitest-environment jsdom

import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AUXILIARY_PANEL_RENDERERS, renderAuxiliaryPanel } from './panelContentRegistry';

describe('auxiliary panel content registry', () => {
  it('lists only panels with an auxiliary renderer', () => {
    expect(Object.keys(AUXILIARY_PANEL_RENDERERS).sort()).toEqual([
      'codegen',
      'inspector',
      'layers',
      'library',
      'logo',
      'pagenav',
    ]);
    expect(renderAuxiliaryPanel('timeline')).toBeNull();
    expect(renderAuxiliaryPanel('history')).toBeNull();
  });

  it('returns hook-driven adapters as React components instead of invoking them directly', () => {
    // CodePanelAdapter calls useEditor. If the registry invoked it as an
    // ordinary function, this call would violate the Rules of Hooks before
    // React gets a chance to render it.
    expect(() => renderAuxiliaryPanel('codegen')).not.toThrow();

    const content = renderAuxiliaryPanel('codegen');
    expect(isValidElement(content)).toBe(true);
    if (!isValidElement(content)) throw new Error('expected a code panel React element');
    expect(content.type).toBe(AUXILIARY_PANEL_RENDERERS.codegen);
  });
});
