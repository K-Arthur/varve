import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/** Minimal deterministic PNG writer so the fixture is generated, not checked in. */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function makeSubjectPng(width: number, height: number, withSubject = true): Buffer {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.22;
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 4;
      const inSubject = withSubject && (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
      raw[offset] = inSubject ? 214 : 238;
      raw[offset + 1] = inSubject ? 46 : 242;
      raw[offset + 2] = inSubject ? 52 : 246;
      raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test.describe('Select subject — model-free foreground estimate', () => {
  test('reviews a foreground proposal on a licensed real photograph', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-still-life.jpg'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('button', { name: 'Selection Sources' }).click();
    await inspector.getByRole('button', { name: 'Select subject' }).click();

    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /(?:Subject \d+|All foreground) selected/,
      { timeout: 30000 },
    );
    await expect(inspector.getByText(/estimate · \d+ proposal/)).toBeVisible();
    await expect(
      inspector.getByRole('button', { name: /(?:Subject \d+|All foreground), covers \d+ percent/ }),
    ).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'Save selection' })).toBeEnabled();

    const canvas = page.getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await testInfo.attach('select-subject-real-photo', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('select-subject-real-photo.png') });
  });

  test('proposes and applies a centred subject with the bundled local model', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);

    const fixture = testInfo.outputPath('subject-fixture.png');
    writeFileSync(fixture, makeSubjectPng(320, 240));
    await page.locator('#file-import-input').setInputFiles(fixture);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('button', { name: 'Selection Sources' }).click();
    const selectSubject = inspector.getByRole('button', { name: 'Select subject' });
    await expect(selectSubject).toBeVisible();
    await selectSubject.click();

    // The top-ranked proposal is applied immediately and announced by the
    // canvas announcer; no optional model install or download is involved.
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'All foreground selected',
      { timeout: 15000 },
    );
    await expect(inspector.getByText(/estimate · \d+ proposal/)).toBeVisible();
    await expect(
      inspector.getByRole('button', { name: /All foreground, covers \d+ percent/ }),
    ).toBeVisible();
    // An area selection now exists, so the save action becomes available.
    await expect(inspector.getByRole('button', { name: 'Save selection' })).toBeEnabled();

    const canvas = page.getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await testInfo.attach('select-subject-result', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('select-subject-result.png') });

    // Choosing an alternative proposal replaces the selection explicitly.
    await inspector.getByRole('button', { name: /All foreground, covers \d+ percent/ }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /All foreground selected/,
    );
  });

  test('reports no subject on a uniform image instead of inventing one', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const fixture = testInfo.outputPath('flat-fixture.png');
    writeFileSync(fixture, makeSubjectPng(120, 120, false));
    await page.locator('#file-import-input').setInputFiles(fixture);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('button', { name: 'Selection Sources' }).click();
    await inspector.getByRole('button', { name: 'Select subject' }).click();

    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      'No prominent foreground subject was found',
      { timeout: 15000 },
    );
    await expect(inspector.getByText(/Foreground estimate/)).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'Save selection' })).toBeDisabled();
  });
});
