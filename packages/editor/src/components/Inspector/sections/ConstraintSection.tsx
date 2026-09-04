/**
 * ConstraintSection — Figma-style frame constraints for responsive children.
 *
 * Shows two axis selectors (horizontal, vertical) for children of frames.
 * Only renders when a node with a valid frame parent is selected.
 *
 * As of ADR-0230 the constraint controls are embedded inside
 * PositionSizeSection's "Layout" disclosure. This module exports two things:
 * - ConstraintControls: the headless controls (no DisclosureSection wrapper)
 * - ConstraintSection: the legacy standalone wrapper (kept for unit-test compat)
 *
 * Research basis: Figma Constraints dropdown, APG Combobox pattern.
 */
import type { ConstraintAxis, Constraints, SceneNode } from '@varve/scene';
import { getParent } from '@varve/scene';
import { Select } from '@varve/ui';
import { useCallback, useMemo } from 'react';
import { useEditor } from '../../../context';
import { ConstraintPinControl } from '../controls/ConstraintPinControl';
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

interface ConstraintSectionProps {
  nodes: SceneNode[];
}

/**
 * Headless constraint controls — no DisclosureSection wrapper.
 * Used by PositionSizeSection inside the merged "Layout" disclosure (ADR-0230).
 */
export function ConstraintControls({ nodes }: ConstraintSectionProps) {
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

  const handleVisualEditorChange = useCallback(
    (horizontal: string, vertical: string) => {
      setSelectedConstraint({
        horizontal: horizontal as ConstraintAxis,
        vertical: vertical as ConstraintAxis,
      });
    },
    [setSelectedConstraint],
  );

  if (!hasFrameParent) return null;

  return (
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
        <span className="insp-field__label">Visual editor</span>
        <div className="insp-field__control insp-constraint__editor-wrap">
          {currentConstraint ? (
            <ConstraintPinControl
              horizontal={currentConstraint.horizontal}
              vertical={currentConstraint.vertical}
              onChange={handleVisualEditorChange}
            />
          ) : (
            <span className="insp-field__mixed">Mixed</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Legacy standalone wrapper — kept for unit-test backward compatibility.
 * In the merged Inspector, constraint controls render inside PositionSizeSection.
 */
export function ConstraintSection({ nodes }: ConstraintSectionProps) {
  return (
    <DisclosureSection title="Constraints" sectionId="position-size">
      <ConstraintControls nodes={nodes} />
    </DisclosureSection>
  );
}
