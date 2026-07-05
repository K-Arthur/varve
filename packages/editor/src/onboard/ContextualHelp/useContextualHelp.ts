import { useCallback, useState } from 'react';
import { getHelpContent, getHelpContext, searchHelpContent } from './helpContent';
import type { HelpArticle } from './helpContent';

export interface ContextualHelpState {
  open: boolean;
  article: HelpArticle | null;
  searchQuery: string;
  searchResults: HelpArticle[];
}

export function useContextualHelp() {
  const [state, setState] = useState<ContextualHelpState>({
    open: false,
    article: null,
    searchQuery: '',
    searchResults: [],
  });

  const open = useCallback((articleId?: string) => {
    const id = articleId ?? getHelpContext();
    const article = id ? getHelpContent(id) : null;
    setState((s) => ({ ...s, open: true, article, searchQuery: '', searchResults: [] }));
  }, []);

  const close = useCallback(() => {
    setState((s) => ({ ...s, open: false, article: null, searchQuery: '', searchResults: [] }));
  }, []);

  const toggle = useCallback(() => {
    setState((s) =>
      s.open
        ? { ...s, open: false }
        : {
            ...s,
            open: true,
            article: getHelpContent(getHelpContext() ?? 'tool:select'),
          },
    );
  }, []);

  const setArticle = useCallback((article: HelpArticle) => {
    setState((s) => ({ ...s, article, searchQuery: '', searchResults: [] }));
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    setState((s) => ({
      ...s,
      searchQuery: query,
      searchResults: query ? searchHelpContent(query) : [],
    }));
  }, []);

  return { state, open, close, toggle, setArticle, setSearchQuery };
}
