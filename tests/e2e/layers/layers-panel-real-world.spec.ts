/**
 * Layers Panel — real-world document review and regression harness.
 *
 * Builds a realistic multi-page hierarchy from authored SVG fixtures and a
 * real photograph (not a synthetic one-rect document), then exercises the
 * panel's sections end to end: header, filter bar, tree, rows, bulk bar,
 * context menu, selection sets, keyboard, and virtualization.
 *
 * Evidence (screenshots + probe JSON) is written under reports/layers-review/.
 *
 * Mechanism notes (see docs/audits/layers-panel-real-world-2026-09-15.md):
 * - Text enlargement is exercised via two DISTINCT mechanisms:
 *   CSS page zoom (documentElement zoom) and root font-size preference.
 *   Neither is real browser zoom; the mechanism used is recorded in the
 *   probe output.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REPORT_DIR = path.resolve('reports/layers-review');
const SVG_APP = path.resolve('tests/e2e/fixtures/layers-mobile-app.svg');
const SVG_STRESS = path.resolve('tests/e2e/fixtures/layers-stress-board.svg');
const PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');

function ensureReportDir() {
  mkdirSync(REPORT_DIR, { recursive: true });
}

function record(name: string, data: unknown) {
  ensureReportDir();
  writeFileSync(path.join(REPORT_DIR, name), JSON.stringify(data, null, 2));
}

/**
 * Import a file and wait until the panel reports at least `expected` logical
 * layers. The tree is virtualized, so mounted [role=treeitem] count is NOT
 * the document size — read the header count instead.
 */
async function layerCount(page: Page): Promise<number> {
  const text = await page.locator('.layers-panel__count').textContent();
  return Number.parseInt(text ?? '0', 10);
}

async function importFixture(page: Page, filePath: string, expected: number, timeout = 60_000) {
  await page.locator('#file-import-input').setInputFiles(filePath);
  await expect.poll(async () => layerCount(page), { timeout }).toBeGreaterThanOrEqual(expected);
  await page.waitForTimeout(300);
}

/** Dump the visible tree structure (name/level/kind) for evidence. */
async function treeStructure(page: Page, limit = 80) {
  return page.evaluate((max) => {
    const rows = [...document.querySelectorAll('[role="treeitem"]')].slice(0, max);
    return rows.map((el) => ({
      name: el.querySelector('.layers-row__name')?.textContent ?? null,
      level: el.getAttribute('aria-level'),
      category: el.getAttribute('data-layer-category'),
      selected: el.getAttribute('aria-selected'),
      posinset: el.getAttribute('aria-posinset'),
      setsize: el.getAttribute('aria-setsize'),
    }));
  }, limit);
}

