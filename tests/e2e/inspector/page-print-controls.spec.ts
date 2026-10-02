import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function chooseTheme(page: Page, theme: 'light' | 'dark' | 'high-contrast') {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const settings = page.locator('dialog.varve-dialog--settings[open]');
  await settings.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Theme', exact: true }).click();
  const label = theme === 'high-contrast' ? 'High Contrast' : theme === 'dark' ? 'Dark' : 'Light';
  await page.getByRole('option', { name: label, exact: true }).click();
  await settings.getByRole('button', { name: /close/i }).first().click();
}

/** All three drawers retain real pointer targets above the palette. */
async function expectDrawerLaunchersClearPalette(page: Page) {
  const launchers = page.locator('.editor__fab:visible');
  await expect(launchers).toHaveCount(3);
  await expect
    .poll(async () =>
      launchers.evaluateAll((elements) => {
        const palette = document.querySelector<HTMLElement>(
          '.floating-toolbar[data-testid="toolbar"]',
        );
        if (!palette) return ['missing palette'];
        const paletteRect = palette.getBoundingClientRect();
        const failures: string[] = [];
        for (const element of elements) {
          const rect = element.getBoundingClientRect();
          const label = element.getAttribute('aria-label') ?? element.className;
          if (rect.bottom >= paletteRect.top) failures.push(`${label}: overlaps palette`);
          // Sample the centre and inner edge points within each circular hit
          // target. A visible border box alone did not expose the regression.
          for (const [x, y] of [
            [0.5, 0.5],
            [0.2, 0.5],
            [0.8, 0.5],
            [0.5, 0.2],
            [0.5, 0.8],
          ] as const) {
            const hit = document.elementFromPoint(
              rect.x + rect.width * x,
              rect.y + rect.height * y,
            );
            if (!hit || !element.contains(hit)) failures.push(`${label}: blocked at ${x},${y}`);
          }
        }
        return failures;
      }),
    )
    .toEqual([]);
  for (const launcher of await launchers.all()) await expect(launcher).toBeInViewport({ ratio: 1 });
}

async function controlMetrics(control: Locator) {
  return control.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:fixed;visibility:hidden;color:var(--color-text-primary);border:1px solid var(--color-border-subtle);block-size:var(--component-compact-height);outline:2px solid var(--color-interactive-focus-ring)';
    document.body.appendChild(probe);
    const expected = getComputedStyle(probe);
    const metrics = {
      color: style.color,
      expectedColor: expected.color,
      borderColor: style.borderTopColor,
      expectedBorderColor: expected.borderTopColor,
      borderStyle: style.borderTopStyle,
      height: element.getBoundingClientRect().height,
      minimumHeight: probe.getBoundingClientRect().height,
      outlineColor: style.outlineColor,
      expectedOutlineColor: expected.outlineColor,
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
    };
    probe.remove();
    return metrics;
  });
}

for (const { theme, width } of [
  { theme: 'light', width: 1440 },
  { theme: 'dark', width: 390 },
  { theme: 'high-contrast', width: 390 },
] as const) {
  test(`Print orientation action uses readable tokens and swaps page geometry in ${theme} at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await navigateToEditor(page);
    await chooseTheme(page, theme);
    await page.getByRole('radio', { name: 'Print workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Add publishing page', exact: true }).click();
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('q');
    await expect(page.getByRole('button', { name: 'Page Print', exact: true })).toBeVisible();
    await page.setViewportSize({ width, height: 800 });
    if (width < 900) {
      await expectDrawerLaunchersClearPalette(page);
      await page.locator('.editor__fab--inspector').click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const section = page.locator('.page-print');
    const swap = section.getByRole('button', { name: 'Swap orientation', exact: true });
    await swap.scrollIntoViewIfNeeded();
    await expect(swap).toBeInViewport({ ratio: 1 });
    const labelMetrics = await section.locator('.insp-field__label').evaluateAll((labels) =>
      labels.map((label) => ({
        text: label.textContent,
        overflowX: label.scrollWidth - label.clientWidth,
        overflowY: label.scrollHeight - label.clientHeight,
      })),
    );
    expect(labelMetrics.length).toBeGreaterThan(0);
    expect(labelMetrics.filter((label) => label.overflowX > 1 || label.overflowY > 1)).toEqual([]);
    const metrics = await controlMetrics(swap);
    expect(metrics.color).toBe(metrics.expectedColor);
    expect(metrics.borderColor).toBe(metrics.expectedBorderColor);
    expect(metrics.borderStyle).toBe('solid');
    expect(metrics.height).toBeGreaterThanOrEqual(metrics.minimumHeight);
    await swap.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(swap).toBeFocused();
    const focused = await controlMetrics(swap);
    expect(focused.outlineStyle).toBe('solid');
    expect(focused.outlineWidth).toBe('2px');
    expect(focused.outlineColor).toBe(focused.expectedOutlineColor);
    await page.screenshot({ path: testInfo.outputPath(`print-orientation-${theme}-${width}.png`) });

    const pageWidth = section.getByRole('spinbutton', { name: /^Page width/ });
    const pageHeight = section.getByRole('spinbutton', { name: /^Page height/ });
    const originalWidth = await pageWidth.inputValue();
    const originalHeight = await pageHeight.inputValue();
    expect(originalWidth).not.toBe(originalHeight);
    await swap.press('Enter');
    await expect(pageWidth).toHaveValue(originalHeight);
    await expect(pageHeight).toHaveValue(originalWidth);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(pageWidth).toHaveValue(originalWidth);
    await expect(pageHeight).toHaveValue(originalHeight);
    await expect(swap).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(pageWidth).toHaveValue(originalHeight);
    await expect(pageHeight).toHaveValue(originalWidth);
    await expect(swap).toBeFocused();
  });
}

for (const { workspace, height } of [
  { workspace: 'Draw', height: 700 },
  { workspace: 'Motion', height: 800 },
] as const) {
  test(`Compact ${workspace} launchers clear workspace controls in High Contrast`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height });
    await navigateToEditor(page);
    await chooseTheme(page, 'high-contrast');
    await page.getByRole('radio', { name: `${workspace} workspace`, exact: true }).click();
    await page.locator('canvas.editor-canvas__content-layer').focus();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height });
    if (workspace === 'Draw') {
      await expect(page.locator('.floating-toolbar__drawing')).toBeVisible();
      await expect(page.getByRole('slider', { name: 'Brush size', exact: true })).toBeVisible();
    } else {
      await expect(page.locator('.timeline-panel')).toBeVisible();
    }
    await expectDrawerLaunchersClearPalette(page);
    await page.screenshot({
      path: testInfo.outputPath(`launcher-clearance-${workspace.toLowerCase()}-390.png`),
    });
    await page.locator('.editor__fab--inspector').click();
    await expect(page.locator('#editor-inspector-panel')).toHaveAttribute('data-visible', 'true');
  });
}
