/**
 * Field-arrangement regression guards (2026-09-19 follow-up).
 *
 * Two defects this file pins:
 *  - The Snap targets column rendered centre-aligned because the base
 *    `.insp-field__control` rule (declared later in the stylesheet) beat the
 *    `--column` modifier at equal specificity; the shorter switch row was
 *    indented, implying a hierarchy that does not exist.
 *  - Position & Size reserved two invisible action slots, capped every value
 *    at a 9ch rail, stranded the proportion lock at the row's far edge and
 *    gave the orientation swap a fluid 27x39px box. The new arrangement is
 *    two equal value columns with a compact action gutter between W and H.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const RAILS = [240, 320, 640] as const;

function spread(...values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

async function setRail(page: Page, width: number): Promise<void> {
  await page.locator('.editor-shell').evaluate((shell, nextWidth) => {
    (shell as HTMLElement).style.setProperty('--inspector-width', `${nextWidth}px`);
  }, width);
  await expect(page.locator('.editor__inspector-panel')).toHaveCSS('width', `${width}px`);
  await page.waitForTimeout(80);
}

async function openSection(page: Page, title: string): Promise<void> {
  const trigger = page.locator('.insp-disclosure__trigger', { hasText: title }).first();
  await trigger.scrollIntoViewIfNeeded();
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
    await page.waitForTimeout(150);
  }
}

async function createFrame(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  await page.keyboard.press('f');
  await page.mouse.move(bounds.x + 140, bounds.y + 140);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 420, bounds.y + 360);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

test('Snap targets keeps both switches on one left edge', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigateToEditor(page);
  await openSection(page, 'Isometric Grid');

  const field = page
    .locator('.insp-field')
    .filter({ has: page.locator('.insp-field__label', { hasText: /^Snap targets$/ }) });
  await expect(field).toHaveCount(1);
  const switches = field.locator('.varve-switch');
  await expect(switches).toHaveCount(2);

  // The control column is a left-aligned stack, not a centred one.
  const control = field.locator('.insp-field__control');
  await expect(control).toHaveCSS('flex-direction', 'column');
  await expect(control).toHaveCSS('align-items', 'flex-start');

  for (const rail of RAILS) {
    await setRail(page, rail);
    await field.scrollIntoViewIfNeeded();
    const [first, second] = await Promise.all([
      switches.nth(0).boundingBox(),
      switches.nth(1).boundingBox(),
    ]);
    if (!first || !second) throw new Error(`Missing switch geometry at ${rail}`);
    expect(Math.abs(first.x - second.x), `switch left edge at ${rail}`).toBeLessThanOrEqual(1);
    const [firstTrack, secondTrack] = await Promise.all([
      switches.nth(0).locator('.varve-switch__track').boundingBox(),
      switches.nth(1).locator('.varve-switch__track').boundingBox(),
    ]);
    if (!firstTrack || !secondTrack) throw new Error(`Missing track geometry at ${rail}`);
    expect(
      Math.abs(firstTrack.x - secondTrack.x),
      `track left edge at ${rail}`,
    ).toBeLessThanOrEqual(1);
  }
});

test('frame Position & Size uses equal value columns with a centre action gutter', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigateToEditor(page);
  await createFrame(page);
  await openSection(page, 'Position & Size');

  const position = page.locator('.editor-inspector .insp-field-group--position').first();
  const size = page.locator('.editor-inspector .insp-field-group--size').first();
  const rotation = page.locator('.editor-inspector .insp-field-group--rotation').first();
  const fieldInput = (section: ReturnType<Page['locator']>, label: string) =>
    section
      .locator('.insp-field')
      .filter({ has: page.locator('.insp-field__label', { hasText: new RegExp(`^${label}$`) }) })
      .locator('input');

  for (const rail of RAILS) {
    await setRail(page, rail);
    await position.scrollIntoViewIfNeeded();
    if (rail === 320) {
      await page.locator('.editor__inspector-panel').screenshot({
        path: testInfo.outputPath('position-and-size-320.png'),
      });
    }
    const [x, y, w, h, r, gutter, flips] = await Promise.all([
      fieldInput(position, 'X').boundingBox(),
      fieldInput(position, 'Y').boundingBox(),
      fieldInput(size, 'W').boundingBox(),
      fieldInput(size, 'H').boundingBox(),
      fieldInput(rotation, 'R').boundingBox(),
      size.locator('.insp-size-actions').boundingBox(),
      rotation.locator('.insp-flip-group').boundingBox(),
    ]);
    if (!x || !y || !w || !h || !r || !gutter || !flips) {
      throw new Error(`Missing Position & Size geometry at ${rail}`);
    }

    // X/Y are equal halves; W/H are equal halves around the gutter.
    expect(spread(x.width, y.width), `X/Y width at ${rail}`).toBeLessThanOrEqual(1);
    expect(spread(w.width, h.width), `W/H width at ${rail}`).toBeLessThanOrEqual(1);
    expect(spread(x.y, y.y), `X/Y top at ${rail}`).toBeLessThanOrEqual(1);
    expect(spread(w.y, h.y), `W/H top at ${rail}`).toBeLessThanOrEqual(1);
    expect(x.x, `X before Y at ${rail}`).toBeLessThan(y.x);

    // The action gutter sits between W and H and never overlaps them.
    expect(gutter.x, `gutter after W at ${rail}`).toBeGreaterThanOrEqual(w.x + w.width - 1);
    expect(gutter.x + gutter.width, `gutter before H at ${rail}`).toBeLessThanOrEqual(h.x + 1);

    // The orientation swap (frames) lives in that gutter at field height.
    const swap = size.locator('.insp-orientation-btn');
    await expect(swap).toHaveCount(1);
    const swapBox = await swap.boundingBox();
    if (!swapBox) throw new Error(`Missing orientation button at ${rail}`);
    expect(Math.abs(swapBox.height - 32), `swap height at ${rail}`).toBeLessThanOrEqual(1);
    expect(swapBox.x).toBeGreaterThanOrEqual(gutter.x - 1);
    expect(swapBox.x + swapBox.width).toBeLessThanOrEqual(gutter.x + gutter.width + 1);

    // Rotation shares the left reading edge with X; the transform group ends
    // on the same edge as Y and H and never exceeds the field height.
    expect(Math.abs(r.x - x.x), `R/X left edge at ${rail}`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(flips.x + flips.width - (y.x + y.width)),
      `flips right edge at ${rail}`,
    ).toBeLessThanOrEqual(1);
    expect(flips.height, `flip group height at ${rail}`).toBeLessThanOrEqual(32);
    expect(Math.abs(r.height - 32), `R height at ${rail}`).toBeLessThanOrEqual(1);

    const overflow = await page.evaluate(() => {
      const groups = [
        document.querySelector('.insp-field-group--position'),
        document.querySelector('.insp-field-group--size'),
        document.querySelector('.insp-field-group--rotation'),
      ];
      return groups.map((group) => (group ? group.scrollWidth - group.clientWidth : 0));
    });
    expect(Math.max(...overflow), `row overflow at ${rail}`).toBeLessThanOrEqual(1);
  }
});

test('panel fields are sized by their row, not by their value range', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigateToEditor(page);
  await createFrame(page);
  await openSection(page, 'Position & Size');
  await openSection(page, 'Appearance');
  await openSection(page, 'Stack / Grid');

  const boxOf = async (locator: ReturnType<Page['locator']>) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Missing control geometry');
    return box;
  };

  // Single-column rows all fill the same control column, whatever the value
  // range: the retired compact rail rendered Opacity at 39px beside a 239px
  // Blend mode field in the same stack. Scope to the Appearance section —
  // the Fill paint row also carries an "Opacity (%)" spinbutton.
  const appearance = page
    .locator('.insp-disclosure')
    .filter({ has: page.locator('.insp-disclosure__trigger', { hasText: /^Appearance$/ }) });
  const opacity = await boxOf(appearance.getByRole('spinbutton', { name: 'Opacity (%)' }));
  const blend = await boxOf(appearance.getByRole('combobox', { name: 'Blend mode' }));
  const mode = await boxOf(page.getByRole('combobox', { name: 'Layout mode' }));
  expect(spread(opacity.width, blend.width), 'Opacity/Blend width').toBeLessThanOrEqual(1);
  expect(spread(blend.width, mode.width), 'Blend/Mode width').toBeLessThanOrEqual(1);

  // Pair cells are equal across the sizing block.
  const pairWidths = await Promise.all(
    ['Min W', 'Max W', 'Min H', 'Max H'].map(
      async (label) =>
        (await boxOf(page.getByRole('spinbutton', { name: new RegExp(`^${label}`) }))).width,
    ),
  );
  expect(spread(...pairWidths), 'Min/Max pair widths').toBeLessThanOrEqual(3);

  // Position, size, and rotation share one column grid: X/W/R and Y/H match.
  const inputWidth = async (group: string, label: string) =>
    (
      await boxOf(
        page
          .locator(`.editor-inspector .insp-field-group--${group}`)
          .locator('.insp-field')
          .filter({
            has: page.locator('.insp-field__label', { hasText: new RegExp(`^${label}$`) }),
          })
          .locator('input'),
      )
    ).width;
  const [x, w, r, y, h] = await Promise.all([
    inputWidth('position', 'X'),
    inputWidth('size', 'W'),
    inputWidth('rotation', 'R'),
    inputWidth('position', 'Y'),
    inputWidth('size', 'H'),
  ]);
  expect(spread(x, w, r), 'X/W/R width').toBeLessThanOrEqual(1);
  expect(spread(y, h), 'Y/H width').toBeLessThanOrEqual(1);
});

test('non-frame size row keeps W/H equal without an orientation button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await navigateToEditor(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  await page.keyboard.press('r');
  await page.mouse.move(bounds.x + 140, bounds.y + 140);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 360, bounds.y + 300);
  await page.mouse.up();
  await page.waitForTimeout(250);
  await openSection(page, 'Position & Size');

  const size = page.locator('.insp-field-group--size');
  await expect(size.locator('.insp-orientation-btn')).toHaveCount(0);
  await expect(size.locator('.insp-proportion-lock')).toHaveCount(1);
  for (const rail of RAILS) {
    await setRail(page, rail);
    await size.scrollIntoViewIfNeeded();
    const fields = size.locator('.insp-field');
    const [w, h] = await Promise.all([
      fields.nth(0).locator('input').boundingBox(),
      fields.nth(1).locator('input').boundingBox(),
    ]);
    if (!w || !h) throw new Error(`Missing rectangle size geometry at ${rail}`);
    expect(spread(w.width, h.width), `W/H width at ${rail}`).toBeLessThanOrEqual(1);
    expect(spread(w.y, h.y), `W/H top at ${rail}`).toBeLessThanOrEqual(1);
  }
});
