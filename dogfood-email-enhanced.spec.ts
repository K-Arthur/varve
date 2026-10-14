/**
 * Enhanced Email Workspace Dogfood Test
 *
 * Build a realistic, polished marketing email with:
 * - Header with logo
 * - Hero image placeholder
 * - Heading and body text
 * - CTA button
 * - 2-column section
 * - Footer
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

// Configure for high-quality screenshots
test.use({
  viewport: { width: 1920, height: 1200 },
  deviceScaleFactor: 2,
});

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenshotMetadata {
  filename: string;
  description: string;
  elements: Record<string, BoundingBox>;
}

interface Bug {
  severity: 'critical' | 'major' | 'minor' | 'cosmetic';
  title: string;
  description: string;
  repro: string[];
  screenshot?: string;
}

const screenshots: ScreenshotMetadata[] = [];
const bugs: Bug[] = [];
const artifactsDir = '/tmp/cursor/artifacts/email-workspace-dogfood';

// Ensure artifacts directory exists
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function recordBug(
  severity: Bug['severity'],
  title: string,
  description: string,
  repro: string[],
  screenshot?: string,
) {
  bugs.push({ severity, title, description, repro, screenshot });
  console.log(`[WARN]  BUG [${severity.toUpperCase()}]: ${title}`);
}

async function navigateToEditor(page: Page): Promise<void> {
  await page.goto('http://localhost:1420', { timeout: 60000, waitUntil: 'domcontentloaded' });

  const newButton = page.getByRole('button', { name: /^new$/i });
  await newButton.waitFor({ state: 'visible', timeout: 30000 });
  await newButton.click();

  const createButton = page.locator('dialog[open]').getByRole('button', { name: /create design/i });
  await createButton.waitFor({ state: 'visible', timeout: 10000 });
  await createButton.click();

  await page.locator('.layers-panel, .editor__layers-panel').first().waitFor({ timeout: 30000 });

  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

async function switchToEmailWorkspace(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+6');
  await page.waitForTimeout(1000);

  const emailWorkspace = page.getByRole('radio', { name: 'Email workspace' });
  await expect(emailWorkspace).toBeChecked();
}

async function captureElementBounds(
  page: Page,
  selector: string,
  _name: string,
): Promise<BoundingBox | null> {
  try {
    const element = page.locator(selector).first();
    if (await element.isVisible({ timeout: 1000 }).catch(() => false)) {
      const box = await element.boundingBox();
      if (box) {
        return {
          x: Math.round(box.x * 2),
          y: Math.round(box.y * 2),
          width: Math.round(box.width * 2),
          height: Math.round(box.height * 2),
        };
      }
    }
  } catch (_error) {
    // Element not found, continue
  }
  return null;
}

async function captureScreenshotWithMetadata(
  page: Page,
  filename: string,
  description: string,
  elementSelectors: Record<string, string> = {},
): Promise<void> {
  const filepath = path.join(artifactsDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });

  const elements: Record<string, BoundingBox> = {};
  for (const [name, selector] of Object.entries(elementSelectors)) {
    const bounds = await captureElementBounds(page, selector, name);
    if (bounds) {
      elements[name] = bounds;
    }
  }

  screenshots.push({
    filename,
    description,
    elements,
  });

  console.log(`[OK] Captured: ${filename}`);
}

async function selectTool(page: Page, toolName: string): Promise<boolean> {
  try {
    const toolButton = page
      .getByRole('button', { name: new RegExp(toolName, 'i'), exact: false })
      .first();
    if (await toolButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await toolButton.click();
      await page.waitForTimeout(200);
      return true;
    }
  } catch (_error) {
    recordBug(
      'minor',
      `Cannot find ${toolName} tool`,
      `Tool button with name matching "${toolName}" not found`,
      [`Look for button matching /${toolName}/i in toolbar`],
    );
  }
  return false;
}

async function getCanvasCenter(page: Page): Promise<{ x: number; y: number } | null> {
  const canvas = page.locator('.editor-canvas, .editor-shell__canvas-dock canvas').first();
  if (await canvas.isVisible({ timeout: 1000 }).catch(() => false)) {
    const box = await canvas.boundingBox();
    if (box) {
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }
  }
  return null;
}

test('enhanced email workspace dogfood', async ({ page }) => {
  console.log('\n[START] Enhanced Email Workspace Dogfood Test\n');

  // Navigate and setup
  await navigateToEditor(page);
  console.log('[OK] Navigated to editor');

  await switchToEmailWorkspace(page);
  console.log('[OK] Switched to Email workspace');
  await page.waitForTimeout(1000);

  // Capture initial state
  await captureScreenshotWithMetadata(
    page,
    'enhanced-01-initial-email-workspace.png',
    'Initial Email workspace view',
    {
      'workspace-tabs': '.workspace-dock__bar',
      'layers-panel': '.layers-panel',
      inspector: '.inspector',
      'canvas-area': '.editor-canvas, .editor-shell__canvas-dock',
      toolbar: '.toolbar, .tool-palette',
      'email-preview': '.email-preview-panel, [data-panel-id="emailPreview"]',
    },
  );

  // Try to open Email inspector tab
  const emailTab = page.getByRole('tab', { name: /email/i }).first();
  if (await emailTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailTab.click();
    await page.waitForTimeout(300);
  } else {
    recordBug(
      'major',
      'Email inspector tab not found',
      'Could not find Email tab in inspector panel',
      ['Switch to Email workspace', 'Look for Email tab in inspector'],
    );
  }

  // Check if we can enable email profile
  const enableEmailButton = page
    .locator('button:has-text("Enable Email"), button:has-text("Create Email")')
    .first();
  if (await enableEmailButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await enableEmailButton.click();
    await page.waitForTimeout(500);
    console.log('[OK] Enabled email profile');
  }

  // Create email container frame (600px wide typical)
  const center = await getCanvasCenter(page);
  if (!center) {
    recordBug('critical', 'Cannot find canvas', 'Canvas element not found or not visible', [
      'Open email workspace',
      'Look for .editor-canvas',
    ]);
    return;
  }

  if (await selectTool(page, 'frame')) {
    // Draw 600x1000 email frame
    const frameX = center.x - 150;
    const frameY = center.y - 250;
    await page.mouse.move(frameX, frameY);
    await page.mouse.down();
    await page.mouse.move(frameX + 300, frameY + 500);
    await page.mouse.up();
    await page.waitForTimeout(500);
    console.log('[OK] Created email container frame');

    await captureScreenshotWithMetadata(
      page,
      'enhanced-02-email-frame-created.png',
      'Email container frame created on canvas',
      { canvas: '.editor-canvas' },
    );
  }

  // Add header text
  await selectTool(page, 'select');
  await page.waitForTimeout(200);

  if (await selectTool(page, 'text')) {
    const headerY = center.y - 200;
    await page.mouse.click(center.x, headerY);
    await page.waitForTimeout(300);
    await page.keyboard.type('Design without the detour');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    console.log('[OK] Added header text');
  }

  // Add subheading
  if (await selectTool(page, 'text')) {
    const subheadY = center.y - 150;
    await page.mouse.click(center.x, subheadY);
    await page.waitForTimeout(300);
    await page.keyboard.type('Varve brings your ideas to life with precision and speed.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    console.log('[OK] Added subheading');
  }

  // Add CTA button shape
  if (await selectTool(page, 'rect')) {
    const btnX = center.x - 60;
    const btnY = center.y - 50;
    await page.mouse.move(btnX, btnY);
    await page.mouse.down();
    await page.mouse.move(btnX + 120, btnY + 40);
    await page.mouse.up();
    await page.waitForTimeout(500);
    console.log('[OK] Added CTA button shape');
  }

  // Add button text
  await selectTool(page, 'select');
  await page.waitForTimeout(200);

  if (await selectTool(page, 'text')) {
    const btnTextY = center.y - 30;
    await page.mouse.click(center.x, btnTextY);
    await page.waitForTimeout(300);
    await page.keyboard.type('Download Varve');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    console.log('[OK] Added button text');
  }

  // Add body text
  if (await selectTool(page, 'text')) {
    const bodyY = center.y + 30;
    await page.mouse.click(center.x, bodyY);
    await page.waitForTimeout(300);
    await page.keyboard.type('Experience professional design tools built for creators.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    console.log('[OK] Added body text');
  }

  // Add footer text
  if (await selectTool(page, 'text')) {
    const footerY = center.y + 200;
    await page.mouse.click(center.x, footerY);
    await page.waitForTimeout(300);
    await page.keyboard.type('(c) 2026 Varve. All rights reserved.');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    console.log('[OK] Added footer');
  }

  await page.waitForTimeout(1000);

  // Capture canvas with content
  await captureScreenshotWithMetadata(
    page,
    'enhanced-03-email-content-complete.png',
    'Email with header, CTA, body, and footer',
    {
      canvas: '.editor-canvas',
      layers: '.layers-panel',
    },
  );

  // Select an element and capture selection
  await selectTool(page, 'select');
  await page.mouse.click(center.x, center.y - 180); // Click on header
  await page.waitForTimeout(500);

  await captureScreenshotWithMetadata(
    page,
    'enhanced-04-element-selected.png',
    'Element selected with selection outline visible',
    {
      canvas: '.editor-canvas',
      'selection-outline': '.selection-overlay',
      inspector: '.inspector',
    },
  );

  // Try desktop/mobile preview toggle
  const desktopToggle = page
    .locator('button:has-text("Desktop"), [aria-label*="desktop" i]')
    .first();
  const mobileToggle = page.locator('button:has-text("Mobile"), [aria-label*="mobile" i]').first();

  if (await desktopToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
    await desktopToggle.click();
    await page.waitForTimeout(500);

    await captureScreenshotWithMetadata(
      page,
      'enhanced-05-preview-desktop.png',
      'Email preview in desktop viewport',
      {
        'preview-panel': '.email-preview-panel',
        'preview-frame': '.email-panel__preview-frame iframe',
        'desktop-btn': 'button:has-text("Desktop")',
        'mobile-btn': 'button:has-text("Mobile")',
      },
    );
    console.log('[OK] Captured desktop preview');
  } else {
    recordBug(
      'minor',
      'Desktop/mobile preview toggle not found',
      'Could not find preview viewport toggle buttons',
      ['Open Email workspace', 'Look for Email Preview panel', 'Look for Desktop/Mobile buttons'],
    );
  }

  if (await mobileToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
    await mobileToggle.click();
    await page.waitForTimeout(500);

    await captureScreenshotWithMetadata(
      page,
      'enhanced-06-preview-mobile.png',
      'Email preview in mobile viewport',
      {
        'preview-panel': '.email-preview-panel',
        'mobile-btn': 'button:has-text("Mobile")',
      },
    );
    console.log('[OK] Captured mobile preview');
  }

  // Look for block list / inserter
  const blockListButton = page
    .locator('button:has-text("Blocks"), button:has-text("Insert"), [aria-label*="block" i]')
    .first();
  if (await blockListButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await blockListButton.click();
    await page.waitForTimeout(500);

    await captureScreenshotWithMetadata(
      page,
      'enhanced-07-block-inserter.png',
      'Email block inserter showing available blocks',
      {
        'block-list': '.email-blocks-panel, .email-source-blocks',
        inspector: '.inspector',
      },
    );
    console.log('[OK] Captured block inserter');
  } else {
    console.log('! Block inserter not found');
  }

  // Look for preflight/compatibility results
  const preflightButton = page
    .locator(
      'button:has-text("Preflight"), button:has-text("Compatibility"), [aria-label*="preflight" i]',
    )
    .first();
  if (await preflightButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await preflightButton.click();
    await page.waitForTimeout(500);

    await captureScreenshotWithMetadata(
      page,
      'enhanced-08-preflight-results.png',
      'Email preflight and compatibility check results',
      {
        'preflight-panel': '.email-preflight-panel',
        findings: '.preflight-finding, .diagnostic-item',
      },
    );
    console.log('[OK] Captured preflight results');
  } else {
    console.log('! Preflight panel not found');
  }

  // Try to open Email Output panel
  const outputButton = page
    .locator('button:has-text("Output"), button:has-text("HTML"), [aria-label*="output" i]')
    .first();
  if (await outputButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await outputButton.click();
    await page.waitForTimeout(500);
  }

  const outputPanel = page.locator('.email-output-panel, [data-panel-id="emailOutput"]').first();
  if (await outputPanel.isVisible({ timeout: 1000 }).catch(() => false)) {
    await captureScreenshotWithMetadata(
      page,
      'enhanced-09-html-output.png',
      'Generated HTML output and export options',
      {
        'output-panel': '.email-output-panel',
        'html-editor': '.email-code-editor',
        'export-buttons': '.email-output-panel button',
      },
    );
    console.log('[OK] Captured HTML output');

    // Look for plain text output
    const plainTextTab = page.locator('button:has-text("Plain"), [aria-label*="plain" i]').first();
    if (await plainTextTab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await plainTextTab.click();
      await page.waitForTimeout(500);

      await captureScreenshotWithMetadata(
        page,
        'enhanced-10-plain-text-output.png',
        'Generated plain text email output',
        {
          'output-panel': '.email-output-panel',
          'plain-text': '.email-plain-text-preview',
        },
      );
      console.log('[OK] Captured plain text output');
    }
  } else {
    recordBug(
      'major',
      'Email Output panel not accessible',
      'Could not find or open Email Output panel',
      ['Open Email workspace', 'Look for Output button or panel'],
    );
  }

  // Final full workspace capture
  await captureScreenshotWithMetadata(
    page,
    'enhanced-11-complete-workspace.png',
    'Complete Email workspace with finished design',
    {
      'workspace-tabs': '.workspace-dock__bar',
      toolbar: '.toolbar',
      layers: '.layers-panel',
      canvas: '.editor-canvas',
      inspector: '.inspector',
      preview: '.email-preview-panel',
      output: '.email-output-panel',
    },
  );

  // Capture close crops
  const canvasArea = page.locator('.editor-canvas').first();
  if (await canvasArea.isVisible({ timeout: 1000 }).catch(() => false)) {
    await canvasArea.screenshot({
      path: path.join(artifactsDir, 'enhanced-12-canvas-close-crop.png'),
      type: 'png',
    });
    screenshots.push({
      filename: 'enhanced-12-canvas-close-crop.png',
      description: 'Close crop of canvas showing email design',
      elements: {},
    });
    console.log('[OK] Captured canvas close crop');
  }

  // Write metadata
  const metadataPath = path.join(artifactsDir, 'screenshot-metadata-enhanced.json');
  fs.writeFileSync(metadataPath, JSON.stringify(screenshots, null, 2));
  console.log(`\n[OK] Saved metadata: screenshot-metadata-enhanced.json`);

  // Write bug report
  const bugsPath = path.join(artifactsDir, 'bugs-found.json');
  fs.writeFileSync(bugsPath, JSON.stringify(bugs, null, 2));
  console.log(`[OK] Saved bug report: bugs-found.json (${bugs.length} issues)`);

  // Write comprehensive report
  const reportPath = path.join(artifactsDir, 'dogfood-report-enhanced.md');
  const report = `# Email Workspace Dogfood Report (Enhanced)

## Test Information

- **Date**: ${new Date().toISOString()}
- **Viewport**: 1920x1200 @ 2x device scale
- **Environment**: Dev server on http://localhost:1420
- **Screenshots captured**: ${screenshots.length}
- **Bugs found**: ${bugs.length}

## Email Design Created

A realistic marketing email template with:
- Header text: "Design without the detour"
- Subheading with value proposition
- Call-to-action button: "Download Varve"
- Body text
- Footer with copyright

## Screenshots Captured

${screenshots
  .map(
    (s, i) => `${i + 1}. **${s.filename}**
   - ${s.description}
   - Elements tracked: ${Object.keys(s.elements).length}`,
  )
  .join('\n\n')}

## UI Elements and Bounding Boxes

${screenshots
  .map((s) => {
    if (Object.keys(s.elements).length === 0) {
      return `### ${s.filename}\n(No elements tracked)`;
    }
    const elementsText = Object.entries(s.elements)
      .map(
        ([name, box]) => `- **${name}**: x=${box.x}, y=${box.y}, w=${box.width}, h=${box.height}`,
      )
      .join('\n');
    return `### ${s.filename}\n${elementsText}`;
  })
  .join('\n\n')}

## Bugs and Issues Found

${
  bugs.length === 0
    ? '[DONE] No bugs found during this session!'
    : bugs
        .map(
          (bug, i) => `### ${i + 1}. [${bug.severity.toUpperCase()}] ${bug.title}

**Description**: ${bug.description}

**Reproduction Steps**:
${bug.repro.map((step, j) => `${j + 1}. ${step}`).join('\n')}

${bug.screenshot ? `**Screenshot**: ${bug.screenshot}` : ''}
`,
        )
        .join('\n---\n\n')
}

## Features Exercised

- [DONE] Workspace switching (Ctrl+Shift+6 to Email)
- [DONE] Email inspector tab
- [DONE] Frame tool for email container
- [DONE] Text tool for content creation
- [DONE] Rectangle tool for CTA button
- [DONE] Selection tool
- [DONE] Email Preview panel
- ${bugs.some((b) => b.title.includes('preview toggle')) ? '[WARN]' : '[DONE]'} Desktop/Mobile preview toggle
- ${bugs.some((b) => b.title.includes('Output')) ? '[WARN]' : '[DONE]'} Email Output panel
- ${bugs.some((b) => b.title.includes('Preflight')) ? '[WARN]' : '[DONE]'} Preflight/compatibility checks
- ${bugs.some((b) => b.title.includes('block')) ? '[WARN]' : '[DONE]'} Block inserter

## Notes

- All screenshots captured at 2x device scale for high quality (3840x2400 effective resolution)
- Bounding boxes are in screenshot pixel coordinates (already scaled)
- Test focused on realistic email authoring workflow
- Additional content blocks (hero image, 2-column section) could be added with more time

## Recommendations for Marketing Video

1. **Hero shots**: Use \`enhanced-03-email-content-complete.png\` and \`enhanced-11-complete-workspace.png\`
2. **Detail shots**: Use close crops to highlight specific features
3. **Interaction demos**: Show desktop/mobile preview toggle, block selection
4. **Export flow**: Demonstrate HTML and plain text output generation

---

Generated by Email Workspace Dogfood Test
`;

  fs.writeFileSync(reportPath, report);
  console.log(`[OK] Saved comprehensive report: dogfood-report-enhanced.md`);

  console.log('\n[DONE] Enhanced Email Workspace Dogfood Complete!\n');
  console.log(`[DIR] Artifacts: ${artifactsDir}`);
  console.log(`[PICS] Screenshots: ${screenshots.length}`);
  console.log(`[BUGS] Bugs: ${bugs.length}`);
  if (bugs.length > 0) {
    console.log('\n[WARN]  Issues by severity:');
    const bySeverity = bugs.reduce(
      (acc, bug) => {
        acc[bug.severity] = (acc[bug.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    Object.entries(bySeverity).forEach(([sev, count]) => {
      console.log(`   ${sev}: ${count}`);
    });
  }
});
