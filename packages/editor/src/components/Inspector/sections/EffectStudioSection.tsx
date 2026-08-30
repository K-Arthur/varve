import {
  EFFECT_STUDIO_CATEGORIES,
  EFFECT_STUDIO_KINDS,
  EFFECT_STUDIO_PRESETS,
  EFFECT_SURFACE_GUIDANCE,
  type EffectDefinition,
  type EffectStudioCategoryId,
  getEffectDefinition,
  type SurfacePreset,
  searchEffectStudioDefinitions,
} from '@varve/engine';
import {
  appendEffectLook,
  canHaveSmartFilters,
  createEffectLook,
  cryptoId,
  type EffectLook,
  makeSmartFilter,
  type SceneNode,
} from '@varve/scene';
import { SOLID_CHROME_ICONS, SolidIcon } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import './effectStudio.css';

const FAVORITES_KEY = 'varve:effect-studio:favorites';
const RECENTS_KEY = 'varve:effect-studio:recents';
const MAX_LIBRARY_IDS = 32;

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_LIBRARY_IDS)
      : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: readonly string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(ids.slice(0, MAX_LIBRARY_IDS)));
  } catch {
    // Browser storage can be disabled or full; the current session still works.
  }
}

function remember(id: string, current: readonly string[]): string[] {
  return [id, ...current.filter((entry) => entry !== id)].slice(0, MAX_LIBRARY_IDS);
}

function effectLabel(kind: string): string {
  return getEffectDefinition(kind)?.displayName ?? kind;
}

function appendStudioPreset(node: SceneNode, preset: SurfacePreset): SceneNode {
  if (preset.surface !== 'effect-studio') return node;
  return {
    ...node,
    smartFiltersEnabled: true,
    smartFilters: [
      ...(node.smartFilters ?? []),
      ...preset.effects.map((effect) =>
        makeSmartFilter(cryptoId(), effect.kind, {
          ...effect.overrides,
          visible: true,
        }),
      ),
    ],
  };
}

export interface EffectStudioSectionProps {
  nodes: import('@varve/scene').SceneNode[];
}

/**
 * Effect Studio's discovery surface. The committed Object Filters stack and
 * its editors remain the authoritative editor; this component only provides
 * catalog discovery, preview transactions, comparison, and Looks.
 */
