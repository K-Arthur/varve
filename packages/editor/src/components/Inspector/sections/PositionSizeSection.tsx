/**
 * Position & Size section — X/Y/W/H for the current selection.
 *
 * Multi-select: each axis uses `commonValue`; a differing axis renders the
 * NumberField in its `mixed` state (WCAG 1.4.1 — conveyed as "Mixed values"
 * via aria-valuetext, not by colour alone). Editing one axis commits via the
 * batch setters in ONE undo step and preserves the other axis per-node.
 *
 * (Rotation / corner-radius / flip / align-distribute land with the appearance
 * model extension — Slice B1.)
 */
import type { Shape } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export function PositionSizeSection({ nodes }: { nodes: SceneNode[] }) {
  const { setSelectedX, setSelectedY, setSelectedW, setSelectedH } = useEditor();

  const xRaw = commonValue(nodes, (n) => n.transform[4] ?? 0);
  const yRaw = commonValue(nodes, (n) => n.transform[5] ?? 0);
  const allShapes = nodes.every((n) => n.kind === 'shape');
  const wRaw: MaybeMixed<number> | null = allShapes
    ? commonValue(nodes, (n) => shapeW((n as SceneNode & { shape: Shape }).shape))
    : null;
  const hRaw: MaybeMixed<number> | null = allShapes
    ? commonValue(nodes, (n) => shapeH((n as SceneNode & { shape: Shape }).shape))
    : null;

  return (
    <DisclosureSection title="Position & Size">
      <NumberField
        label="X"
        unit="px"
        value={isMixed(xRaw) ? 0 : xRaw}
        mixed={isMixed(xRaw)}
        onChange={setSelectedX}
      />
      <NumberField
        label="Y"
        unit="px"
        value={isMixed(yRaw) ? 0 : yRaw}
        mixed={isMixed(yRaw)}
        onChange={setSelectedY}
      />
      {allShapes && (
        <>
          <NumberField
            label="W"
            unit="px"
            value={wRaw !== null && !isMixed(wRaw) ? wRaw : 0}
            mixed={wRaw !== null && isMixed(wRaw)}
            min={0}
            onChange={setSelectedW}
          />
          <NumberField
            label="H"
            unit="px"
            value={hRaw !== null && !isMixed(hRaw) ? hRaw : 0}
            mixed={hRaw !== null && isMixed(hRaw)}
            min={0}
            onChange={setSelectedH}
          />
        </>
      )}
    </DisclosureSection>
  );
}

function shapeW(shape: Shape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.w;
    case 'ellipse':
      return shape.rx;
    case 'circle':
      return shape.r;
    case 'polygon':
      return shape.radius;
    case 'star':
      return shape.outerRadius;
    default:
      return 0;
  }
}

function shapeH(shape: Shape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.h;
    case 'ellipse':
      return shape.ry;
    case 'circle':
      return shape.r;
    case 'polygon':
      return shape.radius;
    case 'star':
      return shape.outerRadius;
    default:
      return 0;
  }
}
