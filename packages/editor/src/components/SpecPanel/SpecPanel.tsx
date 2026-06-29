/**
 * SpecPanel — developer handoff / inspection surface.
 *
 * Read-only mode activated when the tool is set to 'inspect'.
 * Displays per-node spec readouts, measurements, code generation,
 * asset export, and annotations — all computed locally from the
 * scene graph with zero network round-trips.
 */

import type { Engine } from '@strata/engine';
import type { Document, SceneNode, VariableStore } from '@strata/scene';
import { useCallback, useRef, useState } from 'react';
import { AnnotationsDisplay, type Annotation } from './AnnotationsDisplay';
import { AssetExportControls } from './AssetExportControls';
import { CodeGenView } from './CodeGenView';
import { MeasurementReadout } from './MeasurementReadout';
import { SpecReadouts } from './SpecReadouts';
import { UnitSelector, useSpecUnit } from './UnitSelector';
import './SpecPanel.css';

export interface SpecPanelProps {
  nodes: SceneNode[];
  doc: Document;
  variableStore?: VariableStore;
  engine?: Engine;
}

const BASE_FONT_SIZE = 16;

export function SpecPanel({ nodes, doc, variableStore, engine }: SpecPanelProps) {
  const node = nodes[0];
  const [unit, setUnit] = useSpecUnit();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const annotIdRef = useRef(1);
  const handleAddAnnotation = useCallback((text: string) => {
    const a: Annotation = {
      id: `annot-${annotIdRef.current++}`,
      nodeId: node?.id ?? '',
      text,
      timestamp: Date.now(),
    };
    setAnnotations((prev) => [...prev, a]);
  }, [node]);

  const handleRemoveAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

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
      <CodeGenView node={node} doc={doc} />

      <AssetExportControls node={node} doc={doc} engine={engine!} />

      <AnnotationsDisplay
        nodeId={node.id}
        annotations={annotations}
        onAdd={handleAddAnnotation}
        onRemove={handleRemoveAnnotation}
      />
    </div>
  );
}
