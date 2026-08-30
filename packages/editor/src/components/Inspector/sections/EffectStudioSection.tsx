import {
  EFFECT_STUDIO_CATEGORIES,
  EFFECT_SURFACE_GUIDANCE,
  type EffectDefinition,
  type EffectStudioCategoryId,
  getEffectStudioTreatment,
  type StudioTreatment,
  searchEffectStudioDefinitions,
  searchEffectStudioTreatments,
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

interface StudioPreview {
  nodeId: string;
  treatmentId: string;
  effectIds: string[];
  name: string;
}

interface TreatmentGroup {
  id: string;
  label: string;
  description: string;
  treatments: StudioTreatment[];
}

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

function appendStudioTreatment(node: SceneNode, treatment: StudioTreatment): SceneNode {
  return {
    ...node,
    smartFiltersEnabled: true,
    smartFilters: [
      ...(node.smartFilters ?? []),
      ...treatment.effects.map((effect) =>
        makeSmartFilter(cryptoId(), effect.kind, {
          ...effect.overrides,
          visible: true,
        }),
      ),
    ],
  };
}

function treatmentGroupsFor(
  treatments: StudioTreatment[],
  query: string,
  category: EffectStudioCategoryId | undefined,
  favoritesOnly: boolean,
): TreatmentGroup[] {
  if (category) {
    const selectedCategory = EFFECT_STUDIO_CATEGORIES.find((entry) => entry.id === category);
    return selectedCategory && treatments.length > 0
      ? [
          {
            id: selectedCategory.id,
            label: selectedCategory.label,
            description: selectedCategory.description,
            treatments,
          },
        ]
      : [];
  }

  if (query || favoritesOnly) {
    return treatments.length > 0
      ? [
          {
            id: favoritesOnly ? 'saved' : 'results',
            label: favoritesOnly ? 'Saved treatments' : 'Search results',
            description: favoritesOnly
              ? 'Treatments saved on this device.'
              : 'Treatment recipes matching your search.',
            treatments,
          },
        ]
      : [];
  }

  return EFFECT_STUDIO_CATEGORIES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    treatments: treatments.filter((treatment) => treatment.categoryId === entry.id),
  })).filter((group) => group.treatments.length > 0);
}

export interface EffectStudioSectionProps {
  nodes: import('@varve/scene').SceneNode[];
}

