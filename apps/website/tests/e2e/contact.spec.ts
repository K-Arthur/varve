import { expect, test } from '@playwright/test';

/**
 * Contact-surface E2E.
 *
 * Unit tests can prove the constants are right; only a real page load proves
 * a visitor can find and use them. These specs check the properties that
 * actually decide whether someone gets help: the address is visible text (not
 * an image, not JavaScript-assembled), the mail link resolves to the right
 * channel, the page is reachable by navigation, it works without scripting,
 * and it does not overflow a phone screen.
 */

const CHANNELS = [
  { id: 'general', email: 'hello@varve.studio', label: 'General inquiries' },
  { id: 'support', email: 'support@varve.studio', label: 'Product support' },
  { id: 'feedback', email: 'feedback@varve.studio', label: 'Product feedback' },
  { id: 'security', email: 'security@varve.studio', label: 'Security' },
  { id: 'privacy', email: 'privacy@varve.studio', label: 'Privacy' },
  { id: 'press', email: 'press@varve.studio', label: 'Press and media' },
  {
    id: 'partnerships',
    email: 'partnerships@varve.studio',
    label: 'Partnerships',
  },
];

test('every public channel is listed with a working mail link', async ({ page }) => {
  await page.goto('/contact');

  for (const channel of CHANNELS) {
    const section = page.locator(`section[aria-labelledby="contact-${channel.id}"]`);
    await expect(section.getByRole('heading', { name: channel.label })).toBeVisible();

    // The address must be readable text so it can be copied by a visitor with
    // no mail client configured.
    const link = section.getByRole('link', { name: /Email Varve/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveText(channel.email);
    await expect(link).toHaveAttribute('href', new RegExp(`^mailto:${channel.email}`));
  }
});

test('mail links carry no body payload or personal data', async ({ page }) => {
  await page.goto('/contact');

  const hrefs = await page
    .locator('a[href^="mailto:"]')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href') ?? ''));

  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href).not.toContain('body=');
    // A subject long enough to hold diagnostics is a leak waiting to happen.
    expect(href.length).toBeLessThan(120);
    expect(href).toMatch(/^mailto:[a-z]+@varve\.studio/);
  }
});

test('the contact page is reachable from the site header and footer', async ({ page }) => {
  await page.goto('/');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Contact' })
    .click();
  await expect(page).toHaveURL(/\/contact\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Contact Varve' })).toBeVisible();

  await page.goto('/');
  const footer = page.getByRole('navigation', { name: 'Footer' });
  await expect(footer.getByRole('link', { name: 'Contact Varve' })).toBeVisible();
  await expect(footer.getByRole('link', { name: /Press/i })).toBeVisible();
});

test('addresses remain visible with JavaScript disabled', async ({ browser }) => {
  // The copy button is progressive enhancement; the address itself must never
  // depend on scripting.
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('/contact');
    await expect(page.getByText('support@varve.studio').first()).toBeVisible();
    await expect(page.locator('a[href^="mailto:security@varve.studio"]').first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test('contact links are reachable by keyboard', async ({ page }) => {
  await page.goto('/contact');

  const link = page.locator('a[href^="mailto:hello@varve.studio"]').first();
  await link.focus();
  await expect(link).toBeFocused();

  // A visible focus indicator is required, not merely focusability.
  const outline = await link.evaluate((el) => {
    const cs = getComputedStyle(el, ':focus-visible');
    return { outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle };
  });
  expect(outline.outlineStyle).not.toBe('none');
});

test('no address overflows a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/contact');

  const overflow = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    return [...document.querySelectorAll('a[href^="mailto:"]')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { text: el.textContent?.trim() ?? '', right: Math.round(rect.right) };
      })
      .filter((entry) => entry.right > docWidth + 1);
  });

  expect(overflow).toEqual([]);
  // Horizontal scrolling of the whole document is the other failure mode.
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(scrolls).toBe(false);
});

test('security.txt is served and points at the security channel', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');

  const body = await response.text();
  expect(body).toContain('Contact: mailto:security@varve.studio');
  expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);

  // An expired security.txt is treated as invalid by consumers.
  const expires = body.match(/^Expires: (.+)$/m)?.[1];
  expect(expires).toBeTruthy();
  expect(new Date(expires as string).getTime()).toBeGreaterThan(Date.now());
});

test('the contact page exposes accurate ContactPoint structured data', async ({ page }) => {
  await page.goto('/contact');

  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((n) => JSON.parse(n.textContent ?? '{}')));

  const flat = blocks.flat();
  const contactPage = flat.find((b) => b['@type'] === 'ContactPage');
  expect(contactPage).toBeTruthy();

  const points = contactPage.mainEntity.contactPoint as Array<{
    contactType: string;
    email: string;
  }>;
  const byType = Object.fromEntries(points.map((p) => [p.contactType, p.email]));
  expect(byType['customer support']).toBe('support@varve.studio');
  expect(byType.security).toBe('security@varve.studio');
  expect(byType['media inquiries']).toBe('press@varve.studio');

  // Structured data must describe reality, and must not leak a routing mailbox.
  expect(JSON.stringify(flat)).not.toMatch(/gmail|outlook|proton/i);

  const faq = flat.find((b) => b['@type'] === 'FAQPage');
  expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
});
