import { describe, expect, it } from 'vitest';
import {
  computeWorkspaceLayout,
  WORKSPACE_ICON_ONLY_THRESHOLD,
  WORKSPACE_TAB_GAP_FALLBACK,
} from './workspaceOverflow';
import { WORKSPACE_OVERFLOW_ORDER, WORKSPACE_OVERFLOW_PRIORITY } from './workspaceTypes';

const modes = WORKSPACE_OVERFLOW_ORDER;
// Realistic labeled tab widths (~80-100px each).
const tabWidths: Record<(typeof modes)[number], number> = {
  design: 96,
  print: 82,
  drawing: 88,
  image: 92,
  motion: 90,
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
    // Below the icon-only threshold inactive tabs are the 28px button plus
    // the gap, but the active mode keeps its measured label pill (96px): the
    // strip math must account for that or the bar overflows its wrapper and
    // covers the title.
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 250,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.iconOnly).toBe(true);
    expect(result.compactActive).toBe(false);
    expect(result.visible).toEqual(['design', 'print', 'drawing', 'image']);
    expect(result.overflow).toEqual(['motion', 'email']);
  });

  it('budgets tablet-sized icon targets and the matching More control', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 300,
      tabWidths,
      overflowMenuWidth: 44,
      iconButtonWidth: 44,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
      tabGap: 4,
    });

    expect(result.visible).toEqual(['design', 'print', 'drawing', 'image']);
    expect(result.overflow).toEqual(['motion', 'email']);
  });

  it('keeps the active label on desktop strips and compacts it only when too narrow', () => {
    const wide = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 500,
      tabWidths,
      overflowMenuWidth: 40,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(wide.compactActive).toBe(false);
    expect(wide.visible).toContain('design');

    const narrow = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 150,
      tabWidths,
      overflowMenuWidth: 40,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(narrow.compactActive).toBe(true);
    expect(narrow.visible).toContain('design');
  });

  it('keeps the active mode visible even when it would overflow', () => {
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'email',
      availableWidth: 250,
      tabWidths,
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.visible).toContain('email');
    expect(result.visible[0]).toBe('design');
    expect(result.visible).toEqual(['design', 'print', 'drawing', 'image', 'email']);
    expect(result.overflow).toEqual(['motion']);
  });

  it('keeps the active mode visible even when it would overflow (labeled strip)', () => {
    // Wide-enough strip for labels with inflated widths to force overflow:
    // Display order is design/print/draw/photo/motion/email. When the active
    // Email tab needs room, the lowest-priority visible specialist yields.
    const wide: Record<(typeof modes)[number], number> = {
      design: 220,
      drawing: 200,
      image: 210,
      print: 190,
      motion: 200,
      email: 210,
    };
    const result = computeWorkspaceLayout({
      modes,
      activeMode: 'email',
      availableWidth: 1000,
      tabWidths: wide,
      overflowMenuWidth: 60,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    expect(result.iconOnly).toBe(false);
    expect(result.visible).toEqual(['design', 'print', 'drawing', 'email']);
    expect(result.overflow).toEqual(['image', 'motion']);
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
    // Icon-only: 7 tabs at 33px + 36px menu = 267px, all fit.
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

  it('applies the caller-measured tab gap exactly once per tab', () => {
    // The gap is a measured input, not a second copy of a CSS value: a larger
    // rendered gap must move more tabs into overflow.
    const base = {
      modes,
      activeMode: 'design' as const,
      availableWidth: 300,
      tabWidths: {},
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    };
    const tight = computeWorkspaceLayout({ ...base, tabGap: 4 });
    const loose = computeWorkspaceLayout({ ...base, tabGap: 20 });
    expect(loose.visible.length).toBeLessThan(tight.visible.length);
    expect([...loose.visible, ...loose.overflow].sort()).toEqual([...modes].sort());
  });

  it('defaults the gap when the caller cannot measure it', () => {
    const withDefault = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 300,
      tabWidths: {},
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
    });
    const explicit = computeWorkspaceLayout({
      modes,
      activeMode: 'design',
      availableWidth: 300,
      tabWidths: {},
      overflowMenuWidth: 36,
      overflowPriority: WORKSPACE_OVERFLOW_PRIORITY,
      tabGap: WORKSPACE_TAB_GAP_FALLBACK,
    });
    expect(withDefault).toEqual(explicit);
  });
});
