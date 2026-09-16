import { writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function startText(page: Page) {
  await navigateToEditor(page);
  // A document can finish its IndexedDB hand-off after the navigation helper
  // returns and briefly put the shell back on Home. Re-open the freshly
  // created card before querying editor-only controls.
  const editorShell = page.locator('.editor-shell');
  const toolbarRoot = page.getByTestId('toolbar');
  if (!(await editorShell.isVisible({ timeout: 1500 }).catch(() => false))) {
    const recentFile = page.getByRole('gridcell').first();
    if (await recentFile.isVisible({ timeout: 1500 }).catch(() => false)) {
      await recentFile.click({ timeout: 10000 });
      await editorShell.waitFor({ state: 'visible', timeout: 60000 });
    }
  }
  await editorShell.waitFor({ state: 'visible', timeout: 60000 });
  await toolbarRoot.waitFor({ state: 'visible', timeout: 60000 });
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  // The responsive floating palette may move Text into its More tools menu
  // when side panels consume the canvas width. Use the always-visible context
  // bar action in that state so this visual test measures the text toolbar
  // instead of assuming every tool is a direct child of the palette.
  const textTool = toolbarRoot.locator('[data-tool="text"]');
  if (await textTool.isVisible({ timeout: 1000 }).catch(() => false)) {
    await textTool.click({ timeout: 15000 });
  } else {
    const contextText = page.getByRole('button', { name: 'Add text', exact: true });
    await contextText.waitFor({ state: 'visible', timeout: 15000 });
    await contextText.click({ timeout: 15000 });
  }
  // Dragging creates an area-text target and enters the same editing state a
  // user gets when they size a text box; a single click only selects the new
  // point-text node and leaves the formatting bar closed.
  await page.mouse.move(bounds.x + 120, bounds.y + 160);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 360, bounds.y + 220);
  await page.mouse.up();
  await page.keyboard.insertText('Typography in context');
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
  // Text creation and text editing are separate states on a cold canvas. If
  // the click created a selected layer without entering editing, use the
  // same explicit action a user sees in Selection actions before measuring
  // the quick formatting bar.
  if (!(await toolbar.isVisible({ timeout: 1000 }).catch(() => false))) {
    const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    await edit.waitFor({ state: 'visible', timeout: 15000 });
    await edit.click({ timeout: 15000 });
  }
  await expect(toolbar).toBeVisible({ timeout: 15000 });
  return toolbar;
}

async function containedInViewport(page: Page, surface: Locator) {
  const bounds = await surface.boundingBox();
  const viewport = page.viewportSize();
  if (!bounds || !viewport) throw new Error('Missing surface or viewport bounds');
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function measureToolbarConsistency(page: Page, toolbar: Locator) {
  const chrome = await page.locator('.floating-toolbar [role="toolbar"]').evaluate((element) => {
    const style = getComputedStyle(element);
    return { gap: style.gap, padding: style.padding };
  });
  const palette = await page.locator('.floating-toolbar__row').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      radius: style.borderRadius,
      shadow: style.boxShadow,
      height: element.getBoundingClientRect().height,
    };
  });
  const measured = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    const controls = Array.from(element.querySelectorAll('input, button')).map((control) => ({
      label: control.getAttribute('aria-label'),
      height: control.getBoundingClientRect().height,
      center: control.getBoundingClientRect().y + control.getBoundingClientRect().height / 2,
    }));
    const fields = Array.from(element.querySelectorAll('input, .varve-select__trigger')).map(
      (field) => getComputedStyle(field).fontSize,
    );
    return {
      gap: style.gap,
      padding: style.padding,
      background: style.backgroundColor,
      radius: style.borderRadius,
      shadow: getComputedStyle(element.parentElement!).boxShadow,
      height: element.getBoundingClientRect().height,
      overflowX: style.overflowX,
      flexWrap: style.flexWrap,
      controls,
      fields,
    };
  });
  await test.info().attach('toolbar-comparison', {
    body: JSON.stringify({ chrome, palette, measured }, null, 2),
    contentType: 'application/json',
  });
  expect(measured.gap).toBe(chrome.gap);
  expect(measured.padding).toBe(chrome.padding);
  expect(measured.background).toBe(palette.background);
  expect(measured.radius).toBe(palette.radius);
  expect(measured.shadow).toBe(palette.shadow);
  expect(measured.height).toBeCloseTo(palette.height, 0);
  expect(measured.overflowX).toBe('auto');
  expect(measured.flexWrap).toBe('nowrap');
  expect(new Set(measured.fields).size).toBe(1);
  const firstControl = measured.controls[0];
  if (!firstControl) throw new Error('Text toolbar has no controls');
  for (const control of measured.controls) {
    expect(control.height, `${control.label} height`).toBe(32);
    expect(control.center, `${control.label} alignment`).toBeCloseTo(firstControl.center, 0);
  }
  return { chrome, palette, measured };
}