/**
 * Effect Studio is the creative discovery route for named, editable stacks.
 * Object Filters stays authoritative for entry ordering and parameter editing;
 * Image Tuning and Adjustment Filters keep their correction-specific jobs.
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
  const [preview, setPreview] = useState<StudioPreview | null>(null);
  const previewRef = useRef<StudioPreview | null>(null);
  const compareRef = useRef(false);
  const compareNodeRef = useRef<string | null>(null);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [lookName, setLookName] = useState('My Look');

  const treatments = useMemo(() => {
    const listed = searchEffectStudioTreatments(query, category);
    if (!favoritesOnly) return listed;
    return listed.filter((treatment) => favorites.includes(treatment.id));
  }, [category, favorites, favoritesOnly, query]);
  const primitiveDefinitions = useMemo(
    () => searchEffectStudioDefinitions('', category),
    [category],
  );
  const groups = useMemo(
    () => treatmentGroupsFor(treatments, query, category, favoritesOnly),
    [category, favoritesOnly, query, treatments],
  );

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

  const previewTreatment = useCallback(
    (treatment: StudioTreatment) => {
      if (!nodeId) return;
      const current = previewRef.current;
      if (current && current.nodeId !== nodeId) return;
      const effectIds =
        current?.treatmentId === treatment.id
          ? current.effectIds
          : treatment.effects.map(() => cryptoId());
      if (!current) beginTransaction('preview');
      updateNode(nodeId, (owner) => {
        const withoutPreview = (owner.smartFilters ?? []).filter(
          (effect) => !current?.effectIds.includes(effect.id),
        );
        return {
          ...owner,
          smartFiltersEnabled: true,
          smartFilters: [
            ...withoutPreview,
            ...treatment.effects.map((effect, index) =>
              makeSmartFilter(effectIds[index]!, effect.kind, {
                ...effect.overrides,
                visible: true,
              }),
            ),
          ],
        };
      });
      const next: StudioPreview = {
        nodeId,
        treatmentId: treatment.id,
        effectIds,
        name: treatment.name,
      };
      previewRef.current = next;
      setPreview(next);
      updateRecents(treatment.id);
      announce(`${treatment.name} previewed`);
    },
    [announce, beginTransaction, nodeId, updateNode, updateRecents],
  );

  const commitPreview = useCallback(() => {
    const current = previewRef.current;
    if (!current) return;
    commitTransaction();
    previewRef.current = null;
    setPreview(null);
    announce(`${current.name} applied`);
  }, [announce, commitTransaction]);

  const applyTreatment = useCallback(
    (treatment: StudioTreatment) => {
      if (previewRef.current) {
        if (previewRef.current.treatmentId === treatment.id) {
          commitPreview();
        } else {
          previewTreatment(treatment);
        }
        return;
      }
      updateNodes(
        nodes.map((selectedNode) => ({
          id: selectedNode.id,
          update: (current) => appendStudioTreatment(current, treatment),
        })),
      );
      updateRecents(treatment.id);
      announce(`Applied treatment ${treatment.name}`);
    },
    [announce, commitPreview, nodes, previewTreatment, updateNodes, updateRecents],
  );

  const addPrimitive = useCallback(
    (definition: EffectDefinition) => {
      if (previewRef.current) cancelPreview('Preview cancelled');
      addSmartFilterToSelected(definition.id, undefined);
      announce(`${definition.displayName} added to Object Filters`);
    },
    [addSmartFilterToSelected, announce, cancelPreview],
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

  const recentTreatments = recents
    .map((id) => getEffectStudioTreatment(id))
    .filter((treatment): treatment is StudioTreatment => treatment !== undefined)
    .slice(0, 4);
  const looks = state.document.effectLooks ?? [];
  const targetLabel =
    nodes.length === 1 ? (node?.name ?? 'selected object') : `${nodes.length} objects`;
  const previewing = preview !== null;
  const canPreview = nodeId !== undefined;
  const stackEnabled = !compareOriginal && node?.smartFiltersEnabled !== false;
  const targetGuidance = EFFECT_SURFACE_GUIDANCE['effect-studio'];

  return (
    <DisclosureSection title="Effect Studio" id="effect-studio" defaultExpanded>
      <div className="effect-studio" data-effect-studio>
        <div className="effect-studio__intro">
          <div>
            <h3>Curated editable treatments</h3>
            <p>
              Browse a creative family, preview a matched stack on {targetLabel}, then refine its
              entries in Object Filters.
            </p>
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
          <span className="sr-only">Search treatments</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search treatments"
            aria-label="Search treatments"
          />
        </label>

        <div
          className="effect-studio__filters"
          role="toolbar"
          aria-label="Treatment gallery filters"
        >
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
            Saved
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

        {recentTreatments.length > 0 && !query && !category && !favoritesOnly && (
          <fieldset className="effect-studio__recent">
            <legend>Recent treatments</legend>
            {recentTreatments.map((treatment) => (
              <button
                type="button"
                key={treatment.id}
                onClick={() => previewTreatment(treatment)}
                disabled={!canPreview || preview?.treatmentId === treatment.id}
                aria-label={`Preview ${treatment.name}`}
              >
                {treatment.name}
              </button>
            ))}
          </fieldset>
        )}

        <section className="effect-studio__gallery" aria-label="Treatment Gallery">
          {groups.map((group) => (
            <section className="effect-studio__treatment-group" key={group.id}>
              <div className="effect-studio__treatment-group-header">
                <h4>{group.label}</h4>
                <p>{group.description}</p>
              </div>
              <ul className="effect-studio__treatment-grid">
                {group.treatments.map((treatment) => {
                  const isFavorite = favorites.includes(treatment.id);
                  const isPreview = preview?.treatmentId === treatment.id;
                  return (
                    <li className={isPreview ? 'is-previewing' : ''} key={treatment.id}>
                      <div
                        className="effect-studio__treatment-art"
                        data-treatment-art={treatment.art}
                        data-treatment-category={treatment.categoryId}
                        aria-hidden="true"
                      />
                      <div className="effect-studio__treatment-copy">
                        <strong>{treatment.name}</strong>
                        <span>{treatment.description}</span>
                        <small>
                          {treatment.effects.length} editable effect
                          {treatment.effects.length === 1 ? '' : 's'} · raster + vector
                        </small>
                      </div>
                      <div className="effect-studio__card-actions">
                        <button
                          type="button"
                          onClick={() => previewTreatment(treatment)}
                          disabled={!canPreview || isPreview}
                          aria-label={`Preview ${treatment.name}`}
                        >
                          {isPreview ? 'Previewing' : 'Preview'}
                        </button>
                        <button
                          type="button"
                          className="effect-studio__add"
                          onClick={() => applyTreatment(treatment)}
                          aria-label={`Apply ${treatment.name}`}
                        >
                          {isPreview ? 'Keep' : 'Apply'}
                        </button>
                        <button
                          type="button"
                          className="effect-studio__favorite"
                          aria-pressed={isFavorite}
                          aria-label={
                            isFavorite
                              ? `Remove ${treatment.name} from saved treatments`
                              : `Save ${treatment.name}`
                          }
                          onClick={() => toggleFavorite(treatment.id)}
                        >
                          {isFavorite ? 'Saved' : 'Save'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>
        {treatments.length === 0 && (
          <p className="effect-studio__empty" role="status">
            No treatments match this search. Try a category or clear the query.
          </p>
        )}

        {previewing && (
          <div className="effect-studio__preview-status" role="status" aria-live="polite">
            <span>
              Previewing <strong>{preview.name}</strong> on the canvas. Keep applies its ordered
              stack.
            </span>
            <button type="button" onClick={() => cancelPreview()}>
              Cancel preview
            </button>
          </div>
        )}

        <details className="effect-studio__primitives">
          <summary>Individual creative effects</summary>
          <p>
            These are raw building blocks, not a second effect gallery. Add one here when you know
            the operator you need, then use Object Filters for its parameters, order, mask, and
            blend. Use Image Tuning for photo correction and Adjustment Filters for a scoped
            backdrop correction.
          </p>
          <ul aria-label="Individual creative effects">
            {primitiveDefinitions.map((definition) => (
              <li key={definition.id}>
                <span>{definition.displayName}</span>
                <button
                  type="button"
                  onClick={() => addPrimitive(definition)}
                  aria-label={`Add ${definition.displayName} primitive to stack`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </details>

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
          Effect Studio writes ordered editable entries to Object Filters; it never flattens raster
          source or converts vector geometry. Image Tuning is for image-local photographic work,
          while Adjustment Filters correct a scoped backdrop.
        </p>
      </div>
    </DisclosureSection>
  );
}
