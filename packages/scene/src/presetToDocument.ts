/**
 * Maps a shared, framework-agnostic Preset into scene's CreateDocumentOptions
 * / Document. This is the one place a Preset's plain-string colorProfileId
 * becomes a real ColorProfileRef — @strata/shared can't depend on
 * @strata/scene (scene depends on shared, not the reverse), so the preset
 * only carries an id; resolving it to an actual profile happens here.
 */
import type { Preset } from '@strata/shared';
import { CMYK_PROFILES, type ColorProfileRef, RGB_PROFILES, uniformBleed } from './colorManagement';
import { type CreateDocumentOptions, createDocument, type Document } from './document';

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

/** Create a Document from a Preset, additionally resolving any recommended
 *  color profile into the document's colorConfig. */
export function createDocumentFromPreset(preset: Preset, name?: string): Document {
  const doc = createDocument(name ?? preset.name, createDocumentOptionsFromPreset(preset));
  if (!preset.colorProfileId || !doc.colorConfig) return doc;
  const profile = resolveColorProfileRef(preset.colorProfileId);
  if (!profile) return doc;
  const profileKey = doc.colorConfig.mode === 'cmyk' ? 'cmykProfile' : 'rgbProfile';
  return { ...doc, colorConfig: { ...doc.colorConfig, [profileKey]: profile } };
}
