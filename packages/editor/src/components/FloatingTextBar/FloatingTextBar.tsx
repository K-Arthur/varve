import { getFontRegistry } from '@varve/engine';
import type { CharacterFormat, ManagedColor, NodeId, RichSelection, TextNode } from '@varve/scene';
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
  Toolbar,
  viewportPoint,
} from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { publishTextEditSession } from '../../context/textEditSession';
import { FontSelector } from '../FontBrowser/FontSelector';
import {
  fontFamilyChanges,
  fontStyleAvailable,
  fontStyleChanges,
  fontWeightChanges,
  fontWeightOptions,
} from '../Typography/fontWeight';
import { typographyDisplayValues } from '../Typography/typographyCommand';
import { useTypographyPreview } from '../Typography/useTypographyPreview';
import './FloatingTextBar.css';

export interface FloatingTextBarProps {
  node: TextNode;
  onUpdate: (id: NodeId, changes: Partial<TextNode>) => void;
  onClose: () => void;
  textScreenRect: { x: number; y: number; w: number; h: number };
  selectionRange?: RichSelection | null;
  pendingFormat?: CharacterFormat | null;
  beginPreview?: () => void;
  commitPreview?: () => void;
  abortPreview?: () => void;
}

const TOOLBAR_FALLBACKS: Array<'bottom-start' | 'right-start' | 'left-start'> = [
  'bottom-start',
  'right-start',
  'left-start',
];

