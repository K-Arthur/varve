import { Button, Select, Switch } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { NumberField } from '../Inspector/controls/NumberField';
import './tonalEditors.css';

export function SourceChannels({
  source,
  label,
  onSample,
  onChannelChange,
}: {
  source?: ImageData | null;
  label?: string;
  onSample?: (x: number, y: number) => void;
  onChannelChange?: (channel: string) => void;
}) {
  const [channel, setChannel] = useState('composite');
  const [colorized, setColorized] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!source || !canvas.current) return;
    const preview = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    if (channel !== 'composite') {
      const component =
        ({ red: 0, green: 1, blue: 2, alpha: 3 } as Record<string, number>)[channel] ?? 0;
      for (let i = 0; i < preview.data.length; i += 4) {
        const v = source.data[i + component]!;
        for (let c = 0; c < 3; c++)
          preview.data[i + c] = colorized && component < 3 && c !== component ? 0 : v;
        preview.data[i + 3] = component === 3 ? 255 : source.data[i + 3]!;
      }
    }
    canvas.current.width = source.width;
    canvas.current.height = source.height;
    canvas.current.getContext('2d')?.putImageData(preview, 0, 0);
  }, [source, channel, colorized]);
  if (!source)
    return <p className="tonal-editor__hint">Source preview unavailable for this target.</p>;
  const x = Math.max(0, Math.min(source.width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(source.height - 1, Math.round(point.y)));
  const i = (y * source.width + x) * 4;
  return (
    <div className="tonal-editor">
      <p className="tonal-editor__hint">
        {label ?? 'Scoped source'} · {source.width} x {source.height} preview. Viewing leaves the
        edit target and export unchanged.
      </p>
      <Select
        label="Inspect channel"
        value={channel}
        onChange={(value) => {
          setChannel(value);
          onChannelChange?.(value);
        }}
        options={[
          { value: 'composite', label: 'Composite' },
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
          { value: 'blue', label: 'Blue' },
          { value: 'alpha', label: 'Alpha coverage' },
        ]}
      />
      {channel !== 'composite' && channel !== 'alpha' && (
        <Switch
          label="Colorized channel"
          checked={colorized}
          onChange={(e) => setColorized(e.target.checked)}
        />
      )}
      <button
        type="button"
        className="tonal-source-preview"
        aria-label={onSample ? 'Pick neutral patch from source preview' : 'Read source pixel'}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const next = {
            x: Math.max(
              0,
              Math.min(
                source.width - 1,
                Math.floor(((e.clientX - rect.left) * source.width) / rect.width),
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                source.height - 1,
                Math.floor(((e.clientY - rect.top) * source.height) / rect.height),
              ),
            ),
          };
          // Keyboard activation has no client coordinates: use the displayed point.
          if (e.detail === 0) {
            onSample?.(x, y);
            return;
          }
          setPoint(next);
          onSample?.(next.x, next.y);
        }}
      >
        <canvas ref={canvas} aria-label={`${channel} source preview`} />
      </button>
      <div className="tonal-editor__fields">
        <NumberField
          label="Source sample X"
          displayLabel="X"
          value={x}
          min={0}
          max={source.width - 1}
          onChange={(v) => setPoint((p) => ({ ...p, x: v }))}
        />
        <NumberField
          label="Source sample Y"
          displayLabel="Y"
          value={y}
          min={0}
          max={source.height - 1}
          onChange={(v) => setPoint((p) => ({ ...p, y: v }))}
        />
      </div>
      <output className="tonal-editor__hint">
        Source RGBA: {Array.from(source.data.slice(i, i + 4)).join(', ')}
      </output>
      <div className="tonal-editor__actions">
        {onSample && (
          <Button variant="secondary" size="sm" onClick={() => onSample(x, y)}>
            Sample neutral patch
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setChannel('composite');
            onChannelChange?.('composite');
          }}
        >
          Restore composite
        </Button>
      </div>
    </div>
  );
}
