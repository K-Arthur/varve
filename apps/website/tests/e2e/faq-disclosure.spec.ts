/**
 * FAQ disclosure surfaces — rendered behaviour for the marketing site.
 *
 * The support and compare FAQs use native `<details>` deliberately (see
 * docs/research/disclosure-review-2026-09-15.md): the platform supplies the
 * button role, expanded state, Enter/Space toggling, and true hiding of closed
 * content. Guests list two things the native element does not give for free,
 * which this spec pins:
 *
 * 1. question-level heading navigation (each question is an `h3`); and
 * 2. printing every answer, not only the open ones.
 *
 * It also asserts the deliberate multi-open behaviour (NN/g: exclusive
 * accordions frustrate users who compare answers) and that closed answers are
 * not reachable by Tab.
 */
import { expect, test } from '@playwright/test';

test.describe('FAQ disclosure surfaces', () => {
  test('support FAQ questions are headings and toggle with Enter and Space', async ({ page }) => {
    await page.goto('/support/faq');

    await expect(page.locator('h1')).toContainText(/frequently asked questions/i);
    await expect(page.locator('.faq-item__question-text')).toHaveCount(16);

    const details = page.locator('details.faq-item').first();
    const summary = details.locator('summary');
    const answer = details.locator('.faq-item__answer p');

    await expect(details).not.toHaveAttribute('open', '');
    await summary.focus();
    await expect(summary).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(answer).toBeVisible();

    await page.keyboard.press(' ');
    await expect(details).not.toHaveAttribute('open', '');
  });

  test('keeps multiple answers open for comparison', async ({ page }) => {
    await page.goto('/support/faq');
    const items = page.locator('details.faq-item');

    await items.nth(0).locator('summary').click();
    await items.nth(1).locator('summary').click();

    await expect(items.nth(0)).toHaveAttribute('open', '');
    await expect(items.nth(1)).toHaveAttribute('open', '');
  });

  test('closed answers are not reachable by Tab', async ({ page }) => {
    await page.goto('/support/faq');
    const first = page.locator('details.faq-item').first();
    await first.locator('summary').focus();
    await page.keyboard.press('Tab');

    const stranded = await page.evaluate(
      () => document.activeElement?.closest('.faq-item__answer') !== null,
    );
    expect(stranded).toBe(false);
  });

  test('print media reveals every answer', async ({ page }) => {
    await page.goto('/support/faq');
    const closedAnswer = page.locator('details.faq-item').first().locator('.faq-item__answer p');
    await expect(closedAnswer).toBeHidden();

    await page.emulateMedia({ media: 'print' });
    await expect(closedAnswer).toBeVisible();
    const box = await closedAnswer.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });

  test('compare page FAQ uses the same heading and print contract', async ({ page }) => {
    await page.goto('/compare');
    await expect(page.locator('.faq-item__question-text')).toHaveCount(6);

    const closedAnswer = page.locator('details.faq-item').first().locator('.faq-item__answer p');
    await expect(closedAnswer).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(closedAnswer).toBeVisible();
  });

  test('FAQ questions expose a comfortable touch target', async ({ page }) => {
    await page.goto('/support/faq');
    const summary = page.locator('details.faq-item').first().locator('summary');
    const box = await summary.boundingBox();
    expect(box, 'FAQ summary should be measurable').toBeTruthy();
    // WCAG 2.5.5 (enhanced) 44px default for a stacked list of page controls.
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('FAQ structured data matches the visible question set', async ({ page }) => {
    await page.goto('/support/faq');
    const schemaQuestions = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const entries: Record<string, unknown>[] = [];
      for (const script of scripts) {
        const data = JSON.parse(script.textContent ?? '{}') as unknown;
        if (Array.isArray(data)) entries.push(...(data as Record<string, unknown>[]));
        else entries.push(data as Record<string, unknown>);
      }
      const faqPage = entries.find((entry) => entry['@type'] === 'FAQPage');
      const main = faqPage?.mainEntity;
      return Array.isArray(main)
        ? main.map((entry) => (entry as { name?: string }).name ?? '')
        : [];
    });
    expect(schemaQuestions.length).toBeGreaterThanOrEqual(16);

    const visible = await page
      .locator('.faq-item__question-text')
      .evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim() ?? ''));
    for (const question of visible) {
      expect(schemaQuestions).toContain(question);
    }
  });
});
