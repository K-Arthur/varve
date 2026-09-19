/**
 * Layers Panel — workspace-evolution evidence harness.
 *
 * One spec serves both phases so before/after evidence is methodologically
 * identical. Output directory is selected by `VARVE_LAYERS_PHASE`
 * (`baseline` | `after`), defaulting to `after`:
 *
 *   reports/layers-evolution/<phase>/matrix/<workspace>-<theme>.png
 *   reports/layers-evolution/<phase>/matrix/metrics.json
 *   reports/layers-evolution/<phase>/scale/perf.json
 *   reports/layers-evolution/<phase>/realism/<workspace>.png
 *
 * Fixtures are generated in memory (Playwright accepts a FilePayload) so the
 * repository never carries multi-megabyte synthetic SVGs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

const PHASE = process.env.VARVE_LAYERS_PHASE ?? 'after';
const ROOT = path.resolve('reports/layers-evolution', PHASE);

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function record(rel: string, data: unknown) {
  const file = path.join(ROOT, rel);
  ensureDir(path.dirname(file));
  writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── In-memory fixtures ──────────────────────────────────────────────────────

function svgDocument(svg: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name: 'fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) };
}

function svgShell(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

/** N rects distributed across G named groups. */
function flatSvg(groupCount: number, perGroup: number): string {
  let body = '';
  for (let g = 0; g < groupCount; g++) {
    body += `<g id="group-${g}" data-name="Group ${g + 1}">`;
    for (let i = 0; i < perGroup; i++) {
      const idx = g * perGroup + i;
      body += `<rect id="r${idx}" data-name="Layer ${idx + 1}" x="${(idx % 50) * 12}" y="${Math.floor(idx / 50) * 12}" width="10" height="10" fill="#3a7"/>`;
    }
    body += '</g>';
  }
  return svgShell(640, Math.ceil((groupCount * perGroup) / 50) * 12 + 40, body);
}

/** 24 nested groups, one leaf at the bottom. */
function deepSvg(depth: number): string {
  let body = '';
  for (let d = 0; d < depth; d++) body += `<g id="d${d}" data-name="Depth ${d + 1}">`;
  body +=
    '<rect id="deep-leaf" data-name="Deep leaf" x="10" y="10" width="20" height="20" fill="#c33"/>';
  for (let d = 0; d < depth; d++) body += '</g>';
  return svgShell(200, 200, body);
}

/** Long names, RTL names, duplicates, empty groups. */
function namesSvg(): string {
  const long =
    'A very long layer name that exceeds any reasonable panel width and must truncate cleanly without breaking the row';
  return svgShell(
    400,
    400,
    `<g id="empty" data-name="Empty group"></g>
     <g id="dupes" data-name="Duplicates">
       <rect id="dup1" data-name="Button" x="10" y="10" width="40" height="20" fill="#58a"/>
       <rect id="dup2" data-name="Button" x="60" y="10" width="40" height="20" fill="#a85"/>
       <rect id="dup3" data-name="Button" x="110" y="10" width="40" height="20" fill="#8a5"/>
     </g>
     <rect id="long" data-name="${long}" x="10" y="60" width="200" height="20" fill="#777"/>
     <rect id="rtl" data-name="مستطيل الصفحة الرئيسية" x="10" y="100" width="200" height="20" fill="#577"/>
     <g id="locked-parent">
       <rect id="locked-child" data-name="Unlocked child of locked parent" x="10" y="140" width="80" height="20" fill="#759"/>
     </g>
     <g id="hidden-parent">
       <rect id="hidden-child" data-name="Child of hidden ancestor" x="10" y="180" width="80" height="20" fill="#975"/>
     </g>`,
  );
}

/** Print-like brochure: a guides group, text frames, and images. */
function printBrochureSvg(): string {
  const body = `
    <g id="guides" data-name="Guides (non-printing)">
      <rect id="guide-col-1" data-name="Column guide 1" x="40" y="0" width="1" height="600" fill="#f0f"/>
      <rect id="guide-col-2" data-name="Column guide 2" x="200" y="0" width="1" height="600" fill="#f0f"/>
      <rect id="guide-margin" data-name="Margin frame" x="20" y="20" width="360" height="560" fill="none" stroke="#f0f"/>
    </g>
    <g id="cover" data-name="Page 1 — Cover">
      <rect id="cover-bg" data-name="Cover background" x="0" y="0" width="400" height="600" fill="#123"/>
      <rect id="cover-image" data-name="Cover photograph" x="0" y="180" width="400" height="260" fill="#456"/>
      <rect id="headline-a" data-name="Headline — first line" x="40" y="80" width="300" height="34" fill="#fff"/>
      <rect id="headline-b" data-name="Headline — second line" x="40" y="120" width="240" height="34" fill="#fff"/>
      <rect id="standfirst" data-name="Standfirst paragraph" x="40" y="470" width="320" height="60" fill="#9ab"/>
    </g>
    <g id="spread-2-3" data-name="Pages 2–3 — Feature">
      <rect id="feature-body" data-name="Feature body copy" x="40" y="60" width="150" height="480" fill="#ddd"/>
      <rect id="feature-pull" data-name="Pull quote" x="220" y="60" width="140" height="90" fill="#678"/>
      <rect id="feature-image" data-name="Feature photograph" x="220" y="170" width="140" height="200" fill="#876"/>
      <rect id="feature-caption" data-name="Image caption" x="220" y="380" width="140" height="40" fill="#aaa"/>
    </g>
    <g id="footer" data-name="Running footer">
      <rect id="folio" data-name="Folio" x="180" y="570" width="40" height="14" fill="#ccc"/>
    </g>`;
  return svgShell(400, 600, body);
}

