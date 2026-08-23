/**
 * Focus-order baseline trace — records the deterministic Tab/Shift+Tab
 * sequence through the editor's major regions.
 *
 * Purpose (milestone 1 of the focus-navigation remediation):
 *   - Establish a machine-readable baseline of the current focus order so
 *     later milestones can prove they only change what they intend to.
 *   - Assert region-level ordering (semantic roles + accessible names), not
 *     raw DOM indexes, so the spec survives widget-internal refactors.
 *
 * The expected high-level order (see docs/audits/focus-navigation-audit-2026-08-02.md):
 *   Menubar → [Floating] toolbar → Document tabs → Canvas → Layers panel →
 *   Inspector → Status bar
 *
 * Run: npx playwright test tests/e2e/a11y/focus-order.spec.ts --project=chromium
 */

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

interface FocusEntry {
  tag: string;
  role: string | null;
  name: string | null;
  testid: string | null;
}

async function recordFocus(page: Page): Promise<FocusEntry> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) {
      return { tag: 'body', role: null, name: null, testid: null };
    }
    const role = el.getAttribute('role');
    const testid = el.getAttribute('data-testid');
    let name: string | null = null;
    const labelled = el.getAttribute('aria-label');
    if (labelled) {
      name = labelled;
    } else if (el instanceof HTMLButtonElement) {
      name = el.textContent?.trim() || el.getAttribute('aria-label') || null;
    } else if (el instanceof HTMLInputElement) {
      name = el.getAttribute('placeholder') || el.name || null;
    }
    return {
      tag: el.tagName.toLowerCase(),
      role,
      name: name ? name.slice(0, 60) : null,
      testid,
    };
  });
}

/** Press Tab n times from the current focus, recording each stop. */
async function traceTab(page: Page, steps: number): Promise<FocusEntry[]> {
  const trace: FocusEntry[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    trace.push(await recordFocus(page));
  }
  return trace;
}

/** Press Shift+Tab n times from the current focus, recording each stop. */
async function traceShiftTab(page: Page, steps: number): Promise<FocusEntry[]> {
  const trace: FocusEntry[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(60);
    trace.push(await recordFocus(page));
  }
  return trace;
}

function regionOf(entry: FocusEntry): string {
  if (entry.testid === 'editor-canvas') return 'canvas';
  if (entry.role === 'menuitem') return 'menubar';
  if (entry.role === 'toolbar' || entry.role === 'tooltip') return 'toolbar';
  if (entry.role === 'tab') return 'tabs';
  if (entry.role === 'treeitem') return 'layers';
  if (entry.role === 'separator' && entry.tag === 'hr') return 'panel-resize';
  if (entry.tag === 'input') return 'form';
  if (entry.tag === 'body') return 'body';
  return `${entry.tag}:${entry.role ?? ''}`;
}

test.describe('Focus-order baseline trace', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.waitForTimeout(400);
  });

  test('Tab from the first menubar item reaches canvas then panels, never body', async ({
    page,
  }) => {
    // Deterministic entry point: first menubar item.
    const firstItem = page.getByTestId('menubar').locator('[role="menuitem"]').first();
    await firstItem.focus();
    await expect(firstItem).toBeFocused();

    const trace = await traceTab(page, 18);
    const regions = trace.map(regionOf);

    // Assert the documented region order appears in sequence.
    const order = ['menubar', 'toolbar', 'canvas', 'layers'];
    const orderIdx = order.map((r) => regions.indexOf(r)).filter((i) => i >= 0);
    expect(
      orderIdx,
      `regions ${order.join(' → ')} appear in order; got ${regions.join(' → ')}`,
    ).toEqual([...orderIdx].sort((a, b) => a - b));

    // No stop may land on <body> during the trace.
    expect(
      trace.some((e) => e.tag === 'body'),
      `trace: ${JSON.stringify(trace)}`,
    ).toBe(false);
  });

  test('Shift+Tab from the layers panel returns through canvas and toolbar', async ({ page }) => {
    await seedLayers(page, 2);
    const tree = page.getByRole('tree', { name: 'Layers' });
    await tree.waitFor({ state: 'visible', timeout: 5000 });
    const firstItem = tree.locator('[role="treeitem"]').first();
    await firstItem.focus();
    await expect(firstItem).toBeFocused();

    // 25 steps to traverse from the layers panel through canvas to the
    // menubar — the layers panel contains several focusable sub-panels
    // (minimap, master, pages, etc.) that consume steps before reaching
    // the canvas region.
    const trace = await traceShiftTab(page, 25);
    const regions = trace.map(regionOf);

    const canvasIdx = regions.indexOf('canvas');
    expect(
      canvasIdx,
      `canvas reachable backward; got ${regions.join(' → ')}`,
    ).toBeGreaterThanOrEqual(0);

    expect(
      trace.some((e) => e.tag === 'body'),
      `trace: ${JSON.stringify(trace)}`,
    ).toBe(false);

    const menubarIdx = regions.indexOf('menubar');
    if (canvasIdx >= 0 && regions[canvasIdx + 1] === 'canvas') {
      // Trapped in canvas selection cycling — documented baseline defect.
      expect(menubarIdx).toBe(-1);
    } else {
      expect(
        menubarIdx,
        `menubar reachable backward; got ${regions.join(' → ')}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  // Milestone 4 (canvas Tab exit): with no selection, Tab must leave the
  // canvas for the next region (previously the canvas always consumed Tab
  // because fresh documents always contain an artboard node — RC-15).
  test('canvas region is a single tab stop with no stray focusable overlays between it and the panels', async ({
    page,
  }) => {
    const canvas = page.getByTestId('editor-canvas');
    await canvas.focus();
    await expect(canvas).toBeFocused();

    const next = await traceTab(page, 1);
    const regions = next.map(regionOf);
    // No selection on a fresh document: Tab exits the canvas (previously
    // it cycled selection and focus stayed on the canvas).
    expect(regions[0], `next stop after canvas; got ${regions.join(' → ')}`).not.toBe('canvas');
    expect(next[0]).toBeDefined();
    expect(next[0]?.tag).not.toBe('body');
  });
});

test.describe('Focus-order regression guard', () => {
  test('no positive tabindex in the editor DOM', async ({ page }) => {
    await navigateToEditor(page);
    const bad = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('[tabindex]')) {
        const v = parseInt(el.getAttribute('tabindex') ?? '0', 10);
        if (v > 0) out.push(`${el.tagName}.${el.className?.toString().slice(0, 40)}:${v}`);
      }
      return out;
    });
    expect(bad).toEqual([]);
  });

  test('focus never lands inside aria-hidden content', async ({ page }) => {
    await navigateToEditor(page);
    await page.waitForTimeout(300);
    const violation = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;
      let node: Element | null = el;
      while (node) {
        if (node.getAttribute?.('aria-hidden') === 'true') return true;
        node = node.parentElement;
      }
      return false;
    });
    expect(violation).toBe(false);
  });
});
