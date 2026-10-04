import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from './shared';

const HOME_DB_VERSION = 6;

async function waitForHomeDatabase(page: Page): Promise<void> {
  await page.waitForFunction(
    async (version) =>
      (await indexedDB.databases()).some(
        (database) => database.name === 'varve-home' && (database.version ?? 0) >= version,
      ),
    HOME_DB_VERSION,
    { timeout: 15000 },
  );
}

async function clearRecentRecords(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const request = indexedDB.open('varve-home');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction('recentFiles', 'readwrite');
    transaction.objectStore('recentFiles').clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Recent-file reset aborted'));
    });
    db.close();
    localStorage.removeItem('recentFiles.v1');
  });
}

async function seedRecentFile(
  page: Page,
  options: { id: string; name: string; includeDocument: boolean },
): Promise<void> {
  await page.evaluate(async ({ id, name, includeDocument }) => {
    const request = indexedDB.open('varve-home');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    const json = JSON.stringify({
      id,
      formatVersion: '2.33',
      name,
      rootChildren: [],
      nodes: {},
      components: {},
      nextId: 1,
    });
    const contentHash = `e2e-${id}`;
    const transaction = db.transaction(['files', 'recentFiles', 'fileContent'], 'readwrite');
    transaction.objectStore('files').put({
      entry: {
        id,
        name,
        kind: 'strata',
        projectId: null,
        createdAt: now,
        updatedAt: now,
        openedAt: 0,
        size: json.length,
        pinned: false,
        trashedAt: null,
        ordering: '',
        contentHash,
      },
    });
    if (includeDocument) {
      transaction.objectStore('fileContent').put({ hash: contentHash, json });
    }
    transaction.objectStore('recentFiles').put({
      id,
      name,
      lastOpenedAt: now,
      openedCount: 1,
      pinned: false,
      hidden: false,
      workspaceRelevance: [],
      userWorkspaceTag: null,
      encrypted: false,
      missing: false,
      version: 1,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Recent-file seed aborted'));
    });
    db.close();
  }, options);
}

async function openRecentSubmenu(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'File' }).click();
  const openRecent = page.getByRole('menuitem', { name: 'Open Recent', exact: true });
  await expect(openRecent).toBeVisible();
  await openRecent.click();
  await expect(page.getByRole('menu', { name: 'Open Recent' })).toBeVisible();
}

test.describe('Recent Files', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { timeout: 45000, waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 45000 });
    await waitForHomeDatabase(page);
    await clearRecentRecords(page);
  });

  test('shows a newly created document in Open Recent', async ({ page }) => {
    await navigateToEditor(page);
    await openRecentSubmenu(page);
    await expect(
      page.getByRole('menu', { name: 'Open Recent' }).getByRole('menuitem', { name: /Untitled/ }),
    ).toBeVisible();
  });

  test('shows and opens a saved document from the platform recent-files store', async ({
    page,
  }) => {
    await seedRecentFile(page, {
      id: 'e2e-recent-open',
      name: 'my-document',
      includeDocument: true,
    });
    await navigateToEditor(page);

    await openRecentSubmenu(page);
    await page
      .getByRole('menu', { name: 'Open Recent' })
      .getByRole('menuitem', { name: 'my-document' })
      .click();
    await expect(page.getByRole('tab', { name: /my-document/ })).toBeVisible();
  });

  test('shows a missing-file dialog when a recent library document has no stored content', async ({
    page,
  }) => {
    await seedRecentFile(page, {
      id: 'e2e-recent-missing',
      name: 'deleted-file',
      includeDocument: false,
    });
    await navigateToEditor(page);

    await openRecentSubmenu(page);
    await page
      .getByRole('menu', { name: 'Open Recent' })
      .getByRole('menuitem', { name: 'deleted-file' })
      .click();
    await expect(page.getByRole('alertdialog', { name: 'File Not Found' })).toBeVisible();
  });

  test('clear recent files removes all platform history entries', async ({ page }) => {
    await seedRecentFile(page, {
      id: 'e2e-recent-clear',
      name: 'clear-me',
      includeDocument: true,
    });
    await navigateToEditor(page);

    await openRecentSubmenu(page);
    await page
      .getByRole('menu', { name: 'Open Recent' })
      .getByRole('menuitem', { name: 'Clear Recent Files' })
      .click();
    await page.getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open Recent', exact: true })).toHaveCount(0);
  });
});
