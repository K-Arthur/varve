/**
 * Storage settings tab — usage, persistence, and cleanup for the browser
 * route.
 *
 * The surface exists because "clear the cache" is ambiguous and destructive
 * advice. It separates three classes explicitly:
 *   - documents and recovery copies (irreplaceable, never removed here),
 *   - offline app copies (disposable build assets, safe to clear),
 *   - profile/browsing-data deletion (outside the app; removes everything).
 *
 * Usage and quota come from `navigator.storage.estimate()` and are labelled
 * as estimates. Persistence is requested only from the user's click, and a
 * denial is reported without drama because nothing is lost either way.
 */

import { formatFileSize } from '@varve/shared';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import {
  clearDisposableAppCaches,
  collectStorageInventory,
  requestPersistentStorage,
  type StorageInventory,
} from '../../persistence/storageInventory';
import { getSharedRecoveryManager } from '../../recovery';

function formatBytes(value: number | null): string {
  if (value === null) return 'unknown';
  return formatFileSize(value);
}

function percentage(usage: number | null, quota: number | null): string | null {
  if (usage === null || quota === null || quota <= 0) return null;
  const pct = Math.min(100, Math.round((usage / quota) * 100));
  return `${pct}% of the estimate`;
}

export function StorageSettingsTab() {
  const [inventory, setInventory] = useState<StorageInventory | null>(null);
  const [busy, setBusy] = useState<'none' | 'persist' | 'clear'>('none');
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const cacheStorage =
      typeof caches === 'undefined'
        ? undefined
        : {
            keys: () => caches.keys(),
            open: (name: string) => caches.open(name),
          };
    const next = await collectStorageInventory({
      storageManager: nav?.storage,
      cacheStorage,
      listRecoveryMeta: () => getSharedRecoveryManager().listSessionsMeta(),
    });
    setInventory(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRequestPersistence = useCallback(async () => {
    setBusy('persist');
    setStatus(null);
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const granted = await requestPersistentStorage(nav?.storage);
    if (granted === true) {
      setStatus('The browser agreed to keep this app\u2019s data unless you delete it.');
    } else if (granted === false) {
      setStatus(
        'The browser declined for now. Nothing was deleted; using the demo regularly and installing it can change the decision.',
      );
    } else {
      setStatus('This browser does not offer persistent storage for sites.');
    }
    await refresh();
    setBusy('none');
  }, [refresh]);

  const onClearCaches = useCallback(async () => {
    if (typeof caches === 'undefined') {
      setStatus('This browser has no offline cache to clear.');
      return;
    }
    setBusy('clear');
    setStatus(null);
    try {
      const deleted = await clearDisposableAppCaches(caches);
      setStatus(
        deleted.length > 0
          ? `Cleared ${deleted.length} offline app cop${deleted.length === 1 ? 'y' : 'ies'}. Your documents and recovery copies were not touched.`
          : 'There were no offline app copies to clear.',
      );
    } catch {
      setStatus('The offline app copies could not be cleared. Nothing else was changed.');
    }
    await refresh();
    setBusy('none');
  }, [refresh]);

  const estimate = inventory?.estimate;
  const appCacheCount = inventory?.appCaches.names.length ?? 0;
  const recovery = inventory?.recovery;

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Storage &amp; Offline</h3>

      <div className="settings-field-row">
        <span className="settings-field-row__label">Browser storage used</span>
        <div className="settings-field-row__control">
          {inventory === null
            ? 'Checking…'
            : `${formatBytes(estimate?.usageBytes ?? null)} of ${formatBytes(estimate?.quotaBytes ?? null)} estimated available`}
        </div>
      </div>
      {estimate?.usageBytes != null && (
        <p className="settings-hint">
          {percentage(estimate.usageBytes, estimate.quotaBytes) ?? ''} — browser estimates are
          approximate and shared with everything else this site stores. Saving a large document
          needs roughly twice its size while the write is in progress.
        </p>
      )}

      <div className="settings-field-row">
        <span className="settings-field-row__label">Keep data on this device</span>
        <div className="settings-field-row__control">
          {inventory === null ? (
            'Checking…'
          ) : (
            <>
              <span>
                {inventory.persisted === null
                  ? 'Not supported by this browser'
                  : inventory.persisted
                    ? 'Persistent storage granted'
                    : 'Best-effort storage'}
              </span>{' '}
              {inventory.persisted === false && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy === 'persist'}
                  onClick={() => void onRequestPersistence()}
                >
                  Ask the browser to keep it
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <p className="settings-hint">
        Best-effort storage is only removed by the browser when the whole device is low on space
        (oldest site first). Granting persistence makes removal very unlikely; it never moves data
        to the cloud. Private/incognito windows discard everything when they close, and uninstalling
        the app with &quot;delete data&quot; removes documents and recovery copies.
      </p>

      <div className="settings-field-row">
        <span className="settings-field-row__label">Recovery copies</span>
        <div className="settings-field-row__control">
          {recovery === undefined
            ? 'Checking…'
            : `${recovery.count} saved version${recovery.count === 1 ? '' : 's'} (${formatBytes(recovery.bytes)})`}
        </div>
      </div>
      <p className="settings-hint">
        Recovery copies protect unsaved edits and are removed when the document is saved, when you
        discard it intentionally, or after seven days. They are stored with your documents and are
        never touched by clearing offline app copies.
      </p>

      <div className="settings-field-row">
        <span className="settings-field-row__label">Offline app copies</span>
        <div className="settings-field-row__control">
          {appCacheCount > 0
            ? `${inventory?.appCaches.entries ?? 0} cached file${(inventory?.appCaches.entries ?? 0) === 1 ? '' : 's'}`
            : 'None (the demo caches itself after the first complete online visit)'}
        </div>
      </div>
      <div className="settings-field-row">
        <span className="settings-field-row__label" />
        <div className="settings-field-row__control">
          <Button
            variant="destructive"
            size="sm"
            confirmLabel="Confirm clear"
            loading={busy === 'clear'}
            onClick={() => void onClearCaches()}
          >
            Clear offline app copies
          </Button>
        </div>
      </div>
      <p className="settings-hint">
        Clearing these removes only the cached copy of the app itself so the next visit downloads a
        fresh build. Documents, recovery copies, and any open editor state are unaffected. The demo
        will need one complete online visit before it can open offline again.
      </p>

      {status && (
        <p className="settings-hint" role="status">
          {status}
        </p>
      )}

      <p className="settings-hint">
        To remove everything this browser stores for Varve, use the browser&apos;s own &quot;Delete
        browsing data&quot; for this site (or uninstall the installed app with data removal). That
        deletes documents and recovery copies too — export anything you need first.
      </p>
    </div>
  );
}
