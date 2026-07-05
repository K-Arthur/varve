import type { FileEntry, FileKind, Platform } from '@strata/platform';
import { contentHash, DRAFTS_ID, detectFileKind, stripExtension, uuid } from '@strata/platform';
import { serializeDocument as serializeDoc } from '@strata/scene';
import { Button, Dialog, Icon } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';

interface QueuedFile {
  id: string;
  name: string;
  kind: FileKind;
  size: number;
  status: 'queued' | 'importing' | 'done' | 'error';
  error?: string;
}

export interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
  platform: Platform;
  onImportComplete: (results: { success: number; failed: number; total: number }) => void;
}

type ImportStage = 'select' | 'importing' | 'results';

export function BulkImportDialog({
  open,
  onClose,
  platform,
  onImportComplete,
}: BulkImportDialogProps) {
  const [stage, setStage] = useState<ImportStage>('select');
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: QueuedFile[] = Array.from(fileList)
      .filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase();
        return [
          'strata',
          'fig',
          'svg',
          'png',
          'jpg',
          'jpeg',
          'webp',
          'gif',
          'pdf',
          'ai',
          'eps',
          'psd',
        ].includes(ext ?? '');
      })
      .map((f) => ({
        id: uuid(),
        name: f.name,
        kind: detectFileKind(f.name),
        size: f.size,
        status: 'queued' as const,
      }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handlePick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleImport = useCallback(async () => {
    setStage('importing');
    let success = 0;
    let failed = 0;

    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setFiles((prev) =>
        prev.map((pf) => (pf.id === f.id ? { ...pf, status: 'importing' as const } : pf)),
      );
      setProgress(i);

      try {
        const now = Date.now();
        const entry: FileEntry = {
          id: f.id,
          name: stripExtension(f.name),
          kind: f.kind,
          projectId: DRAFTS_ID,
          createdAt: now,
          updatedAt: now,
          openedAt: now,
          size: f.size,
          pinned: false,
          trashedAt: null,
          ordering: '',
          contentHash: contentHash(f.name),
        };
        const json = serializeDoc({
          id: f.id,
          name: stripExtension(f.name),
          rootChildren: [],
          nodes: {},
          components: {},
          nextId: 1,
        });
        await platform.upsertFile(entry, json);
        setFiles((prev) =>
          prev.map((pf) => (pf.id === f.id ? { ...pf, status: 'done' as const } : pf)),
        );
        success++;
      } catch (err) {
        setFiles((prev) =>
          prev.map((pf) =>
            pf.id === f.id ? { ...pf, status: 'error' as const, error: String(err) } : pf,
          ),
        );
        failed++;
      }
    }

    setProgress(files.length);
    setStage('results');
    onImportComplete({ success, failed, total: files.length });
  }, [files, platform, onImportComplete]);

  const handleClose = useCallback(() => {
    setStage('select');
    setFiles([]);
    setProgress(0);
    onClose();
  }, [onClose]);

  const hasFiles = files.length > 0;
  const queuedCount = files.filter((f) => f.status === 'queued').length;
  const doneCount = files.filter((f) => f.status === 'done').length;
  const failedCount = files.filter((f) => f.status === 'error').length;

  return (
    <Dialog open={open} onClose={handleClose} title="Import files">
      <div className="bulk-import">
        {stage === 'select' && (
          <>
            <div
              ref={dropRef}
              className={`bulk-import__dropzone ${isDragOver ? 'bulk-import__dropzone--active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Icon name="Upload" label={undefined} className="bulk-import__dropzone-icon" />
              <p className="bulk-import__dropzone-text">Drag files here or click to browse</p>
              <p className="bulk-import__dropzone-hint">Strata, SVG, PNG, JPG, PDF, AI, EPS, PSD</p>
              <Button variant="secondary" onClick={handlePick}>
                Choose files
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".strata,.fig,.svg,.png,.jpg,.jpeg,.webp,.gif,.pdf,.ai,.eps,.psd"
                style={{ display: 'none' }}
                onChange={handleFileInput}
              />
            </div>

            {hasFiles && (
              <div className="bulk-import__queue">
                <span className="bulk-import__queue-label">
                  {files.length} file{files.length !== 1 ? 's' : ''} selected
                </span>
                <div className="bulk-import__queue-list">
                  {files.map((f) => (
                    <div key={f.id} className="bulk-import__queue-item">
                      <span className="bulk-import__queue-name">{f.name}</span>
                      <span className="bulk-import__queue-kind">{f.kind}</span>
                      <button
                        type="button"
                        className="bulk-import__queue-remove"
                        onClick={() => removeFile(f.id)}
                        aria-label={`Remove ${f.name}`}
                      >
                        <Icon name="X" label={undefined} size="0.85em" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bulk-import__footer">
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!hasFiles || queuedCount === 0}
                onClick={handleImport}
              >
                Import {hasFiles ? `(${files.length})` : ''}
              </Button>
            </div>
          </>
        )}

        {stage === 'importing' && (
          <div className="bulk-import__progress">
            <div className="bulk-import__progress-bar">
              <div
                className="bulk-import__progress-fill"
                style={{ width: `${files.length > 0 ? (progress / files.length) * 100 : 0}%` }}
              />
            </div>
            <p className="bulk-import__progress-text">
              Importing file {progress + 1} of {files.length}
            </p>
            <p className="bulk-import__progress-file">{files[progress]?.name}</p>
          </div>
        )}

        {stage === 'results' && (
          <div className="bulk-import__results">
            <div className="bulk-import__results-summary">
              <span className="bulk-import__results-count">
                <span className="bulk-import__results-success">{doneCount} imported</span>
                {failedCount > 0 && (
                  <>
                    <span className="bulk-import__results-sep">, </span>
                    <span className="bulk-import__results-fail">{failedCount} failed</span>
                  </>
                )}
              </span>
            </div>
            <div className="bulk-import__results-list">
              {files.map((f) => (
                <div
                  key={f.id}
                  className={`bulk-import__result-item bulk-import__result-item--${f.status}`}
                >
                  <Icon
                    name={
                      f.status === 'done'
                        ? 'CircleCheck'
                        : f.status === 'error'
                          ? 'CircleAlert'
                          : 'Clock'
                    }
                    label={undefined}
                    size="0.85em"
                  />
                  <span className="bulk-import__result-name">{f.name}</span>
                  {f.error && <span className="bulk-import__result-error">{f.error}</span>}
                </div>
              ))}
            </div>
            <div className="bulk-import__footer">
              <Button variant="primary" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
