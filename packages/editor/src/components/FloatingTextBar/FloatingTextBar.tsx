import { getFontRegistry } from '@varve/engine';
import type { ManagedColor, NodeId, TextNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, managedColorToRgba } from '@varve/shared';
import {
  ColorPicker,
  FloatingPortal,
  Icon,
  Popover,
  pointAnchor,
  SegmentedControl,
  Select,
  ToggleButton,
  viewportPoint,
} from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FontSelector } from '../FontBrowser/FontSelector';
import {
  fontFamilyChanges,
  fontStyleChanges,
  fontWeightChanges,
  fontWeightOptions,
} from '../Typography/fontWeight';
import './FloatingTextBar.css';

export interface FloatingTextBarProps {
  node: TextNode;
  onUpdate: (id: NodeId, changes: Partial<TextNode>) => void;
  onClose: () => void;
  textScreenRect: { x: number; y: number; w: number; h: number };
}

const TOOLBAR_FALLBACKS: Array<'bottom-start' | 'right-start' | 'left-start'> = [
  'bottom-start',
  'right-start',
  'left-start',
];

export function FloatingTextBar({ node, onUpdate, onClose, textScreenRect }: FloatingTextBarProps) {
  const registry = useMemo(() => getFontRegistry(), []);
  const weightOptions = useMemo(() => fontWeightOptions(node, registry), [node, registry]);
  const [colorOpen, setColorOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const textAnchor = useMemo(
    () => pointAnchor(viewportPoint(textScreenRect.x, textScreenRect.y), document),
    [textScreenRect.x, textScreenRect.y],
  );

  const handleBoldToggle = useCallback(() => {
    const current = node.fontWeight ?? 400;
    const next = current >= 600 ? 400 : 700;
    const option = weightOptions.find((candidate) => candidate.value === next);
    if (!option || option.disabled) return;
    onUpdate(node.id, fontWeightChanges(node, next, registry));
  }, [node, onUpdate, registry, weightOptions]);

  const handleItalicToggle = useCallback(() => {
    const next = (node.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic';
    onUpdate(node.id, fontStyleChanges(node, next, registry));
  }, [node, onUpdate, registry]);

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
      onUpdate(node.id, fontFamilyChanges(value));
    },
    [node, onUpdate],
  );

  const handleFontWeightChange = useCallback(
    (value: string) => {
      onUpdate(node.id, fontWeightChanges(node, Number(value), registry));
    },
    [node, onUpdate, registry],
  );

  const fillColor: ManagedColor = node.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
  const fillColorRgba = managedColorToRgba(fillColor);
  const isBold = (node.fontWeight ?? 400) >= 600;
  const boldAvailable =
    isBold || weightOptions.some((option) => option.value === 700 && !option.disabled);
  const isItalic = (node.fontStyle ?? 'normal') === 'italic';
  const isList = (node.listStyle ?? 'none') !== 'none';
  const textAlign = node.textAlign ?? 'left';

  return (
    <FloatingPortal
      anchor={textAnchor}
      open
      placement="top-start"
      fallbackPlacements={TOOLBAR_FALLBACKS}
      offsetDistance={8}
      kind="popover"
      dismissOnEscape={!colorOpen}
      onClose={() => onClose()}
      className="floating-text-bar__layer"
    >
      <div className="floating-text-bar" role="toolbar" aria-label="Text formatting">
        <FontSelector
          value={node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY}
          fontReference={node.fontReference}
          onChange={handleFontFamilyChange}
        />

        <div className="floating-text-bar__separator" />

        <Select
          label="Font weight"
          className="floating-text-bar__weight-select"
          value={String(node.fontWeight ?? 400)}
          options={weightOptions.map((option) => ({
            value: String(option.value),
            label: option.label,
            disabled: option.disabled,
            disabledReason: option.disabledReason,
          }))}
          onChange={(v) => handleFontWeightChange(v)}
        />

        <ToggleButton
          size="sm"
          icon="Bold"
          pressed={isBold}
          onPressedChange={handleBoldToggle}
          label="Bold"
          disabled={!boldAvailable}
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

        <FontSizeInput
          key={node.id}
          value={node.fontSize ?? 16}
          onCommit={(fontSize) => onUpdate(node.id, { fontSize })}
        />

        <div className="floating-text-bar__separator" />

        <Popover
          placement="top"
          open={colorOpen}
          onOpenChange={setColorOpen}
          label="Text color picker"
          popover={<ColorPicker value={fillColor} onChange={handleColorChange} />}
        >
          <button type="button" className="floating-text-bar__swatch" aria-label="Text color">
            <span
              className="floating-text-bar__swatch-color"
              aria-hidden="true"
              style={{
                background: `rgba(${fillColorRgba[0]}, ${fillColorRgba[1]}, ${fillColorRgba[2]}, ${fillColorRgba[3] / 255})`,
              }}
            />
          </button>
        </Popover>
        <button
          ref={moreRef}
          type="button"
          className="floating-text-bar__btn"
          aria-label="More text formatting"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <Icon name="Ellipsis" size={16} />
        </button>
        <FloatingPortal
          anchorRef={moreRef}
          open={moreOpen}
          placement="bottom-end"
          kind="popover"
          className="floating-text-bar__more-layer"
          dismissOnEscape
          dismissOnPointerDown
          onClose={(reason) => {
            setMoreOpen(false);
            if (reason === 'escape') moreRef.current?.focus();
          }}
        >
          <div className="floating-text-bar__more" role="dialog" aria-label="More text formatting">
            <div className="floating-text-bar__alignment">
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
            </div>

            <div className="floating-text-bar__separator" />

            <ToggleButton
              size="sm"
              icon="List"
              pressed={isList}
              onPressedChange={handleListToggle}
              label="List"
              className={`floating-text-bar__btn${isList ? ' floating-text-bar__btn--active' : ''}`}
            />
          </div>
        </FloatingPortal>
      </div>
    </FloatingPortal>
  );
}

/** Editing digits is a draft; blur or Enter commits one authored size. */
function FontSizeInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0 && next <= 10000) {
      if (next !== value) onCommit(next);
    } else setDraft(String(value));
  };
  return (
    <input
      type="number"
      className="floating-text-bar__size-input"
      value={draft}
      aria-label="Font size"
      min={1}
      max={10000}
      step={1}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape' && draft !== String(value)) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(String(value));
        }
      }}
    />
  );
}
