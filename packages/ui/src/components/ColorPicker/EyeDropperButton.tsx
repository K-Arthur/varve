import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../icons';
import { Tooltip } from '../Tooltip';
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
    <Tooltip
      label="Pick color from screen"
      disabledReason={available ? undefined : 'Eyedropper unavailable (use native picker)'}
    >
      <button
        type="button"
        aria-label={
          available ? 'Pick color from screen' : 'Eyedropper unavailable (use native picker)'
        }
        disabled={!available}
        onClick={handleClick}
        className="eye-dropper"
      >
        <Icon name="Pipette" label={undefined} size="1em" />
      </button>
    </Tooltip>
  );
}
