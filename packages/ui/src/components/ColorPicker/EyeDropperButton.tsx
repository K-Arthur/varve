import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../icons';
import type { Color } from './color-utils';
import { hexToRgb } from './color-utils';

export interface EyeDropperButtonProps {
  onPick: (color: Color) => void;
}

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperInstance {
  open(options?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}

interface EyeDropperConstructor {
  new (): EyeDropperInstance;
}

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor;
  }
}

export function EyeDropperButton({ onPick }: EyeDropperButtonProps) {
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    setAvailable(typeof window !== 'undefined' && 'EyeDropper' in window);
  }, []);

  const handleClick = useCallback(async () => {
    if (!available) return;
    try {
      const EyeDropper = window.EyeDropper as EyeDropperConstructor;
      if (!EyeDropper) return;
      const dropper = new EyeDropper();
      const result = await dropper.open();
      const rgb = hexToRgb(result.sRGBHex);
      if (rgb) {
        onPick([rgb[0], rgb[1], rgb[2], 255]);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
    }
  }, [available, onPick]);

  return (
    <button
      type="button"
      aria-label={
        available ? 'Pick color from screen' : 'Eyedropper unavailable (use native picker)'
      }
      title={available ? 'Pick color from screen' : 'Eyedropper unavailable (use native picker)'}
      disabled={!available}
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 'var(--space-5)',
        height: 'var(--space-5)',
        padding: 0,
        background: 'var(--color-surface-sunken)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        color: available ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        cursor: available ? 'pointer' : 'not-allowed',
        opacity: available ? 1 : 0.5,
      }}
    >
      <Icon name="Pipette" label={undefined} size="1em" />
    </button>
  );
}
