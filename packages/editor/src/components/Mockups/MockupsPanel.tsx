/**
 * MockupsPanel — browse and apply mockup templates.
 *
 * The discovery surface for the mockup system: search, category filters,
 * accurate vector previews, favourites and recents (localStorage), licence
 * display, and one-click apply to the current selection (or pending sources
 * from context-menu / palette entry points via the tab request store).
 *
 * Templates listed: the built-in catalog plus user templates embedded in
 * the document. Applying embeds the template (deduped) and creates a
 * linked mockup frame beside the first source — one undoable transaction.
 */

import type { MockupCategory, MockupTemplateAsset, NodeId } from '@varve/scene';
import { getBuiltinMockupTemplates } from '@varve/scene';
import { Button, Icon } from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { applyMockupToSources, templatesForDocument } from '../../mockup/mockupActions';
import { subscribeMockupsTab } from '../../mockup/mockupTabStore';
import { MockupTemplatePreview } from './MockupTemplatePreview';
import './MockupsPanel.css';

const CATEGORIES: Array<{ id: MockupCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'devices', label: 'Devices' },
  { id: 'browser-desktop', label: 'Browser & Desktop' },
  { id: 'print', label: 'Print' },
  { id: 'stationery', label: 'Stationery' },
  { id: 'packaging', label: 'Packaging' },
  { id: 'social-marketing', label: 'Social & Marketing' },
  { id: 'logo', label: 'Logo' },
];

const ORIENTATIONS = [
  { id: 'all' as const, label: 'Any' },
  { id: 'portrait' as const, label: 'Portrait' },
  { id: 'landscape' as const, label: 'Landscape' },
  { id: 'square' as const, label: 'Square' },
];

const RECENTS_KEY = 'varve-mockups-recents';
const FAVOURITES_KEY = 'varve-mockups-favourites';
const MAX_RECENTS = 6;

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value.slice(0, MAX_RECENTS + 12)));
  } catch {
    /* storage unavailable — recents are best-effort */
  }
}

