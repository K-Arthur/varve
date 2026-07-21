/**
 * CombinedPreview — shows the union of all selected subject masks
 * applied to the source image, with before/after comparison and
 * background options.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type PreviewBackground = 'checkerboard' | 'black' | 'white' | 'custom';

interface CombinedPreviewProps {
  sourceImageSrc: string;
  maskDataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  selectedCount: number;
  totalCount: number;
}

export function CombinedPreview({
  sourceImageSrc,
  maskDataUrl,
  sourceWidth,
  sourceHeight,
  selectedCount,
  totalCount,
}: CombinedPreviewProps) {
  const [background, setBackground] = useState<PreviewBackground>('checkerboard');
  const [comparisonPosition, setComparisonPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load images
  const [sourceImg, setSourceImg] = useState<HTMLImageElement | null>(null);
  const [maskImg, setMaskImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!sourceImageSrc) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setSourceImg(img);
    img.src = sourceImageSrc;
  }, [sourceImageSrc]);

  useEffect(() => {
    if (!maskDataUrl) return;
    const img = new Image();
    img.onload = () => setMaskImg(img);
    img.src = maskDataUrl;
  }, [maskDataUrl]);

  // Render combined preview
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceImg || !maskImg) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    // Draw background
    if (background === 'checkerboard') {
      const checkSize = 8;
      for (let y = 0; y < sourceHeight; y += checkSize) {
        for (let x = 0; x < sourceWidth; x += checkSize) {
          ctx.fillStyle =
            (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0
              ? '#e0e0e0'
              : '#ffffff';
          ctx.fillRect(x, y, checkSize, checkSize);
        }
      }
    } else if (background === 'black') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, sourceWidth, sourceHeight);
    } else if (background === 'white') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sourceWidth, sourceHeight);
    }

    // Apply mask and draw source
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // Draw mask to alpha channel
    ctx.drawImage(maskImg, 0, 0, sourceWidth, sourceHeight);
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(sourceImg, 0, 0, sourceWidth, sourceHeight);
    ctx.restore();
  }, [sourceImg, maskImg, sourceWidth, sourceHeight, background]);

  // Comparison slider
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setComparisonPosition(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div className="combined-preview">
      <div className="combined-preview__header">
        <span className="combined-preview__count">
          {selectedCount} of {totalCount} subjects
        </span>
        <div className="combined-preview__bg-selector">
          {(['checkerboard', 'black', 'white'] as const).map((bg) => (
            <button
              key={bg}
              type="button"
              className={`combined-preview__bg-btn ${background === bg ? 'combined-preview__bg-btn--active' : ''}`}
              onClick={() => setBackground(bg)}
              aria-label={`${bg} background`}
              aria-pressed={background === bg}
            >
              {bg === 'checkerboard' && '▦'}
              {bg === 'black' && '■'}
              {bg === 'white' && '□'}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="combined-preview__canvas-container"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <canvas
          ref={canvasRef}
          className="combined-preview__canvas"
          style={{ width: '100%', height: 'auto', aspectRatio: `${sourceWidth}/${sourceHeight}` }}
        />

        {/* Comparison overlay */}
        <div
          className="combined-preview__comparison"
          style={{ clipPath: `inset(0 ${100 - comparisonPosition}% 0 0)` }}
        >
          <img
            src={sourceImageSrc}
            alt="Original"
            className="combined-preview__original"
            style={{ width: '100%', height: 'auto' }}
          />
        </div>

        {/* Slider handle */}
        <div className="combined-preview__slider" style={{ left: `${comparisonPosition}%` }}>
          <div className="combined-preview__slider-line" />
          <div className="combined-preview__slider-handle">⇔</div>
        </div>
      </div>
    </div>
  );
}
