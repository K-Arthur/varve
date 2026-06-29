/**
 * SpecPanel — developer handoff / inspection surface.
 *
 * Read-only mode activated when the tool is set to 'inspect'.
 * Displays per-node spec readouts, measurements, code generation,
 * asset export, and annotations — all computed locally from the
 * scene graph with zero network round-trips.
 */

import type { Document, SceneNode, VariableStore } from '@strata/scene';
import { MeasurementReadout } from './MeasurementReadout';
import { SpecReadouts } from './SpecReadouts';
import { UnitSelector, useSpecUnit } from './UnitSelector';
import './SpecPanel.css';

export interface SpecPanelProps {
  nodes: SceneNode[];
  doc: Document;
  variableStore?: VariableStore;
}

const BASE_FONT_SIZE = 16;

export function SpecPanel({ nodes, doc, variableStore }: SpecPanelProps) {
  const node = nodes[0];
  const [unit, setUnit] = useSpecUnit();

  if (!node) return null;

  const readoutsProps = { node, doc, unit, baseFontSize: BASE_FONT_SIZE, variableStore };

  return (
    <div className="spec-panel" role="region" aria-label="Specification inspector">
      <div className="spec-panel__header">
        <span className="spec-panel__name">{node.name}</span>
        <span className="spec-panel__kind">{node.kind}</span>
      </div>

      <UnitSelector value={unit} onChange={setUnit} />

      <MeasurementReadout node={node} doc={doc} unit={unit} baseFontSize={BASE_FONT_SIZE} />
      <SpecReadouts {...readoutsProps} />

      <section className="spec-panel__section" aria-labelledby="spec-code-heading">
        <h3 id="spec-code-heading">Code</h3>
        <p className="spec-panel__placeholder">Code generation — Phase 4</p>
      </section>

      <section className="spec-panel__section" aria-labelledby="spec-export-heading">
        <h3 id="spec-export-heading">Export</h3>
        <p className="spec-panel__placeholder">Asset export — Phase 5</p>
      </section>
    </div>
  );
}
