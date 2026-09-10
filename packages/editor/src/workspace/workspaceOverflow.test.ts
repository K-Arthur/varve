import { describe, expect, it } from 'vitest';
import { computeWorkspaceLayout, WORKSPACE_ICON_ONLY_THRESHOLD } from './workspaceOverflow';
import { WORKSPACE_OVERFLOW_ORDER, WORKSPACE_OVERFLOW_PRIORITY } from './workspaceTypes';

const modes = WORKSPACE_OVERFLOW_ORDER;
// Realistic labeled tab widths (~80-100px each).
const tabWidths: Record<(typeof modes)[number], number> = {
  design: 96,
  drawing: 88,
  image: 92,
  print: 82,
  motion: 90,
  codegen: 100,
  logo: 80,
  email: 92,
};

describe('computeWorkspaceLayout', () => {
  it('shows every mode when the strip is wide enough', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 1000,
      tabWidths,
      overflowMenuWidth: 40,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.visible).toEqual(modes);
    expect(result.overflow).toEqual([]);
    expect(result.iconOnly).toBe(false);
  });

  it('overflows the lowest-priority modes first in icon-only mode', () => {
    // Below the icon-only threshold, tabs are 32px; at 250px only six fit.
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 250,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.iconOnly).toBe(true);
    expect(result.visible).toEqual(['design', 'drawing', 'image', 'print', 'motion', 'codegen']);
    expect(result.overflow).toEqual(['email', 'logo']);
  });

  it('keeps the active mode visible even when it would overflow', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'logo',
      availableWidth: 250,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.visible).toContain('logo');
    expect(result.visible[0]).toBe('design');
    // Logo displaced 'codegen' (highest overflow priority among visible).
    expect(result.visible).toEqual(['design', 'drawing', 'image', 'print', 'motion', 'logo']);
    expect(result.overflow).toEqual(['codegen', 'email']);
  });

  it('keeps the active mode visible even when it would overflow (labeled strip)', () => {
    // Wide-enough strip for labels with inflated widths to force overflow:
    // display order design/drawing/image/print/motion/... with print's tab
    // sacrificed for the active logo mode.
    const wide: Record<(typeof modes)[number], number> = {
      design: 220,
      drawing: 200,
      image: 210,
      print: 190,
      motion: 200,
      codegen: 220,
      logo: 180,
      email: 210,
    };
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'logo',
      availableWidth: 1000,
      tabWidths: wide,
      overflowMenuWidth: 60,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.iconOnly).toBe(false);
    expect(result.visible).toEqual(['design', 'drawing', 'image', 'logo']);
    expect(result.overflow).toEqual(['print', 'motion', 'codegen', 'email']);
  });

  it('never removes functionality — overflow keeps full mode list', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 100,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect([...result.visible, ...result.overflow].sort()).toEqual([...modes].sort());
  });

  it('falls back to icon-only tabs below the compact threshold', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 800,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.iconOnly).toBe(true);
    // Icon-only: 7 tabs at 32px + 36px menu = 260px, all fit.
    expect(result.visible).toEqual(modes);
    expect(result.overflow).toEqual([]);
  });

  it('reduces to the active tab only when nothing else fits', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'image',
      availableWidth: 60,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.visible).toEqual(['image']);
    expect(result.overflow).toEqual(modes.filter((m) => m !== 'image'));
  });

  it('uses a sensible default tab width for unmeasured modes', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 1000,
      tabWidths: {},
      overflowMenuWidth: 40,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    // 7 * 64 + 40 = 488 <= 1000: everything fits.
    expect(result.visible).toEqual(modes);
  });

  it('threshold constant matches the CSS breakpoint', () => {
    expect(WORKSPACE_ICON_ONLY_THRESHOLD).toBe(900);
  });
});