export function MockupsPanel(): React.ReactElement {
  const editor = useEditor();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MockupCategory | 'all'>('all');
  const [orientation, setOrientation] = useState<'all' | 'portrait' | 'landscape' | 'square'>(
    'all',
  );
  const [favourites, setFavourites] = useState<string[]>(() => readList(FAVOURITES_KEY));
  const [recents, setRecents] = useState<string[]>(() => readList(RECENTS_KEY));
  const [pendingSources, setPendingSources] = useState<NodeId[] | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeMockupsTab((request) => {
      setPendingSources(request.sourceNodeIds?.length ? request.sourceNodeIds : null);
      setAppliedId(null);
    });
  }, []);

  const templates = useMemo(
    () => templatesForDocument(editor.state.document),
    [editor.state.document],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== 'all' && t.category !== category) return false;
      if (orientation !== 'all' && t.orientation !== orientation) return false;
      if (q) {
        const haystack = `${t.name} ${t.tags?.join(' ') ?? ''} ${t.category}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [templates, query, category, orientation]);

  const sorted = useMemo(() => {
    const favSet = new Set(favourites);
    const recentSet = new Set(recents);
    const score = (t: MockupTemplateAsset): number => {
      if (favSet.has(t.id)) return 0;
      if (recentSet.has(t.id)) return 1;
      return 2;
    };
    return [...filtered].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }, [filtered, favourites, recents]);

  const sourceIds = pendingSources ?? editor.state.selection;
  const hasSources = sourceIds.length > 0;

  const apply = useCallback(
    (template: MockupTemplateAsset) => {
      if (!hasSources) return;
      const frameId = applyMockupToSources(editor, template.id, sourceIds, true);
      if (frameId) {
        setAppliedId(template.id);
        const nextRecents = [template.id, ...recents.filter((id) => id !== template.id)].slice(
          0,
          MAX_RECENTS,
        );
        setRecents(nextRecents);
        writeList(RECENTS_KEY, nextRecents);
      }
    },
    [editor, hasSources, sourceIds, recents],
  );

  const toggleFavourite = useCallback(
    (templateId: string) => {
      const next = favourites.includes(templateId)
        ? favourites.filter((id) => id !== templateId)
        : [...favourites, templateId];
      setFavourites(next);
      writeList(FAVOURITES_KEY, next);
    },
    [favourites],
  );

  const builtinIds = useMemo(() => new Set(getBuiltinMockupTemplates().map((t) => t.id)), []);

  return (
    <section className="mockups-panel" aria-label="Mockups">
      <div className="mockups-panel__header">
        <h2 className="mockups-panel__title">Mockups</h2>
        <span className="mockups-panel__count" aria-live="polite">
          {sorted.length} template{sorted.length === 1 ? '' : 's'}
        </span>
      </div>

      {!hasSources && (
        <p className="mockups-panel__hint" role="status">
          Select a frame, group, image, or logo on the canvas to fill the surfaces.
        </p>
      )}
      {pendingSources && hasSources && (
        <p className="mockups-panel__hint mockups-panel__hint--active" role="status">
          Applying to {pendingSources.length} selected node{pendingSources.length === 1 ? '' : 's'}.
        </p>
      )}

      <label className="mockups-panel__search">
        <span className="visually-hidden">Search mockup templates</span>
        <Icon name="Search" size={14} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search mockups…"
          aria-label="Search mockup templates"
        />
      </label>

      <div className="mockups-panel__filters">
        <fieldset className="mockups-panel__chips">
          <legend className="visually-hidden">Category</legend>
          {CATEGORIES.map((cat) => (
            <button
              type="button"
              key={cat.id}
              className={`mockups-panel__chip ${category === cat.id ? 'mockups-panel__chip--active' : ''}`}
              onClick={() => setCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </fieldset>
        <fieldset className="mockups-panel__chips">
          <legend className="visually-hidden">Orientation</legend>
          {ORIENTATIONS.map((o) => (
            <button
              type="button"
              key={o.id}
              className={`mockups-panel__chip ${orientation === o.id ? 'mockups-panel__chip--active' : ''}`}
              onClick={() => setOrientation(o.id)}
            >
              {o.label}
            </button>
          ))}
        </fieldset>
      </div>

      {sorted.length === 0 ? (
        <div className="mockups-panel__empty">
          <p className="mockups-panel__empty-title">No mockups match</p>
          <p className="mockups-panel__empty-desc">Try a different search or category.</p>
        </div>
      ) : (
        <div className="mockups-panel__grid">
          {sorted.map((template) => {
            const isFavourite = favourites.includes(template.id);
            const isApplied = appliedId === template.id;
            return (
              <article key={template.id} className="mockups-panel__card">
                <div className="mockups-panel__preview">
                  <MockupTemplatePreview
                    template={template}
                    className="mockups-panel__preview-svg"
                  />
                </div>
                <div className="mockups-panel__card-body">
                  <h3 className="mockups-panel__card-name">{template.name}</h3>
                  <p className="mockups-panel__card-meta">
                    {template.surfaces.length} surface{template.surfaces.length === 1 ? '' : 's'} ·{' '}
                    {template.orientation} · {template.capabilities?.join(', ') ?? 'flat'}
                  </p>
                  {template.licence && (
                    <p
                      className="mockups-panel__card-licence"
                      title={`${template.licence.creator} · ${template.licence.title}`}
                    >
                      {template.licence.spdx ?? template.licence.title}
                    </p>
                  )}
                  <div className="mockups-panel__card-actions">
                    <Button
                      size="sm"
                      disabled={!hasSources}
                      onClick={() => apply(template)}
                      aria-label={`Apply ${template.name}${hasSources ? '' : ' (select content first)'}`}
                    >
                      {isApplied ? 'Applied' : 'Apply'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleFavourite(template.id)}
                      aria-label={
                        isFavourite
                          ? `Remove ${template.name} from favourites`
                          : `Add ${template.name} to favourites`
                      }
                      aria-pressed={isFavourite}
                    >
                      <Icon name="Star" size={14} />
                    </Button>
                  </div>
                  {template.source !== 'builtin' && !builtinIds.has(template.id) && (
                    <p className="mockups-panel__card-source">Custom</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
