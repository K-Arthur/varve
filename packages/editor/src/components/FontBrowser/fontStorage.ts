/**
 * Font storage — persists downloaded font bytes to the application
 * font cache so they survive across sessions.
 */

export interface FontStorageMetadata {
  providerId: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
}

/**
 * Store a downloaded font in the application font cache.
 * Persists the font bytes and metadata for offline use.
 */
export async function storeFont(
  familyName: string,
  data: ArrayBuffer,
  metadata: FontStorageMetadata,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  try {
    const open = indexedDB.open('strata-font-storage', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('fonts')) {
        db.createObjectStore('fonts', { keyPath: 'familyName' });
      }
    };
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('fonts', 'readwrite');
        const store = tx.objectStore('fonts');
        store.put({ familyName, data, metadata, storedAt: Date.now() });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      open.onerror = () => reject(open.error);
    });
  } catch {
    // Font storage is best-effort; ignore failures
  }
}

/**
 * Retrieve a stored font from the application font cache.
 */
export async function getStoredFont(
  familyName: string,
): Promise<{ data: ArrayBuffer; metadata: FontStorageMetadata } | null> {
  if (typeof indexedDB === 'undefined') return null;

  try {
    const open = indexedDB.open('strata-font-storage', 1);
    const result = await new Promise<{ data: ArrayBuffer; metadata: FontStorageMetadata } | null>(
      (resolve, reject) => {
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('fonts')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('fonts', 'readonly');
          const store = tx.objectStore('fonts');
          const req = store.get(familyName);
          req.onsuccess = () => {
            db.close();
            resolve(req.result ?? null);
          };
          req.onerror = () => {
            db.close();
            reject(req.error);
          };
        };
        open.onerror = () => reject(open.error);
      },
    );
    return result;
  } catch {
    return null;
  }
}

/**
 * Remove a stored font from the application font cache.
 */
export async function removeStoredFont(familyName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  try {
    const open = indexedDB.open('strata-font-storage', 1);
    await new Promise<void>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('fonts')) {
          db.close();
          resolve();
          return;
        }
        const tx = db.transaction('fonts', 'readwrite');
        const store = tx.objectStore('fonts');
        store.delete(familyName);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      open.onerror = () => reject(open.error);
    });
  } catch {
    // Ignore failures
  }
}
