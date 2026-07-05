import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HelpArticle } from './content/helpTypes';
import { getHelpContent, HELP_CONTENT, searchHelpContent } from './content/helpContent';
import './HelpBrowser.css';

interface HelpBrowserProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_ORDER = [
  'Getting Started',
  'Tools',
  'Panels',
  'Export',
  'Shortcuts',
  'FAQ',
  'Troubleshooting',
];

function articlesForCategory(articles: HelpArticle[], category: string): HelpArticle[] {
  return articles.filter((a) => a.category === category);
}

export function HelpBrowser({ open, onClose }: HelpBrowserProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);
  const [helpfulFeedback, setHelpfulFeedback] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('strata-help-feedback');
      return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const allArticles = useMemo(() => Object.values(HELP_CONTENT), []);

  const searchResults = useMemo(
    () => (searchQuery.trim() ? searchHelpContent(searchQuery) : []),
    [searchQuery],
  );

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setSelectedCategory(null);
      setSelectedArticle(null);
      // Focus search on open
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const firstFocusable = dialog.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => window.removeEventListener('keydown', trap);
  }, [open]);

  // Ctrl+F to focus search
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedCategory(null);
    setSelectedArticle(null);
  }, []);

  const handleCategoryClick = useCallback((category: string) => {
    setSelectedCategory(category);
    setSelectedArticle(null);
    setSearchQuery('');
  }, []);

  const handleArticleClick = useCallback((article: HelpArticle) => {
    setSelectedArticle(article);
  }, []);

  const handleRelatedClick = useCallback(
    (id: string) => {
      const article = getHelpContent(id);
      if (article) {
        const cat = article.category;
        setSelectedCategory(cat);
        setSelectedArticle(article);
      }
    },
    [],
  );

  const handleHelpfulClick = useCallback(
    (articleId: string, isHelpful: boolean) => {
      const updated = { ...helpfulFeedback, [articleId]: isHelpful };
      setHelpfulFeedback(updated);
      try {
        localStorage.setItem('strata-help-feedback', JSON.stringify(updated));
      } catch {
        // localStorage not available
      }
    },
    [helpfulFeedback],
  );

  const articlesInCategory = useMemo(
    () => (selectedCategory ? articlesForCategory(allArticles, selectedCategory) : []),
    [allArticles, selectedCategory],
  );

  if (!open) return null;

  const showingResults = searchQuery.trim().length > 0;
  const hasResults = searchResults.length > 0;

  return (
    <div
      className="help-browser"
      role="dialog"
      aria-label="Help"
      aria-modal="true"
      ref={dialogRef}
    >
      <div className="help-browser__header">
        <h2 className="help-browser__title">Help</h2>
        <search className="help-browser__search">
          <svg
            className="help-browser__search-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            className="help-browser__search-input"
            placeholder="Search help..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search help articles"
          />
          <button
            type="button"
            className="help-browser__close"
            onClick={onClose}
            aria-label="Close help"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <title>Close</title>
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </search>
      </div>

      <div className="help-browser__body">
        <nav className="help-browser__sidebar" aria-label="Categories">
          {CATEGORY_ORDER.map((category) => {
            const count = articlesForCategory(allArticles, category).length;
            return (
              <button
                key={category}
                type="button"
                className={`help-browser__category${
                  selectedCategory === category ? ' help-browser__category--active' : ''
                }`}
                onClick={() => handleCategoryClick(category)}
                aria-current={selectedCategory === category ? 'true' : undefined}
              >
                <span className="help-browser__category-name">{category}</span>
                <span className="help-browser__category-count">{count}</span>
              </button>
            );
          })}
        </nav>

        <section className="help-browser__content" aria-label="Help content">
          {showingResults ? (
            hasResults ? (
              <div
                className="help-browser__results"
                aria-live="polite"
              >
                <p className="help-browser__results-count">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
                </p>
                {searchResults.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    className="help-browser__result-item"
                    onClick={() => handleArticleClick(article)}
                  >
                    <span className="help-browser__result-title">{article.title}</span>
                    <span className="help-browser__result-summary">{article.summary}</span>
                    <span className="help-browser__result-category">{article.category}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="help-browser__empty" aria-live="polite">
                <p className="help-browser__empty-text">
                  No results found for &ldquo;{searchQuery}&rdquo;
                </p>
                <p className="help-browser__empty-hint">
                  Try different keywords or browse categories from the sidebar.
                </p>
              </div>
            )
          ) : selectedArticle ? (
            <article className="help-browser__article">
              <div className="help-browser__breadcrumbs">
                <button
                  type="button"
                  className="help-browser__breadcrumb-link"
                  onClick={() => {
                    setSelectedCategory(selectedArticle.category);
                    setSelectedArticle(null);
                  }}
                >
                  {selectedArticle.category}
                </button>
                <span className="help-browser__breadcrumb-sep" aria-hidden="true">
                  &rsaquo;
                </span>
                <span className="help-browser__breadcrumb-current">
                  {selectedArticle.title}
                </span>
              </div>

              <h3 className="help-browser__article-title">{selectedArticle.title}</h3>
              <p className="help-browser__article-summary">{selectedArticle.summary}</p>
              <div className="help-browser__article-body">{selectedArticle.body}</div>

              {selectedArticle.related.length > 0 && (
                <div className="help-browser__related">
                  <span className="help-browser__related-label">Related articles</span>
                  <div className="help-browser__related-grid">
                    {selectedArticle.related.map((relatedId) => {
                      const relatedArticle = getHelpContent(relatedId);
                      if (!relatedArticle) return null;
                      return (
                        <button
                          key={relatedId}
                          type="button"
                          className="help-browser__related-card"
                          onClick={() => handleRelatedClick(relatedId)}
                        >
                          <span className="help-browser__related-title">
                            {relatedArticle.title}
                          </span>
                          <span className="help-browser__related-summary">
                            {relatedArticle.summary}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="help-browser__helpful">
                <span className="help-browser__helpful-label">Was this helpful?</span>
                <div className="help-browser__helpful-buttons">
                  {helpfulFeedback[selectedArticle.id] === true ? (
                    <span className="help-browser__helpful-thanks">Thanks for your feedback!</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`help-browser__helpful-btn${
                          helpfulFeedback[selectedArticle.id] === false
                            ? ' help-browser__helpful-btn--active'
                            : ''
                        }`}
                        onClick={() => handleHelpfulClick(selectedArticle.id, true)}
                        aria-label="Yes, this was helpful"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={`help-browser__helpful-btn${
                          helpfulFeedback[selectedArticle.id] === false
                            ? ' help-browser__helpful-btn--no'
                            : ''
                        }`}
                        onClick={() => handleHelpfulClick(selectedArticle.id, false)}
                        aria-label="No, this was not helpful"
                      >
                        No
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ) : selectedCategory ? (
            <div className="help-browser__category-articles">
              <h3 className="help-browser__category-heading">{selectedCategory}</h3>
              <div className="help-browser__category-list">
                {articlesInCategory.map((article) => (
                  <button
                    key={article.id}
                    type="button"
                    className="help-browser__article-card"
                    onClick={() => handleArticleClick(article)}
                  >
                    <span className="help-browser__article-card-title">{article.title}</span>
                    <span className="help-browser__article-card-summary">{article.summary}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="help-browser__landing">
              <h3 className="help-browser__landing-heading">How can we help you?</h3>
              <p className="help-browser__landing-subtitle">
                Search for a topic above, or select a category from the sidebar to browse articles.
              </p>
              <div className="help-browser__landing-grid">
                {CATEGORY_ORDER.map((category) => {
                  const articles = articlesForCategory(allArticles, category);
                  return (
                    <button
                      key={category}
                      type="button"
                      className="help-browser__landing-card"
                      onClick={() => handleCategoryClick(category)}
                    >
                      <span className="help-browser__landing-card-title">{category}</span>
                      <span className="help-browser__landing-card-count">
                        {articles.length} article{articles.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
