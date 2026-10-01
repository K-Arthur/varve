/**
 * Responsive contract for the dock panels — the Layers rail, the Inspector, and
 * the panels the dock geometry places around the canvas.
 *
 * The rails are positioned from `useEditorDockGeometry`'s bounds, so a panel
 * can be "placed" and still be unusable: pushed partly outside the viewport,
 * overlapping the canvas rectangle, or clipping its own controls where the
 * splitter's hit band then covers the remainder. Every finding is collected and
 * reported together rather than failing on the first one, so one run gives the
 * whole picture at that width.
 *
 * Findings are reported as a list; the test fails if any remain.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const WIDTHS = [1920, 1440, 1280, 1160, 1000, 936, 900, 899, 768, 641, 480, 360];

interface PanelProbe {
  selector: string;
  visible: boolean;
  box: { x: number; y: number; right: number; bottom: number; w: number; h: number } | null;
  /** Text inside the panel that is cut off without an ellipsis. */
  clippedText: string[];
  /** Controls whose centre no longer hit-tests to themselves (or a child). */
  unreachable: string[];
}

async function probePanels(page: import('@playwright/test').Page): Promise<{
  viewport: { w: number; h: number };
  dock: { x: number; y: number; right: number; bottom: number; w: number } | null;
  canvasWidth: number;
  panels: PanelProbe[];
}> {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
    };

    const clippedTextIn = (root: Element): string[] => {
      const bad: string[] = [];
      for (const el of root.querySelectorAll('*')) {
        const hasText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 3,
        );
        if (!hasText) continue;
        if (/sr-only|visually-hidden/.test(String(el.className))) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        if (['auto', 'scroll'].includes(cs.overflowX)) continue;
        const spill = el.scrollWidth - el.clientWidth;
        if (spill > 2 && cs.textOverflow !== 'ellipsis') {
          bad.push(
            `${String(el.className).slice(0, 48)} :: ${(el.textContent ?? '').trim().slice(0, 28)} (${Math.round(spill)}px)`,
          );
        }
      }
      return bad;
    };

    const unreachableIn = (root: Element): string[] => {
      const bad: string[] = [];
      const clippedByScrollAncestor = (el: HTMLElement): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const pr = p.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) {
            return true;
          }
        }
        return false;
      };
      const candidates = root.querySelectorAll<HTMLElement>(
        'button, input, [role="button"], [role="tab"], [role="treeitem"]',
      );
      for (const el of [...candidates].slice(0, 40)) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (cs.pointerEvents === 'none') continue;
        // Scrolled-out or clipped content is reachable by scrolling; only
        // in-view controls are hit-tested.
        const rootRect = root.getBoundingClientRect();
        if (
          r.bottom < rootRect.top + 1 ||
          r.top > rootRect.bottom - 1 ||
          r.right < rootRect.left + 1 ||
          r.left > rootRect.right - 1
        ) {
          continue;
        }
        if (clippedByScrollAncestor(el)) continue;
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const hit = document.elementFromPoint(cx, cy);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit.contains(el)) continue;
        const label =
          el.getAttribute('aria-label') ??
          ((el.textContent ?? '').trim().slice(0, 24) || el.tagName);
        const hitBox = hit.getBoundingClientRect();
        const point = `(${Math.round(cx)},${Math.round(cy)})`;
        const ancestorClips: string[] = [];
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
          const box = parent.getBoundingClientRect();
          ancestorClips.push(
            `${String(parent.className).slice(0, 28)}:${style.overflowX}/${style.overflowY} y${Math.round(box.top)}..${Math.round(box.bottom)} scroll${parent.scrollTop}/${parent.clientHeight}/${parent.scrollHeight}`,
          );
        }
        const labelText = el.closest('label')?.textContent?.trim().slice(0, 48) ?? '';
        bad.push(
          `${label} ${String(el.className).slice(0, 32)} ${labelText} at ${point} covered by ${String(hit.className).slice(0, 40)} [${Math.round(hitBox.left)},${Math.round(hitBox.top)} ${Math.round(hitBox.width)}x${Math.round(hitBox.height)}] via ${ancestorClips.join(' > ')}`,
        );
      }
      return bad;
    };

    const dockEl = document.querySelector('.editor-shell__canvas-dock');
    const dock = dockEl ? rect(dockEl) : null;
    const canvas = document.querySelector('.editor-canvas');
    const panels: PanelProbe[] = [];
    for (const selector of [
      '.editor__layers-panel',
      '.editor__inspector-panel',
      '.workspace-bottom-panels',
      '.editor__codegen-panel',
      '.editor__logo-panel',
      '.editor__library-panel',
    ]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const r = rect(el);
      const cs = getComputedStyle(el);
      const visible = cs.display !== 'none' && cs.visibility === 'visible' && r.w > 0 && r.h > 0;
      if (!visible) continue;
      // Compact widths park the rails off-canvas as dismissible drawers; only
      // what is actually on screen is judged.
      if (r.right < 1 || r.x > window.innerWidth - 1) continue;
      panels.push({
        selector,
        visible,
        box: r,
        clippedText: clippedTextIn(el),
        unreachable: unreachableIn(el),
      });
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dock,
      canvasWidth: canvas ? canvas.getBoundingClientRect().width : 0,
      panels,
    };
  });
}