/** Email-like newsletter: section → row → column → block. */
function emailNewsletterSvg(): string {
  const body = `
    <g id="preheader" data-name="Preheader">
      <rect id="pre-text" data-name="Preheader text" x="0" y="0" width="600" height="30" fill="#eee"/>
    </g>
    <g id="header-section" data-name="Header section">
      <rect id="logo" data-name="Logo image" x="24" y="30" width="120" height="40" fill="#2a7"/>
      <rect id="nav" data-name="Navigation links" x="360" y="40" width="216" height="20" fill="#ddd"/>
    </g>
    <g id="body-section" data-name="Body section">
      <g id="hero-row" data-name="Hero row">
        <g id="hero-col" data-name="Hero column">
          <rect id="hero-img" data-name="Hero image" x="0" y="70" width="600" height="220" fill="#587"/>
          <rect id="hero-head" data-name="Hero heading" x="40" y="310" width="400" height="28" fill="#234"/>
          <rect id="hero-cta" data-name="Hero button" x="240" y="360" width="120" height="36" fill="#2a7"/>
        </g>
      </g>
      <g id="two-col-row" data-name="Two column row">
        <g id="col-left" data-name="Left column">
          <rect id="prod-1" data-name="Product image — left" x="20" y="420" width="260" height="160" fill="#97a"/>
          <rect id="prod-1-copy" data-name="Product description — left" x="20" y="590" width="260" height="60" fill="#ccc"/>
        </g>
        <g id="col-right" data-name="Right column">
          <rect id="prod-2" data-name="Product image — right" x="320" y="420" width="260" height="160" fill="#7a9"/>
          <rect id="prod-2-copy" data-name="Product description — right" x="320" y="590" width="260" height="60" fill="#ccc"/>
          <rect id="mobile-only-divider" data-name="Divider (mobile-hidden)" x="320" y="660" width="260" height="2" fill="#999"/>
        </g>
      </g>
    </g>
    <g id="footer-section" data-name="Footer section">
      <rect id="social" data-name="Social icons" x="0" y="680" width="600" height="40" fill="#456"/>
      <rect id="unsub" data-name="Unsubscribe" x="200" y="730" width="200" height="20" fill="#bbb"/>
    </g>`;
  return svgShell(600, 760, body);
}

/** Motion-like: many separately named layers. */
function motionSceneSvg(): string {
  let body =
    '<g id="stage" data-name="Stage"><rect id="bg" data-name="Background" x="0" y="0" width="800" height="450" fill="#123"/>';
  for (let i = 0; i < 40; i++) {
    body += `<g id="actor-${i}" data-name="Actor ${i + 1}">
      <rect id="actor-${i}-body" data-name="Actor ${i + 1} body" x="${20 + (i % 8) * 95}" y="${40 + Math.floor(i / 8) * 80}" width="60" height="60" fill="#4a8"/>
      <rect id="actor-${i}-arm" data-name="Actor ${i + 1} arm" x="${20 + (i % 8) * 95 + 60}" y="${50 + Math.floor(i / 8) * 80}" width="24" height="12" fill="#8a4"/>
    </g>`;
  }
  body += '</g>';
  return svgShell(800, 450, body);
}

/** Logo-like: wordmark + mark + variants. */
function logoSvg(): string {
  const body = `
    <g id="wordmark" data-name="Wordmark">
      <g id="wordmark-letters" data-name="Letterforms">
        <rect id="w1" data-name="Letter V" x="0" y="40" width="40" height="60" fill="#123"/>
        <rect id="w2" data-name="Letter A" x="44" y="40" width="40" height="60" fill="#123"/>
        <rect id="w3" data-name="Letter R" x="88" y="40" width="40" height="60" fill="#123"/>
        <rect id="w4" data-name="Letter V element" x="132" y="40" width="40" height="60" fill="#123"/>
        <rect id="w5" data-name="Letter E" x="176" y="40" width="40" height="60" fill="#123"/>
      </g>
      <rect id="tagline" data-name="Tagline" x="0" y="108" width="180" height="12" fill="#666"/>
    </g>
    <g id="mark" data-name="Symbol">
      <rect id="mark-primary" data-name="Mark primary shape" x="240" y="20" width="100" height="100" fill="#2a7"/>
      <rect id="mark-cut" data-name="Mark negative space" x="270" y="50" width="40" height="40" fill="#fff"/>
    </g>
    <g id="clearspace" data-name="Clear-space guides">
      <rect id="clear-box" data-name="Clear-space boundary" x="230" y="10" width="120" height="120" fill="none" stroke="#f0f"/>
    </g>`;
  return svgShell(400, 160, body);
}

