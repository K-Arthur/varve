/** Temporary diagnostic probe — menubar spacing geometry (deleted after use). */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('probe menubar geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await navigateToEditor(page);
  const data = await page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el as HTMLElement);
      return {
        cls: (el.className || '').toString().slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 24),
        x: Math.round(r.x * 10) / 10,
        right: Math.round(r.right * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        padding: cs.padding,
        margin: cs.margin,
        gap: cs.gap,
        fontSize: cs.fontSize,
      };
    };
    const menubar = document.querySelector('.editor-menubar');
    const children = menubar ? [...menubar.children] : [];
    const left = document.querySelector('.editor-menubar__left') ?? children[0];
    const right = document.querySelector('.editor-menubar__controls');
    const title = document.querySelector('.editor-menubar__doc-name');
    const dock = document.querySelector('.workspace-dock');
    const bar = document.querySelector('.workspace-dock__bar');
    const zoom = document.querySelector('.editor-menubar__zoom');
    const zoomInput = document.querySelector('.editor-menubar__zoom-input');
    const dividers = [...document.querySelectorAll('.editor-menubar__zoom-divider')];
    const iconButtons = [
      ...document.querySelectorAll(
        '.editor-menubar__controls .varve-icon-btn, .editor-menubar__controls button',
      ),
    ];
    return {
      menubar: rect(menubar),
      children: children.map(rect),
      left: rect(left ?? null),
      right: rect(right),
      title: rect(title),
      titleCenter: (() => {
        const r = title?.getBoundingClientRect();
        return r ? Math.round((r.x + r.width / 2) * 10) / 10 : null;
      })(),
      viewportCenter: window.innerWidth / 2,
      dock: rect(dock),
      bar: rect(bar),
      zoom: rect(zoom),
      zoomInput: rect(zoomInput),
      dividers: dividers.map(rect),
      iconButtons: iconButtons.slice(0, 8).map(rect),
      barVertical: (() => {
        const m = menubar?.getBoundingClientRect();
        const b = bar?.getBoundingClientRect();
        if (!m || !b) return null;
        return {
          top: Math.round((b.y - m.y) * 10) / 10,
          bottom: Math.round((m.bottom - b.bottom) * 10) / 10,
        };
      })(),
      // gaps between adjacent right-rail items
      rightRailGaps: (() => {
        if (!right) return [];
        const kids = [...right.children];
        const out: unknown[] = [];
        for (let i = 0; i < kids.length - 1; i += 1) {
          const a = kids[i]?.getBoundingClientRect();
          const b = kids[i + 1]?.getBoundingClientRect();
          if (!a || !b) continue;
          out.push({
            from: (kids[i]?.className || '').toString().slice(0, 30),
            to: (kids[i + 1]?.className || '').toString().slice(0, 30),
            gap: Math.round((b.x - a.right) * 10) / 10,
          });
        }
        return out;
      })(),
    };
  });
  writeFileSync(join(process.cwd(), 'menubar-probe.json'), `${JSON.stringify(data, null, 2)}\n`);
  expect(data.menubar).toBeTruthy();
});
