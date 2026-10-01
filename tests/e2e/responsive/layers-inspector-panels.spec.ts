/**
 * Responsive contract for the Layers panel and the Inspector panel — the two
 * docked rails of the editor shell — across rail widths, compact drawers,
 * short desktop windows, and text-only enlargement (WCAG 2.2 SC 1.4.4).
 *
 * These tests exist because each assertion below failed on real measurements
 * before its fix (see docs/audits/responsive-layers-inspector-2026-09-30.md):
 *
 * - The short-height media tier scoped `flex: 0 0 auto` onto every
 *   `.editor-layers`, including the inner `.layers-panel__content` whose
 *   parent is a ROW-direction flex container. That sized the inner content to
 *   its max-content width (~313px) inside a ~280px rail: the filter bar's
 *   right third — including the "Show filter options" toggle — was clipped
 *   off the panel edge, and the dock splitter's 24px hit band covered what
 *   remained, so the toggle had no reachable hit point at all.
 * - The design-canvas row kept five text-labelled actions in normal flow at
 *   `opacity: 0`, which reserved ~210px for them at every width: the canvas
 *   name collapsed to "C…" (a ~10px button in the compact drawer), the row
 *   overflowed the list, and the *invisible* buttons still hit-tested, so a
 *   click on the row's empty middle activated a hidden action.
 * - The shell grid's rem-derived panel tracks summed past the viewport under
 *   a 200% root text size (1325px in a 1280px window), and
 *   `.editor-shell { overflow: hidden }` clipped 45px off the right end of
 *   every full-width chrome row.
 * - Inspector content that assumes 100% text size clipped at 200%: the align
 *   target cluster spilled 144px past its group, every segmented option label
 *   ellipsized ("Linear RGB" → "Li…"), and field labels truncated.
 *
 * Geometry is asserted through `elementFromPoint` and Playwright's actionability
 * trial (the harness's definition of "a user can activate this"), not through
 * layout boxes alone: a control whose centre loses its own hit test is
 * unreachable regardless of how its box measures.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

/** Visible text nodes inside `rootSel` that are clipped without an ellipsis. */
async function clippedTextWithoutEllipsis(page: import('@playwright/test').Page, rootSel: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [`missing:${sel}`];
    const bad: string[] = [];
    for (const el of root.querySelectorAll('*')) {
      if (!el.childNodes.length) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 3,
      );
      if (!hasText) continue;
      if (/sr-only|visually-hidden/.test(String(el.className))) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      if (['auto', 'scroll'].includes(cs.overflowX)) continue;
      const spillX = el.scrollWidth - el.clientWidth;
      if (spillX > 2 && cs.textOverflow !== 'ellipsis') {
        bad.push(
          `${String(el.className).slice(0, 60)} :: ${(el.textContent ?? '').trim().slice(0, 30)} (${Math.round(spillX)}px)`,
        );
      }
    }
    return bad;
  }, rootSel);
}

test.describe('layers rail geometry', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('layers rail contains its filter bar', async ({ page }) => {
    await navigateToEditor(page);
    const aside = page.locator('#editor-layers-panel');
    const content = page.locator('.editor-layers.layers-panel__content');
    const bar = page.locator('.layers-filter-bar');
    // Matches both states: the label flips to "Hide filter options" when open.
    const toggle = page.getByRole('button', { name: /filter options/i });

    await expect(content).toBeVisible();
    // The inner content must track the rail, not its own max-content width.
    const contentBox = await content.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(contentBox.scroll).toBeLessThanOrEqual(contentBox.client + 1);

    const barBox = await bar.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(barBox.scroll).toBeLessThanOrEqual(barBox.client + 1);

    // The toggle keeps its own hit test: centre point resolves to the button
    // or its own child icon (never the splitter or another surface), and
    // Playwright's actionability trial agrees.
    const hitOk = await toggle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!t && (t === el || el.contains(t));
    });
    expect(hitOk).toBe(true);
    await toggle.click({ trial: true });
    await toggle.click();
    await expect(page.getByRole('group', { name: /filter by type and attributes/i })).toBeVisible();
    await toggle.click();

    // No part of the rail content extends past the rail itself.
    const asideBox = await aside.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    // The legacy PanelResizeHandle currently protrudes ~7px (a known overlap
    // with the dock splitter, recorded in the audit); content must not.
    expect(asideBox.scroll - asideBox.client).toBeLessThanOrEqual(8);
  });

  test('canvas navigator row keeps its name and stays inside the list', async ({ page }) => {
    await navigateToEditor(page);
    const name = page.locator('.design-canvas-panel__name');
    await expect(name).toHaveText('Canvas 1');
    // Full text visible: scrollWidth equals clientWidth (no "C…" collapse).
    const nameBox = await name.evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(nameBox.scroll).toBeLessThanOrEqual(nameBox.client + 1);

    // No horizontal spill in the list or the rail from this row.
    for (const sel of ['.design-canvas-panel__list', '.layers-panel__content']) {
      const box = await page
        .locator(sel)
        .first()
        .evaluate((el) => ({
          scroll: el.scrollWidth,
          client: el.clientWidth,
        }));
      expect(box.scroll, `${sel} must not overflow horizontally`).toBeLessThanOrEqual(
        box.client + 1,
      );
    }

    // At rest the hover-revealed actions must not exist in layout at all:
    // clicking the row's empty middle reaches the select, never a hidden
    // action (the old `opacity: 0` reveal still hit-tested).
    const row = page.locator('.design-canvas-panel__row').first();
    const middleHit = await row.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width * 0.75, r.y + r.height / 2);
      return t ? `${t.tagName}.${String(t.className)}` : 'none';
    });
    expect(middleHit).not.toContain('pages-panel__icon-btn');
    await expect(row.locator('.design-canvas-panel__actions')).toHaveCSS('display', 'none');

    // Hover reveals them and they are really clickable; the select keeps its
    // own hit test while they are revealed (they wrap to their own line
    // rather than covering it).
    await row.hover();
    await expect(row.locator('.design-canvas-panel__actions')).toHaveCSS('display', 'flex');
    const rename = row.getByRole('button', { name: /rename canvas/i });
    await rename.click({ trial: true });
    const selectStillHit = await row.locator('.design-canvas-panel__select').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!t && (t === el || el.contains(t));
    });
    expect(selectStillHit).toBe(true);
    await page.keyboard.press('Escape');

    // WCAG 2.2 AA SC 2.5.8: the add button holds the 24px floor.
    const addBox = await page
      .locator('.pages-panel__add-btn')
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
    expect(addBox.w).toBeGreaterThanOrEqual(24);
    expect(addBox.h).toBeGreaterThanOrEqual(24);
  });
});