/** Draw-like: heavy freehand-ish path document. */
function drawSvg(): string {
  let body = '<g id="sketch" data-name="Sketch">';
  for (let i = 0; i < 120; i++) {
    const y = 10 + i * 3;
    body += `<path id="stroke-${i}" data-name="Brush stroke ${i + 1}" d="M 10 ${y} C 60 ${y - 8}, 140 ${y + 8}, 380 ${y}" stroke="#246" fill="none" stroke-width="2"/>`;
  }
  body +=
    '</g><g id="color" data-name="Colour"><rect id="flats" data-name="Flat colour" x="10" y="375" width="380" height="20" fill="#c85"/></g>';
  return svgShell(400, 400, body);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function layerCount(page: Page): Promise<number> {
  const text = await page.locator('.layers-panel__count').textContent();
  return Number.parseInt(text ?? '0', 10);
}

async function importSvg(page: Page, svg: string, minLayers: number, timeout = 240_000) {
  await page.locator('#file-import-input').waitFor({ state: 'attached', timeout: 30_000 });
  await page.locator('#file-import-input').setInputFiles(svgDocument(svg));
  await expect.poll(() => layerCount(page), { timeout }).toBeGreaterThanOrEqual(minLayers);
  await page.waitForTimeout(250);
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(120);
}

async function panelShot(page: Page, rel: string) {
  const file = path.join(ROOT, rel);
  ensureDir(path.dirname(file));
  await page.locator('.layers-panel').screenshot({ path: file });
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Layers — workspace evolution evidence', () => {
  test.describe.configure({ timeout: 300_000 });

  test('workspace x theme matrix and layout metrics', async ({ page }) => {
    await navigateToEditor(page);
    await importSvg(page, printBrochureSvg(), 8);

    const workspaces = [
      ['Design', 'design'],
      ['Print', 'print'],
      ['Draw', 'draw'],
      ['Photo', 'photo'],
      ['Motion', 'motion'],
      ['Logo', 'logo'],
      ['Email', 'email'],
      ['Codegen', 'codegen'],
    ] as const;

    const metrics: Record<string, unknown> = {};

    for (const [label, id] of workspaces) {
      await switchWorkspace(page, label);
      await page.waitForTimeout(320);

      for (const theme of ['light', 'dark', 'high-contrast'] as const) {
        await setTheme(page, theme);
        await panelShot(page, path.join('matrix', `${id}-${theme}.png`));
      }

      metrics[id] = await page.evaluate(() => {
        const panel = document.querySelector('.layers-panel');
        if (!panel) return null;
        const row = panel.querySelector('.layers-row') as HTMLElement | null;
        const name = panel.querySelector('.layers-row__name') as HTMLElement | null;
        const icon = panel.querySelector('.layers-row__type-icon') as HTMLElement | null;
        const disclosure = panel.querySelector('.layers-row__disclosure') as HTMLElement | null;
        const rowStyle = row ? getComputedStyle(row) : null;
        const cs = (el: HTMLElement | null) => (el ? getComputedStyle(el) : null);
        return {
          rowHeightPx: row ? Math.round(row.getBoundingClientRect().height) : null,
          rowMinHeight: rowStyle?.minHeight ?? null,
          rowPaddingLeft: rowStyle?.paddingLeft ?? null,
          nameFontSize: cs(name)?.fontSize ?? null,
          nameFontWeight: cs(name)?.fontWeight ?? null,
          nameFontFamily: cs(name)?.fontFamily ?? null,
          iconSizePx: icon ? Math.round(icon.getBoundingClientRect().width) : null,
          disclosureSizePx: disclosure
            ? Math.round(disclosure.getBoundingClientRect().width)
            : null,
          filterChips: panel.querySelectorAll('.layers-filter-bar button').length,
          visibleRowBadges: panel.querySelectorAll('.layers-row__badges > *').length,
          persistentRowControls: panel.querySelectorAll('.layers-row__toggle').length,
          headerActions: panel.querySelectorAll('.layers-panel__header-actions button').length,
        };
      });
    }

    record('matrix/metrics.json', metrics);
    expect(Object.keys(metrics).length).toBe(workspaces.length);
  });

  test('scale and edge-case performance', async ({ page }) => {
    await navigateToEditor(page);

    const perf: Record<string, unknown> = {};

    const time = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
      const start = Date.now();
      const value = await fn();
      return [value, Date.now() - start];
    };

    // 1k nodes in-browser. Larger tiers (10k/50k) are measured on the panel's
    // data layer by `__benchmarks__/layers10k.bench.test.ts`; importing 10k
    // SVG nodes through the full app pipeline exceeds any sane per-test
    // budget and would measure the importer, not the panel.
    const [, importMs] = await time(async () => {
      await importSvg(page, flatSvg(20, 50), 1_000);
      return true;
    });
    perf.import1kMs = importMs;

    const [, renderMs] = await time(async () => {
      await page.locator('.layers-panel__count').waitFor();
      await page.locator('[role="treeitem"]').first().waitFor();
      return true;
    });
    perf.firstTreePaint1kMs = renderMs;

    // Select before scrolling: a post-scroll click can land on a row whose
    // virtualized position moved between hit-test and event delivery. Assert
    // on the tree (any row selected) rather than on the clicked locator —
    // virtualized rows are re-created, so a row-scoped locator can re-resolve
    // to a different node after the commit.
    const [, selectMs] = await time(async () => {
      await page.locator('.layers-panel__tree [role="treeitem"]:visible').nth(5).click();
      await expect(
        page.locator('.layers-panel__tree [role="treeitem"][aria-selected="true"]'),
      ).toHaveCount(1, { timeout: 10_000 });
      return true;
    });
    perf.selectRowMs = selectMs;

    // Expand all: Alt+click the first container's disclosure expands its subtree.
    const firstGroup = page.locator('[role="treeitem"][aria-expanded]').first();
    const [expandedCount, expandMs] = await time(async () => {
      await firstGroup.locator('.layers-row__disclosure').click({ modifiers: ['Alt'] });
      await page.waitForTimeout(400);
      return page.locator('[role="treeitem"]').count();
    });
    perf.expandSubtree1kMs = expandMs;
    perf.renderedRowsAfterExpand = expandedCount;

    // Scroll: 20 wheel steps, measure elapsed.
    const [, scrollMs] = await time(async () => {
      const tree = page.locator('.layers-panel__tree');
      for (let i = 0; i < 20; i++) {
        await tree.hover();
        await page.mouse.wheel(0, 600);
      }
      await page.waitForTimeout(300);
      return true;
    });
    perf.scroll20StepsMs = scrollMs;

    await panelShot(page, 'scale/one-thousand.png');

    // Deep nesting (24 levels), fresh document. Containers default to
    // expanded, so the whole chain is visible without interaction.
    await navigateToEditor(page);
    await importSvg(page, deepSvg(24), 2);
    await page.waitForTimeout(300);
    await panelShot(page, 'scale/deep-nesting.png');
    perf.deepNestingRows = await page.locator('[role="treeitem"]').count();

    // Names: long, RTL, duplicates, empty groups.
    await navigateToEditor(page);
    await importSvg(page, namesSvg(), 6);
    await panelShot(page, 'scale/edge-names.png');

    record('scale/perf.json', perf);
    expect(perf.import1kMs).toBeGreaterThan(0);
  });

  test('per-workspace realistic documents', async ({ page }) => {
    await navigateToEditor(page);

    const fixtures: Array<[string, string, string, number]> = [
      ['print', 'Print', printBrochureSvg(), 8],
      ['email', 'Email', emailNewsletterSvg(), 10],
      ['motion', 'Motion', motionSceneSvg(), 40],
      ['logo', 'Logo', logoSvg(), 6],
      ['draw', 'Draw', drawSvg(), 100],
      ['design', 'Design', emailNewsletterSvg(), 10],
      ['codegen', 'Codegen', logoSvg(), 6],
    ];

    for (const [id, label, svg, min] of fixtures) {
      // Import in Design so the import lands on the design canvas — then
      // switch to the workspace under test so one document is compared
      // across workspaces rather than re-importing per mode.
      await switchWorkspace(page, 'Design');
      await importSvg(page, svg, min);
      await switchWorkspace(page, label);
      await page.waitForTimeout(250);
      // Expand a couple of levels so structure is visible in the evidence.
      const containers = page.locator('[role="treeitem"][aria-expanded]');
      const count = Math.min(await containers.count(), 3);
      for (let i = 0; i < count; i++) {
        const disclosure = containers.nth(i).locator('.layers-row__disclosure');
        if (await disclosure.isVisible().catch(() => false)) {
          await disclosure.click({ modifiers: ['Alt'] }).catch(() => undefined);
        }
      }
      await page.waitForTimeout(300);
      await panelShot(page, path.join('realism', `${id}.png`));
    }
  });
});
