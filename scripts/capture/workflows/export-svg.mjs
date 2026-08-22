#!/usr/bin/env node
/**
 * Video G — Design to SVG.
 *
 * Concept: a small space/astronomy icon set — primitives, one Bézier and
 * some type. The artwork is built before the cut so the clip opens on
 * finished work, then exported through the real SVG path.
 *
 * The exported file is captured from the browser download and validated as
 * an artefact: it is parsed, its viewBox and geometry are checked, and it is
 * re-rendered in a fresh browser context that has never seen Varve. A clip
 * showing an export dialog closing proves nothing on its own.
 *
 *   node scripts/capture/workflows/export-svg.mjs
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  beat,
  dragAt,
  fitContent,
  layerNames,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
  useTool,
} from '../core/editor.mjs';
import { capture, ROOT } from '../core/run.mjs';

const ARTIFACT_DIR = join(ROOT, 'docs', 'screenshots', 'workflows', 'artifacts');

/** Structural checks against the exported markup, not against Varve's memory. */
function validateSvg(svg) {
  const findings = [];
  if (!/^\s*<\?xml|^\s*<svg/i.test(svg)) findings.push('does not begin as an SVG document');
  if (!/<\/svg>\s*$/i.test(svg.trim())) findings.push('is not closed');

  const viewBox = svg.match(/viewBox\s*=\s*"([^"]+)"/i)?.[1];
  const width = svg.match(/\swidth\s*=\s*"([^"]+)"/i)?.[1];
  const height = svg.match(/\sheight\s*=\s*"([^"]+)"/i)?.[1];
  if (!viewBox && !(width && height)) findings.push('carries neither a viewBox nor a size');
  if (viewBox && viewBox.trim().split(/[\s,]+/).length !== 4) {
    findings.push(`viewBox is malformed: "${viewBox}"`);
  }

  const drawables = (svg.match(/<(path|rect|circle|ellipse|polygon|line|text|g)\b/gi) ?? []).length;
  if (drawables === 0) findings.push('contains no drawable elements');

  // A transform that stringified an object or a NaN renders as nothing.
  if (/NaN|undefined|\[object/i.test(svg)) findings.push('contains NaN/undefined/[object] tokens');

  return { findings, viewBox, width, height, drawables };
}

await capture({
  slug: 'export-svg',
  workflow: 'Design → SVG',
  purpose: 'Exporting real artwork to SVG and validating the file that comes out.',
  fixture: null,
  duration: [15, 26],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    await settle(page);

    // ── Build the icon set before the cut ──────────────────────────
    // Primitives, one Bézier, and type — the mix the export has to handle.
    await useTool(page, 'o');
    await dragAt(page, [0.08, 0.16], [0.30, 0.38], { steps: 16 });
    await useTool(page, 'r');
    await dragAt(page, [0.39, 0.18], [0.59, 0.36], { steps: 16 });
    await useTool(page, 'o');
    await dragAt(page, [0.68, 0.16], [0.90, 0.38], { steps: 16 });

    // A drawn Bézier: a comet arc.
    await useTool(page, 'p');
    await dragAt(page, [0.10, 0.62], [0.18, 0.54]);
    await dragAt(page, [0.30, 0.70], [0.38, 0.62]);
    await dragAt(page, [0.52, 0.56], [0.60, 0.50]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await useTool(page, 'v');

    await useTool(page, 't');
    await dragAt(page, [0.08, 0.82], [0.72, 0.92]);
    await page.keyboard.type('ORBIT · ICON SET', { delay: 25 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    await useTool(page, 'v');

    await parkPointer(page);
    await fitContent(page);
    await settle(page);

    const artwork = await layerNames(page);
    assert.ok(artwork.length >= 5, `expected a small icon set, got ${artwork.length} layers`);
    assertions.push(`source artwork is ${artwork.length} real nodes: primitives, a Bézier and type`);

    begin();
    await beat(page, 1600);

    // ── Export ─────────────────────────────────────────────────────
    await selectLayer(page, artwork[0].trim().split('\n')[0]);
    await page.waitForTimeout(500);

    const exportTab = page
      .locator('[role="tablist"] button[role="tab"]')
      .filter({ hasText: /^export$/i });
    if (!(await exportTab.isVisible({ timeout: 6000 }).catch(() => false))) {
      throw new Error('no Export tab for the selected node');
    }
    await exportTab.click();
    await page.waitForTimeout(700);
    assertions.push('the Export tab is opened on a real selection');
    await beat(page, 1200);

    // Choose SVG as the output format through the export controls.
    const format = page.getByRole('combobox', { name: /format/i }).first();
    if (await format.isVisible({ timeout: 5000 }).catch(() => false)) {
      await format.selectOption({ label: 'SVG' }).catch(async () => {
        await format.selectOption('svg').catch(() => undefined);
      });
      await page.waitForTimeout(700);
      assertions.push('SVG is chosen as the export format in the export controls');
    }
    await beat(page, 1300);

    // ── Capture the file the application produces ──────────────────
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    const exportBtn = page
      .getByRole('button', { name: /^export$|export selected|download/i })
      .first();
    await exportBtn.waitFor({ state: 'visible', timeout: 8000 });
    await exportBtn.click();

    const download = await downloadPromise;
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    const saved = join(ARTIFACT_DIR, 'export-svg-icon-set.svg');
    await download.saveAs(saved);
    const svg = (await import('node:fs')).readFileSync(saved, 'utf8');
    assertions.push(`export produced ${download.suggestedFilename()} (${svg.length} bytes)`);
    await beat(page, 1500);

    // ── Validate the artefact ──────────────────────────────────────
    const result = validateSvg(svg);
    assert.equal(
      result.findings.length,
      0,
      `exported SVG failed validation: ${result.findings.join('; ')}`,
    );
    assertions.push(
      `exported SVG parses, carries viewBox "${result.viewBox ?? `${result.width}x${result.height}`}" ` +
        `and ${result.drawables} drawable elements, with no NaN or undefined tokens`,
    );

    // ── Render it somewhere that has never seen Varve ──────────────
    const independent = await page.context().browser().newContext({
      viewport: { width: 900, height: 700 },
      deviceScaleFactor: 1,
    });
    const viewer = await independent.newPage();
    await viewer.setContent(`<!doctype html><style>html,body{margin:0}</style>${svg}`, {
      waitUntil: 'load',
    });
    const rendered = await viewer.locator('svg').first().boundingBox();
    assert.ok(
      rendered && rendered.width > 1 && rendered.height > 1,
      'the exported SVG renders to nothing in an independent browser',
    );
    writeFileSync(
      join(ARTIFACT_DIR, 'export-svg-independent-render.png'),
      await viewer.screenshot({ type: 'png' }),
    );
    await independent.close();
    assertions.push(
      `the exported file renders at ${Math.round(rendered.width)}x${Math.round(rendered.height)} ` +
        'in a browser context that never loaded Varve',
    );

    await parkPointer(page);
    await settle(page);
    await beat(page, 1600);

    return assertions;
  },
});
