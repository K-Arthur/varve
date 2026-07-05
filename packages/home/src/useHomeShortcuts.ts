import { useCallback, useEffect, useRef } from 'react';

export interface HomeShortcutHandlers {
  newFile: () => void;
  openFromDisk: () => void;
  templates: () => void;
  closeDialog: () => void;
  selectAll: () => void;
  showHelp: () => void;
  searchCommand: () => void;
  importFiles: () => void;
  toggleFavorite?: () => void;
}

export function useHomeShortcuts(handlers: HomeShortcutHandlers, dialogOpen: boolean) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const focusSearch = useCallback(() => {
    if (!searchInputRef.current) {
      searchInputRef.current = document.querySelector<HTMLInputElement>('.strata-search__input');
    }
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;

      if (dialogOpen) {
        if (e.key === 'Escape') {
          handlers.closeDialog();
          e.preventDefault();
          return;
        }
        return;
      }

      if (isCtrl && e.key === 'n') {
        handlers.newFile();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.key === 'o') {
        handlers.openFromDisk();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.key === 'k') {
        handlers.searchCommand();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.key === 'i') {
        handlers.importFiles();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.key === 'f') {
        focusSearch();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.key === 'd' && handlers.toggleFavorite) {
        handlers.toggleFavorite();
        e.preventDefault();
        return;
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            (active as HTMLElement).isContentEditable)
        ) {
          return;
        }
        focusSearch();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.shiftKey && e.key === 'T') {
        handlers.templates();
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape') {
        handlers.closeDialog();
        e.preventDefault();
        return;
      }

      if (e.key === '/' && e.shiftKey && !isCtrl) {
        handlers.showHelp();
        e.preventDefault();
        return;
      }

      if (isCtrl && e.key === 'a') {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            (active as HTMLElement).isContentEditable)
        ) {
          return;
        }
        handlers.selectAll();
        e.preventDefault();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, dialogOpen, focusSearch]);
}
