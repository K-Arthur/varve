import { buildSpec } from '@varve/codegen';
import type { Document } from '@varve/scene';

interface SpecPanelMotionProps {
  doc: Document;
}

export function MotionSpecSection({ doc }: SpecPanelMotionProps) {
  const spec = buildSpec(doc);
  if (spec.timelines.length === 0) return null;

  return (
    <section className="spec-panel__motion" aria-label="Motion timelines">
      <h3 className="spec-panel__section-title">Motion</h3>
      <p className="spec-panel__motion-hash">
        Export hash: <code>{spec.exportHash}</code>
      </p>
      <ul className="spec-panel__motion-list">
        {spec.timelines.map((tl) => (
          <li key={tl.id} className="spec-panel__motion-item">
            <span className="spec-panel__motion-name">{tl.name}</span>
            <span className="spec-panel__motion-meta">
              {tl.durationMs}ms · {tl.trackCount} tracks · {tl.keyframeCount} keyframes
              {tl.markerCount > 0 ? ` · ${tl.markerCount} markers` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