test.describe('dock panels responsive contract', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('panels stay inside the viewport, clear of the canvas, and unclipped', async ({ page }) => {
    test.setTimeout(300_000);
    await navigateToEditor(page);
    await expect(page.locator('.editor-shell')).toBeVisible();

    const findings: string[] = [];
    const report: string[] = [];

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width >= 1200 ? 900 : 800 });
      await page.waitForTimeout(300);
      const probe = await probePanels(page);
      const lines: string[] = [`--- ${width}px (viewport ${probe.viewport.w})`];

      if (probe.dock) {
        lines.push(
          `  dock ${Math.round(probe.dock.x)}..${Math.round(probe.dock.right)} | canvas width ${Math.round(probe.canvasWidth)}`,
        );
        // The canvas keeps its registered floor whenever both rails are docked
        // at a desktop width.
        if (width >= 900 && probe.panels.length > 0) {
          if (probe.canvasWidth < 319) {
            findings.push(`${width}px: canvas width ${Math.round(probe.canvasWidth)} < 320 floor`);
          }
        }
      }

      for (const panel of probe.panels) {
        const box = panel.box!;
        lines.push(
          `  ${panel.selector} ${Math.round(box.x)}..${Math.round(box.right)} y${Math.round(box.y)}..${Math.round(box.bottom)}`,
        );
        const id = `${width}px ${panel.selector}`;

        if (box.x < -1 || box.right > probe.viewport.w + 1) {
          findings.push(
            `${id}: horizontally outside the viewport (${Math.round(box.x)}..${Math.round(box.right)} of ${probe.viewport.w})`,
          );
        }
        if (box.y < -1 || box.bottom > probe.viewport.h + 1) {
          findings.push(
            `${id}: vertically outside the viewport (${Math.round(box.y)}..${Math.round(box.bottom)} of ${probe.viewport.h})`,
          );
        }
        if (probe.dock) {
          if (panel.selector === '.editor__layers-panel' && box.right > probe.dock.x + 1) {
            findings.push(
              `${id}: overlaps the canvas by ${Math.round(box.right - probe.dock.x)}px`,
            );
          }
          if (
            panel.selector === '.editor__inspector-panel' &&
            box.x < probe.dock.x + probe.dock.w - 1
          ) {
            findings.push(
              `${id}: overlaps the canvas by ${Math.round(probe.dock.x + probe.dock.w - box.x)}px`,
            );
          }
        }
        for (const text of panel.clippedText) findings.push(`${id}: clipped text ${text}`);
        for (const control of panel.unreachable)
          findings.push(`${id}: unreachable control ${control}`);
        if (panel.clippedText.length > 0 || panel.unreachable.length > 0) {
          lines.push(
            `    clipped: ${panel.clippedText.length} | unreachable: ${panel.unreachable.length}`,
          );
        }
      }
      report.push(lines.join('\n'));
    }

    console.log(`DOCK-PANEL-REPORT\n${report.join('\n')}`);
    console.log(`DOCK-PANEL-FINDINGS ${JSON.stringify(findings, null, 1)}`);
    expect(findings, `responsive panel findings:\n${findings.join('\n')}`).toEqual([]);
  });
});
