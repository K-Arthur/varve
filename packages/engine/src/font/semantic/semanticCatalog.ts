import type { FontEntry } from '../../fontRegistry';
import { getFontRegistry } from '../../fontRegistry';
import type { ParsedFontMetadata } from '../fontIdentity';
import { getFontsourceCatalog } from '../fontsourceCatalog';
import {
  createFontSemanticProfile,
  mergeFontSemanticInput,
  semanticInputFromParsedFont,
  semanticRecordFromFontsource,
} from './semanticEnrichment';
import { searchFontSemanticRecords } from './semanticRanking';
import type {
  FontSearchResult,
  FontSemanticInput,
  FontSemanticQuery,
  FontSemanticRecord,
  FontSemanticSearchOptions,
  FontSemanticUserState,
} from './semanticTypes';

const USER_STATE_STORAGE_KEY = 'varve-font-semantic-user-v1';
const MAX_USER_TAGS = 32;
const MAX_TAG_LENGTH = 64;

type Listener = () => void;

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function readUserState(): Map<string, FontSemanticUserState> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(USER_STATE_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Partial<FontSemanticUserState>>;
    const result = new Map<string, FontSemanticUserState>();
    for (const [familyId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      result.set(familyId, {
        tags: normalizeTags(value.tags),
        projectTags: normalizeTags(value.projectTags),
        hiddenTagIds: Array.isArray(value.hiddenTagIds)
          ? value.hiddenTagIds.filter((id): id is string => typeof id === 'string').slice(0, 64)
          : [],
        overrides:
          value.overrides && typeof value.overrides === 'object'
            ? (Object.fromEntries(
                Object.entries(value.overrides)
                  .filter(([, decision]) => decision === 'show' || decision === 'hide')
                  .slice(0, 64),
              ) as FontSemanticUserState['overrides'])
            : {},
        isFavorite: value.isFavorite === true,
        ...(typeof value.recentlyUsedAt === 'number'
          ? { recentlyUsedAt: value.recentlyUsedAt }
          : {}),
      });
    }
    return result;
  } catch {
    return new Map();
  }
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [
    ...new Set(
      tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= MAX_TAG_LENGTH),
    ),
  ].slice(0, MAX_USER_TAGS);
}

function writeUserState(state: Map<string, FontSemanticUserState>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const serializable = Object.fromEntries(state.entries());
    localStorage.setItem(USER_STATE_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // Storage quota and privacy modes should never block font search.
  }
}

function registryInput(
  entry: FontEntry,
  registry: ReturnType<typeof getFontRegistry>,
): FontSemanticInput {
  const familyId = `local:${normalize(entry.family)}`;
  const source: FontSemanticInput['source'] =
    entry.source === 'google' || entry.source === 'fontsource' ? 'user' : entry.source;
  const assignments = [
    {
      tagId: 'source.installed',
      scope: 'artifact' as const,
      source: 'provider' as const,
      evidenceStrength: 'verified' as const,
      evidence: [
        { kind: 'provider' as const, label: `${entry.source} font registry`, value: entry.family },
      ],
      ontologyVersion: '1.0.0',
      overridable: false,
    },
  ];
  if (entry.source === 'bundled')
    assignments.push({
      ...assignments[0]!,
      tagId: 'source.open-source',
      evidence: [{ kind: 'provider', label: 'Bundled application font', value: entry.family }],
    });
  const profile = createFontSemanticProfile(
    familyId,
    assignments,
    {
      supportedWeightMin: entry.weight,
      supportedWeightMax: entry.weight,
    },
    { scope: 'family' },
  );
  const metadata = registry.getMetadata(entry.family);
  const parsedFeatures = metadata?.openTypeFeatures ?? [];
  return {
    familyId,
    familyName: entry.family,
    source,
    sourceKinds: [source],
    weights: [entry.weight],
    styles: [entry.style],
    variable: Boolean(entry.variableAxes || entry.axisDefinitions?.length),
    axes: (entry.axisDefinitions ?? []).map((axis) => ({ ...axis })),
    openTypeFeatures: parsedFeatures,
    installed: true,
    downloadable: false,
    profile,
  };
}

function sourcePriority(record: FontSemanticRecord): FontSemanticRecord['source'] {
  if (record.sourceKinds.includes('system')) return 'system';
  if (record.sourceKinds.includes('bundled')) return 'bundled';
  if (record.sourceKinds.includes('user')) return 'user';
  if (record.sourceKinds.includes('project')) return 'project';
  if (record.sourceKinds.includes('remote')) return 'remote';
  return 'downloadable';
}

/**
 * One reactive family-level semantic index. It combines the shipped provider
 * catalog with local registry faces while keeping user state separate.
 */
