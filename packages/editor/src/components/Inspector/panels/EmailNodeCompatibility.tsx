/**
 * What the compiler did with the selected object.
 *
 * Compilation makes decisions the canvas cannot show: two frames become a row
 * of columns, a rotation is dropped, a headline stays live text rather than
 * being flattened. Without a readout, the designer only discovers any of it by
 * reading generated HTML or by sending themselves a test. This puts the answer
 * next to the selection, and keeps the detail in preflight.
 */

import type { EmailDocumentIr, EmailIrNode } from '@varve/codegen';

export interface EmailNodeCompatibilityProps {
  ir: EmailDocumentIr | null;
  nodeId: string;
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  native: 'Email safe',
  converted: 'Converted for email',
  approximated: 'Approximated',
  rasterized: 'Exported as an image',
  unsupported: 'Not supported',
};

const CLASSIFICATION_EXPLANATION: Record<string, string> = {
  native: 'Emitted as-is; every target client can render this.',
  converted: 'Restructured into table markup that behaves the same way.',
  approximated: 'Kept as live text or markup, with some styling simplified.',
  rasterized: 'Flattened to an image because email cannot draw it.',
  unsupported: 'No email equivalent exists and no fallback was produced.',
};

export function EmailNodeCompatibility({ ir, nodeId }: EmailNodeCompatibilityProps) {
  if (!ir) return null;
  const compiled = findBySourceId(ir.nodes, nodeId);

  // A node the compiler never reached is hidden, empty, or outside the email
  // body. Saying nothing is better than claiming it is email safe.
  if (!compiled) {
    return (
      <div className="email-compat" data-testid="email-node-compatibility">
        <h4>Email output</h4>
        <p className="insp-panel__empty-hint">
          This object does not appear in the compiled email. Hidden layers and empty containers are
          left out.
        </p>
      </div>
    );
  }

  const classification = compiled.compatibility;
  const columns = compiled.kind === 'row' ? compiled.children.length : 0;
  const degraded = compiled.degradedStyles ?? [];

  return (
    <div className="email-compat" data-testid="email-node-compatibility">
      <h4>Email output</h4>

      <p
        className={`email-compat__badge email-compat__badge--${classification}`}
        data-testid="email-compat-classification"
      >
        {CLASSIFICATION_LABEL[classification] ?? classification}
      </p>
      <p className="email-compat__explanation">{CLASSIFICATION_EXPLANATION[classification]}</p>

      <dl className="email-compat__facts">
        <div>
          <dt>Compiles to</dt>
          <dd>{describeKind(compiled)}</dd>
        </div>
        {columns > 0 && (
          <div>
            <dt>Columns</dt>
            <dd>
              {columns} ·{' '}
              {compiled.children.map((column) => `${column.width ?? '?'}px`).join(' + ')}
            </dd>
          </div>
        )}
        {compiled.kind === 'column' && (
          <div>
            <dt>On mobile</dt>
            <dd>
              {compiled.mobileBehavior === 'preserve'
                ? 'Stays beside its neighbours'
                : 'Stacks to full width'}
            </dd>
          </div>
        )}
      </dl>

      {degraded.length > 0 && (
        <div className="email-compat__degraded">
          <p className="email-compat__degraded-heading">Styling changed for email</p>
          <ul>
            {degraded.map((entry) => (
              <li key={`${entry.property}-${entry.value}`}>
                <code>{entry.property}</code>{' '}
                {entry.support === 'unsupported' ? 'dropped' : 'replaced with a fallback'}
                {entry.note ? ` — ${entry.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function describeKind(node: EmailIrNode): string {
  switch (node.kind) {
    case 'row':
      return 'A row of columns';
    case 'column':
      return 'A column cell';
    case 'heading':
      return `Heading level ${node.headingLevel ?? 2}`;
    case 'paragraph':
    case 'text':
      return 'Live text';
    case 'button':
      return 'Linked call to action';
    case 'image':
    case 'logo':
      return 'Image';
    case 'custom-html':
      return 'Custom HTML block';
    case 'divider':
      return 'Divider';
    case 'spacer':
      return 'Spacer';
    case 'preheader':
      return 'Inbox preview text';
    default:
      return 'Container';
  }
}

/**
 * The layout pass wraps nodes in synthesised rows and columns, so the node the
 * designer selected can sit a level or two below where it started. Search the
 * whole tree by source id rather than assuming a position.
 */
function findBySourceId(nodes: EmailIrNode[], sourceNodeId: string): EmailIrNode | undefined {
  for (const node of nodes) {
    // Prefer a real match over a synthesised wrapper carrying the same source
    // id, so the readout describes the object rather than its column shell.
    if (node.sourceNodeId === sourceNodeId && node.kind !== 'column' && node.kind !== 'row') {
      return node;
    }
    const nested = findBySourceId(node.children, sourceNodeId);
    if (nested) return nested;
  }
  for (const node of nodes) {
    if (node.sourceNodeId === sourceNodeId) return node;
    const nested = findBySourceId(node.children, sourceNodeId);
    if (nested) return nested;
  }
  return undefined;
}
