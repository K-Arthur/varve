/**
 * FontDetectSection — "Identify Font": detects the font family used in a
 * selected text region of an image.
 *
 * Modes:
 *   - Classifier (default): uses the font-classify EfficientNet model to
 *     predict font families from the image crop. Requires model download.
 *   - Local match: renders the recognized text using installed fonts and
 *     compares visually. Works without any model download.
 *
 * Results are presented as ranked candidates with honest confidence language.
 */

import type { FontDetectionResult } from '@varve/engine';
import { detectFont, getModelLoader, loadFullLabelMap } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import './FontDetectSection.css';

const MODEL_ID = 'font-classify';

interface FontDetectState {
  status: 'idle' | 'downloading' | 'detecting' | 'error';
  errorMessage: string | null;
  progress: number;
  result: FontDetectionResult | null;
}

function loadImageToImageData(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

export function FontDetectSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const { announce } = editor;
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [detect, setDetect] = useState<FontDetectState>({
    status: 'idle',
    errorMessage: null,
    progress: 0,
    result: null,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      const [available] = await Promise.all([
        getModelLoader().isModelAvailable(MODEL_ID),
        loadFullLabelMap(),
      ]);
      if (!cancelled) setModelAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  const handleDownload = useCallback(async () => {
    setDetect((prev) => ({ ...prev, status: 'downloading', errorMessage: null }));
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setDetect((prev) => ({ ...prev, status: 'idle' }));
      setModelAvailable(true);
      announce('Font detection model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setDetect((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setDetect((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleDetect = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDetect((prev) => ({ ...prev, status: 'detecting', errorMessage: null, result: null }));

    try {
      if (!imageSrc) throw new Error('No image selected');
      const fullData = await loadImageToImageData(imageSrc);
      if (controller.signal.aborted) throw new Error('cancelled');

      const result = await detectFont(
        {
          imageData: fullData,
          mode: 'hybrid',
          maxCandidates: 5,
          signal: controller.signal,
        },
        {},
      );

      if (controller.signal.aborted) throw new Error('cancelled');

      setDetect({
        status: 'idle',
        errorMessage: null,
        progress: 100,
        result,
      });

      const candidateCount = result.candidates.length;
      announce(
        candidateCount > 0
          ? `Found ${candidateCount} font candidate${candidateCount === 1 ? '' : 's'}`
          : 'No font candidates found',
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Font detection failed';
      setDetect((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [imageSrc, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setDetect((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  const handleDismissResult = useCallback(() => {
    setDetect((prev) => ({ ...prev, result: null }));
  }, []);

  const applyCandidateFont = useCallback(
    (family: string) => {
      editor.beginTransaction();
      try {
        for (const textNode of nodes) {
          if (textNode.kind === 'text') {
            editor.updateNode(textNode.id, (n) => ({
              ...n,
              fontFamily: family,
            }));
          }
        }
      } finally {
        editor.commitTransaction();
      }
      announce(`Applied font: ${family}`);
    },
    [editor, nodes, announce],
  );

  if (!isImage || !typedNode) return null;

  const isProcessing = detect.status === 'detecting';
  const needsDownload = !modelAvailable && detect.status !== 'downloading';

  return (
    <DisclosureSection title="Identify Font" sectionId="font-detect">
      <div className="insp-field-group">
        <p className="insp-hint">
          Identifies the font family used in this image. Select a clear, high-contrast text region
          for best results. Runs locally in a web worker.
        </p>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDownload}
              aria-label="Download font classifier model (~64 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~64 MB download. Stored locally on this device.
            </p>
          </div>
        )}

        {detect.status === 'downloading' && (
          <div className="insp-actions">
            <div
              className="insp-progress-bar"
              role="progressbar"
              aria-valuenow={downloadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
            </div>
            <p className="insp-hint" aria-live="polite">
              Downloading… {downloadProgress}%
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
              Cancel
            </Button>
          </div>
        )}

        {detect.result && (
          <section className="insp-nested-panel" aria-label="Font detection results">
            <ResultsList result={detect.result} onApply={applyCandidateFont} />
            <div className="insp-actions">
              <Button type="button" variant="ghost" size="sm" onClick={handleDismissResult}>
                Dismiss
              </Button>
            </div>
          </section>
        )}

        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                Identifying font…
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleDetect}
              aria-label="Identify font in image"
            >
              Identify Font
            </Button>
          )}
        </div>

        {detect.status === 'error' && detect.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {detect.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}

function ResultsList({
  result,
  onApply,
}: {
  result: FontDetectionResult;
  onApply?: (family: string) => void;
}) {
  if (result.candidates.length === 0) {
    return (
      <div className="insp-hint" role="status">
        <p>{result.message}</p>
        {result.qualityWarnings.length > 0 && (
          <ul style={{ marginTop: 4, paddingLeft: 16 }}>
            {result.qualityWarnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="insp-subsection__label">
        {result.candidates.length} candidate{result.candidates.length === 1 ? '' : 's'}
      </p>
      <ul className="font-detect-results" aria-label="Font candidates ranked by confidence">
        {result.candidates.map((candidate) => (
          <li key={candidate.family} className="font-detect-candidate">
            <div className="font-detect-candidate__header">
              <span className="font-detect-candidate__family">{candidate.family}</span>
              <ConfidenceBadge category={candidate.confidenceCategory} />
            </div>
            <span className="font-detect-candidate__style">{candidate.style}</span>
            <div className="font-detect-candidate__meta">
              {candidate.isAvailable && (
                <span className="font-detect-candidate__available">Installed</span>
              )}
              <span className="font-detect-candidate__source">{candidate.source}</span>
            </div>
            <div className="insp-actions" style={{ marginTop: 4 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onApply?.(candidate.family)}
                aria-label={`Apply font ${candidate.family}`}
              >
                Apply
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {result.qualityWarnings.length > 0 && (
        <div className="insp-hint insp-hint--warning" role="note">
          {result.qualityWarnings.map((w) => (
            <p key={w.code}>{w.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ category }: { category: string }) {
  const label = confidenceLabel(category);
  const className = `font-detect-badge font-detect-badge--${category}`;
  return (
    <span className={className} role="status" aria-label={`Confidence: ${label}`}>
      {label}
    </span>
  );
}

function confidenceLabel(category: string): string {
  switch (category) {
    case 'likely-match':
      return 'Likely match';
    case 'plausible-match':
      return 'Plausible match';
    case 'similar-candidate':
      return 'Similar';
    case 'low-confidence':
      return 'Low confidence';
    case 'out-of-catalogue':
      return 'Not in catalogue';
    case 'insufficient-quality':
      return 'Low quality';
    default:
      return category;
  }
}