test.describe('text enlargement (WCAG 1.4.4)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('shell and panels stay inside the viewport at 200% root text', async ({ page }) => {
    await navigateToEditor(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(500);

    // F3: rem-derived grid tracks must not sum past the viewport.
    const shell = await page.locator('.editor-shell').evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    expect(shell.scroll).toBeLessThanOrEqual(shell.client + 1);

    // Full-width chrome rows keep their right ends inside the window.
    for (const sel of [
      '.editor-shell__menubar',
      '.editor-tabs-row',
      '.editor-status',
      '.selection-info-bar',
    ]) {
      const right = await page.locator(sel).evaluate((el) => el.getBoundingClientRect().right);
      expect(right, `${sel} right edge`).toBeLessThanOrEqual(1280 + 1);
    }

    // F1 still holds at this text size: the filter bar is contained.
    const contentBox = await page
      .locator('.editor-layers.layers-panel__content')
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(contentBox.scroll).toBeLessThanOrEqual(contentBox.client + 1);

    // The canvas name still renders in full (grows with text, row is fixed).
    const nameBox = await page
      .locator('.design-canvas-panel__name')
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(nameBox.scroll).toBeLessThanOrEqual(nameBox.client + 1);
  });

  test('align target cluster stays inside its group when selected', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);
    await page.locator('.layers-row').first().click();
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(500);

    // F4a: the align target cluster stays inside its group.
    const align = await page.evaluate(() => {
      const targets = document.querySelector('.insp-align-targets');
      const group = targets?.closest('.insp-align-group');
      if (!targets || !group) return { missing: true };
      const t = targets.getBoundingClientRect();
      const g = group.getBoundingClientRect();
      return { overflow: Math.round(t.right - g.right) };
    });
    expect(align.missing).toBeFalsy();
    if (!align.missing) expect(align.overflow).toBeLessThanOrEqual(1);
  });

  test('document panel text stays readable', async ({ page }) => {
    await navigateToEditor(page);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await page.waitForTimeout(500);

    // F4b: segmented option labels keep their full text (wrap, not ellipsis).
    const segLabels = await page.evaluate(() =>
      [...document.querySelectorAll('.editor-inspector .varve-segmented__label')]
        .filter((l) => l.getBoundingClientRect().width > 0)
        .map((l) => ({
          text: l.textContent ?? '',
          ok: l.scrollWidth <= l.clientWidth + 1,
        })),
    );
    expect(segLabels.length).toBeGreaterThan(0);
    for (const l of segLabels) {
      expect(l.ok, `segmented label "${l.text}" must not truncate`).toBe(true);
    }

    // F4c: field labels wrap (never silently clipped without ellipsis) and
    // no inspector text is clipped without an ellipsis affordance.
    const clipped = await clippedTextWithoutEllipsis(page, '#editor-inspector-panel');
    expect(clipped, `clipped without ellipsis: ${clipped.join(' | ')}`).toEqual([]);
  });
});

test.describe('compact drawer (<=899px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('layers drawer keeps its controls reachable', async ({ page }) => {
    await navigateToEditor(page);
    await page.locator('.editor__fab--layers').click();
    const aside = page.locator('#editor-layers-panel');
    await expect(aside).toBeVisible();

    const nameBox = await page
      .locator('.design-canvas-panel__name')
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(nameBox.scroll).toBeLessThanOrEqual(nameBox.client + 1);

    const toggle = page.getByRole('button', { name: /show filter options/i });
    await toggle.click({ trial: true });

    const contentBox = await page
      .locator('.editor-layers.layers-panel__content')
      .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(contentBox.scroll).toBeLessThanOrEqual(contentBox.client + 1);

    // Modal drawer contract: Escape closes it and focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(aside).not.toBeVisible();
    const focusReturned = await page.evaluate(
      () => document.activeElement === document.querySelector('.editor__fab--layers'),
    );
    expect(focusReturned).toBe(true);
  });
});

test.describe('short desktop window', () => {
  test.use({ viewport: { width: 1024, height: 600 } });

  test('layer rows stay operable with the rail scrolling', async ({ page }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);
    const aside = page.locator('#editor-layers-panel');
    // The short-height tier makes the rail the outer scroller.
    const scrollable = await aside.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
    await aside.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // A real row control keeps its hit test at the bottom of the scroll.
    const hide = page
      .locator('.layers-row')
      .first()
      .getByRole('button', { name: /^(hide|show) rectangle/i })
      .first();
    await hide.scrollIntoViewIfNeeded();
    await hide.click({ trial: true });
  });
});
