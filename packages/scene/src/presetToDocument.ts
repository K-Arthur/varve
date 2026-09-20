/**
 * Maps a shared, framework-agnostic Preset into scene's CreateDocumentOptions
 * / Document. This is the one place a Preset's plain-string colorProfileId
 * becomes a real ColorProfileRef — @varve/shared can't depend on
 * @varve/scene (scene depends on shared, not the reverse), so the preset
 * only carries an id; resolving it to an actual profile happens here.
 */
import type { Preset } from '@varve/shared';
import { CMYK_PROFILES, type ColorProfileRef, RGB_PROFILES, uniformBleed } from './colorManagement';
import { applyComicWorkflowProfile } from './comicWorkflow';
import { type CreateDocumentOptions, createDocument, type Document } from './document';
import type { ComicWorkflowProfile } from './types';

/** Look up a built-in ICC profile by its plain string id (e.g. 'srgb',
 *  'fogra39'), searching both the RGB and CMYK registries. */
export function resolveColorProfileRef(profileId: string): ColorProfileRef | undefined {
  const allProfiles: ColorProfileRef[] = [
    ...Object.values(RGB_PROFILES),
    ...Object.values(CMYK_PROFILES),
  ];
  return allProfiles.find((profile) => profile.id === profileId);
}

/** Map a Preset's sizing/color/print fields into createDocument's options. */
export function createDocumentOptionsFromPreset(preset: Preset): CreateDocumentOptions {
  return {
    colorMode: preset.colorMode,
    physicalWidth: preset.width,
    physicalHeight: preset.height,
    documentUnit: preset.unit,
    bleed: preset.bleed ? uniformBleed(preset.bleed.value, preset.bleed.unit) : undefined,
    dpi: preset.dpi,
  };
}

/** Built-in comic page presets and the advisory workflow profile each implies. */
const PROFILE_BY_PRESET: Record<string, ComicWorkflowProfile> = {
  'comic-print-a4': 'comic-print',
  'manga-a5': 'manga',
  'webtoon-vertical': 'webtoon-vertical',
};

/**
 * The comic workflow profile a built-in page preset implies, or undefined for
 * ordinary presets. One mapping shared by the legacy createDocumentFromPreset
 * path and the canonical createNewDocument service so a document cannot get
 * the preset's dimensions without its production profile.
 */
export function comicProfileForPreset(
  presetId: string | undefined,
): ComicWorkflowProfile | undefined {
  return presetId ? PROFILE_BY_PRESET[presetId] : undefined;
}

/** Create a Document from a Preset, additionally resolving any recommended
 *  color profile into the document's colorConfig. */
export function createDocumentFromPreset(preset: Preset, name?: string): Document {
  let doc = createDocument(name ?? preset.name, createDocumentOptionsFromPreset(preset));
  const workflowProfile = comicProfileForPreset(preset.id);
  if (workflowProfile) doc = applyComicWorkflowProfile(doc, workflowProfile);
  if (preset.background === 'transparent' && doc.canvasBackground) {
    doc = { ...doc, canvasBackground: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 } };
  }
  if (!preset.colorProfileId || !doc.colorConfig) return doc;
  const profile = resolveColorProfileRef(preset.colorProfileId);
  if (!profile) return doc;
  const profileKey = doc.colorConfig.mode === 'cmyk' ? 'cmykProfile' : 'rgbProfile';
  return { ...doc, colorConfig: { ...doc.colorConfig, [profileKey]: profile } };
}
