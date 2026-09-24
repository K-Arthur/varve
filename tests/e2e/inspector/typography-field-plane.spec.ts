/**
 * Typography field-plane regression guard (IA-010 / IA-011).
 *
 * Weight and Style are semantic peers in one two-up field group. Three
 * coupled defects used to break that reading:
 *  - the group's centre alignment dragged the shorter Weight cell down once
 *    the Style cell carried a second line (measured 5.2px);
 *  - the segmented control kept the kit's 24px toolbar track (29.1px in the
 *    field) against the density-aware Inspector field height;
 *  - the contrast readout lived inside the Style cell, so it read as a
 *    subordinate of Font style although it describes the text colour.
 *
 * These assertions fail if any of the three comes back.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const THEMES = ['light', 'dark', 'high-contrast'] as const;
const TWO_UP_RAILS = [320, 640] as const;
const STACKED_RAIL = 240;

function spread(...values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

async function createTextSelection(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  await page.keyboard.press('t');
  await page.mouse.click(bounds.x + 160, bounds.y + 180);
  await page.keyboard.type('Heading copy');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

async function setRail(page: Page, width: number): Promise<void> {
  await page.locator('.editor-shell').evaluate((shell, nextWidth) => {
    (shell as HTMLElement).style.setProperty('--inspector-width', `${nextWidth}px`);
  }, width);
  await expect(page.locator('.editor__inspector-panel')).toHaveCSS('width', `${width}px`);
  await page.waitForTimeout(80);
}

test('Weight and Style share one label and control plane across rails and themes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await navigateToEditor(page);
  await createTextSelection(page);

  const group = page.locator('.typography__paired-fields').first();
  await group.scrollIntoViewIfNeeded();
  const weight = group.getByRole('combobox', { name: 'Font weight' });
  const style = group.getByRole('radiogroup', { name: 'Font style' });
  const weightLabel = group.locator('.insp-field__label', { hasText: /^Weight$/ });
  const styleLabel = group.locator('.insp-field__label', { hasText: /^Style$/ });

  for (const theme of THEMES) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    for (const rail of TWO_UP_RAILS) {
      await setRail(page, rail);
      await group.scrollIntoViewIfNeeded();
      const [weightBox, styleBox, weightLabelBox, styleLabelBox] = await Promise.all([
        weight.boundingBox(),
        style.boundingBox(),
        weightLabel.boundingBox(),
        styleLabel.boundingBox(),
      ]);
      if (!weightBox || !styleBox || !weightLabelBox || !styleLabelBox) {
        throw new Error(`Missing geometry at ${theme}/${rail}`);
      }
      if (rail === 320) {
        await page.locator('.editor__inspector-panel').screenshot({
          path: testInfo.outputPath(`typography-${theme}-320.png`),
        });
      }
      // The two cells are peers: same top, same control height, same bottom,
      // and their labels start on the same line.
      expect(
        spread(weightLabelBox.y, styleLabelBox.y),
        `${theme}/${rail} label plane`,
      ).toBeLessThanOrEqual(1);
      expect(spread(weightBox.y, styleBox.y), `${theme}/${rail} control top`).toBeLessThanOrEqual(
        1,
      );
      expect(
        spread(weightBox.height, styleBox.height),
        `${theme}/${rail} control height`,
      ).toBeLessThanOrEqual(1);
      expect(
        spread(weightBox.y + weightBox.height, styleBox.y + styleBox.height),
        `${theme}/${rail} control bottom`,
      ).toBeLessThanOrEqual(1);
    }
  }

  // Below the group's auto-fit minimum the pair stacks; the shared plane
  // becomes a shared left edge with equal control heights.
  await setRail(page, STACKED_RAIL);
  await group.scrollIntoViewIfNeeded();
  const [stackedWeight, stackedStyle] = await Promise.all([
    weight.boundingBox(),
    style.boundingBox(),
  ]);
  if (!stackedWeight || !stackedStyle) throw new Error('Missing stacked geometry');
  expect(Math.abs(stackedWeight.x - stackedStyle.x), 'stacked left edge').toBeLessThanOrEqual(1);
  expect(Math.abs(stackedWeight.width - stackedStyle.width), 'stacked width').toBeLessThanOrEqual(
    1,
  );
  expect(
    spread(stackedWeight.height, stackedStyle.height),
    'stacked control height',
  ).toBeLessThanOrEqual(1);
});

test('a field-embedded radiogroup keeps its arrow-key model after the field-plane change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await navigateToEditor(page);
  await createTextSelection(page);

  // Horizontal align is a four-option field-embedded radiogroup; every option
  // is available for any text node, so the roving-tabindex contract can be
  // exercised without depending on a font shipping an italic face.
  const align = page
    .locator('.typography-controls')
    .getByRole('radiogroup', { name: 'Horizontal align' });
  await align.scrollIntoViewIfNeeded();
  const left = align.getByRole('radio', { name: 'Align left' });
  const center = align.getByRole('radio', { name: 'Align center' });
  await left.focus();
  await page.keyboard.press('ArrowRight');
  await expect(center).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(left).toBeChecked();
});

test('the contrast readout is attached to the Colour row, not the Style cell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await navigateToEditor(page);
  await createTextSelection(page);

  const styleField = page
    .locator('.typography-controls .insp-field')
    .filter({ has: page.locator('.insp-field__label', { hasText: /^Style$/ }) });
  const colourField = page
    .locator('.typography-controls .insp-field')
    .filter({ has: page.locator('.insp-field__label', { hasText: /^Colour$/ }) });
  await expect(styleField).toHaveCount(1);
  await expect(colourField).toHaveCount(1);

  await expect(styleField.locator('.contrast-indicator')).toHaveCount(0);
  const chip = colourField.locator('.contrast-indicator');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute('role', 'status');
  await expect(chip).toHaveAccessibleName(/^Contrast /);

  // The readout wraps to the Colour control's own line and never overflows it
  // or the panel rail at any supported width.
  for (const rail of [STACKED_RAIL, ...TWO_UP_RAILS]) {
    await setRail(page, rail);
    await colourField.scrollIntoViewIfNeeded();
    const [controlBox, chipBox] = await Promise.all([
      colourField.locator('.insp-field__control').boundingBox(),
      chip.boundingBox(),
    ]);
    if (!controlBox || !chipBox) throw new Error(`Missing colour-row geometry at ${rail}`);
    expect(chipBox.x, `chip start at ${rail}`).toBeGreaterThanOrEqual(controlBox.x - 1);
    expect(chipBox.x + chipBox.width, `chip end at ${rail}`).toBeLessThanOrEqual(
      controlBox.x + controlBox.width + 1,
    );
    expect(chipBox.y + chipBox.height, `chip bottom at ${rail}`).toBeLessThanOrEqual(
      controlBox.y + controlBox.height + 1,
    );
  }
});
