/**
 * Icon licensing model — types and helpers for icon licence management.
 */

export type IconLicenceType =
  | 'apache-2.0'
  | 'mit'
  | 'bsd-2'
  | 'bsd-3'
  | 'cc0'
  | 'cc-by-4.0'
  | 'cc-by-sa-4.0'
  | 'cc-by-nc-4.0'
  | 'ofl-1.1'
  | 'proprietary'
  | 'unknown';

export interface IconLicence {
  spdxId: IconLicenceType;
  name: string;
  url: string;
  commercialUse: boolean;
  modification: boolean;
  redistribution: boolean;
  attributionRequired: boolean;
  attributionText: string;
  sourceUrl?: string;
  brandRestrictions?: string;
}

export interface IconAttributionEntry {
  iconName: string;
  provider: string;
  pack?: string;
  licence: IconLicence;
  sourceUrl?: string;
}

export const ICON_LICENCES: Record<IconLicenceType, IconLicence> = {
  'apache-2.0': {
    spdxId: 'apache-2.0',
    name: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under the Apache License 2.0',
  },
  mit: {
    spdxId: 'mit',
    name: 'MIT License',
    url: 'https://opensource.org/licenses/MIT',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under the MIT License',
  },
  'bsd-2': {
    spdxId: 'bsd-2',
    name: 'BSD 2-Clause License',
    url: 'https://opensource.org/licenses/BSD-2-Clause',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under the BSD 2-Clause License',
  },
  'bsd-3': {
    spdxId: 'bsd-3',
    name: 'BSD 3-Clause License',
    url: 'https://opensource.org/licenses/BSD-3-Clause',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under the BSD 3-Clause License',
  },
  cc0: {
    spdxId: 'cc0',
    name: 'CC0 1.0 Universal',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: false,
    attributionText: '',
  },
  'cc-by-4.0': {
    spdxId: 'cc-by-4.0',
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under CC BY 4.0',
  },
  'cc-by-sa-4.0': {
    spdxId: 'cc-by-sa-4.0',
    name: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under CC BY-SA 4.0',
  },
  'cc-by-nc-4.0': {
    spdxId: 'cc-by-nc-4.0',
    name: 'CC BY-NC 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    commercialUse: false,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under CC BY-NC 4.0',
  },
  'ofl-1.1': {
    spdxId: 'ofl-1.1',
    name: 'SIL Open Font License 1.1',
    url: 'https://scripts.sil.org/OFL',
    commercialUse: true,
    modification: true,
    redistribution: true,
    attributionRequired: true,
    attributionText: 'Licensed under the SIL Open Font License 1.1',
  },
  proprietary: {
    spdxId: 'proprietary',
    name: 'Proprietary',
    url: '',
    commercialUse: false,
    modification: false,
    redistribution: false,
    attributionRequired: true,
    attributionText: 'Proprietary licence',
    brandRestrictions: 'Subject to provider terms',
  },
  unknown: {
    spdxId: 'unknown',
    name: 'Unknown Licence',
    url: '',
    commercialUse: false,
    modification: false,
    redistribution: false,
    attributionRequired: false,
    attributionText: '',
  },
};

export function parseIconLicence(raw: string | undefined): IconLicence {
  if (!raw || raw.trim().length === 0) {
    return ICON_LICENCES.unknown;
  }
  const normalised = raw.toLowerCase().trim().replace(/\s+/g, '-');

  if (normalised.includes('apache') && normalised.includes('2')) {
    return ICON_LICENCES['apache-2.0'];
  }
  if (normalised === 'mit') {
    return ICON_LICENCES.mit;
  }
  if (normalised.includes('bsd') && normalised.includes('3')) {
    return ICON_LICENCES['bsd-3'];
  }
  if (normalised.includes('bsd') && normalised.includes('2')) {
    return ICON_LICENCES['bsd-2'];
  }
  if (normalised.includes('cc0') || normalised.includes('public-domain')) {
    return ICON_LICENCES.cc0;
  }
  if (normalised.includes('cc-by-sa')) {
    return ICON_LICENCES['cc-by-sa-4.0'];
  }
  if (normalised.includes('cc-by-nc')) {
    return ICON_LICENCES['cc-by-nc-4.0'];
  }
  if (normalised.includes('cc-by') || normalised.includes('cc-by-4')) {
    return ICON_LICENCES['cc-by-4.0'];
  }
  if (normalised.includes('ofl') || normalised.includes('sil-open-font')) {
    return ICON_LICENCES['ofl-1.1'];
  }

  return ICON_LICENCES.unknown;
}

export function generateAttributionReport(icons: IconAttributionEntry[]): string {
  const grouped = new Map<string, { licence: IconLicence; icons: IconAttributionEntry[] }>();

  for (const icon of icons) {
    const key = icon.licence.spdxId;
    if (!grouped.has(key)) {
      grouped.set(key, { licence: icon.licence, icons: [] });
    }
    grouped.get(key)!.icons.push(icon);
  }

  const lines: string[] = ['Icon Attribution Report', '======================\n'];

  for (const [spdxId, entry] of grouped) {
    lines.push(`## ${entry.licence.name} (${spdxId})`);
    lines.push(`URL: ${entry.licence.url}`);
    if (!entry.licence.commercialUse) {
      lines.push('NOTE: Commercial use is NOT permitted.');
    }
    lines.push('');
    for (const icon of entry.icons) {
      lines.push(
        `  - "${icon.iconName}" from ${icon.provider}${icon.pack ? ` (${icon.pack})` : ''}`,
      );
      if (icon.sourceUrl) {
        lines.push(`    Source: ${icon.sourceUrl}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function canUseCommercially(icons: IconAttributionEntry[]): {
  allowed: boolean;
  blocked: IconAttributionEntry[];
} {
  const blocked = icons.filter((icon) => !icon.licence.commercialUse);
  return { allowed: blocked.length === 0, blocked };
}