export function EffectStudioSection({ nodes }: EffectStudioSectionProps) {
  const {
    state,
    updateNode,
    updateDoc,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    addSmartFilterToSelected,
    updateNodes,
    announce,
  } = useEditor();
  const node = nodes.length === 1 ? nodes[0] : undefined;
  const compatible = nodes.length > 0 && nodes.every(canHaveSmartFilters);
  const nodeId = node?.id;
  const filters = node?.smartFilters ?? [];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EffectStudioCategoryId | undefined>();
  const [favorites, setFavorites] = useState<string[]>(readIds(FAVORITES_KEY));
  const [recents, setRecents] = useState<string[]>(readIds(RECENTS_KEY));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [preview, setPreview] = useState<{ nodeId: string; effectId: string; kind: string } | null>(
    null,
  );
  const previewRef = useRef<typeof preview>(null);
  const compareRef = useRef(false);
  const compareNodeRef = useRef<string | null>(null);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [lookName, setLookName] = useState('My Look');

  const definitions = useMemo(() => {
    const listed = searchEffectStudioDefinitions(query, category);
    if (!favoritesOnly) return listed;
    return listed.filter((definition) => favorites.includes(definition.id));
  }, [category, favorites, favoritesOnly, query]);

  const updateRecents = useCallback((id: string) => {
    setRecents((current) => {
      const next = remember(id, current);
      writeIds(RECENTS_KEY, next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((current) => {
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [id, ...current];
      writeIds(FAVORITES_KEY, next);
      return next;
    });
  }, []);

  const cancelPreview = useCallback(
    (message = 'Preview cancelled') => {
      if (!previewRef.current) return;
      abortTransaction();
      previewRef.current = null;
      setPreview(null);
      announce(message);
    },
    [abortTransaction, announce],
  );

  const previewEffect = useCallback(
    (definition: EffectDefinition) => {
      if (!nodeId) return;
      const current = previewRef.current;
      const effectId = current?.effectId ?? cryptoId();
      if (!current) beginTransaction('preview');
      updateNode(nodeId, (owner) => {
        const withoutPreview = (owner.smartFilters ?? []).filter(
          (effect) => effect.id !== effectId,
        );
        return {
          ...owner,
          smartFilters: [...withoutPreview, makeSmartFilter(effectId, definition.id)],
        };
      });
      const next = { nodeId, effectId, kind: definition.id };
      previewRef.current = next;
      setPreview(next);
      updateRecents(definition.id);
      announce(`${definition.displayName} previewed`);
    },
    [announce, beginTransaction, nodeId, updateNode, updateRecents],
  );

  const commitPreview = useCallback(() => {
    const current = previewRef.current;
    if (!current) return;
    commitTransaction();
    previewRef.current = null;
    setPreview(null);
    announce(`${effectLabel(current.kind)} added`);
  }, [announce, commitTransaction]);

  const addEffect = useCallback(
    (definition: EffectDefinition) => {
      if (previewRef.current) {
        if (previewRef.current.kind === definition.id) {
          commitPreview();
          return;
        }
        previewEffect(definition);
        return;
      }
      addSmartFilterToSelected(definition.id, undefined);
      updateRecents(definition.id);
    },
    [addSmartFilterToSelected, commitPreview, previewEffect, updateRecents],
  );

  const applyPreset = useCallback(
    (preset: SurfacePreset) => {
      updateNodes(
        nodes.map((selectedNode) => ({
          id: selectedNode.id,
          update: (current) => appendStudioPreset(current, preset),
        })),
      );
      announce(`Applied Studio preset ${preset.name}`);
    },
    [announce, nodes, updateNodes],
  );

  const toggleCompare = useCallback(() => {
    if (!nodeId || filters.length === 0 || previewRef.current) return;
    if (compareRef.current) {
      abortTransaction();
      compareRef.current = false;
      compareNodeRef.current = null;
      setCompareOriginal(false);
      announce('Compare View: showing effects');
      return;
    }
    beginTransaction('preview');
    updateNode(nodeId, (owner) => ({ ...owner, smartFiltersEnabled: false }));
    compareRef.current = true;
    compareNodeRef.current = nodeId;
    setCompareOriginal(true);
    announce('Compare View: showing original');
  }, [abortTransaction, announce, beginTransaction, filters.length, nodeId, updateNode]);

  const cancelCompare = useCallback(
    (message = 'Compare View cancelled') => {
      if (!compareRef.current) return;
      abortTransaction();
      compareRef.current = false;
      compareNodeRef.current = null;
      setCompareOriginal(false);
      announce(message);
    },
    [abortTransaction, announce],
  );

  const saveLook = useCallback(() => {
    if (filters.length === 0) return;
    const look = createEffectLook(cryptoId(), lookName, filters);
    updateDoc((document) => ({
      ...document,
      effectLooks: [...(document.effectLooks ?? []), look],
    }));
    announce(`Saved Look ${look.name}`);
  }, [announce, filters, lookName, updateDoc]);

  const applyLook = useCallback(
    (look: EffectLook) => {
      if (!nodeId) return;
      updateNode(nodeId, (owner) => ({
        ...owner,
        smartFilters: appendEffectLook(owner.smartFilters ?? [], look, cryptoId),
      }));
      announce(`Applied Look ${look.name}`);
    },
    [announce, nodeId, updateNode],
  );

  const deleteLook = useCallback(
    (lookId: string) => {
      updateDoc((document) => ({
        ...document,
        effectLooks: (document.effectLooks ?? []).filter((look) => look.id !== lookId),
      }));
      announce('Look deleted');
    },
    [announce, updateDoc],
  );

  useEffect(() => {
    if (preview && preview.nodeId !== nodeId) cancelPreview('Preview cancelled: target changed');
    if (compareRef.current && compareNodeRef.current !== nodeId) {
      cancelCompare('Compare View cancelled: target changed');
    }
  }, [cancelCompare, cancelPreview, nodeId, preview]);

  useEffect(
    () => () => {
      if (previewRef.current || compareRef.current) abortTransaction();
    },
    [abortTransaction],
  );

  if (!compatible) return null;

  const recentDefinitions = recents
    .map((id) => getEffectDefinition(id))
    .filter(
      (definition): definition is EffectDefinition =>
        definition !== undefined &&
        (EFFECT_STUDIO_KINDS as readonly string[]).includes(definition.id),
    )
    .slice(0, 4);
  const looks = state.document.effectLooks ?? [];
  const targetLabel =
    nodes.length === 1 ? (node?.name ?? 'selected object') : `${nodes.length} objects`;
  const previewing = preview !== null;
  const stackEnabled = !compareOriginal && node?.smartFiltersEnabled !== false;
  const targetGuidance = EFFECT_SURFACE_GUIDANCE['effect-studio'];

  return (
    <DisclosureSection title="Effect Studio" id="effect-studio" defaultExpanded>
      <div className="effect-studio" data-effect-studio>
        <div className="effect-studio__intro">
          <div>
            <h3>Explore editable treatments</h3>
            <p>Preview on {targetLabel}, then add the result to the Object Filters stack.</p>
            <details className="effect-studio__target-guidance">
              <summary>How this works on raster and vector objects</summary>
              <p>
                <strong>Raster:</strong> {targetGuidance.rasterBehavior}
              </p>
              <p>
                <strong>Vector:</strong> {targetGuidance.vectorBehavior}
              </p>
            </details>
          </div>
          <button
            type="button"
            className="effect-studio__compare"
            aria-pressed={!stackEnabled}
            onClick={toggleCompare}
            disabled={filters.length === 0 || previewing}
          >
            <SolidIcon
              name={stackEnabled ? SOLID_CHROME_ICONS.visibilityOff : SOLID_CHROME_ICONS.visibility}
              size="0.8em"
              aria-hidden
            />
            {stackEnabled ? 'Compare original' : 'Show effects'}
          </button>
        </div>

        <label className="effect-studio__search-label">
          <span className="sr-only">Search effects</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search effects"
            aria-label="Search effects"
          />
        </label>

        <div className="effect-studio__filters" role="toolbar" aria-label="Effect library filters">
          <button
            type="button"
            className={!category && !favoritesOnly ? 'is-selected' : ''}
            aria-pressed={!category && !favoritesOnly}
            onClick={() => {
              setCategory(undefined);
              setFavoritesOnly(false);
            }}
          >
            All
          </button>
          <button
            type="button"
            className={favoritesOnly ? 'is-selected' : ''}
            aria-pressed={favoritesOnly}
            onClick={() => {
              setFavoritesOnly(true);
              setCategory(undefined);
            }}
          >
            Favorites
          </button>
          {EFFECT_STUDIO_CATEGORIES.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={category === entry.id ? 'is-selected' : ''}
              aria-pressed={category === entry.id}
              onClick={() => {
                setCategory(entry.id);
                setFavoritesOnly(false);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {recentDefinitions.length > 0 && !query && !category && !favoritesOnly && (
          <fieldset className="effect-studio__recent">
            <legend>Recent</legend>
            {recentDefinitions.map((definition) => (
              <button type="button" key={definition.id} onClick={() => previewEffect(definition)}>
                {definition.displayName}
              </button>
            ))}
          </fieldset>
        )}

        <fieldset className="effect-studio__presets">
          <legend>Studio presets</legend>
          <div className="effect-studio__preset-grid">
            {EFFECT_STUDIO_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="effect-studio__preset"
                onClick={() => applyPreset(preset)}
                aria-label={`Apply Studio preset ${preset.name}`}
              >
                <strong>{preset.name}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <ul className="effect-studio__library" aria-label="Effect Library">
          {definitions.map((definition) => {
            const isFavorite = favorites.includes(definition.id);
            const isPreview = preview?.kind === definition.id;
            return (
              <li className={isPreview ? 'is-previewing' : ''} key={definition.id}>
                <div className="effect-studio__card-art" aria-hidden="true">
                  <span
                    data-effect-category={definition.studioCategoryId ?? definition.categoryId}
                  />
                </div>
                <div className="effect-studio__card-copy">
                  <strong>{definition.displayName}</strong>
                  <span>{definition.description}</span>
                  <small>
                    {definition.rendering.estimatedCost === 'high'
                      ? 'Settled preview may take longer'
                      : 'Live preview'}
                  </small>
                </div>
                <div className="effect-studio__card-actions">
                  <button
                    type="button"
                    onClick={() => (isPreview ? commitPreview() : previewEffect(definition))}
                    aria-label={
                      isPreview
                        ? `Add ${definition.displayName}`
                        : `Preview ${definition.displayName}`
                    }
                  >
                    {isPreview ? 'Add' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    className="effect-studio__favorite"
                    aria-pressed={isFavorite}
                    aria-label={
                      isFavorite
                        ? `Remove ${definition.displayName} from favorites`
                        : `Favorite ${definition.displayName}`
                    }
                    onClick={() => toggleFavorite(definition.id)}
                  >
                    {isFavorite ? 'Saved' : 'Fav'}
                  </button>
                  <button
                    type="button"
                    className="effect-studio__add"
                    onClick={() => addEffect(definition)}
                    aria-label={`Add ${definition.displayName} to stack`}
                  >
                    Add
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {definitions.length === 0 && (
          <p className="effect-studio__empty" role="status">
            No effects match this search. Try a category or clear the query.
          </p>
        )}

        {previewing && (
          <div className="effect-studio__preview-status" role="status" aria-live="polite">
            <span>
              Previewing <strong>{effectLabel(preview.kind)}</strong> on the canvas.
            </span>
            <button type="button" onClick={() => cancelPreview()}>
              Cancel preview
            </button>
          </div>
        )}

        <div className="effect-studio__looks">
          <div className="effect-studio__looks-header">
            <div>
              <h3>Looks</h3>
              <p>Save an ordered recipe without flattening the artwork.</p>
            </div>
            <button type="button" onClick={saveLook} disabled={filters.length === 0}>
              Save current stack
            </button>
          </div>
          <label>
            <span>Look name</span>
            <input value={lookName} onChange={(event) => setLookName(event.target.value)} />
          </label>
          {looks.length > 0 ? (
            <ul aria-label="Saved Looks">
              {looks.map((look) => (
                <li key={look.id}>
                  <span>
                    <strong>{look.name}</strong>
                    <small>
                      {look.effects.length} effect{look.effects.length === 1 ? '' : 's'}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => applyLook(look)}
                    aria-label={`Apply Look ${look.name}`}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteLook(look.id)}
                    aria-label={`Delete Look ${look.name}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="effect-studio__empty">No Looks saved in this document.</p>
          )}
        </div>

        <p className="effect-studio__stack-note">
          The committed Object Filters stack below remains the source of truth for order, settings,
          masks, and undo history.
        </p>
      </div>
    </DisclosureSection>
  );
}
