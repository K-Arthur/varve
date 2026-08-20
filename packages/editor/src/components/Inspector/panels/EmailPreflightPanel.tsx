/**
 * Preflight results, grouped so the important things stay at the top.
 *
 * A flat list does not survive a real template. One heavily styled block can
 * produce a dozen "a fallback was applied" notes, and a broken link buried
 * under them reads as no more urgent than a rounded corner. So findings are
 * ordered by severity, grouped by the part of the email they concern, and
 * summarised with counts — the summary answers "is this ready to send?"
 * without the reader expanding anything.
 */

import type { EmailDiagnostic, EmailDiagnosticCategory } from '@varve/scene';

export interface EmailPreflightPanelProps {
  diagnostics: EmailDiagnostic[];
  /** Called with a node id when a finding is activated; omitted when unresolvable. */
  onSelectNode?: (nodeId: string) => void;
  /** Node ids that still exist in the document, so dead links stay inert. */
  resolvableNodeIds?: ReadonlySet<string>;
}

type Severity = EmailDiagnostic['severity'];

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Categories in the order a sender cares about them. */
const CATEGORY_ORDER: EmailDiagnosticCategory[] = [
  'security',
  'link',
  'asset',
  'image',
  'accessibility',
  'layout',
  'compatibility',
  'css',
  'typography',
  'structure',
  'variable',
  'provider',
];

const CATEGORY_LABEL: Record<EmailDiagnosticCategory, string> = {
  security: 'Security',
  link: 'Links',
  asset: 'Assets',
  image: 'Images',
  accessibility: 'Accessibility',
  layout: 'Layout',
  compatibility: 'Compatibility',
  css: 'Styling',
  typography: 'Typography',
  structure: 'Structure',
  variable: 'Personalization',
  provider: 'Provider',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
};

export function EmailPreflightPanel({
  diagnostics,
  onSelectNode,
  resolvableNodeIds,
}: EmailPreflightPanelProps) {
  const counts = countBySeverity(diagnostics);
  const groups = groupByCategory(diagnostics);

  return (
    <section className="email-preflight" aria-labelledby="email-preflight-heading">
      <div className="email-panel__heading-row">
        <h3 id="email-preflight-heading">Preflight</h3>
        <p className="email-preflight__summary" data-testid="email-preflight-summary">
          {summarize(counts)}
        </p>
      </div>

      {diagnostics.length === 0 ? (
        <p className="email-preflight__clear">
          No issues found. Browser preview only — this is not a guarantee of how any particular mail
          client will render the message.
        </p>
      ) : (
        <ul className="email-preflight__groups">
          {groups.map(([category, items]) => (
            <li key={category} className="email-preflight__group">
              <h4 className="email-preflight__group-heading">
                {CATEGORY_LABEL[category] ?? category}
                <span className="email-preflight__group-count">{items.length}</span>
              </h4>
              <ul className="email-preflight__items">
                {items.map((diagnostic, index) => (
                  <PreflightItem
                    key={diagnosticKey(diagnostic, index)}
                    diagnostic={diagnostic}
                    onSelectNode={onSelectNode}
                    resolvableNodeIds={resolvableNodeIds}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PreflightItem({
  diagnostic,
  onSelectNode,
  resolvableNodeIds,
}: {
  diagnostic: EmailDiagnostic;
  onSelectNode?: (nodeId: string) => void;
  resolvableNodeIds?: ReadonlySet<string>;
}) {
  const nodeId = diagnostic.sourceNodeId;
  // A finding about a node that has since been deleted must not offer to
  // navigate to it; the button would select nothing and look broken.
  const canNavigate = Boolean(
    nodeId && onSelectNode && (!resolvableNodeIds || resolvableNodeIds.has(nodeId)),
  );

  const body = (
    <>
      <span
        className={`email-preflight__severity email-preflight__severity--${diagnostic.severity}`}
      >
        {SEVERITY_LABEL[diagnostic.severity]}
      </span>
      <span className="email-preflight__message">{diagnostic.message}</span>
      {diagnostic.suggestedFix && (
        <span className="email-preflight__fix">{diagnostic.suggestedFix}</span>
      )}
    </>
  );

  return (
    <li className="email-preflight__item">
      {canNavigate ? (
        <button
          type="button"
          className="email-preflight__item-button"
          onClick={() => onSelectNode?.(nodeId as string)}
        >
          {body}
        </button>
      ) : (
        <span className="email-preflight__item-static">{body}</span>
      )}
    </li>
  );
}

function countBySeverity(diagnostics: EmailDiagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1;
  return counts;
}

function summarize(counts: Record<Severity, number>): string {
  const parts: string[] = [];
  if (counts.error > 0) parts.push(`${counts.error} ${plural(counts.error, 'error')}`);
  if (counts.warning > 0) parts.push(`${counts.warning} ${plural(counts.warning, 'warning')}`);
  if (counts.info > 0) parts.push(`${counts.info} ${plural(counts.info, 'note')}`);
  return parts.length > 0 ? parts.join(', ') : 'No issues';
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function groupByCategory(
  diagnostics: EmailDiagnostic[],
): Array<[EmailDiagnosticCategory, EmailDiagnostic[]]> {
  const byCategory = new Map<EmailDiagnosticCategory, EmailDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const existing = byCategory.get(diagnostic.category);
    if (existing) existing.push(diagnostic);
    else byCategory.set(diagnostic.category, [diagnostic]);
  }

  for (const items of byCategory.values()) {
    items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }

  // A group is as urgent as its worst finding, so a category holding an error
  // outranks one holding only notes regardless of the nominal order.
  return [...byCategory.entries()].sort(([categoryA, itemsA], [categoryB, itemsB]) => {
    const worstA = Math.min(...itemsA.map((item) => SEVERITY_ORDER[item.severity]));
    const worstB = Math.min(...itemsB.map((item) => SEVERITY_ORDER[item.severity]));
    if (worstA !== worstB) return worstA - worstB;
    return categoryRank(categoryA) - categoryRank(categoryB);
  });
}

function categoryRank(category: EmailDiagnosticCategory): number {
  const index = CATEGORY_ORDER.indexOf(category);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

function diagnosticKey(diagnostic: EmailDiagnostic, index: number): string {
  return `${diagnostic.code}-${diagnostic.sourceNodeId ?? diagnostic.sourceVariableId ?? ''}-${index}`;
}
