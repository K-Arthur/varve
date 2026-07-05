import type {
  ContentSearchMatch,
  FileEntry,
  Platform,
  Project,
  TemplateLibrary,
} from '@strata/platform';
import { fuzzySearch } from '@strata/platform';
import { Icon } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ResultItem {
  id: string;
  name: string;
  sub?: string;
  groupKind: string;
  groupLabel: string;
  groupIcon: string;
  isFirstInGroup: boolean;
}

export interface HomeSearchPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenFile: (id: string) => void;
  files: FileEntry[];
  projects: Project[];
  templates: TemplateLibrary[];
  platform: Platform;
}

export function HomeSearchPalette({
  open,
  onClose,
  onOpenFile,
  files,
  projects,
  templates,
  platform,
}: HomeSearchPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [contentMatches, setContentMatches] = useState<ContentSearchMatch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setContentMatches([]);
      return;
    }
    const seen = new Set<string>();
    const controller = new AbortController();
    let cancelled = false;
    const results: ContentSearchMatch[] = [];
    for (const f of files) {
      if (cancelled) break;
      platform.searchFileContent(f.id, q).then((jsonStrings) => {
        if (cancelled) return;
        for (const json of jsonStrings) {
          try {
            const match: ContentSearchMatch = JSON.parse(json);
            const key = `${match.fileId}:${match.nodeId}:${match.matchType}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push(match);
            }
          } catch {
            // skip malformed entries
          }
        }
        setContentMatches([...results]);
      });
    }
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, files, platform]);

  const allItems = useMemo(() => {
    const q = query.trim();
    if (!q) return [];

    const items: ResultItem[] = [];

    const matchingFiles = fuzzySearch(q, files, (f) => f.name);
    if (matchingFiles.length > 0) {
      items.push({
        id: '__header__files',
        name: 'Files',
        groupKind: 'header',
        groupLabel: '',
        groupIcon: 'FileText',
        isFirstInGroup: false,
      });
      for (const f of matchingFiles.slice(0, 10)) {
        items.push({
          id: f.id,
          name: f.name,
          groupKind: 'file',
          groupLabel: 'Files',
          groupIcon: 'FileText',
          isFirstInGroup: false,
        });
      }
    }

    const matchingProjects = fuzzySearch(q, projects, (p) => p.name);
    if (matchingProjects.length > 0) {
      items.push({
        id: '__header__projects',
        name: 'Projects',
        groupKind: 'header',
        groupLabel: '',
        groupIcon: 'Folder',
        isFirstInGroup: false,
      });
      for (const p of matchingProjects.slice(0, 5)) {
        items.push({
          id: p.id,
          name: p.name,
          groupKind: 'project',
          groupLabel: 'Projects',
          groupIcon: 'Folder',
          isFirstInGroup: false,
        });
      }
    }

    const matchingTemplates = fuzzySearch(q, templates, (t) => t.name);
    if (matchingTemplates.length > 0) {
      items.push({
        id: '__header__templates',
        name: 'Templates',
        groupKind: 'header',
        groupLabel: '',
        groupIcon: 'LayoutGrid',
        isFirstInGroup: false,
      });
      for (const t of matchingTemplates.slice(0, 5)) {
        items.push({
          id: t.id,
          name: t.name,
          sub: t.category,
          groupKind: 'template',
          groupLabel: 'Templates',
          groupIcon: 'LayoutGrid',
          isFirstInGroup: false,
        });
      }
    }

    if (contentMatches.length > 0) {
      items.push({
        id: '__header__content',
        name: 'In Documents',
        groupKind: 'header',
        groupLabel: '',
        groupIcon: 'Search',
        isFirstInGroup: false,
      });
      for (const m of contentMatches.slice(0, 8)) {
        items.push({
          id: `${m.fileId}||${m.nodeId}`,
          name: m.nodeName,
          sub: `${m.snippet}`,
          groupKind: 'content',
          groupLabel: 'In Documents',
          groupIcon: 'Search',
          isFirstInGroup: false,
        });
      }
    }

    return items;
  }, [query, files, projects, templates, contentMatches]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when query changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIdx((i) => {
            const max = allItems.length - 1;
            let next = i + 1;
            while (next <= max && allItems[next]?.groupKind === 'header') next++;
            return next <= max ? next : i;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIdx((i) => {
            let prev = i - 1;
            while (prev >= 0 && allItems[prev]?.groupKind === 'header') prev--;
            return prev >= 0 ? prev : i;
          });
          break;
        case 'Enter': {
          e.preventDefault();
          let idx = activeIdx;
          if (allItems[idx]?.groupKind === 'header') {
            idx = idx + 1;
            while (idx < allItems.length && allItems[idx]?.groupKind === 'header') idx++;
          }
          const hit = allItems[idx];
          if (hit && hit.groupKind !== 'header') {
            const resolvedId = hit.groupKind === 'content' ? hit.id.split('||')[0]! : hit.id;
            onOpenFile(resolvedId);
            onClose();
          }
          break;
        }
      }
    },
    [onClose, onOpenFile, allItems, activeIdx],
  );

  if (!open) return null;

  return (
    <div
      className="search-palette"
      role="dialog"
      aria-label="Search files, projects, templates, and documents"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="search-palette__container">
        <div className="search-palette__input-wrap">
          <Icon name="Search" label={undefined} size="1em" className="search-palette__input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="search-palette__input"
            placeholder="Search files, projects, templates, documents\u2026"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
          />
          {query && (
            <button
              type="button"
              className="search-palette__clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <Icon name="X" label={undefined} size="0.85em" />
            </button>
          )}
        </div>

        <div className="search-palette__results">
          {allItems.length === 0 && query && (
            <div className="search-palette__empty">No results found</div>
          )}
          {allItems.length === 0 && !query && (
            <div className="search-palette__empty">Start typing to search</div>
          )}
          {allItems.map((item, idx) => {
            if (item.groupKind === 'header') {
              return (
                <div key={item.id} className="search-palette__group-label">
                  <Icon
                    name={item.groupIcon as 'FileText' | 'Folder' | 'LayoutGrid' | 'Search'}
                    label={undefined}
                    size="0.85em"
                  />
                  {item.name}
                </div>
              );
            }
            const isActive = idx === activeIdx;
            return (
              <button
                key={item.id}
                type="button"
                className={`search-palette__result ${isActive ? 'search-palette__result--active' : ''}`}
                onClick={() => {
                  const resolvedId =
                    item.groupKind === 'content' ? item.id.split('||')[0]! : item.id;
                  onOpenFile(resolvedId);
                  onClose();
                }}
                onMouseEnter={() => setActiveIdx(idx)}
                role="option"
                aria-selected={isActive}
              >
                <span className="search-palette__result-name">{item.name}</span>
                {item.sub && <span className="search-palette__result-sub">{item.sub}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
