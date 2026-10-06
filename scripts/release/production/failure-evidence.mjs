import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Capture the actual failed UI before its native session is closed. Diagnostics
// must never replace the original qualification failure or report success.
export async function captureDomFailure(page, out, receipt) {
  if (!page) return;
  const errors = [];
  try {
    await page.screenshot({ path: join(out, 'native-failure.png') });
  } catch (error) {
    errors.push(`screenshot: ${error.message}`);
  }
  try {
    const dom = await page.evaluate(() => ({
      text: document.body.innerText,
      controls: Array.from(
        document.querySelectorAll('button,[role="menuitem"],[role="treeitem"],[role="dialog"]'),
      ).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          !rect.width ||
          !rect.height ||
          style.display === 'none' ||
          style.visibility === 'hidden'
        )
          return [];
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return [
          {
            role: element.getAttribute('role'),
            name: element.getAttribute('aria-label') || element.innerText,
            nodeId: element.getAttribute('data-node-id'),
            expanded: element.getAttribute('aria-expanded'),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            pointerEvents: style.pointerEvents,
            centerHit: hit
              ? { tag: hit.tagName, class: hit.className, text: hit.textContent?.slice(0, 200) }
              : null,
            receivesPointer: hit === element || element.contains(hit),
          },
        ];
      }),
    }));
    writeFileSync(join(out, 'native-failure-dom.json'), JSON.stringify(dom, null, 2) + '\n');
  } catch (error) {
    errors.push(`DOM: ${error.message}`);
  }
  if (errors.length) receipt.evidenceErrors = errors;
}
