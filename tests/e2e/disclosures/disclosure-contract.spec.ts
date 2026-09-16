/**
 * Disclosure contract — rendered, real-document scenarios.
 *
 * The unit suite (`packages/ui/src/components/__tests__/Disclosure.test.tsx`)
 * proves the primitive in isolation. This spec proves the assembled editor
 * behaviour that real users reported against other products:
 *
 * 1. section state must not reset as a side effect of editing, changing
 *    selection, or undo/redo (Blender #123653 / #141506, Godot #81481);
 * 2. collapsing a section must not throw the reader to a random position in
 *    the inspector (Bootstrap #41240, Elementor/GenerateBlocks reports);
 * 3. keyboard toggling must keep focus and collapsed content must not be
 *    reachable by Tab;
 * 4. collapse state must reach the persisted settings store.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function drawRect(page: Page, offset = 0): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 180 + offset, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 320 + offset, box.y + 260, { steps: 4 });
  await page.mouse.up();
}

function section(page: Page, title: string): Locator {
  return page.locator('section.insp-disclosure').filter({
    has: page.getByRole('heading', { name: title, exact: true }),
  });
}

function trigger(page: Page, title: string): Locator {
  return section(page, title).locator('button.insp-disclosure__trigger');
}

async function setExpanded(page: Page, title: string, expanded: boolean): Promise<void> {
  const el = trigger(page, title);
  await el.waitFor({ timeout: 10_000 });
  if ((await el.getAttribute('aria-expanded')) !== String(expanded)) {
    await el.click();
  }
  await expect(el).toHaveAttribute('aria-expanded', String(expanded));
}

test.describe('Disclosure contract (rendered)', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('section collapse survives selection changes, document edits, and undo', async ({
    page,
  }) => {
    await drawRect(page);
    await drawRect(page, 180);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });

    await setExpanded(page, 'Fill', false);
    await expect(section(page, 'Fill').locator('.insp-disclosure__content')).toHaveCount(0);

    // Selection change: pick the other rect in the layers tree.
    await page.getByRole('treeitem').first().click();
    await expect(trigger(page, 'Fill')).toHaveAttribute('aria-expanded', 'false');

    // Document edit + undo: nudge, then undo through the real history.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Control+z');
    await expect(trigger(page, 'Fill')).toHaveAttribute('aria-expanded', 'false');

    // Expanding an unrelated section must not disturb it either.
    await setExpanded(page, 'Stroke', false);
    await setExpanded(page, 'Fill', true);
    await expect(trigger(page, 'Stroke')).toHaveAttribute('aria-expanded', 'false');
  });

  test('collapsing a section above the reading position does not jump the viewport', async ({
    page,
  }) => {
    await drawRect(page);

    const scroller = page.locator('.editor-inspector > .insp-panel').first();
    await scroller.waitFor({ timeout: 10_000 });

    // Read far enough down that the first section is above the viewport and
    // its sticky header is pinned at the top of the panel.
    await scroller.evaluate((el) => {
      el.scrollTop = Math.min(600, el.scrollHeight - el.clientHeight);
    });
    const collapsedTitle = 'Position & Size';
    const referenceTitle = 'Stroke';
    await expect(trigger(page, referenceTitle)).toBeVisible();
    await expect(trigger(page, collapsedTitle)).toBeVisible();

    const before = await page.evaluate(
      ({ refTitle }) => {
        const panel = document.querySelector('.editor-inspector > .insp-panel');
        const sections = [...document.querySelectorAll('section.insp-disclosure')];
        const target = sections.find((s) => new RegExp(refTitle, 'i').test(s.textContent ?? ''));
        return {
          scrollTop: panel instanceof HTMLElement ? panel.scrollTop : 0,
          referenceDocTop: target ? target.getBoundingClientRect().top : 0,
        };
      },
      { refTitle: referenceTitle },
    );

    await setExpanded(page, collapsedTitle, false);

    const after = await page.evaluate(
      ({ refTitle }) => {
        const panel = document.querySelector('.editor-inspector > .insp-panel');
        const sections = [...document.querySelectorAll('section.insp-disclosure')];
        const target = sections.find((s) => new RegExp(refTitle, 'i').test(s.textContent ?? ''));
        return {
          scrollTop: panel instanceof HTMLElement ? panel.scrollTop : 0,
          referenceDocTop: target ? target.getBoundingClientRect().top : 0,
          referenceVisible: target ? target.getBoundingClientRect().top > -1 : false,
        };
      },
      { refTitle: referenceTitle },
    );

    // Reclaiming space is expected; scrolling past the reader's reference row
    // or back to the top is the reported failure.
    expect(after.scrollTop).toBeLessThanOrEqual(before.scrollTop + 1);
    expect(after.scrollTop).toBeGreaterThan(0);
    expect(after.referenceDocTop).toBeGreaterThanOrEqual(before.referenceDocTop - 1);
    expect(after.referenceVisible).toBe(true);
  });

  test('keyboard toggling keeps focus and collapsed content is not tabbable', async ({ page }) => {
    await drawRect(page);
    await setExpanded(page, 'Fill', false);

    const fills = trigger(page, 'Fill');
    await fills.focus();
    await expect(fills).toBeFocused();
    await expect(fills).not.toHaveAttribute('aria-controls');

    await page.keyboard.press('Enter');
    await expect(fills).toHaveAttribute('aria-expanded', 'true');
    await expect(fills).toBeFocused();
    const controlled = await fills.getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    await expect(page.locator(`#${controlled}`)).toHaveCount(1);

    await page.keyboard.press(' ');
    await expect(fills).toHaveAttribute('aria-expanded', 'false');
    await expect(fills).toBeFocused();

    // Tab away: focus must not land inside the removed panel.
    await page.keyboard.press('Tab');
    const stranded = await page.evaluate(
      () => document.activeElement?.closest('.insp-disclosure__content') !== null,
    );
    expect(stranded).toBe(false);
  });

  test('collapse state reaches the persisted settings store', async ({ page }) => {
    await drawRect(page);
    await setExpanded(page, 'Stroke', false);

    const persisted = await page.evaluate(() => {
      const raw = window.localStorage.getItem('varve-editor-settings');
      return raw
        ? (JSON.parse(raw) as { sections?: { sections?: Record<string, unknown> } })
        : null;
    });
    const stroke = persisted?.sections?.sections?.stroke as { collapsed?: boolean } | undefined;
    expect(stroke?.collapsed).toBe(true);
  });
});
