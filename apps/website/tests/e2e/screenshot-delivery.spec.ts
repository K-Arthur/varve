import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * Marketing screenshot delivery contract.
 *
 * The capture pipeline proves an image exists; this spec proves the *website*
 * shows it correctly. They are different systems, and the earlier markup
 * failed here rather than in the pipeline: a shared
 * `aspect-ratio: 4/3; object-fit: cover` cropped a portrait layer-panel crop
 * down to a landscape window, so the image no longer contained the rows its
 * caption described, and nothing failed.
 *
 * What is asserted, per placement:
 *   - a captured scene keeps its own aspect ratio (nothing is cropped);
 *   - the above-the-fold showcase image is eager and high priority, and the
 *     below-the-fold details are lazy;
 *   - intrinsic width/height are present so the box is reserved (no shift);
 *   - a live page never shows a capture command to a visitor.
 */
const manifest = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../src/data/screenshot-manifest.json', import.meta.url)),
    'utf8',
  ),
) as {
  scenes: Record<
    string,
    {
      file: string;
      alt: string;
      caption?: string;
      status?: string;
      width?: number;
      height?: number;
    }
  >;
};

/** Compare natural sizing, except when the element intentionally uses contain. */
async function assertNotCropped(img: ReturnType<import('@playwright/test').Page['locator']>) {
  // Lazily loaded images below the fold may not have started loading yet;
  // decoding first means this asserts about a real image, not a pending one.
  await img.evaluate((element: HTMLImageElement) => {
    element.loading = 'eager';
  });
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(() => img.evaluate((element: HTMLImageElement) => element.complete), {
      timeout: 15_000,
    })
    .toBe(true);
  await img.evaluate((element: HTMLImageElement) => element.decode().catch(() => undefined));
  const geometry = await img.evaluate((element: HTMLImageElement) => {
    const rect = element.getBoundingClientRect();
    return {
      renderedRatio: rect.width / rect.height,
      naturalRatio: element.naturalWidth / element.naturalHeight,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      complete: element.complete,
      currentSrc: element.currentSrc,
      objectFit: getComputedStyle(element).objectFit,
    };
  });
  expect(geometry.complete, 'image finished loading').toBe(true);
  expect(geometry.naturalWidth, 'image decoded to a real size').toBeGreaterThan(0);
  if (geometry.objectFit === 'contain') return;
  expect(
    Math.abs(geometry.renderedRatio - geometry.naturalRatio),
    `rendered aspect ${geometry.renderedRatio.toFixed(3)} must match the capture's ${geometry.naturalRatio.toFixed(3)} (${geometry.currentSrc})`,
  ).toBeLessThan(0.02);
}

