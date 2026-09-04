import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@wdio/globals';

const artifactDirectory = resolve('artifacts/desktop/shine-border');

async function openEditor(): Promise<void> {
  const homeButton = await browser.$('.editor-menubar__home');
  if (await homeButton.isDisplayed().catch(() => false)) await homeButton.click();

  const newButton = await browser.$('[data-testid="new-file-button"]');
  await newButton.waitForDisplayed({ timeout: 30000 });
  await newButton.click();
  const createButton = await browser.$('[data-testid="create-design-button"]');
  await createButton.waitForDisplayed({ timeout: 10000 });
  await createButton.click();
  await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
}

describe('Tauri WebKitGTK: Shine Border', () => {
  it('renders the enhanced ring or safe fallback without changing interaction geometry', async () => {
    await openEditor();
    const state = await browser.tauri.execute(() => {
      document.documentElement.dataset.theme = 'light';
      const fixture = document.createElement('section');
      fixture.id = 'native-shine-validation';
      fixture.setAttribute('aria-label', 'Native shine validation');
      fixture.style.cssText = [
        'position:fixed',
        'inset:20px',
        'z-index:2147483640',
        'display:grid',
        'align-content:start',
        'gap:18px',
        'padding:24px',
        'background:var(--color-surface-app)',
        'color:var(--color-text-primary)',
      ].join(';');
      fixture.innerHTML = `
        <article
          data-testid="native-shine-light"
          class="varve-shine-border varve-shine-border--beam varve-shine-border--tone-accent"
          style="width:280px;padding:16px;border:1px solid var(--color-border-subtle);border-radius:var(--radius-lg);background:var(--color-surface-raised)"
        ><strong>Light review ready</strong><button type="button">Apply result</button></article>
        <div data-theme="dark">
          <article
            data-testid="native-shine-dark"
            class="varve-shine-border varve-shine-border--beam varve-shine-border--tone-success varve-shine-border--active"
            style="width:280px;padding:16px;border:1px solid var(--color-border-subtle);border-radius:var(--radius-lg);background:var(--color-surface-raised);color:var(--color-text-primary)"
          >Dark export complete</article>
        </div>
        <div data-theme="high-contrast">
          <article
            data-testid="native-shine-high-contrast"
            class="varve-shine-border varve-shine-border--beam varve-shine-border--tone-accent varve-shine-border--active"
            style="width:280px;padding:16px;border:1px solid var(--color-border-subtle);border-radius:var(--radius-lg);background:var(--color-surface-raised);color:var(--color-text-primary)"
          >High-contrast review</article>
        </div>
      `;
      document.body.append(fixture);

      const light = fixture.querySelector<HTMLElement>('[data-testid="native-shine-light"]');
      if (!light) throw new Error('Native shine fixture did not mount');
      const before = light.getBoundingClientRect();
      light.classList.add('varve-shine-border--active');
      getComputedStyle(light, '::after').animationName;
      const after = light.getBoundingClientRect();
      const animation = light.getAnimations({ subtree: true })[0];
      animation?.pause();
      if (animation) {
        animation.currentTime = 288;
        (window as typeof window & { __nativeShineAnimation?: Animation }).__nativeShineAnimation =
          animation;
      }

      const decoration = getComputedStyle(light, '::after');
      const highContrastHost = fixture.querySelector<HTMLElement>(
        '[data-testid="native-shine-high-contrast"]',
      );
      if (!highContrastHost) throw new Error('Native high-contrast fixture did not mount');
      const highContrast = getComputedStyle(highContrastHost, '::after');
      const conicSupported = CSS.supports(
        'background',
        'conic-gradient(from 0deg, transparent, currentColor)',
      );
      const maskSupported =
        CSS.supports('mask-composite', 'exclude') || CSS.supports('-webkit-mask-composite', 'xor');
      return {
        enhanced: conicSupported && maskSupported,
        dimensions: {
          before: { width: before.width, height: before.height },
          after: { width: after.width, height: after.height },
        },
        decoration: {
          animationName: decoration.animationName,
          iterationCount: decoration.animationIterationCount,
          pointerEvents: decoration.pointerEvents,
          borderRadius: decoration.borderRadius,
          hostBorderRadius: getComputedStyle(light).borderRadius,
          borderColor: decoration.borderColor,
        },
        highContrast: {
          animationName: highContrast.animationName,
          borderWidth: highContrast.borderWidth,
          opacity: highContrast.opacity,
        },
      };
    });

    expect(state.dimensions.after).toEqual(state.dimensions.before);
    expect(state.decoration.pointerEvents).toBe('none');
    expect(state.decoration.borderRadius).toBe(state.decoration.hostBorderRadius);
    if (state.enhanced) {
      expect(state.decoration.animationName).toBe('varve-shine-border-once');
      expect(state.decoration.iterationCount).toBe('1');
    } else {
      expect(state.decoration.animationName).toBe('none');
      expect(state.decoration.borderColor).not.toBe('rgba(0, 0, 0, 0)');
    }
    expect(state.highContrast).toEqual({
      animationName: 'none',
      borderWidth: '2px',
      opacity: '1',
    });

    mkdirSync(artifactDirectory, { recursive: true });
    await browser.saveScreenshot(resolve(artifactDirectory, 'webkitgtk-midpoint.png'));

    const focusState = await browser.tauri.execute(() => {
      const light = document.querySelector<HTMLElement>('[data-testid="native-shine-light"]');
      const button = light?.querySelector<HTMLButtonElement>('button');
      if (!light || !button) throw new Error('Native focus fixture is missing');
      const animationBefore = (window as typeof window & { __nativeShineAnimation?: Animation })
        .__nativeShineAnimation;
      button.focus();
      const animationAfter = light.getAnimations({ subtree: true })[0];
      return {
        activeElement: document.activeElement === button,
        sameAnimation: animationBefore === animationAfter,
        currentTime: animationAfter?.currentTime ?? null,
      };
    });
    expect(focusState.activeElement).toBe(true);
    if (state.enhanced) {
      expect(focusState.sameAnimation).toBe(true);
      expect(focusState.currentTime).toBe(288);
    } else {
      expect(focusState.currentTime).toBeNull();
    }
    await browser.saveScreenshot(resolve(artifactDirectory, 'webkitgtk-focus-within.png'));
  });
});
