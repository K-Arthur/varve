import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const BEAM_CLASS = 'varve-shine-border--active';

async function capture(locator: Locator, testInfo: TestInfo, name: string) {
  const screenshotPath = testInfo.outputPath(`${name}.png`);
  await locator.screenshot({ path: screenshotPath, animations: 'allow' });
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
}

async function installValidationFixture(page: Page) {
  await navigateToEditor(page);
  await page.evaluate(() => {
    document.querySelectorAll('dialog[open]').forEach((dialog) => {
      (dialog as HTMLDialogElement).close();
    });
  });
  await page.addStyleTag({
    content: `
      #shine-border-validation {
        position: fixed;
        inset: 0;
        z-index: 2147483640;
        box-sizing: border-box;
        overflow: auto;
        display: grid;
        align-content: start;
        gap: 24px;
        padding: 32px;
        background: var(--color-surface-app);
        color: var(--color-text-primary);
      }
      #shine-border-validation .shine-validation-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
      }
      #shine-border-validation .shine-validation-host {
        box-sizing: border-box;
        width: 268px;
        min-height: 72px;
        padding: 16px;
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-lg);
        background: var(--color-surface-raised);
        color: var(--color-text-primary);
      }
      #shine-border-validation .shine-validation-pill {
        width: 150px;
        min-height: 44px;
        border-radius: var(--radius-pill);
      }
      #shine-border-validation .shine-validation-stress {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 8px;
      }
      #shine-border-validation .shine-validation-stress > div {
        box-sizing: border-box;
        min-width: 96px;
        padding: 10px;
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        background: var(--color-surface-raised);
      }
    `,
  });
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'shine-border-validation';
    fixture.dataset.theme = 'light';
    fixture.setAttribute('aria-label', 'Shine border validation fixture');
    fixture.innerHTML = `
      <h1>Shine border validation</h1>
      <div class="shine-validation-row">
        <article
          data-testid="shine-beam"
          class="shine-validation-host varve-shine-border varve-shine-border--beam varve-shine-border--tone-accent varve-shine-border--active"
        >
          <strong>Review ready</strong>
          <button type="button">Apply result</button>
        </article>
        <button
          type="button"
          disabled
          data-testid="shine-native-disabled"
          class="shine-validation-host shine-validation-pill varve-shine-border varve-shine-border--beam varve-shine-border--tone-accent varve-shine-border--active"
        >Native disabled</button>
        <div
          role="button"
          aria-disabled="true"
          data-testid="shine-aria-disabled"
          class="shine-validation-host shine-validation-pill varve-shine-border varve-shine-border--beam varve-shine-border--tone-accent varve-shine-border--active"
        >ARIA disabled</div>
      </div>
      <div class="shine-validation-row">
        <button
          type="button"
          data-testid="shine-subtle"
          class="shine-validation-host shine-validation-pill varve-shine-border varve-shine-border--subtle varve-shine-border--tone-accent varve-shine-border--active"
        >Hover reference</button>
      </div>
      ${[5, 10, 20]
        .map(
          (count) => `
            <section data-stress-count="${count}" aria-label="${count} instance stress reference">
              <h2>${count} idle instances</h2>
              <div class="shine-validation-stress">
                ${Array.from(
                  { length: count },
                  (_, index) =>
                    `<div data-stress-instance class="varve-shine-border varve-shine-border--subtle varve-shine-border--tone-accent varve-shine-border--active">${index + 1}</div>`,
                ).join('')}
              </div>
            </section>
          `,
        )
        .join('')}
    `;
    fixture
      .querySelector('[data-testid="shine-beam"]')
      ?.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).dataset.contextMenuReceived = 'true';
      });
    document.body.append(fixture);
  });
}

async function decorationStyle(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return {
      animationName: style.animationName,
      borderRadius: style.borderRadius,
      borderWidth: style.borderWidth,
      filter: style.filter,
      hostBorderRadius: getComputedStyle(element).borderRadius,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      visibility: style.visibility,
      willChange: style.willChange,
    };
  });
}