test.describe('screenshot delivery', () => {
  test('homepage showcase shows real captures at their own aspect ratio', async ({ page }) => {
    await page.goto('/');
    const showcase = page.locator('.showcase');
    await showcase.scrollIntoViewIfNeeded();
    await expect(showcase).toBeVisible();

    const primary = showcase.locator('.showcase-window img').first();
    await expect(primary).toBeVisible();
    await expect(primary).toHaveAttribute('loading', 'eager');
    await expect(primary).toHaveAttribute('fetchpriority', 'high');
    await assertNotCropped(primary);
    // The reserved box must match the intrinsic size, or the page shifts when
    // the image lands.
    const reserved = await primary.evaluate((element) => ({
      w: element.getAttribute('width'),
      h: element.getAttribute('height'),
      nw: (element as HTMLImageElement).naturalWidth,
      nh: (element as HTMLImageElement).naturalHeight,
    }));
    expect(Number(reserved.w)).toBe(reserved.nw);
    expect(Number(reserved.h)).toBe(reserved.nh);

    const details = showcase.locator('.showcase-detail');
    const count = await details.count();
    expect(count, 'showcase renders detail crops').toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const img = details.nth(index).locator('img').first();
      await expect(img).toHaveAttribute('loading', 'lazy');
      await assertNotCropped(img);
      const contentFit = await img.evaluate((element: HTMLImageElement) => {
        const frame = element.closest('.screenshot-image')?.getBoundingClientRect();
        const frameRatio = frame ? frame.width / frame.height : 0;
        const imageRatio = element.naturalWidth / element.naturalHeight;
        return {
          kind: element.closest('.screenshot-image')?.getAttribute('data-kind'),
          visibleWidthFraction: Math.min(1, imageRatio / frameRatio),
          imageRatio,
          currentSrc: element.currentSrc,
        };
      });
      // The homepage row is for landscape detail crops. A narrow panel image
      // technically fits in `object-fit: contain`, but becomes a tiny strip
      // surrounded by empty space at desktop card widths.
      expect(contentFit.kind).toBe('detail');
      expect(contentFit.visibleWidthFraction).toBeGreaterThan(0.72);
      if (index === 2) {
        const workflowScene = manifest.scenes['workspace-shared-workflows'];
        if (!workflowScene?.file) {
          throw new Error(
            'The curated shared-workflow scene is missing from the screenshot manifest',
          );
        }
        expect(contentFit.currentSrc).toContain(workflowScene.file);
        expect(
          Math.abs(contentFit.imageRatio - 4 / 3),
          'the shared-workflow card uses its curated landscape crop, not a full-height editor frame',
        ).toBeLessThan(0.02);
      }
      // The figure must contain the whole image: no clipping by the frame.
      const overflow = await details.nth(index).evaluate((figure) => {
        const image = figure.querySelector('img') as HTMLImageElement;
        const frame = figure.querySelector('.screenshot-image') as HTMLElement;
        const figureBox = figure.getBoundingClientRect();
        const frameBox = frame.getBoundingClientRect();
        const imageBox = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return {
          frameFitsCard:
            frameBox.left >= figureBox.left - 1 &&
            frameBox.right <= figureBox.right + 1 &&
            frameBox.top >= figureBox.top - 1 &&
            frameBox.bottom <= figureBox.bottom + 1,
          imageFitsFrame:
            imageBox.left >= frameBox.left - 1 &&
            imageBox.right <= frameBox.right + 1 &&
            imageBox.top >= frameBox.top - 1 &&
            imageBox.bottom <= frameBox.bottom + 1,
          frame: { x: frameBox.x, y: frameBox.y, width: frameBox.width, height: frameBox.height },
          image: { x: imageBox.x, y: imageBox.y, width: imageBox.width, height: imageBox.height },
          computed: {
            width: style.width,
            height: style.height,
            maxWidth: style.maxWidth,
            maxHeight: style.maxHeight,
          },
          intrinsic: { width: image.naturalWidth, height: image.naturalHeight },
        };
      });
      expect(
        overflow.frameFitsCard,
        `detail ${index} media frame exceeds its card: ${JSON.stringify(overflow)}`,
      ).toBe(true);
      expect(
        overflow.imageFitsFrame,
        `detail ${index} image exceeds its frame: ${JSON.stringify(overflow)}`,
      ).toBe(true);
    }
  });

  for (const width of [360, 390, 768, 1024, 1280, 1366, 1440]) {
    test(`showcase holds together at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const showcase = page.locator('.showcase');
      await showcase.scrollIntoViewIfNeeded();
      await expect(showcase).toBeVisible();
      // Ignore the duplicate full-size image inside each closed zoom dialog;
      // only the image actually delivered inline belongs to this layout check.
      const images = showcase.locator('.screenshot-image > img');
      const count = await images.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const img = images.nth(index);
        await assertNotCropped(img);
        const state = await img.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            width: rect.width,
            naturalWidth: (element as HTMLImageElement).naturalWidth,
            maxWidth: getComputedStyle(element).maxWidth,
          };
        });
        // Never displayed wider than its intrinsic width, at any breakpoint.
        expect(
          state.width,
          `image ${index} at ${width}px is ${state.width.toFixed(0)}px wide but only has ${state.naturalWidth}px of data (max-width: ${state.maxWidth})`,
        ).toBeLessThanOrEqual(state.naturalWidth + 1);
      }
    });
  }

  for (const width of [390, 768, 1024, 1280, 1366, 1440]) {
    test(`homepage detail cards align and the image viewer fits ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const details = page.locator('.showcase-detail');
      await expect(details.first()).toBeVisible();
      const initialLayout = await page.evaluate(() => {
        const header = document.querySelector('[data-site-header]')?.getBoundingClientRect();
        const grid = document.querySelector('.showcase-details')?.getBoundingClientRect();
        return { headerBottom: header?.bottom ?? 0, gridTop: grid?.top ?? 0 };
      });
      // At page load the sticky header occupies its own flow position. The
      // overlap in a previous mobile artifact came from locator.screenshot()
      // pinning that header over a grid scrolled all the way to viewport y=0.
      expect(initialLayout.gridTop).toBeGreaterThan(initialLayout.headerBottom);

      const cards = await details.evaluateAll((figures) =>
        figures.map((figure) => {
          const rect = figure.getBoundingClientRect();
          const frame = figure.querySelector('.screenshot-image')?.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            frameWidth: frame?.width ?? 0,
            frameHeight: frame?.height ?? 0,
          };
        }),
      );
      expect(cards.length).toBeGreaterThanOrEqual(3);
      for (const card of cards) {
        expect(card.frameWidth).toBeGreaterThan(0);
        expect(Math.abs(card.frameWidth / card.frameHeight - 4 / 3)).toBeLessThan(0.02);
        expect(card.width).toBeLessThanOrEqual(width);
      }
      expect(
        Math.max(...cards.map((card) => card.height)) -
          Math.min(...cards.map((card) => card.height)),
      ).toBeLessThan(2);
      if (width <= 720) {
        const rows = [...new Set(cards.map((card) => Math.round(card.y)))];
        expect(rows.length).toBe(cards.length);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      const detailGrid = page.locator('.showcase-details');
      await detailGrid.scrollIntoViewIfNeeded();
      if (width <= 720) {
        await page.evaluate(() => {
          const header = document.querySelector('[data-site-header]')?.getBoundingClientRect();
          const grid = document.querySelector('.showcase-details')?.getBoundingClientRect();
          if (!header || !grid) throw new Error('Homepage screenshot layout is incomplete');
          // Leave the normal sticky header visible, but keep it outside the
          // isolated element screenshot so the first card is not obscured.
          const gridDocumentTop = grid.top + window.scrollY;
          window.scrollTo({
            top: Math.max(0, gridDocumentTop - header.bottom - 16),
            behavior: 'instant',
          });
        });
        const captureLayout = await page.evaluate(() => {
          const header = document.querySelector('[data-site-header]')?.getBoundingClientRect();
          const grid = document.querySelector('.showcase-details')?.getBoundingClientRect();
          return { headerBottom: header?.bottom ?? 0, gridTop: grid?.top ?? 0 };
        });
        expect(captureLayout.gridTop).toBeGreaterThanOrEqual(captureLayout.headerBottom + 15);
      }
      await detailGrid.screenshot({
        path: testInfo.outputPath(`homepage-detail-cards-${width}px.png`),
        animations: 'disabled',
      });

      const trigger = details.first().getByRole('button', { name: 'View full size' });
      await trigger.click();
      const dialog = page.locator('.screenshot-zoom__dialog[open]');
      await expect(dialog).toBeVisible();
      const image = dialog.locator('img');
      await expect
        .poll(() =>
          image.evaluate(
            (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
          ),
        )
        .toBe(true);
      const viewer = await dialog.evaluate((element) => {
        const dialogRect = element.getBoundingClientRect();
        const imageRect = element.querySelector('img')?.getBoundingClientRect();
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        return {
          left: dialogRect.left,
          right: dialogRect.right,
          top: dialogRect.top,
          bottom: dialogRect.bottom,
          imageRight: imageRect?.right ?? Infinity,
          imageBottom: imageRect?.bottom ?? Infinity,
          centerX: dialogRect.left + dialogRect.width / 2,
          centerY: dialogRect.top + dialogRect.height / 2,
          imageRatio: (imageRect?.width ?? 0) / (imageRect?.height ?? 1),
          naturalRatio:
            ((element.querySelector('img') as HTMLImageElement).naturalWidth || 0) /
            ((element.querySelector('img') as HTMLImageElement).naturalHeight || 1),
          viewport,
        };
      });
      expect(viewer.left).toBeGreaterThanOrEqual(-1);
      expect(viewer.right).toBeLessThanOrEqual(viewer.viewport.width + 1);
      expect(viewer.top).toBeGreaterThanOrEqual(-1);
      expect(viewer.bottom).toBeLessThanOrEqual(viewer.viewport.height + 1);
      expect(viewer.imageRight).toBeLessThanOrEqual(viewer.right + 1);
      expect(viewer.imageBottom).toBeLessThanOrEqual(viewer.bottom + 1);
      expect(Math.abs(viewer.centerX - viewer.viewport.width / 2)).toBeLessThan(2);
      expect(Math.abs(viewer.centerY - viewer.viewport.height / 2)).toBeLessThan(2);
      expect(Math.abs(viewer.imageRatio - viewer.naturalRatio)).toBeLessThan(0.02);
      await expect(dialog.getByRole('link', { name: 'Open original' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`homepage-image-viewer-${width}px.png`),
        animations: 'disabled',
      });
    });
  }

  test('migrated feature and docs pages use manifest alt text', async ({ page }) => {
    const cases: [string, string][] = [
      ['/features/motion', 'motion'],
      ['/features/vector-tools', 'vector'],
      ['/features/vector-tools', 'vectorize'],
      ['/features/image-trace', 'vectorize'],
      ['/features/canvas', 'layout'],
      ['/features/comic-lettering', 'comic-lettering'],
      ['/features/design-tokens', 'design-tokens-contrast'],
      ['/docs/settings', 'performance-settings'],
      ['/features/typography', 'typography-panel'],
    ];
    for (const [route, sceneId] of cases) {
      const scene = manifest.scenes[sceneId];
      expect(scene?.status, `${sceneId} is captured`).toBe('captured');
      if (!scene) throw new Error(`${sceneId} is missing from the screenshot manifest`);
      await page.goto(route);
      const img = page.locator(`img[src$="/${scene.file}"]`).first();
      await img.waitFor({ state: 'visible', timeout: 15000 });
      await expect(img, `${route} alt comes from the manifest`).toHaveAttribute('alt', scene.alt);
      await assertNotCropped(img);
    }
  });

  test('no page shows a capture command or a broken screenshot reference', async ({ page }) => {
    const routes = ['/', '/features', '/features/typography', '/docs/settings', '/product'];
    for (const route of routes) {
      await page.goto(route);
      const html = await page.content();
      expect(html, `${route} must not leak a developer capture command`).not.toMatch(
        /pnpm screenshots:/,
      );
      // Wait for images the page has committed to loading eagerly. Deferred
      // (`loading="lazy"`) images below the fold are allowed to be unloaded;
      // an image that finished with no pixels is not.
      await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('img')].every(
              (image) => image.loading === 'lazy' || (image.complete && image.naturalWidth > 0),
            ),
          undefined,
          { timeout: 15000 },
        )
        .catch(() => undefined);
      const broken = await page.evaluate(() =>
        ([...document.querySelectorAll('img')] as HTMLImageElement[])
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.currentSrc || image.src),
      );
      expect(broken, `${route} has images that failed to load`).toEqual([]);
    }
  });
});