export class FontSemanticCatalog {
  private readonly records = new Map<string, FontSemanticRecord>();
  private readonly userState = readUserState();
  private readonly listeners = new Set<Listener>();
  private _revision = 0;

  constructor(
    options: {
      fontsource?: readonly import('../catalogSchema').FontsourceCatalogRecord[];
      registry?: ReturnType<typeof getFontRegistry>;
    } = {},
  ) {
    const fontsource = options.fontsource ?? getFontsourceCatalog().families();
    const registry = options.registry ?? getFontRegistry();
    for (const item of fontsource) this.upsertRecord(semanticRecordFromFontsource(item));
    this.syncRegistry(registry);
  }

  get revision(): number {
    return this._revision;
  }

  get size(): number {
    return this.records.size;
  }

  all(): FontSemanticRecord[] {
    return [...this.records.values()];
  }

  get(familyId: string): FontSemanticRecord | undefined {
    return this.records.get(familyId) ?? this.findByFamilyName(familyId);
  }

  findByFamilyName(familyName: string): FontSemanticRecord | undefined {
    const target = normalize(familyName);
    return [...this.records.values()].find((record) => normalize(record.familyName) === target);
  }

  search(
    query: string | FontSemanticQuery = '',
    options: FontSemanticSearchOptions = {},
  ): FontSearchResult[] {
    const records = this.all().map((record) => this.visibleRecord(record));
    const filtered = options.source?.length
      ? records.filter((record) => options.source!.includes(record.source))
      : records;
    const installed = options.installedOnly
      ? filtered.filter((record) => record.installed)
      : filtered;
    return searchFontSemanticRecords(installed, query, {
      limit: options.limit,
      strictness: options.strictness,
      diversity: options.diversity,
    });
  }

  upsertParsedFont(metadata: ParsedFontMetadata): FontSemanticRecord {
    const input = semanticInputFromParsedFont(metadata);
    const existing = this.records.get(input.familyId);
    const record = existing ? mergeFontSemanticInput(existing, input) : this.recordFromInput(input);
    this.records.set(input.familyId, this.applyUserState(record));
    this.notify();
    return this.records.get(input.familyId)!;
  }

  setUserTags(
    familyId: string,
    tags: readonly string[],
    projectTags: readonly string[] = [],
  ): void {
    const record = this.get(familyId);
    if (!record) return;
    const state = this.stateFor(record.familyId);
    state.tags = normalizeTags(tags);
    state.projectTags = normalizeTags(projectTags);
    this.userState.set(record.familyId, state);
    writeUserState(this.userState);
    this.records.set(record.familyId, this.applyUserState(record));
    this.notify();
  }

  addUserTag(familyId: string, tag: string): void {
    const record = this.get(familyId);
    if (
      !record ||
      typeof tag !== 'string' ||
      tag.trim().length === 0 ||
      tag.length > MAX_TAG_LENGTH
    )
      return;
    this.setUserTags(record.familyId, [...record.userTags, tag]);
  }

  removeUserTag(familyId: string, tag: string): void {
    const record = this.get(familyId);
    if (!record) return;
    this.setUserTags(
      record.familyId,
      record.userTags.filter((item) => item !== tag),
      record.projectTags,
    );
  }

  setTagOverride(familyId: string, tagId: string, decision: 'show' | 'hide'): void {
    const record = this.get(familyId);
    if (!record || !tagId || tagId.length > 128) return;
    const state = this.stateFor(record.familyId);
    state.overrides = { ...state.overrides, [tagId]: decision };
    state.hiddenTagIds = Object.entries(state.overrides)
      .filter(([, value]) => value === 'hide')
      .map(([id]) => id);
    this.userState.set(record.familyId, state);
    writeUserState(this.userState);
    this.records.set(record.familyId, this.applyUserState(record));
    this.notify();
  }

  setFavorite(familyId: string, favorite: boolean): void {
    const record = this.get(familyId);
    if (!record) return;
    const state = this.stateFor(record.familyId);
    state.isFavorite = favorite;
    this.userState.set(record.familyId, state);
    writeUserState(this.userState);
    this.records.set(record.familyId, this.applyUserState(record));
    this.notify();
  }

  markRecentlyUsed(familyId: string): void {
    const record = this.get(familyId);
    if (!record) return;
    const state = this.stateFor(record.familyId);
    state.recentlyUsedAt = Date.now();
    this.userState.set(record.familyId, state);
    writeUserState(this.userState);
    this.records.set(record.familyId, this.applyUserState(record));
    this.notify();
  }

