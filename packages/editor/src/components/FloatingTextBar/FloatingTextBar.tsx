import type { ManagedColor, NodeId, TextNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, managedColorToRgba } from '@varve/shared';
import { ColorPicker, Icon, Popover, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontSelector } from '../FontBrowser/FontSelector';
import './FloatingTextBar.css';

export interface FloatingTextBarProps {
  node: TextNode;
  onUpdate: (id: NodeId, changes: Partial<TextNode>) => void;
  onClose: () => void;
  textScreenRect: { x: number; y: number; w: number; h: number };
}

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const BAR_HEIGHT_EST = 42;
const PADDING = 8;
const MIN_BAR_WIDTH = 400;

export function FloatingTextBar({ node, onUpdate, onClose, textScreenRect }: FloatingTextBarProps) {
  const [colorOpen, setColorOpen] = useState(false);

  const { barLeft, barTop } = useMemo(() => {
    const vpH = window.innerHeight;
    const vpW = window.innerWidth;

    const spaceAbove = textScreenRect.y - PADDING;
    const spaceBelow = vpH - (textScreenRect.y + textScreenRect.h) - PADDING;
    const spaceRight = vpW - (textScreenRect.x + textScreenRect.w) - PADDING;

    let top: number;
    let left: number;

    if (spaceAbove >= BAR_HEIGHT_EST) {
      top = textScreenRect.y - BAR_HEIGHT_EST - PADDING;
      left = textScreenRect.x;
    } else if (spaceBelow >= BAR_HEIGHT_EST) {
      top = textScreenRect.y + textScreenRect.h + PADDING;
      left = textScreenRect.x;
    } else if (spaceRight >= 200) {
      top = textScreenRect.y;
      left = textScreenRect.x + textScreenRect.w + PADDING;
    } else {
      top = PADDING;
      left = Math.max(PADDING, textScreenRect.x);
    }

    left = Math.max(PADDING, Math.min(left, vpW - MIN_BAR_WIDTH));
    top = Math.max(PADDING, Math.min(top, vpH - BAR_HEIGHT_EST));

    return { barLeft: left, barTop: top };
  }, [textScreenRect]);

  const handleBoldToggle = useCallback(() => {
    const current = node.fontWeight ?? 400;
    onUpdate(node.id, { fontWeight: current >= 600 ? 400 : 700 });
  }, [node, onUpdate]);

  const handleItalicToggle = useCallback(() => {
    onUpdate(node.id, {
      fontStyle: (node.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic',
    });
  }, [node, onUpdate]);

  const handleAlignChange = useCallback(
    (v: 'left' | 'center' | 'right') => {
      onUpdate(node.id, { textAlign: v });
    },
    [node, onUpdate],
  );

  const handleListToggle = useCallback(() => {
    onUpdate(node.id, { listStyle: (node.listStyle ?? 'none') === 'none' ? 'disc' : 'none' });
  }, [node, onUpdate]);

  const handleColorChange = useCallback(
    (color: ManagedColor) => {
      onUpdate(node.id, { fill: color });
    },
    [node, onUpdate],
  );

  const handleFontFamilyChange = useCallback(
    (value: string) => {
      onUpdate(node.id, { fontFamily: value });
    },
    [node, onUpdate],
  );

  const handleFontWeightChange = useCallback(
    (value: string) => {
      onUpdate(node.id, { fontWeight: Number(value) });
    },
    [node, onUpdate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const fillColor: ManagedColor = node.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
  const fillColorRgba = managedColorToRgba(fillColor);
  const isBold = (node.fontWeight ?? 400) >= 600;
  const isItalic = (node.fontStyle ?? 'normal') === 'italic';
  const isList = (node.listStyle ?? 'none') !== 'none';
  const textAlign = node.textAlign ?? 'left';

  return createPortal(
    <div
      className="floating-text-bar"
      style={{ left: barLeft, top: barTop }}
      role="toolbar"
      aria-label="Text formatting"
      onKeyDown={handleKeyDown}
    >
      <FontSelector
        value={node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY}
        onChange={handleFontFamilyChange}
      />

      <div className="floating-text-bar__separator" />

      <Select
        label="Font weight"
        value={String(node.fontWeight ?? 400)}
        options={FONT_WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))}
        onChange={(v) => handleFontWeightChange(v)}
      />

      <button
        type="button"
        className={`floating-text-bar__btn${isBold ? ' floating-text-bar__btn--active' : ''}`}
        onClick={handleBoldToggle}
        aria-label="Bold"
        aria-pressed={isBold}
      >
        <Icon name="Bold" size={16} />
      </button>

      <button
        type="button"
        className={`floating-text-bar__btn${isItalic ? ' floating-text-bar__btn--active' : ''}`}
        onClick={handleItalicToggle}
        aria-label="Italic"
        aria-pressed={isItalic}
      >
        <Icon name="Italic" size={16} />
      </button>

      <div className="floating-text-bar__separator" />

      <input
        type="number"
        className="floating-text-bar__size-input"
        value={node.fontSize ?? 16}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v) && v > 0) {
            onUpdate(node.id, { fontSize: v });
          }
        }}
        aria-label="Font size"
        min={1}
        step={1}
      />

      <div className="floating-text-bar__separator" />

      {(['left', 'center', 'right'] as const).map((align) => (
        <button
          key={align}
          type="button"
          className={`floating-text-bar__btn${textAlign === align ? ' floating-text-bar__btn--active' : ''}`}
          onClick={() => handleAlignChange(align)}
          aria-label={`Align ${align}`}
          aria-pressed={textAlign === align}
        >
          <Icon
            name={
              align === 'left'
                ? 'TextAlignStart'
                : align === 'center'
                  ? 'TextAlignCenter'
                  : 'TextAlignEnd'
            }
            size={16}
          />
        </button>
      ))}

      <div className="floating-text-bar__separator" />

      <button
        type="button"
        className={`floating-text-bar__btn${isList ? ' floating-text-bar__btn--active' : ''}`}
        onClick={handleListToggle}
        aria-label="List"
        aria-pressed={isList}
      >
        <Icon name="List" size={16} />
      </button>

      <div className="floating-text-bar__separator" />

      <Popover
        placement="top"
        open={colorOpen}
        onOpenChange={setColorOpen}
        label="Text color picker"
        popover={<ColorPicker value={fillColor} onChange={handleColorChange} />}
      >
        <button
          type="button"
          className="floating-text-bar__swatch"
          aria-label="Text color"
          style={{
            background: `rgba(${fillColorRgba[0]}, ${fillColorRgba[1]}, ${fillColorRgba[2]}, ${fillColorRgba[3] / 255})`,
          }}
        />
      </Popover>
    </div>,
    document.body,
  );
}
