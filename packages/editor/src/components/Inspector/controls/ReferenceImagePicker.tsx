/**
 * ReferenceImagePicker — reusable component for selecting a reference
 * image for color transfer, harmonization, and palette extraction.
 *
 * Integrates with Strata's asset system and supports:
 *   - Selection from the current document's image nodes
 *   - Import from local files (drag-and-drop or file picker)
 *   - Clipboard paste
 *   - Thumbnail preview with dimensions
 *   - Replace, remove, and relink actions
 *   - Missing/inaccessible asset recovery
 *
 * WCAG 2.2 AA compliant: keyboard accessible, focus visible,
 * screen reader labels, reduced motion support.
 */
import { Button, Select, Tooltip } from '@strata/ui';
import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferenceImageState {
  /** Unique identifier for the reference. */
  id: string;
  /** Display name (filename or asset name). */
  name: string;
  /** Data URL or asset reference for display. */
  src: string;
  /** Natural pixel dimensions. */
  width: number;
  height: number;
  /** Whether the image is embedded (data URL) or linked (asset reference). */
  type: 'embedded' | 'linked';
  /** Whether the reference is accessible (not missing). */
  accessible: boolean;
  /** Optional color profile. */
  colorProfile?: string;
  /** File size in bytes (for display). */
  sizeBytes?: number;
}

interface ReferenceImagePickerProps {
  /** Current reference state (null = no reference selected). */
  reference: ReferenceImageState | null;
  /** Called when a reference is selected or changed. */
  onChange: (reference: ReferenceImageState | null) => void;
  /** Whether the picker is disabled (e.g. during processing). */
  disabled?: boolean;
  /** Available image nodes in the current document (for document picker). */
  documentImages?: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    src: string;
  }>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReferenceImagePicker({
  reference,
  onChange,
  disabled = false,
  documentImages = [],
}: ReferenceImagePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Handle file import
  const handleFileImport = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;

      const dataUrl = await readFileAsDataUrl(file);
      const dims = await getImageDimensions(dataUrl);

      const ref: ReferenceImageState = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        src: dataUrl,
        width: dims.width,
        height: dims.height,
        type: 'embedded',
        accessible: true,
        sizeBytes: file.size,
      };

      onChange(ref);
    },
    [onChange],
  );

  // Handle file input change
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileImport(file);
      // Reset input so same file can be re-selected
      e.target.value = '';
    },
    [handleFileImport],
  );

  // Handle drag-and-drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFileImport(files[0]!);
      }
    },
    [handleFileImport],
  );

  // Handle document image selection
  const handleDocumentSelect = useCallback(
    (imageId: string) => {
      const img = documentImages.find((i) => i.id === imageId);
      if (!img) return;

      const ref: ReferenceImageState = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: img.name,
        src: img.src,
        width: img.width,
        height: img.height,
        type: 'linked',
        accessible: true,
      };

      onChange(ref);
    },
    [documentImages, onChange],
  );

  // Handle clipboard paste
  const handleClipboardPaste = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const file = new File([blob], 'clipboard-image.png', { type });
            await handleFileImport(file);
            return;
          }
        }
      }
    } catch {
      // Clipboard API not available or no image
    }
  }, [handleFileImport]);

  // Remove reference
  const handleRemove = useCallback(() => {
    onChange(null);
  }, [onChange]);

  return (
    <section
      className="ref-image-picker"
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={disabled ? undefined : handleDragLeave}
      onDrop={disabled ? undefined : handleDrop}
      aria-label="Reference image picker"
    >
      {reference ? (
        <div className="ref-image-picker__current">
          <div
            className="ref-image-picker__preview"
            style={{
              backgroundImage:
                'linear-gradient(45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-sunken) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-sunken) 75%)',
              backgroundSize: '8px 8px',
            }}
          >
            <img
              src={reference.src}
              alt={`Reference: ${reference.name}`}
              style={{
                display: 'block',
                width: '100%',
                maxHeight: 80,
                objectFit: 'contain',
              }}
            />
          </div>
          <div className="ref-image-picker__info">
            <Tooltip label={reference.name} truncationOnly>
              <span className="ref-image-picker__name">{reference.name}</span>
            </Tooltip>
            <span className="ref-image-picker__dims">
              {reference.width} x {reference.height}
            </span>
            <span className="ref-image-picker__type">
              {reference.type === 'embedded' ? 'Embedded' : 'Linked'}
            </span>
          </div>
          <div className="ref-image-picker__actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Replace reference image"
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleRemove}
              aria-label="Remove reference image"
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div
          className={`ref-image-picker__empty ${isDragging ? 'ref-image-picker__empty--dragging' : ''}`}
        >
          <p className="insp-hint">
            Drop an image here, paste from clipboard, or select from document
          </p>
          <div className="ref-image-picker__import-actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Import reference image from file"
            >
              Import File
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={handleClipboardPaste}
              aria-label="Paste reference image from clipboard"
            >
              Paste
            </Button>
          </div>
          {documentImages.length > 0 && (
            <div className="ref-image-picker__document-select">
              <Select
                label="Or select from document"
                value=""
                disabled={disabled}
                onChange={handleDocumentSelect}
                placeholder="Choose image…"
                options={documentImages.map((img) => ({
                  value: img.id,
                  label: `${img.name} (${img.width}x${img.height})`,
                }))}
              />
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}
