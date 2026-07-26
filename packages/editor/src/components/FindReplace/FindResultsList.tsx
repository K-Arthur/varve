import type { MatchResult } from '../../findReplace/types';

interface FindResultsListProps {
  results: MatchResult[];
  currentIndex: number;
  onSelect: (match: MatchResult, index: number) => void;
}

export function FindResultsList({ results, currentIndex, onSelect }: FindResultsListProps) {
  if (results.length === 0) return null;

  const grouped: Record<string, { nodeId: string; nodeName: string; matches: MatchResult[] }> = {};
  for (const match of results) {
    const key = match.nodeId;
    if (!grouped[key]) {
      grouped[key] = { nodeId: match.nodeId, nodeName: match.nodeName, matches: [] };
    }
    grouped[key].matches.push(match);
  }

  const groups = Object.entries(grouped);

  return (
    <div className="find-results-list" role="list" aria-label="Find results">
      {groups.map(([nodeId, group]) => (
        <div key={nodeId} className="find-results-group" role="group" aria-label={group.nodeName}>
          <div className="find-results-group__header" aria-hidden>
            {group.nodeName}
          </div>
          {group.matches.map((match, _mi) => {
            const globalIdx = results.indexOf(match);
            const isActive = globalIdx === currentIndex;
            return (
              <button
                type="button"
                key={`${match.nodeId}-${match.flatStart}`}
                className={`find-results-item ${isActive ? 'find-results-item--active' : ''}`}
                onClick={() => onSelect(match, globalIdx)}
                data-match-index={globalIdx}
                aria-current={isActive ? 'true' : undefined}
                aria-label={`${group.nodeName}: ${match.contextSnippet}`}
              >
                <span className="find-results-item__snippet">{match.contextSnippet}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
