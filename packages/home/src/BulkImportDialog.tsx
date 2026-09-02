import type { FileEntry, FileKind, Platform } from '@varve/platform';
import { contentHash, DRAFTS_ID, detectFileKind, stripExtension, uuid } from '@varve/platform';
import type { FileRejection } from '@varve/shared';
import { Button, Dialog, FileDropZone, FileError, FileQueue, type FileQueueItem } from '@varve/ui';
import { useCallback, useState } from 'react';

interface QueuedFile extends FileQueueItem<File> {
  kind: FileKind;
}

export interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  platform: Platform;
  workspaceId: string;
  onImportComplete: (results: { success: number; failed: number; total: number }) => void;
}

type ImportStage = 'select' | 'importing' | 'results';

const IMPORT_ACCEPT = 'image/*,.svg,.ttf,.otf,.woff,.woff2,.varve,.strata';
const MAX_IMPORT_FILES = 50;
const MAX_IMPORT_SIZE = 128 * 1024 * 1024;

function createQueuedFile(file: File): QueuedFile {
  return {
    id: uuid(),
    file,
    kind: detectFileKind(file.name),
    status: 'queued',
  };
}

function isNativeDocument(file: File): boolean {
  return /\.(varve|strata)$/i.test(file.name);
}

function isAsset(file: File): boolean {
  return detectFileKind(file.name) === 'image' || /\.(ttf|otf|woff|woff2)$/i.test(file.name);
}

async function importQueuedFile(file: QueuedFile, platform: Platform, workspaceId: string) {
  if (isNativeDocument(file.file)) {
    const text = await file.file.text();
    let parsed: { name?: unknown };
    try {
      parsed = JSON.parse(text) as { name?: unknown };
    } catch {
      throw new Error('This Varve document is not valid JSON.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('This Varve document has an invalid structure.');
    }

    const now = Date.now();
    const displayName =
      typeof parsed.name === 'string' && parsed.name.trim()
        ? parsed.name.trim()
        : stripExtension(file.file.name);
    const entry: FileEntry = {
      id: file.id,
      name: displayName,
      kind: 'strata',
      filePath: undefined,
      projectId: DRAFTS_ID,
      createdAt: now,
      updatedAt: now,
      openedAt: now,
      size: file.file.size,
      pinned: false,
      trashedAt: null,
      ordering: '',
      contentHash: contentHash(file.file.name),
    };
    await platform.upsertFile(entry, text);
    return;
  }

  if (isAsset(file.file)) {
    const bytes = new Uint8Array(await file.file.arrayBuffer());
    await platform.importAsset(
      workspaceId,
      file.file.name,
      bytes,
      file.file.type || 'application/octet-stream',
    );
    return;
  }

  throw new Error('This format must be imported from the editor canvas.');
}

export function BulkImportDialog({
  open,
  onClose,
  platform,
  workspaceId,
  onImportComplete,
}: BulkImportDialogProps) {
  const [stage, setStage] = useState<ImportStage>('select');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [selectionErrors, setSelectionErrors] = useState<FileRejection<File>[]>([]);
  const [progress, setProgress] = useState(0);

  const addFiles = useCallback((selected: File[]) => {
    setFiles((previous) => [...previous, ...selected.map(createQueuedFile)]);
  }, []);

  const handleReject = useCallback((rejections: FileRejection<File>[]) => {
    setSelectionErrors(rejections);
  }, []);

  const updateFile = useCallback((id: string, patch: Partial<QueuedFile>) => {
    setFiles((previous) => previous.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((previous) => previous.filter((file) => file.id !== id));
  }, []);

  const handleImport = useCallback(async () => {
    const batch = files.filter((file) => file.status === 'queued');
    setStage('importing');
    let success = 0;
    let failed = 0;

    for (let index = 0; index < batch.length; index += 1) {
      const file = batch[index]!;
      updateFile(file.id, { status: 'processing', progress: 0, error: undefined });
      setProgress(index);
      try {
        await importQueuedFile(file, platform, workspaceId);
        updateFile(file.id, { status: 'complete', progress: 100 });
        success += 1;
      } catch (error) {
        updateFile(file.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        failed += 1;
      }
    }

    setProgress(batch.length);
    setStage('results');
    onImportComplete({ success, failed, total: batch.length });
  }, [files, onImportComplete, platform, updateFile, workspaceId]);

  const handleClose = useCallback(() => {
    setStage('select');
    setFiles([]);
    setSelectionErrors([]);
    setProgress(0);
    onClose();
  }, [onClose]);

  const hasFiles = files.length > 0;
  const queuedCount = files.filter((file) => file.status === 'queued').length;
  const doneCount = files.filter((file) => file.status === 'complete').length;
  const failedCount = files.filter((file) => file.status === 'failed').length;

  return (
    <Dialog open={open} onClose={handleClose} title="Add files to library">
      <div className="bulk-import">
        {stage === 'select' && (
          <>
            <FileDropZone
              label="Drop files to add to your library"
              description="Varve documents are kept as documents; images, SVG, and fonts become local assets."
              actionLabel="Choose files"
              accept={IMPORT_ACCEPT}
              multiple
              maxFiles={MAX_IMPORT_FILES}
              maxSize={MAX_IMPORT_SIZE}
              onFiles={addFiles}
              onReject={handleReject}
            />

            {selectionErrors.length > 0 && (
              <FileError
                title="Some files were not added"
                message={selectionErrors
                  .map((rejection) => `${rejection.file.name}: ${rejection.reason}`)
                  .join(' ')}
                compact
              />
            )}

            <FileQueue
              className="bulk-import__queue"
              items={files}
              label="Files selected for library"
              onRemove={removeFile}
            />

            <div className="bulk-import__footer">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="default"
                disabled={!hasFiles || queuedCount === 0}
                onClick={() => void handleImport()}
              >
                Add to library {hasFiles ? `(${files.length})` : ''}
              </Button>
            </div>
          </>
        )}

        {stage === 'importing' && (
          <div className="bulk-import__progress" aria-live="polite">
            <div
              className="bulk-import__progress-bar"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={files.length}
            >
              <div
                className="bulk-import__progress-fill"
                style={{ width: `${files.length > 0 ? (progress / files.length) * 100 : 0}%` }}
              />
            </div>
            <p className="bulk-import__progress-text">
              Adding file {Math.min(progress + 1, files.length)} of {files.length}
            </p>
            <p className="bulk-import__progress-file">{files[progress]?.file.name}</p>
            <FileQueue items={files} label="Library import progress" />
          </div>
        )}

        {stage === 'results' && (
          <div className="bulk-import__results">
            <div className="bulk-import__results-summary">
              <span className="bulk-import__results-count">
                <span className="bulk-import__results-success">{doneCount} added</span>
                {failedCount > 0 && (
                  <>
                    <span className="bulk-import__results-sep">, </span>
                    <span className="bulk-import__results-fail">{failedCount} failed</span>
                  </>
                )}
              </span>
            </div>
            <FileQueue items={files} label="Library import results" />
            <div className="bulk-import__footer">
              <Button variant="default" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
