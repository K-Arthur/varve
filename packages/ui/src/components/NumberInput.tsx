import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';

export interface NumberInputProps {
  value: number;
  step?: number;
  shiftStep?: number;
  altStep?: number;
  min?: number;
  max?: number;
  label: string;
  onChange: (value: number) => void;
  id?: string;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  {
    value,
    step = 1,
    shiftStep = 10,
    altStep = 0.1,
    min = -99999,
    max = 99999,
    label,
    onChange,
    id,
  },
  ref,
) {
  const [dirty, setDirty] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const dragRef = useRef<{
    startX: number;
    startValue: number;
    scrubbing: boolean;
  } | null>(null);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const commitValue = useCallback(
    (raw: string) => {
      const parsed = Number.parseFloat(raw);
      if (!Number.isNaN(parsed)) {
        onChange(clamp(parsed));
      }
      setDirty(null);
    },
    [clamp, onChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startValue: value,
        scrubbing: false,
      };

      const handleMouseMove = (me: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = me.clientX - drag.startX;
        if (Math.abs(dx) > 2) {
          drag.scrubbing = true;
          const factor = me.shiftKey ? 10 : me.altKey ? 0.1 : 1;
          const delta = dx * (step * factor);
          const newVal = clamp(Math.round((drag.startValue + delta) * 100) / 100);
          onChange(newVal);
          document.body.style.cursor = 'ew-resize';
          document.body.style.userSelect = 'none';
        }
      };

      const handleMouseUp = () => {
        const drag = dragRef.current;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        if (drag && !drag.scrubbing) {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
        dragRef.current = null;
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [clamp, onChange, step, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let newVal = value;
      const factor = e.shiftKey ? shiftStep : e.altKey ? altStep : step;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        newVal = clamp(value + factor);
        onChange(newVal);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        newVal = clamp(value - factor);
        onChange(newVal);
      } else if (e.key === 'Enter' && dirty !== null) {
        e.preventDefault();
        commitValue(dirty);
      }
    },
    [value, step, shiftStep, altStep, dirty, clamp, onChange, commitValue],
  );

  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      className="varve-number-input"
      value={dirty ?? String(value)}
      onChange={(e) => setDirty(e.target.value)}
      onBlur={() => {
        if (dirty !== null) commitValue(dirty);
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      aria-label={label}
    />
  );
});
