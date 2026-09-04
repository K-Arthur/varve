import type { ManagedColor, NodeId, TextNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, managedColorToRgba } from '@varve/shared';
import {
  ColorPicker,
  FloatingPortal,
  Popover,
  pointAnchor,
  SegmentedControl,
  Select,
  ToggleButton,
  viewportPoint,
} from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { FontSelector } from '../FontBrowser/FontSelector';
import './FloatingTextBar.css';

export interface FloatingTextBarProps {
  node: TextNode;
  onUpdate: (id: NodeId, changes: Partial<TextNode>) => void;
  onClose: () => void;
  textScreenRect: { x: number; y: number; w: number; h: number };
}

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export function FloatingTextBar({ node, onUpdate, onClose, textScreenRect }: FloatingTextBarProps) {
  const [colorOpen, setColorOpen] = useState(false);
  const textAnchor = useMemo(
    () => pointAnchor(viewportPoint(textScreenRect.x, textScreenRect.y), document),
    [textScreenRect.x, textScreenRect.y],
  );

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
    (v: 'left' | 'center' | 'right' | 'justify') => {
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

  const fillColor: ManagedColor = node.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
  const fillColorRgba = managedColorToRgba(fillColor);
  const isBold = (node.fontWeight ?? 400) >= 600;
  const isItalic = (node.fontStyle ?? 'normal') === 'italic';
  const isList = (node.listStyle ?? 'none') !== 'none';
  const textAlign = node.textAlign ?? 'left';

  return (
    <FloatingPortal
      anchor={textAnchor}
      open
      placement="top-start"
      fallbackPlacements={['bottom-start', 'right-start', 'left-start']}
      offsetDistance={8}
      kind="popover"
      dismissOnEscape
      onClose={() => onClose()}
      className="floating-text-bar__layer"
    >
      <div className="floating-text-bar" role="toolbar" aria-label="Text formatting">
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

        <ToggleButton
          size="sm"
          icon="Bold"
          pressed={isBold}
          onPressedChange={handleBoldToggle}
          label="Bold"
          className={`floating-text-bar__btn${isBold ? ' floating-text-bar__btn--active' : ''}`}
        />

        <ToggleButton
          size="sm"
          icon="Italic"
          pressed={isItalic}
          onPressedChange={handleItalicToggle}
          label="Italic"
          className={`floating-text-bar__btn${isItalic ? ' floating-text-bar__btn--active' : ''}`}
        />

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

        <SegmentedControl
          label="Text alignment"
          value={textAlign}
          options={[
            { value: 'left', label: 'Left', icon: 'TextAlignStart' },
            { value: 'center', label: 'Center', icon: 'TextAlignCenter' },
            { value: 'right', label: 'Right', icon: 'TextAlignEnd' },
            { value: 'justify', label: 'Justify', icon: 'TextAlignJustify' },
          ]}
          onChange={handleAlignChange}
        />

        <div className="floating-text-bar__separator" />

        <ToggleButton
          size="sm"
          icon="List"
          pressed={isList}
          onPressedChange={handleListToggle}
          label="List"
          className={`floating-text-bar__btn${isList ? ' floating-text-bar__btn--active' : ''}`}
        />

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
      </div>
    </FloatingPortal>
  );
}
