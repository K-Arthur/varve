import type { InspectorContext, InspectorScope } from './inspectorContext';

const SCOPE_LABELS: Record<InspectorScope, string> = {
  document: 'Document',
  canvas: 'Canvas',
  page: 'Page',
  master: 'Master',
  selection: 'Selection',
  'table-cell': 'Table cell',
  'pixel-selection': 'Pixel selection',
  'temporary-workflow': 'Workflow',
  tool: 'Tool options',
};

function shouldShowContextHeader(scope: InspectorScope): boolean {
  return scope !== 'selection' && scope !== 'temporary-workflow' && scope !== 'table-cell';
}

/**
 * Identifies non-object Inspector contexts without adding an editable control
 * or a second selection surface. Ordinary object selections retain their
 * existing node/multi-selection headers inside the Properties surface.
 */
export function InspectorContextHeader({ context }: { context: InspectorContext }) {
  if (!shouldShowContextHeader(context.scope)) return null;

  const scopeLabel = SCOPE_LABELS[context.scope];
  return (
    <section
      className="insp-context-header"
      data-inspector-context-header="true"
      aria-label={`Inspector context: ${scopeLabel}`}
    >
      <span className="insp-context-header__scope">{scopeLabel}</span>
      <h2 className="insp-context-header__target">{context.target.label}</h2>
    </section>
  );
}
