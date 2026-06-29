/**
 * SpecPanel — developer handoff / inspection surface.
 *
 * Read-only mode activated when the tool is set to 'inspect'.
 * Displays per-node spec readouts, measurements, code generation,
 * asset export, and annotations — all computed locally from the
 * scene graph with zero network round-trips.
 */

import type { Document, SceneNode } from '@strata/scene';
import './SpecPanel.css';

export interface SpecPanelProps {
  nodes: SceneNode[];
  doc: Document;
}

export function SpecPanel({ nodes, doc: _doc }: SpecPanelProps) {
  const node = nodes[0];
  if (!node) return null;

  return (
    <div className="spec-panel" role="region" aria-label="Specification inspector">
      <div className="spec-panel__header">
        <span className="spec-panel__name">{node.name}</span>
        <span className="spec-panel__kind">{node.kind}</span>
      </div>

      <section className="spec-panel__section" aria-labelledby="spec-layout-heading">
        <h3 id="spec-layout-heading">Layout</h3>
        <p className="spec-panel__placeholder">Measurement readout — Phase 2</p>
      </section>

      <section className="spec-panel__section" aria-labelledby="spec-typography-heading">
        <h3 id="spec-typography-heading">Typography</h3>
        <p className="spec-panel__placeholder">Spec readouts — Phase 3</p>
      </section>

      <section className="spec-panel__section" aria-labelledby="spec-color-heading">
        <h3 id="spec-color-heading">Color & Fill</h3>
        <p className="spec-panel__placeholder">Spec readouts — Phase 3</p>
      </section>

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
