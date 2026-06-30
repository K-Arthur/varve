/**
 * AnnotationsDisplay — read + minimal authoring of per-node annotations.
 *
 * Annotations are stored in the editor context (not Document) to avoid schema
 * changes. The surface is clearly labeled "Notes" to distinguish read-only
 * spec data from editable annotations.
 *
 * Research basis: Figma comment threads; WCAG 2.2 — status messages via aria-live.
 */

import { useCallback, useId, useRef, useState } from 'react';
export interface Annotation {
  id: string;
  nodeId: string;
  text: string;
  author?: string;
  timestamp: number;
}

export interface AnnotationsDisplayProps {
  nodeId: string;
  annotations: Annotation[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
}

export function AnnotationsDisplay({
  nodeId,
  annotations,
  onAdd,
  onRemove,
}: AnnotationsDisplayProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');
  const liveId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const nodeAnnotations = annotations.filter((a) => a.nodeId === nodeId);

  const handleAdd = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setText('');
    setMessage('Note added');
    inputRef.current?.focus();
  }, [text, onAdd]);

  const handleRemove = useCallback(
    (id: string) => {
      onRemove(id);
      setMessage('Note removed');
    },
    [onRemove],
  );

  return (
    <section className="spec-panel__section" aria-labelledby="spec-notes-heading">
      <h3 id="spec-notes-heading">Notes</h3>

      {nodeAnnotations.length === 0 && (
        <p className="spec-panel__placeholder">No notes for this layer.</p>
      )}

      {nodeAnnotations.map((a) => (
        <div key={a.id} className="spec-annot">
          <div className="spec-annot__body">
            <p className="spec-annot__text">{a.text}</p>
            <span className="spec-annot__meta">
              {a.author ? `${a.author} \u00b7 ` : ''}
              {formatRelativeTime(a.timestamp)}
            </span>
          </div>
          <button
            type="button"
            className="spec-annot__delete"
            aria-label={`Delete note: ${a.text}`}
            onClick={() => handleRemove(a.id)}
          >
            &times;
          </button>
        </div>
      ))}

      <div className="spec-annot__compose">
        <input
          ref={inputRef}
          type="text"
          className="spec-annot__input"
          placeholder="Add a note\u2026"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAdd();
            }
          }}
          aria-label="Add a note about this layer"
        />
        <button
          type="button"
          className="spec-annot__submit"
          disabled={!text.trim()}
          onClick={handleAdd}
          aria-label="Add note"
        >
          Add
        </button>
      </div>

      <div id={liveId} role="status" aria-live="polite" className="strata-visually-hidden">
        {message}
      </div>
    </section>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
