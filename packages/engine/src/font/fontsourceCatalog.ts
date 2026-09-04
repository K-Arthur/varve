import {
  type CatalogSearchOptions,
  type CatalogSearchResult,
  type FontArtifactDescriptor,
  type FontArtifactRequest,
  type FontsourceCatalogRecord,
  type FontsourceCatalogSnapshot,
  resolveFontsourceArtifact,
  searchFontsourceCatalog,
  validateFontsourceCatalogSnapshot,
} from './catalogSchema';
import rawCatalog from './fontsource-catalog.json';

export type {
  CatalogAxis,
  CatalogLicense,
  CatalogSearchOptions,
  CatalogSearchResult,
  FontArtifactDescriptor,
  FontArtifactRequest,
  FontsourceCatalogRecord,
  FontsourceCatalogSnapshot,
} from './catalogSchema';
export {
  FONT_CATALOG_SCHEMA_VERSION,
  FONTSOURCE_CDN_HOST,
  FONTSOURCE_CDN_ORIGIN,
  FONTSOURCE_PROVIDER_ID,
  licenseForId,
  normalizeFontsourceList,
  resolveFontsourceArtifact,
  searchFontsourceCatalog,
  validateFontsourceCatalogSnapshot,
} from './catalogSchema';

const BUILT_IN_SNAPSHOT = validateFontsourceCatalogSnapshot(
  rawCatalog,
) as FontsourceCatalogSnapshot;

type Listener = () => void;

/**
 * Reactive local catalog state. The snapshot is immutable; only installation
 * state changes at runtime. No network access is performed by this class.
 */
export class FontsourceCatalogStore {
  private readonly snapshot: FontsourceCatalogSnapshot;
  private readonly installed = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private _revision = 0;

  constructor(snapshot: FontsourceCatalogSnapshot = BUILT_IN_SNAPSHOT) {
    this.snapshot = validateFontsourceCatalogSnapshot(snapshot);
  }

  get revision(): number {
    return this._revision;
  }

  get metadata(): Omit<FontsourceCatalogSnapshot, 'families'> {
    const { families: _families, ...metadata } = this.snapshot;
    return metadata;
  }

  get size(): number {
    return this.snapshot.families.length;
  }

  families(): readonly FontsourceCatalogRecord[] {
    return this.snapshot.families;
  }

  get(familyId: string): FontsourceCatalogRecord | undefined {
    return this.snapshot.families.find((record) => record.familyId === familyId);
  }

  isInstalled(familyId: string): boolean {
    return this.installed.has(familyId);
  }

  setInstalled(familyId: string, installed: boolean): void {
    if (!this.get(familyId)) return;
    const changed = installed ? !this.installed.has(familyId) : this.installed.delete(familyId);
    if (!changed) return;
    if (installed) this.installed.add(familyId);
    this._revision += 1;
    for (const listener of this.listeners) listener();
  }

  search(options: CatalogSearchOptions = {}): CatalogSearchResult[] {
    return searchFontsourceCatalog(this.snapshot.families, options, this.installed);
  }

  resolve(request: FontArtifactRequest): FontArtifactDescriptor {
    const record = this.get(request.familyId);
    if (!record)
      throw new Error(`Fontsource family "${request.familyId}" is not in the local catalog`);
    return resolveFontsourceArtifact(record, request);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let singleton: FontsourceCatalogStore | undefined;

export function getFontsourceCatalog(): FontsourceCatalogStore {
  singleton ??= new FontsourceCatalogStore();
  return singleton;
}

/** Test seam and host reset hook; it never triggers a remote request. */
export function resetFontsourceCatalog(
  snapshot: FontsourceCatalogSnapshot = BUILT_IN_SNAPSHOT,
): void {
  singleton = new FontsourceCatalogStore(snapshot);
}
