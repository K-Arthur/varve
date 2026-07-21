/**
 * ConstraintSection — Figma-style frame constraints for responsive children.
 *
 * Shows two axis selectors (horizontal, vertical) for children of frames.
 * Only renders when a node with a valid frame parent is selected.
 *
 * Research basis: Figma Constraints dropdown, APG Combobox pattern.
 */
import type { ConstraintAxis, Constraints, SceneNode } from '@strata/scene';
import { getParent } from '@strata/scene';
import { Select } from '@strata/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const HORIZONTAL_OPTIONS: { value: ConstraintAxis; label: string }[] = [
  { value: 'min', label: 'Left' },
  { value: 'max', label: 'Right' },
  { value: 'center', label: 'Center' },
  { value: 'stretch', label: 'Left & Right' },
  { value: 'scale', label: 'Scale' },
];

const VERTICAL_OPTIONS: { value: ConstraintAxis; label: string }[] = [
  { value: 'min', label: 'Top' },
  { value: 'max', label: 'Bottom' },
  { value: 'center', label: 'Center' },
  { value: 'stretch', label: 'Top & Bottom' },
  { value: 'scale', label: 'Scale' },
];

/** Small visual preview of the current constraint pair. */
function ConstraintPreview({ h, v }: { h: ConstraintAxis; v: ConstraintAxis }) {
  const hSize = h === 'stretch' ? '100%' : h === 'scale' ? '60%' : '40%';
  const vSize = v === 'stretch' ? '100%' : v === 'scale' ? '60%' : '40%';

  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      role="img"
      aria-label={`Constraint ${h} x ${v}`}
      className="insp-constraint__preview"
    >
      <rect x="2" y="2" width="24" height="24" rx="2" className="insp-constraint__preview-frame" />
      <rect
        x={h === 'min' ? 4 : h === 'center' ? 10 : 4}
        y={v === 'min' ? 4 : v === 'center' ? 10 : 4}
        width={hSize === '100%' ? 20 : 8}
        height={vSize === '100%' ? 20 : 8}
        rx={1}
        className="insp-constraint__preview-child"
      />
    </svg>
  );
}

interface ConstraintSectionProps {
  nodes: SceneNode[];
}

export function ConstraintSection({ nodes }: ConstraintSectionProps) {
  const { state, setSelectedConstraint } = useEditor();
  const doc = state.document;

  const hasFrameParent = useMemo(() => {
    for (const n of nodes) {
      const parentId = getParent(doc, n.id);
      if (!parentId) return false;
      const parent = doc.nodes[parentId];
      if (parent?.kind === 'frame') return true;
    }
    return false;
  }, [nodes, doc]);

  const currentConstraint = useMemo((): Constraints | null => {
    if (nodes.length === 0) return null;
    const first = nodes[0]?.constraints;
    if (!first) return null;
    for (let i = 1; i < nodes.length; i++) {
      const c = nodes[i]?.constraints;
      if (!c || c.horizontal !== first.horizontal || c.vertical !== first.vertical) {
        return null;
      }
    }
    return first;
  }, [nodes]);

  const mixed = currentConstraint === null && nodes.length > 1;

  const handleHorizontalChange = useCallback(
    (value: string) => {
      if (!currentConstraint) return;
      setSelectedConstraint({ ...currentConstraint, horizontal: value as ConstraintAxis });
    },
    [currentConstraint, setSelectedConstraint],
  );

  const handleVerticalChange = useCallback(
    (value: string) => {
      if (!currentConstraint) return;
      setSelectedConstraint({ ...currentConstraint, vertical: value as ConstraintAxis });
    },
    [currentConstraint, setSelectedConstraint],
  );

  if (!hasFrameParent) return null;

  return (
    <DisclosureSection title="Constraints" defaultExpanded>
      <div className="insp-field-group">
        <div className="insp-field">
          <span className="insp-field__label">Horizontal</span>
          <div className="insp-field__control">
            <Select
              label="Horizontal constraint"
              options={HORIZONTAL_OPTIONS}
              value={mixed ? '' : (currentConstraint?.horizontal ?? 'min')}
              onChange={handleHorizontalChange}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Vertical</span>
          <div className="insp-field__control">
            <Select
              label="Vertical constraint"
              options={VERTICAL_OPTIONS}
              value={mixed ? '' : (currentConstraint?.vertical ?? 'min')}
              onChange={handleVerticalChange}
            />
          </div>
        </div>
        <div className="insp-field">
          <span className="insp-field__label">Preview</span>
          <div className="insp-field__control insp-constraint__preview-wrap">
            {currentConstraint ? (
              <ConstraintPreview h={currentConstraint.horizontal} v={currentConstraint.vertical} />
            ) : (
              <span className="insp-field__mixed">Mixed</span>
            )}
          </div>
        </div>
      </div>
    </DisclosureSection>
  );
}