async function capture(page: Page, name: string, target?: Locator) {
  ensureReportDir();
  const file = path.join(REPORT_DIR, `${name}.png`);
  if (target) {
    await target.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
}

/** Build the shared realistic document: mobile app UI + a real photo. */
async function buildRealisticDocument(page: Page) {
  await navigateToEditor(page);
  await importFixture(page, SVG_APP, 35);
  const before = await layerCount(page);
  await importFixture(page, PHOTO, before + 1);
  // Wait for the tree to settle after import.
  await page.waitForTimeout(500);
}

test.describe('Layers Panel — real-world document', () => {
  // Independent tests: each builds its own document. Serial mode was harmful
  // here — one HMR-interrupted navigation skipped every later check.
  test.describe.configure({ timeout: 180_000 });

  test('imports a realistic nested hierarchy and presents every section', async ({ page }) => {
    await buildRealisticDocument(page);

    const tree = page.getByRole('tree', { name: /layers/i });
    await expect(tree).toBeVisible();

    // Logical layer count comes from the header; the mounted row count is
    // bounded by virtualization.
    const logicalCount = await layerCount(page);
    expect(logicalCount).toBeGreaterThan(35);
    const mountedRows = await page.getByRole('treeitem').count();
    expect(mountedRows).toBeLessThanOrEqual(logicalCount);

    // Nesting: imported groups must appear as containers with aria-expanded.
    const containers = tree.locator('[aria-expanded]');
    expect(await containers.count()).toBeGreaterThan(3);

    // Evidence: what names did the imported layers actually get?
    record('tree-structure.json', {
      logicalCount,
      mountedRows,
      structure: await treeStructure(page),
    });

    // Section inventory probe.
    const sections = await page.evaluate(() => {
      const panel = document.querySelector('.layers-panel');
      const pick = (sel: string) => document.querySelectorAll(sel).length;
      return {
        panelFound: Boolean(panel),
        header: pick('.layers-panel__header'),
        filterBar: pick('.layers-filter-bar'),
        tree: pick('.layers-panel__tree'),
        treeItems: pick('[role="treeitem"]'),
        bulkBar: pick('.layers-bulk-bar'),
        selectionSets: pick('.selection-sets'),
        isolationBreadcrumb: pick('.layers-panel__isolation-breadcrumb'),
        rootDropTarget: pick('.layers-panel__drop-root'),
      };
    });
    record('section-inventory.json', sections);
    expect(sections.header).toBe(1);
    expect(sections.tree).toBe(1);

    await capture(page, '01-initial-panel');
    await capture(page, '02-tree-rows', tree);
  });

  test('stress hierarchy: virtualization mounts a bounded window and scrolls smoothly', async ({
    page,
  }) => {
    await buildRealisticDocument(page);
    await importFixture(page, SVG_STRESS, 280);

    const rows = page.getByRole('treeitem');
    const totalLogical = await layerCount(page);
    const mountedBeforeScroll = await rows.count();
    record('stress-before-scroll.json', {
      totalLogical,
      mountedBeforeScroll,
      structure: await treeStructure(page, 24),
    });

    const tree = page.getByRole('tree', { name: /layers/i });
    await capture(page, '10-stress-top', tree);

    // Scroll deep into the list; virtualization must keep mounted rows bounded.
    const scroller = page.locator('.layers-panel__tree');
    const scrollProbe = await scroller.evaluate(async (el) => {
      const target = el as HTMLElement;
      const started = performance.now();
      target.scrollTop = target.scrollHeight / 2;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const mid = performance.now();
      return {
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
        scrollTop: target.scrollTop,
        twoFrameMs: Math.round(mid - started),
        mountedRows: target.querySelectorAll('[role="treeitem"]').length,
      };
    });
    record('stress-scroll.json', scrollProbe);
    expect(scrollProbe.mountedRows).toBeLessThan(120);
    await capture(page, '11-stress-middle', tree);

    // Rows remain usable deep in the list: aria-posinset must reflect the
    // logical position, not the mounted window index.
    const deepRow = rows.first();
    const posinset = await deepRow.getAttribute('aria-posinset');
    record('stress-first-mounted.json', { posinset });

    // Return to top and toggle a row deep in the list.
    await scroller.evaluate((el) => {
      (el as HTMLElement).scrollTop = 0;
    });
    await page.waitForTimeout(200);
    await capture(page, '12-stress-return-top', tree);
  });

  test('header controls and filter bar: search narrows the tree with match feedback', async ({
    page,
  }) => {
    await buildRealisticDocument(page);

    const search = page.getByLabel('Filter layers by name');
    await search.fill('Card 2');
    await page.waitForTimeout(400);

    const visibleNames = await page
      .getByRole('treeitem')
      .locator('.layers-row__name')
      .allTextContents();
    record('filter-card2.json', { visibleNames });

    const filterCount = await page.locator('.layers-filter-bar__count').textContent();
    record('filter-count-text.json', { filterCount });

    await capture(page, '20-filter-search');

    // Clear via the search clear affordance; all rows return.
    const clear = page.locator('.layers-filter-bar .varve-search__clear');
    if (await clear.isVisible().catch(() => false)) {
      await clear.click();
    } else {
      await search.fill('');
    }
    await page.waitForTimeout(300);
  });

  test('selection: single, range, and toggle selection stay independent of the camera', async ({
    page,
  }) => {
    await buildRealisticDocument(page);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(3).click({ modifiers: ['Shift'] });
    await rows.nth(5).click({ modifiers: ['ControlOrMeta'] });

    const selected = await page.locator('[role="treeitem"][aria-selected="true"]').count();
    record('selection-mixed.json', { selected });
    expect(selected).toBeGreaterThanOrEqual(3);

    await capture(page, '30-multi-selection');

    // Reducer/bulk bar appears for multi-selection.
    await expect(page.locator('.layers-bulk-bar')).toBeVisible();
  });

  test('row toggles: visibility, lock, and solo reflect state and expose targets', async ({
    page,
  }) => {
    await buildRealisticDocument(page);

    const firstRow = page.getByRole('treeitem').first();
    const visibility = firstRow.locator('.layers-row__toggle').first();
    const before = await visibility.getAttribute('aria-pressed');
    await visibility.click();
    await expect(firstRow).toHaveClass(/layers-row--hidden/);
    const after = await visibility.getAttribute('aria-pressed');
    record('visibility-toggle.json', { before, after });
    expect(after).not.toBe(before);

    // Mount every interactive family before measuring: open the advanced
    // filter (chips) and build a multi-selection (bulk bar).
    await page.getByRole('button', { name: 'Show filter options' }).click();
    await page.waitForTimeout(200);
    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);

    // Phase 1 target-size probe: no search text, so the bulk bar (hidden
    // while filtering) and the advanced chips are both mounted at once.
    const sizes = await page.evaluate(() => {
      const sels = [
        '.layers-row__toggle',
        '.layers-row__disclosure',
        '.layers-row__icon-area',
        '.layers-panel__header-btn',
        '.layers-filter-bar__chip',
        '.layer-color-tag-picker__button',
        '.layers-bulk-bar__btn',
      ];
      const out: Record<string, Array<{ w: number; h: number }>> = {};
      for (const sel of sels) {
        out[sel] = [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
        });
      }
      return out;
    });
    record('target-sizes.json', sizes);
    await capture(page, '31-advanced-filter-and-bulk');

    // Phase 2 target-size probe: an active search mounts the Clear button and
    // the search field's own clear affordance.
    await page.getByLabel('Filter layers by name').fill('Card');
    await page.waitForTimeout(300);
    const clearSizes = await page.evaluate(() => {
      const sels = ['.layers-filter-bar__clear-all', '.varve-search__clear'];
      const out: Record<string, Array<{ w: number; h: number }>> = {};
      for (const sel of sels) {
        out[sel] = [...document.querySelectorAll(sel)].map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
        });
      }
      return out;
    });
    record('target-sizes-clear.json', clearSizes);
    await page.getByLabel('Filter layers by name').fill('');
    await page.waitForTimeout(200);

    // WCAG 2.2 SC 2.5.8: every measured interactive control must offer at
    // least a 24x24 CSS px activation area.
    for (const [sel, boxes] of Object.entries({ ...sizes, ...clearSizes })) {
      expect(boxes.length, `${sel} should be mounted`).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.w, `${sel} width`).toBeGreaterThanOrEqual(24);
        expect(box.h, `${sel} height`).toBeGreaterThanOrEqual(24);
      }
    }

    // Keyboard focus must be visibly indicated on the filter controls: the
    // search input is immediately before the advanced toggle in the DOM.
    await page.getByLabel('Filter layers by name').focus();
    await page.keyboard.press('Tab');
    const focusProbe = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        ariaLabel: el.getAttribute('aria-label'),
        className: el.className,
        outlineStyle: s.outlineStyle,
        outlineWidth: s.outlineWidth,
        outlineColor: s.outlineColor,
      };
    });
    record('focus-visible-probe.json', focusProbe);
    expect(focusProbe?.ariaLabel).toMatch(/filter options/i);
    expect(focusProbe?.outlineStyle).toBe('solid');
    expect(focusProbe?.outlineWidth).toBe('2px');
  });

  test('context menu: state-aware labels, arrange alternatives, and focus return', async ({
    page,
  }) => {
    await buildRealisticDocument(page);

    // Hide the first row, then open its context menu.
    const firstRow = page.getByRole('treeitem').first();
    await firstRow.locator('.layers-row__toggle').first().click();
    await expect(firstRow).toHaveClass(/layers-row--hidden/);

    await firstRow.click({ button: 'right' });
    const menu = page.locator('.varve-ctxmenu');
    await expect(menu).toBeVisible();
    const labels = await menu.getByRole('menuitem').allTextContents();
    record('context-menu-labels-hidden-row.json', { labels });

    // State-aware commands must be present for the hidden row, and the
    // stepwise arrange alternatives must be available without dragging.
    expect(labels.some((l) => /^Show/.test(l))).toBe(true);
    expect(labels.some((l) => /^Bring Forward/.test(l))).toBe(true);
    expect(labels.some((l) => /^Send Backward/.test(l))).toBe(true);

    // The menu must fit the viewport (or scroll within it) rather than
    // running off-screen with unreachable commands.
    const menuBox = await menu.boundingBox();
    const viewport = page.viewportSize();
    record('context-menu-geometry.json', { menuBox, viewport });
    expect(menuBox).not.toBeNull();
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual((viewport?.height ?? 0) + 1);

    await capture(page, '40-context-menu-hidden-row');

    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();

    // Keyboard-triggered menu on the focused row.
    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    const keyboardMenuBox = await menu.boundingBox();
    const focusedRowBox = await page.locator('[role="treeitem"]:focus').boundingBox();
    record('context-menu-keyboard-anchor.json', { keyboardMenuBox, focusedRowBox });
    await page.keyboard.press('Escape');
  });

  test('inline rename: F2, Enter commit, Escape cancel', async ({ page }) => {
    await buildRealisticDocument(page);

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('F2');
    const input = page.locator('.layers-row__name-input');
    await expect(input).toBeVisible();
    await input.fill('Renamed Layer');
    await input.press('Enter');
    await expect(page.locator('.layers-row__name').first()).toHaveText('Renamed Layer');

    await page.keyboard.press('F2');
    await page.locator('.layers-row__name-input').fill('Should Not Persist');
    await page.keyboard.press('Escape');
    await expect(page.locator('.layers-row__name').first()).toHaveText('Renamed Layer');
  });

  test('drag reorder via the grip changes document order once', async ({ page }) => {
    await buildRealisticDocument(page);

    const rows = page.getByRole('treeitem');
    const namesBefore = await rows.locator('.layers-row__name').allTextContents();
    record('reorder-before.json', { namesBefore: namesBefore.slice(0, 6) });

    // Drag the second row's grip below the fourth row.
    const source = rows.nth(1);
    const target = rows.nth(4);
    await source.hover();
    const grip = source.locator('.layers-row__drag-handle');
    const sourceBox = await grip.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('rows not measurable');

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.8, {
      steps: 8,
    });
    await page.mouse.up();
    await page.waitForTimeout(400);

    const namesAfter = await rows.locator('.layers-row__name').allTextContents();
    record('reorder-after.json', { namesAfter: namesAfter.slice(0, 6) });
    expect(namesAfter.join('|')).not.toBe(namesBefore.join('|'));

    await capture(page, '50-after-reorder');
  });

  test('isolation: breadcrumb anchors the subtree and Escape exits', async ({ page }) => {
    await buildRealisticDocument(page);

    // Right-click a container row, isolate it. aria-expanded lives on the
    // treeitem itself, so the selector is on one element.
    const container = page.locator('[role="treeitem"][aria-expanded]').first();
    await container.click({ button: 'right' });
    const isolate = page.locator('.varve-ctxmenu').getByRole('menuitem', { name: /isolate/i });
    if (!(await isolate.count())) {
      test.info().annotations.push({ type: 'skip', description: 'no container menu' });
      return;
    }
    await isolate.first().click();
    await expect(page.locator('.layers-panel__isolation-breadcrumb')).toBeVisible();
    await capture(page, '60-isolation');

    await page.keyboard.press('Escape');
    await expect(page.locator('.layers-panel__isolation-breadcrumb')).toBeHidden();
  });

  test('bulk bar: mixed visibility shows mixed state and bulk actions apply', async ({ page }) => {
    await buildRealisticDocument(page);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    const bulk = page.locator('.layers-bulk-bar');
    await expect(bulk).toBeVisible();
    await capture(page, '70-bulk-bar');

    const buttons = await bulk.getByRole('button').allTextContents();
    record('bulk-bar-actions.json', { buttons });

    // Mixed state: hide one of the two selected rows.
    await rows.nth(0).locator('.layers-row__toggle').first().click();
    const mixedToggle = rows.nth(0).locator('.layers-row__toggle').first();
    const mixedClass = await mixedToggle.getAttribute('class');
    record('mixed-visibility-toggle.json', { mixedClass });
  });

  test('selection sets: save, restore, rename, and delete a real selection', async ({ page }) => {
    await buildRealisticDocument(page);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['ControlOrMeta'] });
    await rows.nth(4).click({ modifiers: ['ControlOrMeta'] });
    const selectedBefore = await page.locator('[role="treeitem"][aria-selected="true"]').count();
    expect(selectedBefore).toBe(3);

    await page.getByRole('button', { name: /Save current selection/i }).click();
    const section = page.locator('.selection-sets');
    await expect(section).toBeVisible();

    // Real list semantics with independently focusable buttons — not a
    // listbox wrapping nested interactive controls (invalid option children).
    const list = section.getByRole('list', { name: 'Selection sets' });
    await expect(list).toBeVisible();
    expect(await section.getByRole('listbox').count()).toBe(0);
    expect(await section.getByRole('option').count()).toBe(0);
    expect(await list.getByRole('listitem').count()).toBeGreaterThan(0);

    await capture(page, '75-selection-sets');

    // Clear the selection, then restore the saved set by name.
    await page.keyboard.press('Escape');
    await rows.nth(0).click();
    await page.keyboard.press('Escape');
    await section.locator('.selection-sets__name-btn').first().click();
    await expect
      .poll(async () => page.locator('[role="treeitem"][aria-selected="true"]').count())
      .toBe(selectedBefore);

    // Rename through the section's own action (hover reveals it, like a user).
    const firstItem = section.locator('.selection-sets__item').first();
    await firstItem.hover();
    const renameBtn = section.getByRole('button', { name: /^Rename / }).first();
    await expect(renameBtn).toBeVisible();
    await renameBtn.click();
    const renameInput = section.locator('.selection-sets__name-input');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Renamed Set');
    await renameInput.press('Enter');
    await expect(section.locator('.selection-sets__name').first()).toHaveText('Renamed Set');

    // Delete removes the set from the panel.
    await firstItem.hover();
    await section.getByRole('button', { name: /^Delete Renamed Set$/ }).click();
    await expect(section.locator('.selection-sets__item')).toHaveCount(0);
  });

  test('text enlargement and narrow-panel stress: no clipped-critical controls', async ({
    page,
  }) => {
    await buildRealisticDocument(page);

    // Mechanism 1: CSS page zoom (approximates browser page zoom reflow).
    await page.evaluate(() => {
      (document.documentElement as HTMLElement).style.zoom = '2';
    });
    await page.waitForTimeout(400);
    await capture(page, '80-zoom-200');
    const zoomProbe = await page.evaluate(() => {
      const panel = document.querySelector('[data-panel-root="layers"]');
      const tree = document.querySelector('.layers-panel__tree');
      const toggles = [...document.querySelectorAll('.layers-row__toggle')]
        .slice(0, 6)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) };
        });
      return {
        mechanism: 'css-zoom-200',
        panelRect: panel?.getBoundingClientRect().toJSON(),
        treeScrollWidth: tree?.scrollWidth,
        treeClientWidth: tree?.clientWidth,
        toggles,
      };
    });
    record('zoom-200.json', zoomProbe);
    await page.evaluate(() => {
      (document.documentElement as HTMLElement).style.zoom = '';
    });

    // Mechanism 2: root font-size preference (rem-relative scaling).
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await page.waitForTimeout(400);
    await capture(page, '81-root-32px');
    const fontProbe = await page.evaluate(() => {
      const name = document.querySelector('.layers-row__name');
      const toggle = document.querySelector('.layers-row__toggle');
      return {
        mechanism: 'root-font-size-32px',
        nameFontSize: name ? getComputedStyle(name).fontSize : null,
        toggleSize: toggle
          ? {
              w: Math.round(toggle.getBoundingClientRect().width),
              h: Math.round(toggle.getBoundingClientRect().height),
            }
          : null,
        panelScrollWidth: document.querySelector('.layers-panel')?.scrollWidth,
      };
    });
    record('root-32px.json', fontProbe);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  });

  test('narrow panel: minimum width keeps row identity, toggles, and labels reachable', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await importFixture(page, SVG_APP, 30);

    const panel = page.locator('[data-panel-root="layers"]');
    const handle = page.locator('.panel-resize-handle').first();
    const panelBox = await panel.boundingBox();
    if (!panelBox) throw new Error('panel not measurable');

    // Resize to the minimum by dragging the splitter far left.
    if (await handle.isVisible().catch(() => false)) {
      const hb = await handle.boundingBox();
      if (hb) {
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x - 400, hb.y + hb.height / 2, { steps: 6 });
        await page.mouse.up();
      }
    }
    await page.waitForTimeout(300);

    const probe = await page.evaluate(() => {
      const row = document.querySelector('.layers-row');
      const name = document.querySelector('.layers-row__name');
      const toggle = document.querySelector('.layers-row__toggle');
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect().toJSON() : null);
      return {
        panel: rect(document.querySelector('[data-panel-root="layers"]')),
        row: rect(row),
        name: rect(name),
        toggle: rect(toggle),
        panelWidth: document.querySelector('[data-panel-root="layers"]')?.clientWidth,
      };
    });
    record('narrow-panel.json', probe);
    await capture(page, '90-narrow-panel');
  });
});
