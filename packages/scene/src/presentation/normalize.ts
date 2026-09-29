import {
  PRESENTATION_SCHEMA_VERSION,
  type PresentationDeck,
  type PresentationLayoutSource,
  type PresentationMetadata,
  type PresentationSection,
  type PresentationSlideEntry,
  type PresentationSlideLayoutBinding,
  type PresentationTheme,
} from './types';

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringMap(value: unknown): Record<string, string> {
  const raw = asRecord(value);
  if (!raw) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function baselineMap(value: unknown): Record<string, Record<string, unknown>> | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  return Object.fromEntries(
    Object.entries(raw).flatMap(([nodeId, properties]) => {
      const record = asRecord(properties);
      return record ? [[nodeId, record]] : [];
    }),
  );
}

function normalizeBinding(value: unknown): PresentationSlideLayoutBinding | undefined {
  const raw = asRecord(value);
  if (!raw || typeof raw.sourceId !== 'string' || typeof raw.sourceFrameId !== 'string') {
    return undefined;
  }
  const appliedRevision =
    typeof raw.appliedRevision === 'number' && Number.isInteger(raw.appliedRevision)
      ? Math.max(0, raw.appliedRevision)
      : 0;
  return {
    sourceId: raw.sourceId,
    sourceFrameId: raw.sourceFrameId,
    appliedRevision,
    roleNodes: stringMap(raw.roleNodes),
    ...(baselineMap(raw.managedBaseline)
      ? { managedBaseline: baselineMap(raw.managedBaseline) }
      : {}),
  };
}

function normalizeSlide(value: unknown, index: number): PresentationSlideEntry | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const id = asString(raw.id);
  if (!id) return null;
  // An absent target is represented by a stable, deliberately unresolved id.
  // Keeping this entry retains its notes and ordering for user recovery.
  const frameId = asString(raw.frameId, `missing-frame:${id}`);
  const title = asString(raw.title, `Slide ${index + 1}`);
  const readingOrder = Array.isArray(raw.readingOrder)
    ? raw.readingOrder.filter((id): id is string => typeof id === 'string')
    : undefined;
  const layoutBinding = normalizeBinding(raw.layoutBinding);
  return {
    id,
    frameId,
    title,
    ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
    ...(typeof raw.skipped === 'boolean' ? { skipped: raw.skipped } : {}),
    ...(typeof raw.sectionId === 'string' ? { sectionId: raw.sectionId } : {}),
    ...(layoutBinding ? { layoutBinding } : {}),
    ...(typeof raw.themeId === 'string' ? { themeId: raw.themeId } : {}),
    ...(typeof raw.language === 'string' ? { language: raw.language } : {}),
    ...(typeof raw.altText === 'string' ? { altText: raw.altText } : {}),
    ...(readingOrder ? { readingOrder } : {}),
  };
}

function normalizeSection(value: unknown): PresentationSection | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return { id: raw.id, title: asString(raw.title, 'Untitled section') };
}

function normalizeDeck(value: unknown): PresentationDeck | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const slides = Array.isArray(raw.slides)
    ? raw.slides.flatMap((slide, index) => {
        const normalized = normalizeSlide(slide, index);
        return normalized ? [normalized] : [];
      })
    : [];
  const sections = Array.isArray(raw.sections)
    ? raw.sections.flatMap((section) => {
        const normalized = normalizeSection(section);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id: raw.id,
    name: asString(raw.name, 'Untitled presentation'),
    width: asPositiveNumber(raw.width, 1920),
    height: asPositiveNumber(raw.height, 1080),
    slides,
    sections,
    ...(typeof raw.themeId === 'string' ? { themeId: raw.themeId } : {}),
  };
}

function normalizeLayout(value: unknown): PresentationLayoutSource | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.frameId !== 'string') return null;
  return {
    id: raw.id,
    name: asString(raw.name, 'Untitled layout'),
    frameId: raw.frameId,
    revision:
      typeof raw.revision === 'number' && Number.isInteger(raw.revision)
        ? Math.max(1, raw.revision)
        : 1,
    roleNodes: stringMap(raw.roleNodes),
    ...(baselineMap(raw.geometrySnapshot)
      ? { geometrySnapshot: baselineMap(raw.geometrySnapshot) }
      : {}),
  };
}

function normalizeTheme(value: unknown): PresentationTheme | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    name: asString(raw.name, 'Untitled theme'),
    colorVariables: stringMap(raw.colorVariables),
    textStyles: stringMap(raw.textStyles),
  };
}

/**
 * Validate and normalize persisted presentation metadata without requiring
 * referenced frames to exist. Broken references and their notes are retained.
 */
export function normalizePresentationMetadata(value: unknown): PresentationMetadata | undefined {
  const raw = asRecord(value);
  if (!raw || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)) return undefined;
  if (!Array.isArray(raw.decks)) return undefined;
  const decks = raw.decks.flatMap((deck) => {
    const normalized = normalizeDeck(deck);
    return normalized ? [normalized] : [];
  });
  const layouts = Array.isArray(raw.layouts)
    ? raw.layouts.flatMap((layout) => {
        const normalized = normalizeLayout(layout);
        return normalized ? [normalized] : [];
      })
    : [];
  const themes = Array.isArray(raw.themes)
    ? raw.themes.flatMap((theme) => {
        const normalized = normalizeTheme(theme);
        return normalized ? [normalized] : [];
      })
    : [];
  return { schemaVersion: PRESENTATION_SCHEMA_VERSION, decks, layouts, themes };
}
