import { cachedImageDims, getImageCache } from '@varve/engine';
import { Button } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { NumberField } from '../Inspector/controls/NumberField';

/** Reuses the decoded source cache; allocates only the 128px requested crop. */
export function SourcePixelDetail({ locator }: { locator: string }) {
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [pixels, setPixels] = useState<ImageData | null>(null);
  const [message, setMessage] = useState(
    'Original RGB detail before crop, transforms and filters.',
  );
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setPixels(null);
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [locator]);
  useEffect(() => {
    if (!canvas.current || !pixels) return;
    canvas.current.width = pixels.width;
    canvas.current.height = pixels.height;
    canvas.current.getContext('2d')?.putImageData(pixels, 0, 0);
  }, [pixels]);
  const request = async () => {
    if (busy) return;
    setBusy(true);
    const revision = ++generation.current;
    try {
      const image = await getImageCache().load(locator);
      if (revision !== generation.current) return;
      const size = cachedImageDims(image);
      if (size.width * size.height > 16_000_000) {
        setMessage('Source detail exceeds the 16-megapixel inspection budget.');
        return;
      }
      const width = Math.min(128, size.width),
        height = Math.min(128, size.height);
      const x = Math.max(0, Math.min(size.width - width, Math.round(point.x)));
      const y = Math.max(0, Math.min(size.height - height, Math.round(point.y)));
      const surface = document.createElement('canvas');
      surface.width = width;
      surface.height = height;
      const ctx = surface.getContext('2d');
      if (!ctx) throw new Error('No detail surface');
      ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
      setPixels(ctx.getImageData(0, 0, width, height));
      setMessage(
        `Original source (${x}, ${y}), ${width} x ${height}. One source pixel per CSS pixel. Canvas readback can quantize partial alpha.`,
      );
    } catch {
      if (revision === generation.current) setMessage('Original source detail unavailable.');
    } finally {
      if (revision === generation.current) setBusy(false);
    }
  };
  return (
    <div className="tonal-editor">
      <div className="tonal-editor__fields">
        <NumberField
          label="Original detail X"
          displayLabel="Source X"
          value={point.x}
          min={0}
          max={65535}
          onChange={(x) => setPoint({ ...point, x })}
        />
        <NumberField
          label="Original detail Y"
          displayLabel="Source Y"
          value={point.y}
          min={0}
          max={65535}
          onChange={(y) => setPoint({ ...point, y })}
        />
      </div>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void request()}>
        Show original pixel detail
      </Button>
      <p className="tonal-editor__hint" role="status">
        {message}
      </p>
      {pixels && (
        <div className="tonal-detail">
          <canvas ref={canvas} aria-label="Original source pixel detail" />
        </div>
      )}
    </div>
  );
}
