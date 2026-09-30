import { useEffect, useRef } from 'react';
import type { MatchResult } from '../../findReplace/types';

interface FindResultsListProps {
  results: MatchResult[];
  currentIndex: number;
  checked: ReadonlySet<string>;
  onToggleChecked: (matchId: string, checked: boolean) => void;
  onSelect: (match: MatchResult, index: number) => void;
  /** True when the match budget truncated the result set. */
  truncated?: boolean;
}

/** Bound the rendered list; the full set stays searchable and replaceable. */
const MAX_RENDERED = 500;

function splitSnippet(match: MatchResult): [string, string, string] | null {
  if (!match.original) return null;
  const at = match.contextSnippet.indexOf(match.original);
  if (at < 0) return null;
  return [
    match.contextSnippet.slice(0, at),
    match.original,
    match.contextSnippet.slice(at + match.original.length),
  ];
}

export function FindResultsList({
  results,
  currentIndex,
  checked,
  onToggleChecked,
  onSelect,
  truncated,
}: FindResultsListProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex, results]);

  if (results.length === 0) return null;

  const groups: { key: string; nodeName: string; shared: boolean; matches: MatchResult[] }[] = [];
  const indexByKey = new Map<string, number>();
  for (const match of results) {
    let groupIndex = indexByKey.get(match.targetKey);
    if (groupIndex === undefined) {
      groupIndex = groups.length;
      indexByKey.set(match.targetKey, groupIndex);
      groups.push({
        key: match.targetKey,
        nodeName: match.nodeName,
        shared: match.shared,
        matches: [],
      });
    }
    groups[groupIndex]!.matches.push(match);
  }

  const rendered = results.slice(0, MAX_RENDERED);
  const renderedSet = new Set(rendered.map((m) => m.id));

  return (
    <>
      <ul className="find-results-list" aria-label="Find results">
        {groups.map((group) => {
          const visibleMatches = group.matches.filter((m) => renderedSet.has(m.id));
          if (visibleMatches.length === 0) return null;
          return (
            <li key={group.key} className="find-results-group">
              <div className="find-results-group__header">
                {group.nodeName}
                {group.shared && <span className="find-results-group__badge"> shared</span>}
              </div>
              {visibleMatches.map((match) => {
                const globalIdx = results.indexOf(match);
                const isActive = globalIdx === currentIndex;
                const isChecked = checked.has(match.id);
                const parts = splitSnippet(match);
                return (
                  <div
                    key={match.id}
                    className={`find-results-item ${isActive ? 'find-results-item--active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="find-results-item__check"
                      checked={isChecked}
                      disabled={match.protected}
                      onChange={(e) => onToggleChecked(match.id, e.target.checked)}
                      aria-label={`Select match in ${group.nodeName} at offset ${match.flatStart}`}
                    />
                    <button
                      type="button"
                      ref={isActive ? activeRef : undefined}
                      className="find-results-item__button"
                      onClick={() => onSelect(match, globalIdx)}
                      data-match-index={globalIdx}
                      aria-current={isActive ? 'true' : undefined}
                      aria-label={`${group.nodeName}: ${match.contextSnippet}${
                        match.protected ? ' (find only)' : ''
                      }`}
                    >
                      <span className="find-results-item__snippet">
                        {parts ? (
                          <>
                            {parts[0]}
                            <mark className="find-results-item__match">{parts[1]}</mark>
                            {parts[2]}
                          </>
                        ) : (
                          match.contextSnippet
                        )}
                      </span>
                      {match.protected && (
                        <span className="find-results-item__flag">
                          find only ({match.protectedReason})
                        </span>
                      )}
                      {match.shared && (
                        <span className="find-results-item__flag">
                          shared content — affects {match.frameIds.length} frames
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      {(truncated || results.length > MAX_RENDERED) && (
        <div className="find-replace-bar__status">
          Showing first {Math.min(MAX_RENDERED, results.length)} of {results.length} matches —
          Replace All still covers every eligible match.
        </div>
      )}
    </>
  );
}
