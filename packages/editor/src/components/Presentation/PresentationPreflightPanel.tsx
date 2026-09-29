import type { Document, NodeId } from '@varve/scene';
import { useMemo, useState } from 'react';
import { runPresentationPreflight } from './presentationPreflight';

interface PresentationPreflightPanelProps {
  document: Document;
  deckId: string;
  onFocus: (nodeId: NodeId) => void;
}

export function PresentationPreflightPanel({
  document,
  deckId,
  onFocus,
}: PresentationPreflightPanelProps) {
  const [checked, setChecked] = useState(false);
  const [minimumTextSize, setMinimumTextSize] = useState(18);
  const [minimumContrastRatio, setMinimumContrastRatio] = useState(4.5);
  const findings = useMemo(
    () =>
      checked
        ? runPresentationPreflight(document, deckId, { minimumTextSize, minimumContrastRatio })
        : [],
    [checked, document, deckId, minimumTextSize, minimumContrastRatio],
  );

  return (
    <section className="presentation-preflight" aria-label="Presentation quality checks">
      <button
        type="button"
        className="presentation-preflight__run"
        onClick={() => setChecked(true)}
      >
        {checked ? 'Refresh slide checks' : 'Check slides'}
      </button>
      {checked && (
        <div className="presentation-preflight__results" aria-live="polite">
          <label className="presentation-preflight__threshold">
            Minimum text size
            <input
              aria-label="Minimum text size"
              type="number"
              min={1}
              max={512}
              value={minimumTextSize}
              onChange={(event) =>
                setMinimumTextSize(
                  Math.max(1, Math.min(512, Number(event.currentTarget.value) || 1)),
                )
              }
            />
            px
          </label>
          <label className="presentation-preflight__threshold">
            Minimum contrast ratio
            <input
              aria-label="Minimum contrast ratio"
              type="number"
              min={1}
              max={21}
              step={0.1}
              value={minimumContrastRatio}
              onChange={(event) =>
                setMinimumContrastRatio(
                  Math.max(1, Math.min(21, Number(event.currentTarget.value) || 1)),
                )
              }
            />
          </label>
          <p>
            {findings.length === 0
              ? 'No advisory issues found.'
              : `${findings.length} advisory ${findings.length === 1 ? 'finding' : 'findings'}.`}
          </p>
          {findings.map((finding, index) => {
            const frameId = document.presentation?.decks
              .find((deck) => deck.id === deckId)
              ?.slides.find((slide) => slide.id === finding.entryId)?.frameId;
            const targetId = finding.nodeId ?? frameId;
            return (
              <div
                className={`presentation-preflight__finding presentation-preflight__finding--${finding.severity}`}
                key={`${finding.entryId}-${finding.code}-${finding.nodeId ?? index}`}
              >
                <span>
                  <strong>{finding.slideTitle}:</strong> {finding.message}
                </span>
                {targetId && (
                  <button type="button" onClick={() => onFocus(targetId)}>
                    Focus
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
