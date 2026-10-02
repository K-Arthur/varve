import { expect, type Page, type TestInfo, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, seedLayers } from '../shared';

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type OverlayDebugBridge = {
  enable: () => void;
  trace: () => readonly Record<string, unknown>[];
};

function assertInsideViewport(rect: Rect, viewport: { width: number; height: number }): void {
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(viewport.width);
  expect(rect.bottom).toBeLessThanOrEqual(viewport.height);
}

function assertVerticalOverlap(parent: Rect, child: Rect): void {
  const overlap = Math.min(parent.bottom, child.bottom) - Math.max(parent.top, child.top);
  expect(overlap).toBeGreaterThan(0);
}

async function rect(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).evaluate(async (element) => {
    // The entrance animation scales the floating surface. Measure settled
    // placement while preserving the real animation and its pointer behavior.
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
    const value = element.getBoundingClientRect();
    return {
      left: value.left,
      top: value.top,
      right: value.right,
      bottom: value.bottom,
      width: value.width,
      height: value.height,
    };
  });
}

async function recordEvidence(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const evidence = await page.evaluate(() => {
    const bridge = (window as Window & { __varveOverlayDebug?: OverlayDebugBridge })
      .__varveOverlayDebug;
    const overlays = Array.from(
      document.querySelectorAll<HTMLElement>('[data-varve-overlay="true"]'),
    ).map((element) => {
      const value = element.getBoundingClientRect();
      return {
        id: element.dataset.overlayId,
        kind: element.dataset.overlayKind,
        state: element.dataset.overlayState,
        rect: {
          left: value.left,
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          width: value.width,
          height: value.height,
        },
        ownerWindow: element.ownerDocument.defaultView === window ? 'main' : 'detached',
        portalRoot: element.parentElement?.tagName,
      };
    });
    return {
      environment: {
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        dpr: window.devicePixelRatio,
        visualViewportScale: window.visualViewport?.scale ?? 1,
        activeElement: document.activeElement?.outerHTML.slice(0, 240) ?? null,
      },
      overlays,
      trace: bridge?.trace?.() ?? [],
    };
  });
  console.log(`[overlay-reliability:${name}] ${JSON.stringify(evidence)}`);
  await testInfo.attach(`${name}.json`, {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}

test.describe('Overlay geometry and event reliability', () => {
  test('keeps menubar flyouts and context menus attached through real input', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await navigateToEditor(page);
    await page.evaluate(() => {
      const bridge = (window as Window & { __varveOverlayDebug?: OverlayDebugBridge })
        .__varveOverlayDebug;
      bridge?.enable();
    });

    const viewport = { width: 1280, height: 720 };
    const fileTrigger = page.getByRole('menubar').getByRole('menuitem', {
      name: 'File',
      exact: true,
    });
    const triggerBox = await fileTrigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    await fileTrigger.click();

    const rootLayer = page.locator(
      '[data-overlay-kind="menubar-menu"][data-overlay-state="visible"]',
    );
    await expect(rootLayer).toHaveCount(1);
    const fileMenu = rootLayer.getByRole('menu', { name: 'File', exact: true });
    await expect(fileMenu).toBeVisible();
    const rootRect = await rect(page, '[data-overlay-kind="menubar-menu"]');
    assertInsideViewport(rootRect, viewport);
    expect(rootRect.top).toBeGreaterThanOrEqual(
      (triggerBox?.y ?? 0) + (triggerBox?.height ?? 0) - 2,
    );

    const logoItem = fileMenu.getByRole('menuitem', { name: /^Logo/ });
    const logoRect = await logoItem.boundingBox();
    expect(logoRect).not.toBeNull();
    await logoItem.hover();
    const submenuLayer = page.locator(
      '[data-overlay-kind="submenu"][data-overlay-state="visible"]',
    );
    await expect(submenuLayer).toHaveCount(1);
    const submenuRect = await rect(page, '[data-overlay-kind="submenu"]');
    assertInsideViewport(submenuRect, viewport);
    assertVerticalOverlap(
      {
        left: logoRect!.x,
        top: logoRect!.y,
        right: logoRect!.x + logoRect!.width,
        bottom: logoRect!.y + logoRect!.height,
        width: logoRect!.width,
        height: logoRect!.height,
      },
      submenuRect,
    );
    expect(submenuRect.left).toBeGreaterThanOrEqual(logoRect!.x + logoRect!.width - 3);
    await recordEvidence(page, testInfo, 'menubar-file-logo');

    // Escape first dismisses the deepest branch and restores focus to its
    // parent item; the second Escape dismisses the root menu.
    await page.keyboard.press('Escape');
    await expect(submenuLayer).toHaveCount(0);
    await expect(logoItem).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(rootLayer).toHaveCount(0);
    await expect(fileTrigger).toBeFocused();

    await seedLayers(page, 2);
    const row = page.getByRole('treeitem').first();
    await row.scrollIntoViewIfNeeded();
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    const invocation = { x: rowBox!.x + rowBox!.width / 2, y: rowBox!.y + rowBox!.height / 2 };
    await page.mouse.click(invocation.x, invocation.y, { button: 'right' });

    const contextLayer = page.locator(
      '[data-overlay-kind="context-menu"][data-overlay-state="visible"]',
    );
    await expect(contextLayer).toHaveCount(1);
    const contextRect = await rect(page, '[data-overlay-kind="context-menu"]');
    assertInsideViewport(contextRect, viewport);
    // Compare the menu with the exact viewport point sent to the real mouse.
    // A locator click may recalculate its center after the row box is read.
    expect(Math.abs(contextRect.left - invocation.x)).toBeLessThanOrEqual(3);
    // A tall context menu can flip above the point and shift to the safe
    // viewport edge. Measure distance to its visible interval: zero inside
    // the menu, otherwise distance to the nearer edge.
    const distanceToAnchor =
      invocation.y < contextRect.top
        ? contextRect.top - invocation.y
        : invocation.y > contextRect.bottom
          ? invocation.y - contextRect.bottom
          : 0;
    expect(distanceToAnchor).toBeLessThanOrEqual(12);

    const selectItem = contextLayer.getByRole('menuitem', { name: /^Select/ });
    await expect(selectItem).toBeVisible();
    const selectRect = await selectItem.boundingBox();
    expect(selectRect).not.toBeNull();
    await selectItem.hover();
    // Opening the submenu focuses the hovered parent item. A tall, scrollable
    // context menu may scroll that item into its visible viewport, so measure
    // the anchor after the real interaction rather than comparing against the
    // pre-scroll rectangle.
    const selectRectAfterHover = await selectItem.boundingBox();
    expect(selectRectAfterHover).not.toBeNull();
    const selectSubmenuLayer = page.locator(
      '[data-overlay-kind="submenu"][data-overlay-state="visible"]',
    );
    await expect(selectSubmenuLayer).toHaveCount(1);
    const selectSubmenuRect = await rect(page, '[data-overlay-kind="submenu"]');
    assertInsideViewport(selectSubmenuRect, viewport);
    assertVerticalOverlap(
      {
        left: selectRectAfterHover!.x,
        top: selectRectAfterHover!.y,
        right: selectRectAfterHover!.x + selectRectAfterHover!.width,
        bottom: selectRectAfterHover!.y + selectRectAfterHover!.height,
        width: selectRectAfterHover!.width,
        height: selectRectAfterHover!.height,
      },
      selectSubmenuRect,
    );
    await recordEvidence(page, testInfo, 'layers-context-select');

    // An item click in the portaled child must reach the action before the
    // parent tree is dismissed; one activation leaves no overlay residue.
    await selectSubmenuLayer.getByRole('menuitem', { name: 'Select Same Type' }).click();
    await expect(page.locator('[data-overlay-kind="context-menu"]')).toHaveCount(0);
    await expect(page.locator('[data-overlay-kind="submenu"]')).toHaveCount(0);

    // Keyboard invocation has no pointer history. It is anchored to the
    // focused row and Escape returns focus to that same row.
    await row.focus();
    await page.keyboard.press('Shift+F10');
    await expect(contextLayer).toHaveCount(1);
    const keyboardContextRect = await rect(page, '[data-overlay-kind="context-menu"]');
    assertInsideViewport(keyboardContextRect, viewport);
    // The focused-row anchor is an element anchor. A tall menu may be flipped
    // and shifted to the safe edge, so allow a small collision-padding gap
    // while still requiring attachment to the focused row.
    const rowTop = rowBox!.y;
    const rowBottom = rowBox!.y + rowBox!.height;
    const distanceToFocusedRow =
      keyboardContextRect.bottom < rowTop
        ? rowTop - keyboardContextRect.bottom
        : keyboardContextRect.top > rowBottom
          ? keyboardContextRect.top - rowBottom
          : 0;
    expect(distanceToFocusedRow).toBeLessThanOrEqual(12);
    await page.keyboard.press('Escape');
    await expect(contextLayer).toHaveCount(0);
    await expect(row).toBeFocused();
    await recordEvidence(page, testInfo, 'layers-context-keyboard');

    // The canvas keyboard route uses the focused viewport surface, never the
    // canvas's world transform.
    const canvas = page.getByTestId('editor-canvas');
    await canvas.focus();
    await page.keyboard.press('Shift+F10');
    await expect(contextLayer).toHaveCount(1);
    const canvasContextRect = await rect(page, '[data-overlay-kind="context-menu"]');
    assertInsideViewport(canvasContextRect, viewport);
    await page.keyboard.press('Escape');
    await expect(contextLayer).toHaveCount(0);
    await recordEvidence(page, testInfo, 'canvas-context-keyboard');
  });

  // Regression (2026-09-25): the informational micro-hint that floats over the
  // bottom of the canvas once swallowed real pointer input, so a right-click
  // on the artwork under it never reached the canvas context-menu handler and
  // "Apply Mockup…" style entries were unreachable. The hint surface must stay
  // click-through; only its dismiss control is interactive.
  test('canvas context menu opens on a real right-click under a visible micro-hint', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // First use of the rectangle tool surfaces the "Rectangle" micro-hint for
    // a few seconds at the bottom-centre of the canvas area.
    await page.keyboard.press('r');
    const hint = page.locator('.micro-hint');
    await expect(hint).toBeVisible();

    const hintBox = await hint.boundingBox();
    expect(hintBox).not.toBeNull();
    const hintCenter = {
      x: hintBox!.x + hintBox!.width / 2,
      y: hintBox!.y + hintBox!.height / 2,
    };

    // A real right-click at the hint's own centre must fall through to the
    // canvas and open the canvas context menu.
    await page.mouse.click(hintCenter.x, hintCenter.y, { button: 'right' });
    const menu = page.locator('.varve-ctxmenu[role="menu"]');
    await expect(menu).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // The dismiss control is the one interactive part of the hint; activating
    // it removes the hint without opening anything else.
    await hint.getByRole('button', { name: 'Dismiss hint' }).click();
    await expect(hint).toHaveCount(0);
  });

  test('menu rows stay above the docked panel header', async ({ page }) => {
    // The dock puts its panel header at --z-overlay + 3 (1003), and panels
    // drawn as drawers also resolve to --z-overlay, so the chrome has to
    // out-rank 1000 in every mode simply to stay above its own panel. Floating
    // overlays therefore live at calc(var(--z-overlay) + 10) instead of at
    // 1000. Before they moved, every File-menu row in the band where the
    // Layers header overlapped the menu hit-tested to that header, so those
    // rows could not receive a pointer event at all — and nothing failed,
    // because every other menu assertion only checked that a row existed.
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const menu = page.locator('.editor-menubar__menu');
    // Both docked panels render a chrome bar; the File menu hangs over the
    // Layers one, so address it by its label rather than by position.
    const chrome = page.locator('.workspace-dock-panel-chrome[aria-label="Layers panel controls"]');
    await openMenu(page, 'File');
    await expect(menu).toBeVisible();
    await expect(chrome).toBeVisible();

    const probe = await page.evaluate(() => {
      const open = document.querySelector<HTMLElement>('.editor-menubar__menu');
      const header = document.querySelector<HTMLElement>(
        '.workspace-dock-panel-chrome[aria-label="Layers panel controls"]',
      );
      if (!open || !header) return null;
      const m = open.getBoundingClientRect();
      const c = header.getBoundingClientRect();
      const left = Math.max(m.left, c.left);
      const right = Math.min(m.right, c.right);
      const top = Math.max(m.top, c.top);
      const bottom = Math.min(m.bottom, c.bottom);
      const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      const cy = Math.round((top + bottom) / 2);
      const hits = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => {
        const el = document.elementFromPoint(Math.round(left + (right - left) * t), cy);
        if (!el) return 'nothing';
        return open.contains(el)
          ? 'menu'
          : `${el.tagName}.${(el.className || '').toString().slice(0, 44)}`;
      });
      return {
        overlapArea,
        hits,
        menuZ: Number.parseFloat(getComputedStyle(open).zIndex),
        chromeZ: Number.parseFloat(getComputedStyle(header).zIndex),
      };
    });
    await page.keyboard.press('Escape');

    expect(probe, 'File menu and panel header both exist').not.toBeNull();
    // Precondition: this only means anything where the two overlap. If a
    // layout change stops them overlapping, this fails loudly rather than
    // letting the probes below pass without testing anything.
    expect(probe!.overlapArea, 'File menu overlaps the panel header').toBeGreaterThan(0);
    for (const hit of probe!.hits) {
      expect(hit, `point inside the menu/header overlap band resolved to ${hit}`).toBe('menu');
    }
    expect(probe!.menuZ, 'overlay band must clear the dock chrome band').toBeGreaterThan(
      probe!.chromeZ,
    );
  });
});