async function measureContextFontControls(
  page: Page,
  contextBar: Locator,
  expected: { gap: string; fontFamily: string; fontSize: string },
) {
  const paletteHeight = await page
    .locator('.floating-toolbar__row')
    .evaluate((element) => element.getBoundingClientRect().height);
  const measured = await contextBar.evaluate((element) => {
    const style = getComputedStyle(element);
    const controls = Array.from(element.querySelectorAll('input, button')).map((control) => ({
      label: control.getAttribute('aria-label'),
      width: control.getBoundingClientRect().width,
      height: control.getBoundingClientRect().height,
      center: control.getBoundingClientRect().y + control.getBoundingClientRect().height / 2,
    }));
    return {
      height: element.getBoundingClientRect().height,
      gap: style.gap,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      controls,
      familyWidth: element
        .querySelector<HTMLInputElement>('[aria-label="Font family"]')
        ?.getBoundingClientRect().width,
    };
  });
  await test.info().attach('context-font-controls', {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  });
  expect(measured.height).toBeGreaterThanOrEqual(32);
  expect(measured.height, 'contextual bar height').toBeCloseTo(paletteHeight, 0);
  expect(measured.gap).toBe(expected.gap);
  expect(measured.fontFamily).toBe(expected.fontFamily);
  expect(measured.fontSize).toBe(expected.fontSize);
  expect(measured.familyWidth ?? 0).toBeGreaterThanOrEqual(180);
  const firstControl = measured.controls[0];
  if (!firstControl) throw new Error('Context bar has no text controls');
  for (const control of measured.controls) {
    expect(control.height, `${control.label} height`).toBe(32);
    expect(control.center, `${control.label} alignment`).toBeCloseTo(firstControl.center, 0);
  }
  return measured;
}

for (const dpr of [1, 2, 3]) {
  test.describe(`Font toolbar at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr, contextOptions: { reducedMotion: 'reduce' } });
    test('fits the viewport with readable menus in every theme', async ({ page }, testInfo) => {
      const toolbar = await startText(page);
      // Capture the floating text bar's typography style while it exists; in
      // its non-editing state the context bar must match this text-family
      // rhythm (the palette uses the interface font instead).
      const textBarStyle = await toolbar.evaluate((element) => {
        const style = getComputedStyle(element);
        return { gap: style.gap, fontFamily: style.fontFamily, fontSize: style.fontSize };
      });
      const contextBar = page.getByRole('toolbar', { name: 'Contextual properties' });
      await expect(contextBar).toBeVisible();

      // The document hand-off can briefly return to Home between steps;
      // make sure the editor is mounted before measuring (startText documents
      // the same race).
      if (
        !(await page
          .locator('.editor-shell')
          .isVisible({ timeout: 1500 })
          .catch(() => false))
      ) {
        const recentFile = page.getByRole('gridcell').first();
        if (await recentFile.isVisible({ timeout: 1500 }).catch(() => false)) {
          await recentFile.click({ timeout: 10000 });
        }
      }
      await expect(page.locator('.editor-shell')).toBeVisible({ timeout: 60000 });

      // Measure the context bar's typography while the text node is selected
      // but NOT editing. During an edit session the floating text bar owns
      // formatting and the context bar deliberately points to it instead of
      // rendering a second copy of the same controls (toolbar-system.md).
      await page.keyboard.press('Escape');
      await expect(toolbar).toHaveCount(0);
      await page.getByRole('treeitem', { name: /Typography in context/i }).click();
      for (const theme of ['light', 'dark', 'high-contrast']) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.setViewportSize({ width: 1280, height: 800 });
        await measureContextFontControls(page, contextBar, textBarStyle);
      }

      // Re-enter editing for the floating-bar measurements below.
      await page.getByRole('button', { name: 'Edit text', exact: true }).first().click();
      await expect(toolbar).toBeVisible({ timeout: 15000 });

      for (const theme of ['light', 'dark', 'high-contrast']) {
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        // The global toolbar token is fluid. Check a wide desktop too so the
        // text bar cannot grow taller than the main palette at large widths.
        await page.setViewportSize({ width: 1920, height: 800 });
        await measureToolbarConsistency(page, toolbar);
        await page.setViewportSize({ width: 1280, height: 800 });
        await containedInViewport(page, toolbar);
        const consistency = await measureToolbarConsistency(page, toolbar);
        await writeFile(
          testInfo.outputPath(`${theme}-toolbar-metrics.json`),
          JSON.stringify(consistency, null, 2),
        );
        await testInfo.attach(`${theme}-toolbar-metrics`, {
          body: JSON.stringify(consistency, null, 2),
          contentType: 'application/json',
        });
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-closed.png`),
          animations: 'disabled',
        });
        const family = toolbar.getByRole('combobox', { name: 'Font family', exact: true });
        await family.click();
        const menu = page.getByRole('listbox', { name: 'Font families' });
        await expect(menu.getByRole('option').first()).toBeVisible();
        await containedInViewport(page, menu);
        const variableFaceToggle = page.getByRole('button', {
          name: /Expand IBM Plex Sans Variable faces/i,
        });
        if (await variableFaceToggle.isVisible().catch(() => false)) {
          await variableFaceToggle.click();
          await expect(menu.getByRole('option', { name: /400/ }).first()).toBeVisible();
          await containedInViewport(page, menu);
          await page.screenshot({
            path: testInfo.outputPath(`${theme}-faces-open.png`),
            animations: 'disabled',
          });
          await page
            .getByRole('button', { name: /Collapse IBM Plex Sans Variable faces/i })
            .click();
        }
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-open.png`),
          animations: 'disabled',
        });
        await family.fill('Plex');
        await expect(menu.getByRole('option', { name: /IBM Plex/ })).toBeVisible();
        await page.keyboard.press('ArrowDown');
        const active = await family.getAttribute('aria-activedescendant');
        expect(active).toBeTruthy();
        expect(
          await page.evaluate((id) => Boolean(id && document.getElementById(id)), active),
        ).toBe(true);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(family).toBeFocused();
        // A 640 CSS-pixel viewport exercises the available width of a 1280px
        // window at 200% zoom. It is not native browser zoom certification.
        await page.setViewportSize({ width: 640, height: 640 });
        await containedInViewport(page, toolbar);
        await family.click();
        await expect(menu.getByRole('option').first()).toBeVisible();
        await containedInViewport(page, menu);
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-narrow.png`),
          animations: 'disabled',
        });
        await page.keyboard.press('Escape');
      }
    });
  });
}
