/**
 * Browser file-launch intake for installed apps (`file_handlers` +
 * `launchQueue`).
 *
 * When the demo is installed as an app and the user opens a `.varve` file
 * from the Files app (or any OS surface), Chrome passes the file to the
 * already-installed app through `window.launchQueue` instead of a download.
 * This module captures the consumer and decodes each launch into
 * `{ name, text, handle }`; the host then opens the document through the
 * normal open path and binds the handle so Save writes back to the file.
 *
 * It is a progressive enhancement: browsers without the API (Firefox/Safari,
 * or an uninstalled page) report unsupported and nothing is shown. Launches
 * queued before the consumer is installed are delivered by the browser when
 * the consumer registers, so boot order does not drop files.
 */

export interface LaunchedBrowserFile {
  name: string;
  text: string;
  handle: FileSystemFileHandle;
}

export type BrowserFileLaunchHandler = (file: LaunchedBrowserFile) => void;

interface LaunchParamsLike {
  files?: unknown[];
}

interface LaunchQueueLike {
  setConsumer: (consumer: (params: LaunchParamsLike) => void) => void;
}

interface LaunchCapableWindow {
  launchQueue?: LaunchQueueLike;
  LaunchParams?: { prototype?: object };
}

function launchCapableWindow(): LaunchCapableWindow {
  return window as unknown as LaunchCapableWindow;
}

/** True when this browser can deliver launched files to an installed app. */
export function browserFileLaunchSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const capable = launchCapableWindow();
  const prototype = capable.LaunchParams?.prototype;
  return capable.launchQueue !== undefined && prototype !== undefined && 'files' in prototype;
}

function isFileHandle(value: unknown): value is FileSystemFileHandle {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; getFile?: unknown };
  return candidate.kind === 'file' && typeof candidate.getFile === 'function';
}

/**
 * Install the launch consumer. Resolves to a disposer; because
 * `launchQueue.setConsumer` replaces the previous consumer, a later call
 * (for example a React StrictMode remount) simply takes over.
 */
export async function armBrowserFileLaunch(handle: BrowserFileLaunchHandler): Promise<() => void> {
  if (!browserFileLaunchSupported()) return () => undefined;
  const queue = launchCapableWindow().launchQueue;
  if (!queue) return () => undefined;

  queue.setConsumer((params) => {
    void (async () => {
      for (const item of params.files ?? []) {
        if (!isFileHandle(item)) continue;
        try {
          const file = await item.getFile();
          handle({ name: file.name, text: await file.text(), handle: item });
        } catch {
          // Unreadable or permission-denied files are skipped; the OS prompt
          // (or the file having been removed) is the user-visible surface.
        }
      }
    })();
  });

  return () => undefined;
}
