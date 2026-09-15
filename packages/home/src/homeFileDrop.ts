import type { FileEntry, Platform } from '@varve/platform';
import { contentHash, detectFileKind } from '@varve/platform';
import { validateFileSelection } from '@varve/shared';

const HOME_DROP_ACCEPT = 'image/*,.svg,.ttf,.otf,.woff,.woff2,.varve,.strata';
const HOME_DROP_MAX_FILES = 50;
const HOME_DROP_MAX_SIZE = 128 * 1024 * 1024;

function isNativeHomeDocument(file: File): boolean {
  return /\.(varve|strata)$/i.test(file.name);
}

function isHomeAsset(file: File): boolean {
  return detectFileKind(file.name) === 'image' || /\.(ttf|otf|woff|woff2)$/i.test(file.name);
}

/**
 * Handle Home's broad drop surface without pretending artwork is a document.
 * Native documents open when dropped alone; reusable media becomes a local
 * asset, and every rejected/failed item is returned for one user-facing report.
 */
export async function ingestHomeFiles(
  files: readonly File[],
  platform: Platform,
  workspaceId: string,
  onOpenFile: (entry: FileEntry) => void,
): Promise<string[]> {
  const result = validateFileSelection(files, {
    accept: HOME_DROP_ACCEPT,
    multiple: true,
    maxFiles: HOME_DROP_MAX_FILES,
    maxSize: HOME_DROP_MAX_SIZE,
  });
  const failures = result.rejected.map(
    (rejection) => `${rejection.file.name}: ${rejection.reason}`,
  );

  for (const file of result.accepted) {
    try {
      if (isNativeHomeDocument(file)) {
        const text = await file.text();
        try {
          JSON.parse(text);
        } catch {
          throw new Error('This Varve document is not valid JSON.');
        }
        const now = Date.now();
        const entry: FileEntry = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          kind: 'strata',
          projectId: null,
          createdAt: now,
          updatedAt: now,
          openedAt: now,
          size: file.size,
          pinned: false,
          trashedAt: null,
          ordering: '',
          contentHash: contentHash(file.name),
        };
        await platform.upsertFile(entry, text);
        if (result.accepted.length === 1) onOpenFile(entry);
      } else if (isHomeAsset(file)) {
        await platform.importAsset(
          workspaceId,
          file.name,
          new Uint8Array(await file.arrayBuffer()),
          file.type || 'application/octet-stream',
        );
      } else {
        throw new Error('This format must be imported from the editor canvas.');
      }
    } catch (error) {
      failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return failures;
}
