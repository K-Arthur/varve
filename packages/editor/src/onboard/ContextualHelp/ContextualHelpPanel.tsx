import { useEffect, useRef } from 'react';
import type { HelpArticle } from './helpContent';
import { HELP_CONTENT } from './helpContent';
import type { ContextualHelpState } from './useContextualHelp';
import './ContextualHelpPanel.css';

interface ContextualHelpPanelProps {
  state: ContextualHelpState;
  onClose: () => void;
  onSetArticle: (article: HelpArticle) => void;
  onSetSearchQuery: (query: string) => void;
}

const CATEGORY_ORDER = ['Tools', 'Panels', 'Export', 'General'];

export function ContextualHelpPanel({
  state,
  onClose,
  onSetArticle,
  onSetSearchQuery,
}: ContextualHelpPanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [state.open]);

  useEffect(() => {
    if (!state.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.open, onClose]);

  const articlesByCategory = new Map<string, HelpArticle[]>();
  for (const article of Object.values(HELP_CONTENT)) {
    const cat = article.category;
    if (!articlesByCategory.has(cat)) articlesByCategory.set(cat, []);
    articlesByCategory.get(cat)?.push(article);
  }

  const sortedCategories = CATEGORY_ORDER.filter((c) => articlesByCategory.has(c));

  return (
    <div
      className={`contextual-help-panel${state.open ? ' contextual-help-panel--open' : ''}`}
      role="complementary"
      aria-label="Help"
    >
      <div className="contextual-help-panel__header">
        <h2 className="contextual-help-panel__title">Help</h2>
        <button
          type="button"
          className="contextual-help-panel__close"
          onClick={onClose}
          aria-label="Close help"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            role="presentation"
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="contextual-help-panel__search">
        <svg
          className="contextual-help-panel__search-icon"
          aria-hidden
          role="presentation"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
        >
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          className="contextual-help-panel__search-input"
          placeholder="Search help..."
          value={state.searchQuery}
          onChange={(e) => onSetSearchQuery(e.target.value)}
          aria-label="Search help articles"
        />
      </div>

      <div className="contextual-help-panel__content">
        {state.searchQuery ? (
          state.searchResults.length > 0 ? (
            <ul
              className="contextual-help-panel__results"
              aria-label="Search results"
              aria-live="polite"
            >
              {state.searchResults.map((article) => (
                <li key={article.id} aria-selected={state.article?.id === article.id}>
                  <button
                    type="button"
                    className="contextual-help-panel__result-item"
                    onClick={() => onSetArticle(article)}
                  >
                    <span className="contextual-help-panel__result-title">{article.title}</span>
                    <span className="contextual-help-panel__result-summary">{article.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="contextual-help-panel__empty" aria-live="polite">
              No results found.
            </p>
          )
        ) : state.article ? (
          <article className="contextual-help-panel__article">
            <h3 className="contextual-help-panel__article-title">{state.article.title}</h3>
            <p className="contextual-help-panel__article-summary">{state.article.summary}</p>
            <p className="contextual-help-panel__article-body">{state.article.body}</p>
            {state.article.related.length > 0 && (
              <div className="contextual-help-panel__related">
                <span className="contextual-help-panel__related-label">Related:</span>
                <div className="contextual-help-panel__related-links">
                  {state.article.related.map((relatedId) => {
                    const relatedArticle = HELP_CONTENT[relatedId];
                    if (!relatedArticle) return null;
                    return (
                      <button
                        key={relatedId}
                        type="button"
                        className="contextual-help-panel__related-link"
                        onClick={() => onSetArticle(relatedArticle)}
                      >
                        {relatedArticle.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </article>
        ) : (
          <div className="contextual-help-panel__landing">
            <h3 className="contextual-help-panel__landing-heading">How can we help?</h3>
            <p className="contextual-help-panel__landing-subtitle">
              Search above or browse topics below.
            </p>
            {sortedCategories.map((category) => (
              <div key={category} className="contextual-help-panel__category">
                <h4 className="contextual-help-panel__category-title">{category}</h4>
                <ul className="contextual-help-panel__category-list">
                  {articlesByCategory.get(category)?.map((article) => (
                    <li key={article.id}>
                      <button
                        type="button"
                        className="contextual-help-panel__category-link"
                        onClick={() => onSetArticle(article)}
                      >
                        {article.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
