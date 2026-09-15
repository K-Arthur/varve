/**
 * ThumbnailInfoDialog — a standalone dialog for viewing and changing a
 * project's thumbnail source, with preview and refresh controls.
 */

import type { FileEntry, Platform, ThumbnailSourcePreference } from '@varve/platform';
import { Button, Dialog, Icon } from '@varve/ui';
import { useCallback, useState } from 'react';
import { ThumbnailSourcePicker } from './ThumbnailSourcePicker';

export interface ThumbnailInfoDialogProps {
  file: FileEntry;
  platform: Platform;
  currentThumbnail: string | null | undefined;
  /** Called when the preference is changed and the thumbnail has been
   *  regenerated. The caller should update its thumbnail map. */
  onThumbnailUpdate: (fileId: string, dataUrl: string | null) => void;
  onClose: () => void;
}

export function ThumbnailInfoDialog({
  file,
  platform,
  currentThumbnail,
  onThumbnailUpdate,
  onClose,
}: ThumbnailInfoDialogProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null | undefined>(currentThumbnail);
  const [error, setError] = useState<string | null>(null);

  const handlePreferenceChange = useCallback(
    async (preference: ThumbnailSourcePreference) => {
      // Persist the preference on the FileEntry
      try {
        const updated: FileEntry = { ...file, thumbnailPreference: preference };
        // Note: We don't have a "setThumbnailPreference" on platform, so
        // we just regenerate with the new preference
        await platform.upsertFile(updated, '');
      } catch {
        // Best-effort: preference save failure is non-fatal
      }
    },
    [file, platform],
  );

  const handleRegenerate = useCallback(async () => {
    setError(null);
    try {
      // Regenerate: read the doc, generate thumbnail, persist it
      const docJson = await platform.readFile(file.id);
      if (!docJson) {
        setError('Could not read document to regenerate thumbnail');
        return;
      }

      const { legacyRenderThumbnail } = await import('@varve/engine');
      const doc = JSON.parse(docJson);
      const dataUrl = await legacyRenderThumbnail(doc);
      if (dataUrl) {
        await platform.putThumbnail({
          hash: file.contentHash,
          dataUrl,
          width: 256,
          height: 192,
          createdAt: Date.now(),
        });
        setPreviewUrl(dataUrl);
        onThumbnailUpdate(file.id, dataUrl);
      }
    } catch {
      setError('Thumbnail regeneration failed');
    }
  }, [file, platform, onThumbnailUpdate]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Thumbnail — ${file.name}`}
      className="thumbnail-info-dialog"
    >
      <div className="thumbnail-info-dialog__body">
        {/* Current preview */}
        <div className="thumbnail-info-dialog__preview">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={`Thumbnail preview for ${file.name}`}
              className="thumbnail-info-dialog__preview-img"
            />
          ) : (
            <div className="thumbnail-info-dialog__preview-empty">
              <Icon name="Image" label={undefined} size="2em" />
              <span>No thumbnail</span>
            </div>
          )}
        </div>

        {/* Source picker */}
        <ThumbnailSourcePicker
          file={file}
          platform={platform}
          onPreferenceChange={handlePreferenceChange}
          onRegenerate={handleRegenerate}
        />

        {error && (
          <div className="thumbnail-info-dialog__error" role="alert">
            <Icon name="TriangleAlert" label={undefined} size="0.85em" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="thumbnail-info-dialog__footer">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
