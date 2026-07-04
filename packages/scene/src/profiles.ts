export interface BundledProfile {
  id: string;
  name: string;
  embedded: boolean;
}

const RGB_PROFILES: BundledProfile[] = [
  { id: 'srgb', name: 'sRGB IEC61966-2.1', embedded: true },
  { id: 'display-p3', name: 'Display P3', embedded: true },
  { id: 'adobe-rgb', name: 'Adobe RGB (1998)', embedded: true },
  { id: 'pro-photo', name: 'ProPhoto RGB', embedded: true },
  { id: 'rec2020', name: 'ITU-R BT.2020', embedded: false },
  { id: 'aci', name: 'SMPTE ACES AP0', embedded: false },
];

const CMYK_PROFILES: BundledProfile[] = [
  { id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)', embedded: true },
  { id: 'fogra51', name: 'Fogra51 (PSO Coated v3)', embedded: true },
  { id: 'gracol2006', name: 'GRACoL 2006', embedded: true },
  { id: 'swop-coated', name: 'SWOP Coated v2', embedded: true },
  { id: 'swop-uncoated', name: 'SWOP Uncoated v2', embedded: false },
  { id: 'japan-color-2011', name: 'Japan Color 2011 Coated', embedded: false },
];

export const BUNDLED_RGB_PROFILES: readonly BundledProfile[] = RGB_PROFILES;
export const BUNDLED_CMYK_PROFILES: readonly BundledProfile[] = CMYK_PROFILES;

export function getProfileById(id: string): BundledProfile | undefined {
  return RGB_PROFILES.find((p) => p.id === id) ?? CMYK_PROFILES.find((p) => p.id === id);
}