test.describe('Shine Border visual and interaction contract', () => {
  test('keeps geometry stable across motion, themes, accessibility modes, and stress', async ({
    page,
  }, testInfo) => {
    await installValidationFixture(page);
    const fixture = page.getByRole('region', { name: 'Shine border validation fixture' });
    const beam = page.getByTestId('shine-beam');
    const apply = beam.getByRole('button', { name: 'Apply result' });
    const disabled = page.getByTestId('shine-native-disabled');
    const ariaDisabled = page.getByTestId('shine-aria-disabled');

    const initialBox = await beam.boundingBox();
    await beam.evaluate(
      (element, activeClass) => element.classList.remove(activeClass),
      BEAM_CLASS,
    );
    await capture(beam, testInfo, 'shine-light-before');

    await beam.evaluate((element, activeClass) => {
      element.classList.add(activeClass);
      getComputedStyle(element, '::after').animationName;
    }, BEAM_CLASS);
    await expect
      .poll(() => beam.evaluate((element) => element.getAnimations({ subtree: true }).length))
      .toBe(1);

    await beam.evaluate((element) => {
      const animation = element.getAnimations({ subtree: true })[0];
      if (!animation) throw new Error('Expected the beam animation');
      animation.pause();
      animation.currentTime = 288;
    });
    await capture(beam, testInfo, 'shine-light-brightest');

    await beam.evaluate((element) => {
      const animation = element.getAnimations({ subtree: true })[0];
      if (!animation) throw new Error('Expected the beam animation');
      animation.currentTime = 800;
    });
    await capture(beam, testInfo, 'shine-light-midpoint');
    expect(await beam.boundingBox()).toEqual(initialBox);
    await beam.click({ button: 'right' });
    await expect(beam).toHaveAttribute('data-context-menu-received', 'true');
    await expect(beam).toHaveClass(/varve-shine-border--active/);
    const normalDecoration = await decorationStyle(beam);
    expect(normalDecoration).toMatchObject({
      animationName: 'varve-shine-border-once',
      borderWidth: '1px',
      filter: 'none',
      opacity: '0.78',
      pointerEvents: 'none',
      willChange: 'auto',
    });
    expect(normalDecoration.borderRadius).toBe(normalDecoration.hostBorderRadius);

    await fixture.evaluate((element) => {
      (element as HTMLElement).dataset.theme = 'dark';
    });
    await capture(beam, testInfo, 'shine-dark-midpoint');
    await fixture.evaluate((element) => {
      (element as HTMLElement).dataset.theme = 'light';
    });
    await beam.evaluate((element) => {
      const animation = element.getAnimations({ subtree: true })[0];
      if (!animation) throw new Error('Expected the beam animation');
      animation.currentTime = 1600;
    });
    expect((await decorationStyle(beam)).opacity).toBe('0.34');
    await capture(beam, testInfo, 'shine-light-terminal');

    await beam.evaluate((element) => {
      const animation = element.getAnimations({ subtree: true })[0];
      if (!animation) throw new Error('Expected the beam animation');
      (
        window as typeof window & { __shineValidationAnimation?: Animation }
      ).__shineValidationAnimation = animation;
      animation.currentTime = 600;
    });
    await apply.focus();
    expect((await decorationStyle(beam)).visibility).toBe('hidden');
    await capture(beam, testInfo, 'shine-focus-ring');
    await apply.evaluate((element) => element.blur());
    expect(
      await beam.evaluate((element) => {
        const current = element.getAnimations({ subtree: true })[0];
        const stored = (window as typeof window & { __shineValidationAnimation?: Animation })
          .__shineValidationAnimation;
        return { sameAnimation: current === stored, currentTime: current?.currentTime ?? null };
      }),
    ).toEqual({ sameAnimation: true, currentTime: 600 });

    expect((await decorationStyle(disabled)).visibility).toBe('hidden');
    expect((await decorationStyle(ariaDisabled)).visibility).toBe('hidden');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await decorationStyle(beam)).toMatchObject({
      animationName: 'none',
      borderWidth: '1px',
      opacity: '0.58',
    });
    expect((await decorationStyle(disabled)).visibility).toBe('hidden');
    expect((await decorationStyle(ariaDisabled)).visibility).toBe('hidden');
    await capture(fixture, testInfo, 'shine-reduced-light');

    await fixture.evaluate((element) => {
      (element as HTMLElement).dataset.theme = 'dark';
    });
    await capture(fixture, testInfo, 'shine-reduced-dark');

    await fixture.evaluate((element) => {
      (element as HTMLElement).dataset.theme = 'high-contrast';
    });
    expect(await decorationStyle(beam)).toMatchObject({
      animationName: 'none',
      borderWidth: '2px',
      opacity: '1',
    });
    expect((await decorationStyle(disabled)).visibility).toBe('hidden');
    expect((await decorationStyle(ariaDisabled)).visibility).toBe('hidden');
    await capture(fixture, testInfo, 'shine-high-contrast');

    await fixture.evaluate((element) => {
      delete (element as HTMLElement).dataset.theme;
    });
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'more' });
    expect(await decorationStyle(beam)).toMatchObject({
      animationName: 'none',
      borderWidth: '2px',
      opacity: '1',
    });

    await fixture.evaluate((element) => {
      (element as HTMLElement).dataset.theme = 'light';
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'no-preference' });
    const stressInstances = page.locator('[data-stress-instance]');
    await expect(stressInstances).toHaveCount(35);
    await expect(page.locator('[data-stress-count="5"] [data-stress-instance]')).toHaveCount(5);
    await expect(page.locator('[data-stress-count="10"] [data-stress-instance]')).toHaveCount(10);
    await expect(page.locator('[data-stress-count="20"] [data-stress-instance]')).toHaveCount(20);
    expect(
      await page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (animation) =>
                (animation as CSSAnimation).animationName === 'varve-shine-border-loop',
            ).length,
      ),
    ).toBe(0);
    await capture(fixture, testInfo, 'shine-stress-20-idle');

    await stressInstances.first().hover();
    const supportsFineHover = await page.evaluate(
      () => matchMedia('(hover: hover) and (pointer: fine)').matches,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  (animation as CSSAnimation).animationName === 'varve-shine-border-loop',
              ).length,
        ),
      )
      .toBe(supportsFineHover ? 1 : 0);
    expect(await decorationStyle(stressInstances.first())).toMatchObject({
      filter: 'none',
      pointerEvents: 'none',
      willChange: 'auto',
    });
    await capture(stressInstances.first(), testInfo, 'shine-stress-hover');

    const boxAfterViewportChange = await beam.boundingBox();
    await page.setViewportSize({ width: 1100, height: 760 });
    const resizedBox = await beam.boundingBox();
    expect({ width: resizedBox?.width, height: resizedBox?.height }).toEqual({
      width: boxAfterViewportChange?.width,
      height: boxAfterViewportChange?.height,
    });
    await page.mouse.wheel(0, 500);
    await expect(beam).toBeAttached();
  });
});
