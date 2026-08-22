#!/usr/bin/env node
/**
 * Video E — transparent engineering status reel.
 *
 * The captions are generated from evidence in the current checkout. This
 * workflow fails when an evidence anchor disappears, which makes a published
 * reel detectably stale instead of silently preserving an old complaint.
 */
import { strict as assert } from 'node:assert';
import {
  useTool as activateTool,
  beat,
  dragAt,
  fitContent,
  openCleanEditor,
  parkPointer,
  settle,
} from '../core/editor.mjs';
import { capture, ROOT } from '../core/run.mjs';
import { auditLimitations } from '../limitations.mjs';

let report = null;

async function showCaption(page, index, item) {
  await page.evaluate(
    ({ index, item }) => {
      document.querySelector('[data-capture-limitations-caption]')?.remove();
      const el = document.createElement('div');
      el.dataset.captureLimitationsCaption = 'true';
      el.style.cssText = [
        'position:fixed',
        'left:42px',
        'bottom:42px',
        'z-index:2147483647',
        'width:620px',
        'padding:20px 24px',
        'border-radius:12px',
        'background:rgba(15,18,22,.94)',
        'color:#fff',
        'font:16px/1.45 system-ui,sans-serif',
        'box-shadow:0 8px 30px rgba(0,0,0,.3)',
      ].join(';');
      el.innerHTML = `<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#7dd3c7;margin-bottom:7px">${index + 1} / 5 · ${item.kind}</div><strong style="font-size:25px;line-height:1.15;display:block;margin-bottom:9px">${item.title}</strong><div>${item.status} · Evidence: ${item.evidence[0].file}</div>`;
      document.body.appendChild(el);
    },
    { index, item },
  );
}

await capture({
  slug: 'current-limitations',
  workflow: 'Five things currently broken/unfinished in Varve',
  purpose: 'A current, evidence-backed status reel. It is not a bug-hunting performance.',
  fixture: null,
  duration: [40, 65],
  metadata: () => ({
    limitationsReport: report,
    stalePolicy: 'Capture fails if any evidence file/anchor disappears or the count is not five.',
  }),
  artifacts: () => [
    { name: 'current-limitations.json', contents: `${JSON.stringify(report, null, 2)}\n` },
  ],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    report = auditLimitations(ROOT);
    const assertions = [];
    // This is a public status reel, not an engineering diagnostics clip: the
    // evidence captions are the source of truth, so the development HUD must
    // stay out of the delivered artwork.
    await openCleanEditor(page, base);
    await activateTool(page, 'r');
    await dragAt(page, [0.12, 0.2], [0.42, 0.55]);
    await activateTool(page, 'o');
    await dragAt(page, [0.55, 0.22], [0.84, 0.52]);
    await activateTool(page, 'v');
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    assert.equal(report.limitations.length, 5);
    begin();
    await beat(page, 2200);

    for (const [index, item] of report.limitations.entries()) {
      await showCaption(page, index, item);
      await beat(page, 6000);
      assertions.push(`${item.title} remains current at ${report.exactGitSha}`);
    }
    await page.evaluate(() =>
      document.querySelector('[data-capture-limitations-caption]')?.remove(),
    );
    await parkPointer(page);
    await beat(page, 2600);
    return assertions;
  },
});
