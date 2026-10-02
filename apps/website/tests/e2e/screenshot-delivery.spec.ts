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

/** Rendered box vs intrinsic box: must match, or something is cropping. */
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
    };
  });
  expect(geometry.complete, 'image finished loading').toBe(true);
  expect(geometry.naturalWidth, 'image decoded to a real size').toBeGreaterThan(0);
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
      // The figure must contain the whole image: no clipping by the frame.
      const overflow = await details.nth(index).evaluate((figure) => {
        const image = figure.querySelector('img') as HTMLImageElement;
        const figureBox = figure.getBoundingClientRect();
        const imageBox = image.getBoundingClientRect();
        return {
          left: imageBox.left >= figureBox.left - 1,
          right: imageBox.right <= figureBox.right + 1,
          top: imageBox.top >= figureBox.top - 1,
          bottom: imageBox.bottom <= figureBox.bottom + 1,
        };
      });
      expect(overflow, `detail ${index} is not clipped by its frame`).toEqual({
        left: true,
        right: true,
        top: true,
        bottom: true,
      });
    }
  });

  for (const width of [360, 390, 768, 1280, 1440]) {
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

  test('migrated feature and docs pages use manifest alt text', async ({ page }) => {
    const cases: [string, string][] = [
      ['/features/motion', 'motion'],
      ['/features/vector-tools', 'vector'],
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
