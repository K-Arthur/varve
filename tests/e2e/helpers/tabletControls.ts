/**
 * Shared browser helpers for the tablet specs.
 *
 * `readEditorState` and `dismissTabletPanel` read the editor context through
 * the React fiber and close the tablet controls popover by touch. They mirror
 * the local `serializeEditorDocument` copy in
 * `tests/e2e/interaction/chromeos-device-matrix.spec.ts`, which predates this
 * module.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export interface TabletEditorState {
  /** Authoritative serialized document. */
  serialized: string;
  /** Number of selected nodes (selection is metadata, not document content). */
  selectionCount: number;
}

export async function readEditorState(page: Page): Promise<TabletEditorState> {
  return page.evaluate(() => {
    const root = document.getElementById('root') as unknown as Record<string, unknown>;
    const key = Object.keys(root).find(
      (name) => name.startsWith('__reactContainer$') || name.startsWith('__reactFiber$'),
    );
    if (!key) throw new Error('React fiber not found');
    interface EditorLike {
      serializeDocument?: () => string;
      state?: { selection?: unknown[] };
    }
    interface FiberLike {
      memoizedProps?: { value?: EditorLike };
      child?: unknown;
      sibling?: unknown;
    }
    function find(fiber: unknown): EditorLike | null {
      if (!fiber || typeof fiber !== 'object') return null;
      const candidate = fiber as FiberLike;
      if (typeof candidate.memoizedProps?.value?.serializeDocument === 'function') {
        return candidate.memoizedProps.value;
      }
      return find(candidate.child) ?? find(candidate.sibling);
    }
    const editor = find(root[key]);
    if (!editor?.serializeDocument) throw new Error('Missing editor context');
    return {
      serialized: editor.serializeDocument(),
      selectionCount: editor.state?.selection?.length ?? 0,
    };
  });
}

/**
 * Close the tablet controls popover using a touch-only path.
 *
 * The palette's trailing cluster re-renders when the document changes, so
 * tapping the trigger can lose Playwright's actionability race. Tapping the
 * canvas outside the popover is the other supported touch dismissal; whichever
 * path closes it, the close must not click through to the canvas, so document
 * content and selection are both asserted unchanged.
 */
export async function dismissTabletPanel(
  page: Page,
  trigger: Locator,
  panel: Locator,
  outside: { x: number; y: number },
): Promise<void> {
  if (!(await panel.isVisible())) return;
  const before = await readEditorState(page);
  try {
    await trigger.tap({ timeout: 5000 });
  } catch {
    // Fall through to the outside tap; the palette re-rendered mid-action.
  }
  if (await panel.isVisible()) {
    await page.touchscreen.tap(outside.x, outside.y);
    await expect(panel).toBeHidden({ timeout: 10000 });
  }
  const after = await readEditorState(page);
  expect(after.serialized).toBe(before.serialized);
  expect(after.selectionCount).toBe(before.selectionCount);
}
