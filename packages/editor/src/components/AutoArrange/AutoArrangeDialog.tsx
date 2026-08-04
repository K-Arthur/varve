import type { IconName } from '@varve/ui';
import { Button, Dialog, Icon, NumberInput } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import {
  type ArrangeLayoutType,
  type AutoArrangeOptions,
  applyAutoArrange,
} from '../../layout/autoArrange';
import './AutoArrange.css';

export interface AutoArrangeDialogProps {
  open: boolean;
  onClose: () => void;
  selectionBounds: { x: number; y: number; width: number; height: number } | null;
}

function childSize(n: import('@varve/scene').SceneNode): { width: number; height: number } {
  if (n.kind === 'frame') return { width: n.w, height: n.h };
  return { width: 100, height: 60 };
}

const LAYOUT_TYPES: { value: ArrangeLayoutType; label: string; icon: IconName }[] = [
  { value: 'grid', label: 'Grid', icon: 'LayoutGrid' },
  { value: 'circle', label: 'Circle', icon: 'Circle' },
  { value: 'flow', label: 'Flow', icon: 'ArrowUpRight' },
  { value: 'flex-row', label: 'Flex Row', icon: 'ArrowLeftRight' },
  { value: 'flex-column', label: 'Flex Column', icon: 'ArrowUpDown' },
];

export function AutoArrangeDialog({ open, onClose, selectionBounds }: AutoArrangeDialogProps) {
  const { state, updateDoc } = useEditor();
  const [layoutType, setLayoutType] = useState<ArrangeLayoutType>('grid');
  const [gap, setGap] = useState(16);
  const [padding, setPadding] = useState(16);
  const [radius, setRadius] = useState(200);
  const [startAngle, setStartAngle] = useState(0);
  const [rotateItems, setRotateItems] = useState(false);
  const [idealLength, setIdealLength] = useState(100);

  const selectedNodes = useMemo(() => {
    const sel = state.selection;
    if (sel.length === 0) return [] as import('@varve/scene').SceneNode[];
    return sel
      .map((id) => state.document.nodes[id])
      .filter((n): n is import('@varve/scene').SceneNode => n != null && n.kind !== 'group');
  }, [state.selection, state.document.nodes]);

  const _bounds = useMemo(() => {
    if (selectionBounds) return selectionBounds;
    if (selectedNodes.length === 0) return { x: 0, y: 0, width: 400, height: 400 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of selectedNodes) {
      const tx = (n.transform as readonly number[])?.[4] ?? 0;
      const ty = (n.transform as readonly number[])?.[5] ?? 0;
      const sz = childSize(n);
      minX = Math.min(minX, tx);
      minY = Math.min(minY, ty);
      maxX = Math.max(maxX, tx + sz.width);
      maxY = Math.max(maxY, ty + sz.height);
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 400, height: 400 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [selectionBounds, selectedNodes]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _bounds;

  const handleApply = useCallback(() => {
    if (selectedNodes.length === 0) return;
    const options: AutoArrangeOptions = {
      layoutType,
      gap,
      padding,
      ...(layoutType === 'circle' ? { radius, startAngle, rotateItems } : {}),
      ...(layoutType === 'flow' ? { idealLength } : {}),
    };
    updateDoc((doc) =>
      applyAutoArrange(
        doc,
        selectedNodes.map((n) => n.id),
        options,
      ),
    );
    onClose();
  }, [
    selectedNodes,
    layoutType,
    gap,
    padding,
    radius,
    startAngle,
    rotateItems,
    idealLength,
    updateDoc,
    onClose,
  ]);

  return (
    <Dialog open={open} onClose={onClose} title="Auto Arrange" dismissible>
      <form
        className="auto-arrange"
        onSubmit={(e) => {
          e.preventDefault();
          handleApply();
        }}
      >
        <fieldset className="auto-arrange__fieldset">
          <legend className="auto-arrange__legend">Layout</legend>
          <div className="auto-arrange__layout-types" role="radiogroup" aria-label="Layout type">
            {LAYOUT_TYPES.map((lt) => (
              <label
                key={lt.value}
                className={`auto-arrange__layout-btn${layoutType === lt.value ? ' auto-arrange__layout-btn--active' : ''}`}
              >
                <input
                  type="radio"
                  name="arrange-layout"
                  value={lt.value}
                  checked={layoutType === lt.value}
                  onChange={() => setLayoutType(lt.value)}
                  className="sr-only"
                />
                <span className="auto-arrange__layout-icon">
                  <Icon name={lt.icon} />
                </span>
                <span className="auto-arrange__layout-label">{lt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="auto-arrange__fieldset">
          <legend className="auto-arrange__legend">Spacing</legend>
          <div className="auto-arrange__row">
            <NumberInput label="Gap" value={gap} min={0} max={100} step={1} onChange={setGap} />
            <NumberInput
              label="Padding"
              value={padding}
              min={0}
              max={50}
              step={1}
              onChange={setPadding}
            />
          </div>
        </fieldset>

        {layoutType === 'circle' && (
          <fieldset className="auto-arrange__fieldset">
            <legend className="auto-arrange__legend">Circle Options</legend>
            <div className="auto-arrange__row">
              <NumberInput
                label="Radius"
                value={radius}
                min={20}
                max={2000}
                step={10}
                onChange={setRadius}
              />
              <NumberInput
                label="Start Angle"
                value={startAngle}
                min={0}
                max={360}
                step={15}
                onChange={setStartAngle}
              />
            </div>
            <label className="auto-arrange__checkbox-label">
              <input
                type="checkbox"
                checked={rotateItems}
                onChange={(e) => setRotateItems(e.target.checked)}
                className="auto-arrange__checkbox"
              />
              <span>Rotate items outward</span>
            </label>
          </fieldset>
        )}

        {layoutType === 'flow' && (
          <fieldset className="auto-arrange__fieldset">
            <legend className="auto-arrange__legend">Flow Options</legend>
            <div className="auto-arrange__row">
              <NumberInput
                label="Ideal Edge Length"
                value={idealLength}
                min={20}
                max={500}
                step={10}
                onChange={setIdealLength}
              />
            </div>
          </fieldset>
        )}

        <div className="auto-arrange__preview">
          <span className="auto-arrange__preview-label">
            {selectedNodes.length} node{selectedNodes.length !== 1 ? 's' : ''} selected
          </span>
        </div>

        <div className="auto-arrange__actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply} disabled={selectedNodes.length === 0}>
            Apply
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
