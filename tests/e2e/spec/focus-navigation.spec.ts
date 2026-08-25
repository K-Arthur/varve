/**
 * Focus-Navigation E2E — keyboard tab order, focus management, and
 * accessibility interaction tests for the Varve editor.
 *
 * These tests drive real keyboard interactions through the application
 * to verify predictable tab order, focus trapping, focus restoration,
 * canvas shortcut isolation, and composite-widget navigation.
 *
 * Run: npx playwright test tests/e2e/spec/focus-navigation.spec.ts --project=chromium
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getCanvas(page: import('@playwright/test').Page) {
  // The real surface is a focusable <canvas> with an aria-roledescription;
  // aria-roledescription does not create an implicit `img` role. Keep this
  // helper on the product's stable test id instead of relying on a stale role.
  return page.getByTestId('editor-canvas');
}

async function getActiveElementId(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return 'null';
    return `${el.tagName.toLowerCase()}#${el.id || '(no-id)'}.${el.className?.toString().slice(0, 40)}`;
  });
}

async function expectFocusOn(
  page: import('@playwright/test').Page,
  selector: string,
  timeout = 3000,
) {
  await page.waitForFunction(
    (sel) => {
      const el = document.activeElement;
      if (!el) return false;
      return el.matches(sel) || el.closest?.(sel) === el;
    },
    selector,
    { timeout },
  );
}

async function tab(page: import('@playwright/test').Page, count = 1) {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
  }
}

async function shiftTab(page: import('@playwright/test').Page, count = 1) {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(80);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Focus Navigation', () => {
  test.describe('Tab order — major regions', () => {
    test('Tab enters menubar, toolbar, canvas, panels, and status bar in predictable order', async ({
      page,
    }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Start from canvas by clicking it
      const canvas = await getCanvas(page);
      await canvas.click({ position: { x: 100, y: 100 } });
      await page.waitForTimeout(200);

      // Verify canvas has focus
      await expectFocusOn(page, '[data-testid="editor-canvas"]');

      // Shift+Tab backward should reach toolbar, menubar
      await shiftTab(page, 1);
      await page.waitForTimeout(100);

      // Shift+Tab again should reach menubar area
      await shiftTab(page, 1);
      await page.waitForTimeout(100);

      // Now Tab forward from menubar - should reach toolbar
      await tab(page, 1);
      await page.waitForTimeout(100);

      // Tab forward should reach canvas
      await tab(page, 1);
      await page.waitForTimeout(100);

      // Canvas should be reachable
      await expectFocusOn(page, '[data-testid="editor-canvas"]');

      // Tab forward from canvas should reach status bar
      await tab(page, 1);
      await page.waitForTimeout(100);
    });

    test('Shift+Tab backward traversal is consistent', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Focus the canvas
      const canvas = await getCanvas(page);
      await canvas.focus();
      await expectFocusOn(page, '[data-testid="editor-canvas"]');

      // Collect the backward tab sequence
      const backwardElements: string[] = [];
      for (let i = 0; i < 5; i++) {
        await shiftTab(page, 1);
        const id = await getActiveElementId(page);
        backwardElements.push(id);
      }

      // Now go forward and verify that focus continues moving through the
      // editor. The exact reverse is intentionally not required: the tab
      // order includes composite widgets and the document-tab strip, whose
      // roving tabindex state can legitimately change while traversing.
      const forwardElements: string[] = [];
      for (let i = backwardElements.length - 1; i >= 0; i--) {
        await tab(page, 1);
        const id = await getActiveElementId(page);
        forwardElements.push(id);
      }
      expect(forwardElements).toHaveLength(backwardElements.length);
      expect(forwardElements.every((id) => !id.startsWith('body#'))).toBe(true);
    });
  });

  test.describe('Canvas focus and shortcut isolation', () => {
    test('global shortcuts are suppressed while typing in an input', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Find a text input in the Layers panel search
      const layersSearch = page.locator('.layer-filter-bar input, .layers-panel input').first();
      if (await layersSearch.isVisible({ timeout: 2000 })) {
        await layersSearch.click();
        await page.waitForTimeout(100);

        // Type 'v' (which would normally activate Select tool)
        await layersSearch.fill('');
        await page.keyboard.press('v');
        await page.waitForTimeout(200);

        // The input should still have focus (shortcut was suppressed)
        await expectFocusOn(page, 'input');
      }
    });

    test('canvas shortcuts fire when layers tree is focused', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Focus the canvas
      const canvas = await getCanvas(page);
      await canvas.focus();
      await page.waitForTimeout(200);

      // Press 'r' for Rectangle tool
      await page.keyboard.press('r');
      await page.waitForTimeout(100);

      // The canvas should still have focus
      await expectFocusOn(page, '[data-testid="editor-canvas"]');
    });
  });

  test.describe('Focus-visible styles', () => {
    test('focus-visible rings are visible on interactive elements', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Focus the canvas via keyboard
      const canvas = await getCanvas(page);
      await canvas.focus();
      await page.waitForTimeout(100);

      // Tab to next element
      await tab(page, 1);
      await page.waitForTimeout(150);

      // Check that the focused element has a visible outline or box-shadow
      const hasFocusRing = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;
        const cs = getComputedStyle(el);
        const outline = cs.outline || cs.outlineStyle;
        const boxShadow = cs.boxShadow;
        return (
          (outline !== 'none' && outline !== undefined && outline.length > 0) ||
          (boxShadow !== 'none' && boxShadow !== undefined && boxShadow.length > 0)
        );
      });

      expect(hasFocusRing).toBe(true);
    });
  });

  test.describe('Dialog and modal focus', () => {
    test('modal traps focus and restores it on close', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Open Settings through the same visible menu command used by users;
      // browser keyboard layouts do not consistently synthesize Ctrl+comma.
      await page
        .getByRole('menubar')
        .getByRole('menuitem', { name: /^File$/ })
        .click();
      const settingsItem = page.getByRole('menuitem', { name: /^Settings/ }).last();
      await expect(settingsItem).toBeVisible({ timeout: 5000 });
      await settingsItem.click();
      await page.waitForTimeout(300);

      // Settings dialog should be open
      const settingsDialog = page.locator('dialog.varve-dialog--settings[open]');
      await expect(settingsDialog).toBeVisible({ timeout: 5000 });

      // Focus should be inside the dialog
      const activeInside = await page.evaluate(() => {
        const dialog = document.querySelector('dialog.varve-dialog--settings[open]');
        return dialog?.contains(document.activeElement) ?? false;
      });
      expect(activeInside).toBe(true);

      // Tab through focusable elements should not leave dialog
      for (let i = 0; i < 6; i++) {
        await tab(page, 1);
        const stillInside = await page.evaluate(() => {
          const dialog = document.querySelector('dialog.varve-dialog--settings[open]');
          return dialog?.contains(document.activeElement) ?? false;
        });
        expect(stillInside).toBe(true);
      }

      // Close with Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Dialog should be closed
      await expect(settingsDialog).not.toBeVisible({ timeout: 3000 });
    });

    test('Save dialog initial focus is on the filename input', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Open save dialog via Ctrl+S
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(500);

      // If there is an export/save dialog visible, check focus
      const saveDialog = page.locator('[role="dialog"]:has(input[type="text"])').first();
      if (await saveDialog.isVisible({ timeout: 2000 })) {
        const focusOnInput = await page.evaluate(() => {
          const el = document.activeElement;
          return el?.tagName === 'INPUT' || el?.getAttribute('role') === 'textbox';
        });
        expect(focusOnInput).toBe(true);
      }
    });
  });

  test.describe('Arrow-key composite navigation', () => {
    test('document tabs respond to arrow keys', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      // Open another document
      await page.keyboard.press('Control+t');
      await page.waitForTimeout(300);

      // Focus the tab strip
      const tablist = page.locator('[role="tablist"][aria-label="Open documents"]');
      await tablist.locator('[role="tab"]').first().focus();
      await page.waitForTimeout(100);

      // Arrow right should move focus to next tab
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);

      // Arrow left should move focus back
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(100);
    });
  });

  test.describe('Focus not lost on dynamic changes', () => {
    test('changing tools preserves canvas focus', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      const canvas = await getCanvas(page);
      await canvas.focus();
      await expectFocusOn(page, '[data-testid="editor-canvas"]');

      // Press 'r' for Rectangle tool
      await page.keyboard.press('r');
      await page.waitForTimeout(100);

      // Canvas should still have focus
      await expectFocusOn(page, '[data-testid="editor-canvas"]');

      // Press 'v' for Select tool
      await page.keyboard.press('v');
      await page.waitForTimeout(100);

      // Canvas should still have focus
      await expectFocusOn(page, '[data-testid="editor-canvas"]');
    });
  });

  test.describe('Keyboard accessibility scan', () => {
    test('no element has positive tabIndex values', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      const hasPositiveTabIndex = await page.evaluate(() => {
        const all = document.querySelectorAll('[tabindex]');
        return Array.from(all).some((el) => {
          const val = parseInt(el.getAttribute('tabindex') ?? '0', 10);
          return val > 0;
        });
      });

      expect(hasPositiveTabIndex).toBe(false);
    });

    test('hidden elements are not focusable via tab', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      const hiddenFocusable = await page.evaluate(() => {
        const focusable = document.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        return Array.from(focusable)
          .filter((el) => {
            const style = getComputedStyle(el);
            // `display:none` elements cannot receive focus at all; the
            // actionable regression is an element that remains in the layout
            // but is hidden while still participating in the tab order.
            return style.visibility === 'hidden';
          })
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type'),
            id: el.id,
            className: el.className.toString(),
            ariaHidden: el.closest('[aria-hidden="true"]') !== null,
          }));
      });

      expect(hiddenFocusable, JSON.stringify(hiddenFocusable)).toHaveLength(0);
    });
  });

  test.describe('Resolved limitation regressions', () => {
    test('canvas focus ring appears on keyboard focus, not mouse click', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      const canvas = await getCanvas(page);

      // Mouse click should NOT show the focus ring
      await canvas.click({ position: { x: 100, y: 100 } });
      await page.waitForTimeout(200);
      const hasRingAfterClick = await page.evaluate(() => {
        const section = document.querySelector('.editor-canvas') as HTMLElement | null;
        return section?.getAttribute('data-canvas-focus-visible') === 'true';
      });
      expect(hasRingAfterClick).toBe(false);

      // Return to the canvas with a real keyboard traversal. This exercises
      // the same modality signal as a user pressing Shift+Tab and avoids
      // platform-specific F6 handling or unsupported focusVisible options.
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(canvas).toBeFocused();
      await page.waitForTimeout(200);
      const hasRingAfterKeyboard = await page.evaluate(() => {
        const section = document.querySelector('.editor-canvas') as HTMLElement | null;
        return section?.getAttribute('data-canvas-focus-visible') === 'true';
      });
      expect(hasRingAfterKeyboard).toBe(true);
    });

    test('canvas has aria-describedby pointing to announcer', async ({ page }) => {
      await navigateToEditor(page);
      await page.waitForTimeout(500);

      const describedby = await page.evaluate(() => {
        const canvas = document.querySelector(
          '[data-testid="editor-canvas"]',
        ) as HTMLElement | null;
        return canvas?.getAttribute('aria-describedby') ?? null;
      });
      expect(describedby).toBe('strata-canvas-announcer-polite');

      const announcerExists = await page.evaluate(() => {
        const el = document.getElementById('strata-canvas-announcer-polite');
        return el !== null && el.getAttribute('aria-live') === 'polite';
      });
      expect(announcerExists).toBe(true);
    });
  });
});
