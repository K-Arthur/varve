import { useEditor } from '../../../context';
import { computeLayoutScore, type LayoutIssue } from '../../../intelligence/layoutScore';

const SEVERITY_ICON: Record<LayoutIssue['severity'], string> = {
  error: '\u26A0\uFE0F',
  warning: '\u26A0',
  info: '\u2139\uFE0F',
};

export function LayoutScoreSection() {
  const { state, selectedNodes } = useEditor();
  const sel = selectedNodes();
  const ids = sel.map((n) => n.id);
  const result = computeLayoutScore(state.document, ids);

  return (
    <section className="insp-panel__score-section" aria-label="Layout quality score">
      <header className="insp-panel__score-header">
        <span
          className={`insp-panel__score-value${
            result.score >= 90
              ? ' insp-panel__score-value--good'
              : result.score >= 70
                ? ' insp-panel__score-value--warn'
                : ' insp-panel__score-value--bad'
          }`}
        >
          {result.score}/100
        </span>
      </header>
      {result.issues.length === 0 && (
        <p className="insp-panel__score-empty">No layout issues detected</p>
      )}
      {result.issues.length > 0 && (
        <ul className="insp-panel__score-issues">
          {result.issues.map((issue, i) => (
            <li
              key={i}
              className={`insp-panel__score-issue insp-panel__score-issue--${issue.severity}`}
            >
              <span className="insp-panel__score-issue-icon">{SEVERITY_ICON[issue.severity]}</span>
              <div className="insp-panel__score-issue-body">
                <p className="insp-panel__score-issue-desc">{issue.description}</p>
                <span className="insp-panel__score-issue-cat">{issue.category}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
