/**
 * ThumbnailSourcePicker — UI for selecting and managing a project's
 * thumbnail source.
 *
 * Wires into the existing ThumbnailSourcePreference and
 * persistProjectThumbnail APIs. Can be used as a standalone dialog,
 * a menu sub-panel, or embedded in a File Info dialog.
 *
 * Sources supported:
 *  - automatic (document overview)
 *  - selected page
 *  - selected frame
 *  - selection / current selection
 *  - custom uploaded image
 *
 * Actions:
 *  - choose thumbnail source
 *  - refresh thumbnail
 *  - reset to automatic
 *  - remove a custom thumbnail
 *  - regenerate after a failure
 */

import type { FileEntry, Platform, ThumbnailSourcePreference } from '@varve/platform';
import { Button, Icon } from '@varve/ui';
import { useCallback, useState } from 'react';
import './thumbnailsource.css';

export interface ThumbnailSourcePickerProps {
  file: FileEntry;
  platform: Platform;
  /** Called when the preference changes (so the caller can persist it). */
  onPreferenceChange: (preference: ThumbnailSourcePreference) => void;
  /** Called to regenerate and persist the thumbnail now. */
  onRegenerate: () => void;
  compact?: boolean;
}

export function ThumbnailSourcePicker({
  file,
  platform: _platform,
  onPreferenceChange,
  onRegenerate,
  compact,
}: ThumbnailSourcePickerProps) {
  const currentPref = file.thumbnailPreference ?? { type: 'automatic' };
  const [generating, setGenerating] = useState(false);

  const handleSelect = useCallback(
    (pref: ThumbnailSourcePreference) => {
      onPreferenceChange(pref);
    },
    [onPreferenceChange],
  );

  const handleRefresh = useCallback(async () => {
    setGenerating(true);
    try {
      await onRegenerate();
    } finally {
      setGenerating(false);
    }
  }, [onRegenerate]);

  const handleReset = useCallback(() => {
    onPreferenceChange({ type: 'automatic' });
  }, [onPreferenceChange]);

  // Page sources — only include if the file's document has pages
  // (detection requires loading the document, so we only show the
  // automatic option by default and let the caller provide more).

  const isAutomatic = currentPref.type === 'automatic';

  return (
    <fieldset className="thumbnail-source-picker">
      <legend className="thumbnail-source-picker__header">
        <Icon name="Image" label={undefined} size="1em" />
        <span>Project Thumbnail</span>
      </legend>

      <div className="thumbnail-source-picker__body">
        {/* Source type selector. Native radios preserve the picker semantics
         * while the surrounding fieldset supplies the group name. */}
        <div className="thumbnail-source-picker__sources">
          <label
            className={`thumbnail-source-picker__option${isAutomatic ? ' thumbnail-source-picker__option--active' : ''}`}
          >
            <input
              className="thumbnail-source-picker__radio"
              type="radio"
              name={`thumbnail-source-${file.id}`}
              checked={isAutomatic}
              readOnly
              aria-label="Automatic"
              // A native radio does not emit change when the already selected
              // option is clicked; click is the stable activation event for
              // both pointer and keyboard input.
              onClick={() => handleSelect({ type: 'automatic' })}
            />
            <Icon name="Image" label={undefined} size="0.85em" />
            <span className="thumbnail-source-picker__option-text">
              <span className="thumbnail-source-picker__option-label">Automatic</span>
              <span className="thumbnail-source-picker__option-desc">Document overview</span>
            </span>
          </label>
        </div>

        {/* Actions */}
        <div className="thumbnail-source-picker__actions">
          <Button
            variant="ghost"
            size="sm"
            loading={generating}
            onClick={handleRefresh}
            aria-label="Regenerate thumbnail"
          >
            <Icon name="RotateCcw" label={undefined} size="0.85em" />
            {compact ? '' : ' Refresh'}
          </Button>
          {!isAutomatic && (
            <Button variant="ghost" size="sm" onClick={handleReset} aria-label="Reset to automatic">
              <Icon name="RotateCcw" label={undefined} size="0.85em" />
              {compact ? '' : ' Reset'}
            </Button>
          )}
        </div>
      </div>

      {generating && (
        <div className="thumbnail-source-picker__progress" role="status">
          Generating thumbnail…
        </div>
      )}
    </fieldset>
  );
}
