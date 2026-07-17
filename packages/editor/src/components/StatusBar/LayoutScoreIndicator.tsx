import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { computeLayoutScore } from '../../intelligence/layoutScore';

export function LayoutScoreIndicator() {
  const { state, selectedNodes } = useEditor();
  const sel = selectedNodes();
  const ids = sel.map((n) => n.id);
  const [score, setScore] = useState(100);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const run = () => setScore(computeLayoutScore(state.document, ids).score);
    const id =
      requestIdleCallback?.(run, { timeout: 200 }) ?? (setTimeout(run, 200) as unknown as number);
    rafRef.current = id;
    return () => {
      if (typeof id === 'number' && typeof cancelIdleCallback !== 'undefined')
        cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [state.document, ids]);

  const cls =
    score >= 90
      ? 'editor-status__score-badge--good'
      : score >= 70
        ? 'editor-status__score-badge--warn'
        : 'editor-status__score-badge--bad';

  return (
    <button
      type="button"
      className={`editor-status__score-badge ${cls}`}
      title={`Layout quality: ${score}/100`}
      aria-label={`Layout score: ${score}`}
    >
      {score}
    </button>
  );
}
