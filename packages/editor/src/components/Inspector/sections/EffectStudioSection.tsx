import {
  type Adjustment,
  defaultStudioTreatmentControlValues,
  EFFECT_STUDIO_CATEGORIES,
  EFFECT_SURFACE_GUIDANCE,
  type EffectDefinition,
  type EffectStudioCategoryId,
  getEffectStudioTreatment,
  resolveStudioTreatmentEffects,
  type StudioTreatment,
  searchEffectStudioDefinitions,
  searchEffectStudioTreatments,
  studioTreatmentControls,
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

/** Preserve prior raw-effect saves when the Studio becomes treatment-first. */
const LEGACY_TREATMENT_BY_PRIMITIVE: Readonly<Record<string, string>> = {
  bloom: 'studio-chromatic-bloom',
  caustics: 'studio-refracted-light',
  colorHalftone: 'studio-screen-print',
  crt: 'studio-neon-phosphor',
  dither: 'studio-pencil-poster',
  duotone: 'studio-inked-paper',
  lensFlare: 'studio-aperture-star',
  lightLeak: 'studio-light-leak',
  lightShafts: 'studio-cinema-shafts',
  paletteSnap: 'studio-palette-cut',
  rgbSplit: 'studio-glass-shift',
  tritone: 'studio-pigment-wash',
  vhs: 'studio-analog-signal',
};

interface StudioPreview {
  nodeId: string;
  treatmentId: string;
  instanceId: string;
  effectIds: string[];
  values: Record<string, number>;
  name: string;
}

interface TreatmentTuning {
  treatmentId: string;
  values: Record<string, number>;
  /** Present when the user is editing an already-applied recipe. */
  instanceId?: string;
  customized?: boolean;
}

interface AppliedStudioTreatment {
  /** Treatment and instance together are the durable group identity. */
  key: string;
  treatment: StudioTreatment;
  instanceId: string;
  effectIds: string[];
  values: Record<string, number>;
  customized: boolean;
  firstIndex: number;
}

function studioTreatmentInstanceKey(treatmentId: string, instanceId: string): string {
  // Instance IDs are generated uniquely in normal operation, but documents and
  // Looks are imported data. Keep the treatment id in the group key so a
  // malformed or legacy collision cannot merge two visible applied treatments.
  return `${treatmentId}\u0000${instanceId}`;
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

function readTreatmentIds(key: string): string[] {
  const ids = readIds(key);
  const migrated = [...new Set(ids.map((id) => LEGACY_TREATMENT_BY_PRIMITIVE[id] ?? id))];
  if (migrated.length !== ids.length || migrated.some((id, index) => id !== ids[index])) {
    writeIds(key, migrated);
  }
  return migrated;
}

function remember(id: string, current: readonly string[]): string[] {
  return [id, ...current.filter((entry) => entry !== id)].slice(0, MAX_LIBRARY_IDS);
}

function treatmentControlValues(
  treatment: StudioTreatment,
  values: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const defaults = defaultStudioTreatmentControlValues(treatment);
  return Object.fromEntries(
    Object.entries(defaults).map(([id, defaultValue]) => {
      const candidate = values[id];
      return [
        id,
        typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : defaultValue,
      ];
    }),
  );
}

function studioTreatmentFilters(
  treatment: StudioTreatment,
  values: Readonly<Record<string, number>>,
  instanceId: string,
  effectIds?: readonly string[],
): Adjustment[] {
  const controls = treatmentControlValues(treatment, values);
  return resolveStudioTreatmentEffects(treatment, controls).map((effect, effectIndex) =>
    makeSmartFilter(effectIds?.[effectIndex] ?? cryptoId(), effect.kind, {
      ...effect.overrides,
      visible: true,
      studioTreatment: {
        treatmentId: treatment.id,
        instanceId,
        effectIndex,
        controls,
      },
    }),
  );
}

function appendStudioTreatment(
  node: SceneNode,
  treatment: StudioTreatment,
  values: Readonly<Record<string, number>> = {},
  instanceId = cryptoId(),
): SceneNode {
  return {
    ...node,
    smartFiltersEnabled: true,
    smartFilters: [
      ...(node.smartFilters ?? []),
      ...studioTreatmentFilters(treatment, values, instanceId),
    ],
  };
}

function appliedStudioTreatments(filters: readonly Adjustment[]): AppliedStudioTreatment[] {
  const instances = new Map<string, AppliedStudioTreatment>();
  for (const [index, filter] of filters.entries()) {
    const metadata = filter.studioTreatment;
    if (!metadata) continue;
    const treatment = getEffectStudioTreatment(metadata.treatmentId);
    if (!treatment) continue;
    const key = studioTreatmentInstanceKey(metadata.treatmentId, metadata.instanceId);
    const existing = instances.get(key);
    if (existing) {
      existing.effectIds.push(filter.id);
      existing.customized ||= metadata.customized === true;
      continue;
    }
    instances.set(key, {
      key,
      treatment,
      instanceId: metadata.instanceId,
      effectIds: [filter.id],
      values: treatmentControlValues(treatment, metadata.controls),
      customized: metadata.customized === true,
      firstIndex: index,
    });
  }
  return [...instances.values()].sort((left, right) => left.firstIndex - right.firstIndex);
}

function updateStudioTreatmentInstance(
  node: SceneNode,
  treatment: StudioTreatment,
  instanceId: string,
  values: Readonly<Record<string, number>>,
): SceneNode {
  const controls = treatmentControlValues(treatment, values);
  const effects = resolveStudioTreatmentEffects(treatment, controls);
  return {
    ...node,
    smartFilters: (node.smartFilters ?? []).map((filter) => {
      const metadata = filter.studioTreatment;
      if (
        !metadata ||
        metadata.treatmentId !== treatment.id ||
        metadata.instanceId !== instanceId ||
        !effects[metadata.effectIndex]
      ) {
        return filter;
      }
      const effect = effects[metadata.effectIndex]!;
      return {
        ...filter,
        ...effect.overrides,
        studioTreatment: {
          ...metadata,
          controls,
        },
      } as Adjustment;
    }),
  };
}

function replaceStudioTreatmentInstance(
  node: SceneNode,
  instance: AppliedStudioTreatment,
  values: Readonly<Record<string, number>>,
): SceneNode {
  const filters = node.smartFilters ?? [];
  const firstIndex = filters.findIndex(
    (filter) =>
      filter.studioTreatment?.treatmentId === instance.treatment.id &&
      filter.studioTreatment.instanceId === instance.instanceId,
  );
  if (firstIndex < 0) return node;
  const isMember = (filter: Adjustment) =>
    filter.studioTreatment?.treatmentId === instance.treatment.id &&
    filter.studioTreatment.instanceId === instance.instanceId;
  const insertionIndex = filters.slice(0, firstIndex).filter((filter) => !isMember(filter)).length;
  const withoutInstance = filters.filter((filter) => !isMember(filter));
  return {
    ...node,
    smartFilters: [
      ...withoutInstance.slice(0, insertionIndex),
      ...studioTreatmentFilters(instance.treatment, values, instance.instanceId),
      ...withoutInstance.slice(insertionIndex),
    ],
  };
}

function removeStudioTreatmentInstance(
  node: SceneNode,
  instance: AppliedStudioTreatment,
): SceneNode {
  return {
    ...node,
    smartFilters: (node.smartFilters ?? []).filter(
      (filter) =>
        filter.studioTreatment?.treatmentId !== instance.treatment.id ||
        filter.studioTreatment.instanceId !== instance.instanceId,
    ),
  };
}

function formatControlValue(value: number, unit: '%' | 'steps' | 'px' | undefined): string {
  const display = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (unit === '%') return `${display}%`;
  if (unit === 'px') return `${display}px`;
  if (unit === 'steps') return `${display} steps`;
  return display;
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
  const [favorites, setFavorites] = useState<string[]>(() => readTreatmentIds(FAVORITES_KEY));
  const [recents, setRecents] = useState<string[]>(() => readTreatmentIds(RECENTS_KEY));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [preview, setPreview] = useState<StudioPreview | null>(null);
  const previewRef = useRef<StudioPreview | null>(null);
  const compareRef = useRef(false);
  const compareNodeRef = useRef<string | null>(null);
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [lookName, setLookName] = useState('My Look');
  const [tuning, setTuning] = useState<TreatmentTuning | null>(null);
  const tuningTransactionRef = useRef(false);

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
  const appliedTreatments = useMemo(() => appliedStudioTreatments(filters), [filters]);
  const tuningTreatment = tuning ? getEffectStudioTreatment(tuning.treatmentId) : undefined;

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
    (treatment: StudioTreatment, values: Readonly<Record<string, number>> = {}) => {
      if (!nodeId) return;
      const current = previewRef.current;
      if (current && current.nodeId !== nodeId) return;
      const controls = treatmentControlValues(treatment, values);
      const effectIds =
        current?.treatmentId === treatment.id
          ? current.effectIds
          : treatment.effects.map(() => cryptoId());
      const instanceId = current?.treatmentId === treatment.id ? current.instanceId : cryptoId();
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
            ...studioTreatmentFilters(treatment, controls, instanceId, effectIds),
          ],
        };
      });
      const next: StudioPreview = {
        nodeId,
        treatmentId: treatment.id,
        instanceId,
        effectIds,
        values: controls,
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
    setTuning((active) =>
      active?.treatmentId === current.treatmentId
        ? { ...active, instanceId: current.instanceId, values: current.values, customized: false }
        : active,
    );
    announce(`${current.name} applied`);
  }, [announce, commitTransaction]);

  const applyTreatment = useCallback(
    (treatment: StudioTreatment, values: Readonly<Record<string, number>> = {}) => {
      const controls = treatmentControlValues(treatment, values);
      if (previewRef.current) {
        if (previewRef.current.treatmentId === treatment.id) {
          commitPreview();
        } else {
          previewTreatment(treatment, controls);
        }
        return;
      }
      const singleInstanceId = nodes.length === 1 ? cryptoId() : undefined;
      updateNodes(
        nodes.map((selectedNode) => ({
          id: selectedNode.id,
          update: (current) =>
            appendStudioTreatment(current, treatment, controls, singleInstanceId ?? cryptoId()),
        })),
      );
      if (singleInstanceId) {
        setTuning((active) =>
          active?.treatmentId === treatment.id
            ? { ...active, instanceId: singleInstanceId, values: controls, customized: false }
            : active,
        );
      }
      updateRecents(treatment.id);
      announce(`Applied treatment ${treatment.name}`);
    },
    [announce, commitPreview, nodes, previewTreatment, updateNodes, updateRecents],
  );

  const openTreatmentTuning = useCallback(
    (treatment: StudioTreatment) => {
      if (previewRef.current && previewRef.current.treatmentId !== treatment.id) {
        cancelPreview('Preview cancelled');
      }
      const values = treatmentControlValues(treatment);
      setTuning({ treatmentId: treatment.id, values });
      if (nodeId) previewTreatment(treatment, values);
    },
    [cancelPreview, nodeId, previewTreatment],
  );

  const openAppliedTreatmentTuning = useCallback(
    (instance: AppliedStudioTreatment) => {
      if (previewRef.current) cancelPreview('Preview cancelled');
      setTuning({
        treatmentId: instance.treatment.id,
        instanceId: instance.instanceId,
        values: instance.values,
        customized: instance.customized,
      });
    },
    [cancelPreview],
  );

  const beginTuningTransaction = useCallback(() => {
    if (!tuning?.instanceId || tuningTransactionRef.current) return;
    tuningTransactionRef.current = true;
    beginTransaction();
  }, [beginTransaction, tuning?.instanceId]);

  const finishTuningTransaction = useCallback(() => {
    if (!tuningTransactionRef.current) return;
    tuningTransactionRef.current = false;
    commitTransaction();
  }, [commitTransaction]);

  const setTreatmentControl = useCallback(
    (controlId: string, candidate: number) => {
      if (!tuning || !tuningTreatment) return;
      const control = studioTreatmentControls(tuningTreatment).find(
        (entry) => entry.id === controlId,
      );
      if (!control) return;
      const value = Math.min(control.max, Math.max(control.min, candidate));
      const values = { ...tuning.values, [controlId]: value };
      setTuning({ ...tuning, values });
      if (tuning.instanceId && nodeId) {
        updateNode(nodeId, (owner) =>
          updateStudioTreatmentInstance(owner, tuningTreatment, tuning.instanceId!, values),
        );
      } else if (previewRef.current?.treatmentId === tuningTreatment.id) {
        previewTreatment(tuningTreatment, values);
      }
    },
    [nodeId, previewTreatment, tuning, tuningTreatment, updateNode],
  );

  const resetTreatmentControls = useCallback(() => {
    if (!tuning || !tuningTreatment) return;
    const values = treatmentControlValues(tuningTreatment);
    setTuning({ ...tuning, values });
    if (tuning.instanceId && nodeId) {
      updateNode(nodeId, (owner) =>
        updateStudioTreatmentInstance(owner, tuningTreatment, tuning.instanceId!, values),
      );
    } else if (previewRef.current?.treatmentId === tuningTreatment.id) {
      previewTreatment(tuningTreatment, values);
    }
  }, [nodeId, previewTreatment, tuning, tuningTreatment, updateNode]);

  const closeTreatmentTuning = useCallback(() => {
    if (!tuning) return;
    if (!tuning.instanceId && previewRef.current?.treatmentId === tuning.treatmentId) {
      cancelPreview('Preview cancelled');
    }
    setTuning(null);
  }, [cancelPreview, tuning]);

  const restoreAppliedTreatment = useCallback(() => {
    if (!nodeId || !tuning?.instanceId || !tuningTreatment) return;
    const instance = appliedTreatments.find(
      (entry) =>
        entry.treatment.id === tuningTreatment.id && entry.instanceId === tuning.instanceId,
    );
    if (!instance) return;
    updateNode(nodeId, (owner) => replaceStudioTreatmentInstance(owner, instance, tuning.values));
    setTuning({ ...tuning, customized: false });
    announce(`Restored ${tuningTreatment.name} recipe`);
  }, [announce, appliedTreatments, nodeId, tuning, tuningTreatment, updateNode]);

  const removeAppliedTreatment = useCallback(
    (instance: AppliedStudioTreatment) => {
      if (!nodeId) return;
      updateNode(nodeId, (owner) => removeStudioTreatmentInstance(owner, instance));
      setTuning((active) =>
        active?.treatmentId === instance.treatment.id && active.instanceId === instance.instanceId
          ? null
          : active,
      );
      announce(`Removed ${instance.treatment.name} treatment`);
    },
    [announce, nodeId, updateNode],
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
    if (
      tuning?.instanceId &&
      !appliedTreatments.some(
        (instance) =>
          instance.treatment.id === tuning.treatmentId && instance.instanceId === tuning.instanceId,
      )
    ) {
      setTuning(null);
    }
  }, [appliedTreatments, cancelCompare, cancelPreview, nodeId, preview, tuning?.instanceId]);

  useEffect(
    () => () => {
      if (tuningTransactionRef.current) {
        tuningTransactionRef.current = false;
        commitTransaction();
      }
      if (previewRef.current || compareRef.current) abortTransaction();
    },
    [abortTransaction, commitTransaction],
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
              Browse a creative family, then tune the named treatment directly on {targetLabel}.
              Object Filters is reserved for advanced recipe internals.
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

        {appliedTreatments.length > 0 && (
          <section className="effect-studio__applied" aria-label="Applied treatments">
            <div className="effect-studio__applied-header">
              <div>
                <h3>Applied treatments</h3>
                <p>
                  Tune these named recipes here instead of hunting through the raw filter stack.
                </p>
              </div>
            </div>
            <ul>
              {appliedTreatments.map((instance) => (
                <li
                  className={
                    tuning?.treatmentId === instance.treatment.id &&
                    tuning.instanceId === instance.instanceId
                      ? 'is-selected'
                      : undefined
                  }
                  key={instance.key}
                >
                  <span className="effect-studio__applied-summary">
                    <strong className="effect-studio__applied-name">
                      {instance.treatment.name}
                    </strong>
                    <small className="effect-studio__applied-description">
                      {instance.customized
                        ? 'Customized in advanced editing'
                        : `${instance.effectIds.length} effect${
                            instance.effectIds.length === 1 ? '' : 's'
                          } · curated recipe`}
                    </small>
                  </span>
                  <button
                    type="button"
                    onClick={() => openAppliedTreatmentTuning(instance)}
                    aria-label={`Tune ${instance.treatment.name}`}
                  >
                    Tune
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAppliedTreatment(instance)}
                    aria-label={`Remove ${instance.treatment.name} treatment`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tuning && tuningTreatment && (
          <section
            className="effect-studio__tuning"
            aria-label={`${tuningTreatment.name} settings`}
          >
            <div className="effect-studio__tuning-header">
              <div>
                <h3>{tuningTreatment.name} settings</h3>
                <p>
                  {tuning.instanceId
                    ? 'These controls keep the treatment coherent while preserving its editable stack.'
                    : 'Preview the intended treatment, tune its key controls, then add it to the stack.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTreatmentTuning}
                aria-label="Close treatment settings"
              >
                Close
              </button>
            </div>
            {tuning.customized && (
              <p className="effect-studio__customized" role="status">
                This recipe has advanced edits. Its current appearance is preserved; restoring it
                will replace just this treatment with its coherent recipe again.
              </p>
            )}
            <div className="effect-studio__tuning-controls">
              {studioTreatmentControls(tuningTreatment).map((control) => {
                const value = tuning.values[control.id] ?? control.defaultValue;
                return (
                  <label key={control.id}>
                    <span className="effect-studio__control-label">
                      <strong>{control.label}</strong>
                      <output>{formatControlValue(value, control.unit)}</output>
                    </span>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={value}
                      aria-label={`${tuningTreatment.name} ${control.label}`}
                      onPointerDown={beginTuningTransaction}
                      onPointerUp={finishTuningTransaction}
                      onPointerCancel={finishTuningTransaction}
                      onKeyDown={beginTuningTransaction}
                      onKeyUp={finishTuningTransaction}
                      onChange={(event) =>
                        setTreatmentControl(control.id, Number(event.target.value))
                      }
                    />
                    <small>{control.description}</small>
                  </label>
                );
              })}
            </div>
            <div className="effect-studio__tuning-actions">
              {!tuning.instanceId && (
                <button
                  type="button"
                  onClick={() => previewTreatment(tuningTreatment, tuning.values)}
                  disabled={!canPreview || preview?.treatmentId === tuningTreatment.id}
                >
                  {preview?.treatmentId === tuningTreatment.id ? 'Previewing' : 'Preview'}
                </button>
              )}
              {!tuning.instanceId && (
                <button
                  type="button"
                  className="effect-studio__add"
                  onClick={() => applyTreatment(tuningTreatment, tuning.values)}
                >
                  {preview?.treatmentId === tuningTreatment.id ? 'Keep treatment' : 'Add to stack'}
                </button>
              )}
              {tuning.instanceId && (
                <button type="button" onClick={resetTreatmentControls}>
                  Reset controls
                </button>
              )}
              {tuning.instanceId && tuning.customized && (
                <button
                  type="button"
                  className="effect-studio__add"
                  onClick={restoreAppliedTreatment}
                >
                  Restore recipe
                </button>
              )}
            </div>
          </section>
        )}

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
                          onClick={() => openTreatmentTuning(treatment)}
                          aria-label={`Configure ${treatment.name} before adding`}
                        >
                          Configure
                        </button>
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
            These are raw building blocks, not a second treatment gallery. Tune an applied named
            treatment above to retain its intent. Add one here only when you know the operator you
            need; Object Filters then exposes its parameters, order, mask, and blend. Raw changes to
            a curated treatment are marked Customized rather than silently relabelled. Use Image
            Tuning for photo correction and Adjustment Filters for a scoped backdrop correction.
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
          Effect Studio owns named treatment settings and applied-recipe management. Its recipes are
          still ordered editable Object Filter entries, so stacking never flattens raster source or
          converts vector geometry. Image Tuning is for image-local photographic work, while
          Adjustment Filters correct a scoped backdrop.
        </p>
      </div>
    </DisclosureSection>
  );
}