  syncRegistry(registry: ReturnType<typeof getFontRegistry> = getFontRegistry()): void {
    for (const family of registry.families()) {
      for (const entry of registry.getEntries(family))
        this.upsertRegistryEntry(registryInput(entry, registry));
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Notify mounted consumers after an upstream registry/catalog revision. */
  notifyExternalChange(): void {
    this.notify();
  }

  private upsertRegistryEntry(input: FontSemanticInput): void {
    const existing = this.findByFamilyName(input.familyName);
    if (existing) {
      const merged = mergeFontSemanticInput(existing, input);
      merged.sourceKinds = [...new Set([...existing.sourceKinds, ...(input.sourceKinds ?? [])])];
      merged.source = sourcePriority(merged);
      merged.installed = true;
      this.records.set(existing.familyId, this.applyUserState(merged));
      return;
    }
    this.upsertRecord(this.recordFromInput(input));
  }

  private upsertRecord(record: FontSemanticRecord): void {
    const existing = this.records.get(record.familyId);
    this.records.set(
      record.familyId,
      this.applyUserState(
        existing ? mergeFontSemanticInput(existing, recordToInput(record)) : record,
      ),
    );
  }

  private recordFromInput(input: FontSemanticInput): FontSemanticRecord {
    const state = input.userState;
    return {
      familyId: input.familyId,
      familyName: input.familyName,
      aliases: [...(input.aliases ?? [])],
      profile: input.profile,
      faceProfiles: [...(input.faceProfiles ?? [])],
      source: input.source,
      sourceKinds: [...(input.sourceKinds ?? [input.source])],
      providerId: input.providerId,
      providerCategory: input.providerCategory,
      providerOrigin: input.providerOrigin,
      upstreamVersion: input.upstreamVersion,
      packageVersion: input.packageVersion,
      weights: [...(input.weights ?? [])],
      styles: [...(input.styles ?? [])],
      variable: input.variable ?? false,
      axes: [...(input.axes ?? [])],
      scripts: [...(input.scripts ?? [])],
      languages: [...(input.languages ?? [])],
      openTypeFeatures: [...(input.openTypeFeatures ?? [])],
      legacyCategory: input.legacyCategory,
      vendor: input.vendor,
      designer: input.designer,
      foundry: input.foundry,
      license: input.license,
      licenseUrl: input.licenseUrl,
      installed: input.installed ?? false,
      downloadable: input.downloadable ?? false,
      isFavorite: state?.isFavorite ?? false,
      recentlyUsedAt: state?.recentlyUsedAt,
      userTags: normalizeTags(state?.tags),
      projectTags: normalizeTags(state?.projectTags),
    };
  }

  private stateFor(familyId: string): FontSemanticUserState {
    return (
      this.userState.get(familyId) ?? {
        tags: [],
        projectTags: [],
        hiddenTagIds: [],
        overrides: {},
        isFavorite: false,
      }
    );
  }

  private applyUserState(record: FontSemanticRecord): FontSemanticRecord {
    const state = this.stateFor(record.familyId);
    return {
      ...record,
      userTags: [...state.tags],
      projectTags: [...state.projectTags],
      isFavorite: state.isFavorite,
      recentlyUsedAt: state.recentlyUsedAt,
    };
  }

  private visibleRecord(record: FontSemanticRecord): FontSemanticRecord {
    const state = this.stateFor(record.familyId);
    const hidden = new Set(state.hiddenTagIds);
    return hidden.size === 0
      ? record
      : {
          ...record,
          profile: {
            ...record.profile,
            assignments: record.profile.assignments.filter(
              (assignment) => !hidden.has(assignment.tagId),
            ),
          },
        };
  }

  private notify(): void {
    this._revision += 1;
    for (const listener of this.listeners) listener();
  }
}

function recordToInput(record: FontSemanticRecord): FontSemanticInput {
  return {
    ...record,
    profile: record.profile,
    faceProfiles: record.faceProfiles,
  };
}

let singleton: FontSemanticCatalog | undefined;
let unsubscribed: Array<() => void> = [];

export function getFontSemanticCatalog(): FontSemanticCatalog {
  if (singleton) return singleton;
  const catalog = new FontSemanticCatalog();
  const registry = getFontRegistry();
  const fontsource = getFontsourceCatalog();
  unsubscribed = [
    registry.subscribe(() => {
      catalog.syncRegistry(registry);
      catalog.notifyExternalChange();
    }),
    fontsource.subscribe(() => catalog.notifyExternalChange()),
  ];
  singleton = catalog;
  return catalog;
}

export function resetFontSemanticCatalog(): void {
  for (const unsubscribe of unsubscribed) unsubscribe();
  unsubscribed = [];
  singleton = undefined;
}
