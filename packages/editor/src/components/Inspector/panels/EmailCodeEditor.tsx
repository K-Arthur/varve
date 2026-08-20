import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { highlight } from '../../SpecPanel/syntax';

import './EmailCodeEditor.css';

type EmailCodeLanguage = 'markup' | 'css';

interface EmailCodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: EmailCodeLanguage;
  label: string;
  readOnly?: boolean;
  minRows?: number;
}

export function EmailCodeEditor({
  value,
  onChange,
  language,
  label,
  readOnly = false,
  minRows = 8,
}: EmailCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');

  const highlightedLines = useMemo(
    () => highlight(value, language === 'markup' ? 'svg' : 'css').split('\n'),
    [language, value],
  );
  const lineCount = Math.max(highlightedLines.length, minRows);
  const matchCount = useMemo(() => countMatches(value, query), [query, value]);

  useEffect(() => {
    if (!searchOpen && !replaceOpen) return;
    textareaRef.current?.focus();
  }, [replaceOpen, searchOpen]);

  const syncScroll = () => {
    const textarea = textareaRef.current;
    const highlightLayer = highlightRef.current;
    if (!textarea || !highlightLayer) return;
    highlightLayer.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
  };

  const findNext = () => {
    if (!query) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionEnd ?? 0;
    const next = value.indexOf(query, start);
    const match = next >= 0 ? next : value.indexOf(query);
    if (match < 0) return;
    textarea.focus();
    textarea.setSelectionRange(match, match + query.length);
  };

  const replaceCurrent = () => {
    if (!query || !onChange) return;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? -1;
    const end = textarea?.selectionEnd ?? -1;
    if (start < 0 || end <= start || value.slice(start, end) !== query) {
      findNext();
      return;
    }
    onChange(`${value.slice(0, start)}${replacement}${value.slice(end)}`);
    const restoreSelection = () => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, start + replacement.length);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(restoreSelection);
    } else {
      setTimeout(restoreSelection, 0);
    }
  };

  const replaceAll = () => {
    if (!query || !onChange || !value.includes(query)) return;
    onChange(value.split(query).join(replacement));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setSearchOpen(true);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'h' && !readOnly) {
      event.preventDefault();
      setReplaceOpen(true);
      setSearchOpen(true);
      return;
    }
    if (event.key === 'Escape' && (searchOpen || replaceOpen)) {
      event.preventDefault();
      setSearchOpen(false);
      setReplaceOpen(false);
    }
  };

  return (
    <section className="email-code-editor" aria-label={label}>
      <div className="email-code-editor__toolbar">
        <span className="email-code-editor__language">
          {language === 'markup' ? 'HTML' : 'CSS'}
        </span>
        <button
          type="button"
          className="email-code-editor__tool"
          aria-pressed={searchOpen}
          onClick={() => setSearchOpen((open) => !open)}
        >
          Find
        </button>
        {!readOnly && (
          <button
            type="button"
            className="email-code-editor__tool"
            aria-pressed={replaceOpen}
            onClick={() => {
              setSearchOpen(true);
              setReplaceOpen((open) => !open);
            }}
          >
            Replace
          </button>
        )}
        <span className="email-code-editor__stats" aria-live="polite">
          {highlightedLines.length} lines{query ? ` · ${matchCount} matches` : ''}
        </span>
      </div>

      {(searchOpen || replaceOpen) && (
        <form
          className="email-code-editor__search"
          aria-label="Search email code"
          onSubmit={(event) => {
            event.preventDefault();
            findNext();
          }}
        >
          <input
            aria-label="Find in email code"
            value={query}
            placeholder="Find"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                findNext();
              }
            }}
          />
          {replaceOpen && !readOnly && (
            <input
              aria-label="Replace in email code"
              value={replacement}
              placeholder="Replace"
              onChange={(event) => setReplacement(event.target.value)}
            />
          )}
          <button type="button" className="email-code-editor__tool" onClick={findNext}>
            Next
          </button>
          {replaceOpen && !readOnly && (
            <>
              <button type="button" className="email-code-editor__tool" onClick={replaceCurrent}>
                Replace
              </button>
              <button type="button" className="email-code-editor__tool" onClick={replaceAll}>
                All
              </button>
            </>
          )}
        </form>
      )}

      <div className="email-code-editor__surface">
        <div className="email-code-editor__highlight" ref={highlightRef} aria-hidden="true">
          {highlightedLines.map((html, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: line-numbered source; index is the rendered line identity
              key={index}
              className="email-code-editor__line"
            >
              <span className="email-code-editor__line-number">
                {String(index + 1).padStart(String(lineCount).length, ' ')}
              </span>
              <span
                className="email-code-editor__line-text"
                dangerouslySetInnerHTML={{ __html: html || ' ' }}
              />
            </span>
          ))}
          {highlightedLines.length < minRows &&
            Array.from({ length: minRows - highlightedLines.length }, (_, index) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: empty editor rows have no stable source identity
                key={`empty-${index}`}
                className="email-code-editor__line"
              >
                <span className="email-code-editor__line-number">
                  {String(highlightedLines.length + index + 1).padStart(
                    String(lineCount).length,
                    ' ',
                  )}
                </span>
                <span className="email-code-editor__line-text"> </span>
              </span>
            ))}
        </div>
        <textarea
          ref={textareaRef}
          aria-label={label}
          className="email-code-editor__input"
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          readOnly={readOnly}
          spellCheck={false}
          wrap="off"
          rows={minRows}
        />
      </div>
      <p className="email-code-editor__help">
        Ctrl/Cmd+F to find · Ctrl/Cmd+H to replace · Esc to close
      </p>
    </section>
  );
}

function countMatches(value: string, query: string): number {
  if (!query) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= value.length) {
    const index = value.indexOf(query, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(query.length, 1);
  }
  return count;
}