export function FloatingTextBar({
  node,
  onUpdate,
  onClose,
  textScreenRect,
  selectionRange = null,
  pendingFormat = null,
  beginPreview,
  commitPreview,
  abortPreview,
}: FloatingTextBarProps) {
  const registry = useMemo(() => getFontRegistry(), []);
  const display = useMemo(
    () => typographyDisplayValues(node, selectionRange, pendingFormat),
    [node, pendingFormat, selectionRange],
  );
  const displayNode = useMemo(() => ({ ...node, ...display.values }), [display.values, node]);
  const effectiveNodes = useMemo(
    () => (display.effectiveNodes.length > 0 ? display.effectiveNodes : [displayNode]),
    [display.effectiveNodes, displayNode],
  );
  const weightOptions = useMemo(
    () => fontWeightOptions(effectiveNodes, registry),
    [effectiveNodes, registry],
  );
  const [colorOpen, setColorOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const ignoreResizeEscapeRef = useRef(false);
  const resizeEscapeTimerRef = useRef<number | null>(null);
  const [suppressResizeEscape, setSuppressResizeEscape] = useState(false);
  useEffect(() => {
    const markResize = () => {
      // Chromium/WebView can synthesize an Escape while a focused portal is
      // re-anchored after a viewport resize. Consume only that next Escape so
      // the edit session and its quick toolbar survive responsive layout.
      ignoreResizeEscapeRef.current = true;
      setSuppressResizeEscape(true);
      if (resizeEscapeTimerRef.current !== null) {
        window.clearTimeout(resizeEscapeTimerRef.current);
      }
      resizeEscapeTimerRef.current = window.setTimeout(() => {
        resizeEscapeTimerRef.current = null;
        ignoreResizeEscapeRef.current = false;
        setSuppressResizeEscape(false);
      }, 250);
    };
    const consumeResizeEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !ignoreResizeEscapeRef.current) return;
      ignoreResizeEscapeRef.current = false;
      if (resizeEscapeTimerRef.current !== null) {
        window.clearTimeout(resizeEscapeTimerRef.current);
        resizeEscapeTimerRef.current = null;
      }
      setSuppressResizeEscape(false);
    };
    window.addEventListener('resize', markResize);
    document.addEventListener('keydown', consumeResizeEscape, true);
    return () => {
      window.removeEventListener('resize', markResize);
      document.removeEventListener('keydown', consumeResizeEscape, true);
      if (resizeEscapeTimerRef.current !== null) {
        window.clearTimeout(resizeEscapeTimerRef.current);
        resizeEscapeTimerRef.current = null;
      }
    };
  }, []);
  const textAnchor = useMemo(
    () => pointAnchor(viewportPoint(textScreenRect.x, textScreenRect.y), document),
    [textScreenRect.x, textScreenRect.y],
  );

  // This bar is mounted exactly while the in-canvas text edit session is
  // active, so it owns the session flag other command surfaces subscribe to.
  useEffect(() => {
    publishTextEditSession(node.id);
    return () => publishTextEditSession(null);
  }, [node.id]);

  const applyTypography = useCallback(
    (changes: Partial<TextNode>) => onUpdate(node.id, changes),
    [node.id, onUpdate],
  );
  const { previewChanges, commitChanges, clearPreview } = useTypographyPreview(applyTypography, {
    beginPreview,
    commitPreview,
    abortPreview,
    resetKey: node.id,
  });

  const handleBoldToggle = useCallback(() => {
    const current = displayNode.fontWeight ?? 400;
    const next = current >= 600 ? 400 : 700;
    const option = weightOptions.find((candidate) => candidate.value === next);
    if (!option || option.disabled) return;
    onUpdate(node.id, fontWeightChanges(displayNode, next, registry));
  }, [displayNode, node.id, onUpdate, registry, weightOptions]);

  const handleItalicToggle = useCallback(() => {
    const next = (displayNode.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic';
    onUpdate(node.id, fontStyleChanges(displayNode, next, registry));
  }, [displayNode, node.id, onUpdate, registry]);

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
      commitChanges(
        fontFamilyChanges(
          value,
          displayNode.fontFamily,
          displayNode.fontReference,
          displayNode.variableAxes,
        ),
      );
    },
    [commitChanges, displayNode],
  );
  const handleFontFamilyPreview = useCallback(
    (value: string) =>
      previewChanges(
        fontFamilyChanges(
          value,
          displayNode.fontFamily,
          displayNode.fontReference,
          displayNode.variableAxes,
        ),
      ),
    [displayNode, previewChanges],
  );
  const handleFontFaceChange = useCallback(
    (selection: import('../FontBrowser/fontFaceSelection').FontFaceSelection) =>
      commitChanges({
        fontFamily: selection.family,
        fontWeight: selection.weight,
        fontStyle: selection.style,
        fontReference: selection.fontReference,
        variableAxes: selection.variableAxes,
      }),
    [commitChanges],
  );
  const handleFontFacePreview = useCallback(
    (selection: import('../FontBrowser/fontFaceSelection').FontFaceSelection) =>
      previewChanges({
        fontFamily: selection.family,
        fontWeight: selection.weight,
        fontStyle: selection.style,
        fontReference: selection.fontReference,
        variableAxes: selection.variableAxes,
      }),
    [previewChanges],
  );

  const handleFontWeightChange = useCallback(
    (value: string) => {
      onUpdate(node.id, fontWeightChanges(displayNode, Number(value), registry));
    },
    [displayNode, node.id, onUpdate, registry],
  );

  const fillColor: ManagedColor = node.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
  const fillColorRgba = managedColorToRgba(fillColor);
  const isBold = (displayNode.fontWeight ?? 400) >= 600;
  const boldAvailable = display.mixed.fontWeight
    ? weightOptions.some((option) => option.value === 700 && !option.disabled)
    : isBold || weightOptions.some((option) => option.value === 700 && !option.disabled);
  const isItalic = (displayNode.fontStyle ?? 'normal') === 'italic';
  const italicAvailable = display.mixed.fontStyle
    ? fontStyleAvailable(effectiveNodes, 'italic', registry)
    : isItalic || fontStyleAvailable(effectiveNodes, 'italic', registry);
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
      dismissOnEscape={!colorOpen && !suppressResizeEscape}
      // Resizing or reactivating the editor can transiently blur the window;
      // that must not end a text-edit session or discard the quick toolbar.
      dismissOnWindowBlur={false}
      onClose={(reason) => {
        clearPreview();
        if (reason === 'escape' && ignoreResizeEscapeRef.current) {
          ignoreResizeEscapeRef.current = false;
          setSuppressResizeEscape(false);
          return;
        }
        onClose();
      }}
      className="floating-text-bar__layer"
    >
      <Toolbar label="Text formatting" className="floating-text-bar">
        <FontSelector
          value={displayNode.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY}
          fontReference={displayNode.fontReference}
          variableAxes={displayNode.variableAxes}
          mixed={display.mixed.fontFamily === true}
          onChange={handleFontFamilyChange}
          onSelectFace={handleFontFaceChange}
          onPreviewFamily={handleFontFamilyPreview}
          onPreviewFace={handleFontFacePreview}
          onClearPreview={clearPreview}
        />

        <div className="floating-text-bar__separator" />

        <Select
          label="Font weight"
          className="floating-text-bar__weight-select"
          value={display.mixed.fontWeight ? '' : String(displayNode.fontWeight ?? 400)}
          placeholder={display.mixed.fontWeight ? 'Mixed' : undefined}
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
          disabled={!italicAvailable}
          title={italicAvailable ? undefined : 'This font has no real italic face'}
          className={`floating-text-bar__btn${isItalic ? ' floating-text-bar__btn--active' : ''}`}
        />

        <div className="floating-text-bar__separator" />

        <FontSizeInput
          key={node.id}
          value={displayNode.fontSize ?? 16}
          mixed={display.mixed.fontSize === true}
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
          initialFocus
          yieldTabToAnchor
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
      </Toolbar>
    </FloatingPortal>
  );
}

/** Editing digits is a draft; blur or Enter commits one authored size. */
function FontSizeInput({
  value,
  mixed = false,
  onCommit,
}: {
  value: number;
  mixed?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(mixed ? '' : String(value));
  useEffect(() => setDraft(mixed ? '' : String(value)), [mixed, value]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0 && next <= 10000) {
      if (next !== value) onCommit(next);
    } else setDraft(String(value));
  };
  return (
    <label className="floating-text-bar__size-control">
      <span className="floating-text-bar__field-label">Size</span>
      <input
        type="number"
        className="floating-text-bar__size-input"
        value={draft}
        placeholder={mixed ? 'Mixed' : undefined}
        data-mixed={mixed || undefined}
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
    </label>
  );
}
