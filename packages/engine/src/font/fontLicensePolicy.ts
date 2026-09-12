/**
 * License-aware policy engine for font operations.
 *
 * Evaluates font license metadata against requested operations (download,
 * install, embed, redistribute, modify, subset) and returns allow/deny
 * decisions with attribution requirements.
 *
 * Pre-configured for common open-source licenses (OFL, Apache, MIT) and
 * proprietary/desktop-only restrictions.
 *
 * Research basis: SIL OFL 1.1 FAQ, Apache License 2.1 Terms, OS/2 fsType
 * embedding bits (ISO/IEC 14496-22), Google Fonts embeddin g guidelines.
 */

import type {
  EmbeddingBaseRights,
  EmbeddingRights,
  FontEmbeddingPolicy,
  FontSourceKind,
  LicenseProvenance,
} from './fontIdentity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FontPermissions {
  commercial: boolean;
  modification: boolean;
  redistribution: boolean;
  desktopInstall: boolean;
  webEmbedding: boolean;
  documentEmbedding: boolean;
  printEmbedding: boolean;
  editableEmbedding: boolean;
}

export interface FontLicenseInfo {
  familyName: string;
  licenseName?: string;
  licenseUrl?: string;
  licenseText?: string;
  attribution?: string;
  embeddingRights: EmbeddingRights;
  /** OS/2 base permission and technical restrictions, kept separate. */
  embeddingPolicy?: FontEmbeddingPolicy;
  /** Explicit source-license provenance; unknown is never treated as a grant. */
  licenseProvenance?: LicenseProvenance;
  permissions: FontPermissions;
  source: FontSourceKind;
  sourceLocation?: string;
  version?: string;
}

export type FontOperation =
  | 'download'
  | 'install'
  | 'embed-document'
  | 'embed-web'
  | 'redistribute'
  | 'modify'
  | 'subset';

export interface PolicyDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason: string;
  attribution?: string;
}

// ---------------------------------------------------------------------------
// Known licenses
// ---------------------------------------------------------------------------

export const KNOWN_LICENSES: Map<string, FontLicenseInfo> = new Map([
  [
    'OFL-1.1',
    {
      familyName: '',
      licenseName: 'SIL Open Font License 1.1',
      licenseUrl: 'https://scripts.sil.org/OFL',
      attribution: 'This font is licensed under the SIL Open Font License 1.1.',
      embeddingRights: 'installable',
      permissions: {
        commercial: true,
        modification: true,
        redistribution: true,
        desktopInstall: true,
        webEmbedding: true,
        documentEmbedding: true,
        printEmbedding: true,
        editableEmbedding: true,
      },
      source: 'bundled',
    },
  ],
  [
    'Apache-2.0',
    {
      familyName: '',
      licenseName: 'Apache License 2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
      attribution:
        'This font is licensed under the Apache License 2.0. A copy of the license must be included with redistributions.',
      embeddingRights: 'installable',
      permissions: {
        commercial: true,
        modification: true,
        redistribution: true,
        desktopInstall: true,
        webEmbedding: true,
        documentEmbedding: true,
        printEmbedding: true,
        editableEmbedding: true,
      },
      source: 'bundled',
    },
  ],
  [
    'MIT',
    {
      familyName: '',
      licenseName: 'MIT License',
      licenseUrl: 'https://opensource.org/licenses/MIT',
      attribution: 'This font is licensed under the MIT License.',
      embeddingRights: 'installable',
      permissions: {
        commercial: true,
        modification: true,
        redistribution: true,
        desktopInstall: true,
        webEmbedding: true,
        documentEmbedding: true,
        printEmbedding: true,
        editableEmbedding: true,
      },
      source: 'bundled',
    },
  ],
  [
    'Proprietary',
    {
      familyName: '',
      licenseName: 'Proprietary',
      embeddingRights: 'restricted',
      permissions: {
        commercial: false,
        modification: false,
        redistribution: false,
        desktopInstall: true,
        webEmbedding: false,
        documentEmbedding: false,
        printEmbedding: false,
        editableEmbedding: false,
      },
      source: 'user',
    },
  ],
  [
    'Desktop-Only',
    {
      familyName: '',
      licenseName: 'Desktop-Only',
      embeddingRights: 'preview-and-print',
      permissions: {
        commercial: true,
        modification: false,
        redistribution: false,
        desktopInstall: true,
        webEmbedding: false,
        documentEmbedding: false,
        printEmbedding: true,
        editableEmbedding: false,
      },
      source: 'user',
    },
  ],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive partial permissions from OS/2 embedding-rights tags. */
export function getLicenseFromEmbeddingRights(rights: EmbeddingRights): Partial<FontPermissions> {
  return getLicenseFromEmbeddingPolicy(embeddingPolicyFromRights(rights));
}

/** Convert the legacy single rights tag into the additive policy model. */
export function embeddingPolicyFromRights(rights: EmbeddingRights): FontEmbeddingPolicy {
  if (rights === 'no-subsetting') {
    return {
      baseRights: 'installable',
      noSubsetting: true,
      bitmapOnly: false,
      source: 'os2',
    };
  }
  return {
    baseRights: rights as EmbeddingBaseRights,
    noSubsetting: false,
    bitmapOnly: false,
    source: rights === 'unknown' ? 'unknown' : 'os2',
  };
}

/** Derive technical embedding permissions without turning flags into a license. */
export function getLicenseFromEmbeddingPolicy(
  policy: FontEmbeddingPolicy,
): Partial<FontPermissions> {
  const permissions = getBaseEmbeddingPermissions(policy.baseRights);
  if (policy.bitmapOnly) {
    permissions.documentEmbedding = false;
    permissions.webEmbedding = false;
    permissions.editableEmbedding = false;
  }
  return permissions;
}

function getBaseEmbeddingPermissions(rights: EmbeddingBaseRights): Partial<FontPermissions> {
  switch (rights) {
    case 'installable':
      return {
        desktopInstall: true,
        documentEmbedding: true,
        webEmbedding: true,
        printEmbedding: true,
        editableEmbedding: true,
      };
    case 'preview-and-print':
      return {
        desktopInstall: true,
        documentEmbedding: false,
        webEmbedding: false,
        printEmbedding: true,
        editableEmbedding: false,
      };
    case 'editable':
      return {
        desktopInstall: true,
        documentEmbedding: true,
        webEmbedding: false,
        printEmbedding: true,
        editableEmbedding: true,
      };
    case 'restricted':
      return {
        desktopInstall: true,
        documentEmbedding: false,
        webEmbedding: false,
        printEmbedding: false,
        editableEmbedding: false,
      };
    case 'unknown':
      return {
        desktopInstall: false,
        documentEmbedding: false,
        webEmbedding: false,
        printEmbedding: false,
        editableEmbedding: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Policy class
// ---------------------------------------------------------------------------

/** Maps operation names to the permission key that gates them. */
const OPERATION_TO_PERMISSION: Record<FontOperation, keyof FontPermissions> = {
  install: 'desktopInstall',
  'embed-document': 'documentEmbedding',
  'embed-web': 'webEmbedding',
  redistribute: 'redistribution',
  modify: 'modification',
  subset: 'modification',
  download: 'commercial',
};

function decide(font: FontLicenseInfo, operation: FontOperation): PolicyDecision {
  const permissions = font.permissions;
  const embeddingPolicy = font.embeddingPolicy ?? embeddingPolicyFromRights(font.embeddingRights);

  if (font.licenseProvenance === 'unknown' && operation !== 'install') {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: `Operation "${operation}" cannot be offered until this font's license provenance is verified.`,
    };
  }

  if (operation === 'subset' && embeddingPolicy.noSubsetting) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: 'This font declares No Subsetting in OS/2 fsType; preserve the original bytes.',
    };
  }

  if (
    embeddingPolicy.bitmapOnly &&
    (operation === 'embed-document' || operation === 'embed-web' || operation === 'modify')
  ) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: 'This font declares Bitmap Embedding Only; use an explicit raster fallback.',
    };
  }

  const key = OPERATION_TO_PERMISSION[operation];
  const allowed = permissions[key];

  if (!allowed) {
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: `Operation "${operation}" is not permitted by this font's license.`,
    };
  }

  // Attribution is only required when there is an attribution string present
  // (OFL, Apache, etc.). If the license includes attribution, surface it.
  if (font.attribution) {
    return {
      allowed: true,
      requiresConfirmation: true,
      reason: `Operation "${operation}" is allowed but attribution is required.`,
      attribution: font.attribution,
    };
  }

  return {
    allowed: true,
    requiresConfirmation: false,
    reason: `Operation "${operation}" is permitted by this font's license.`,
  };
}

// ---------------------------------------------------------------------------
// FontLicensePolicy
// ---------------------------------------------------------------------------

export class FontLicensePolicy {
  private licenses = new Map<string, FontLicenseInfo>();

  /** Evaluate whether a font operation is allowed. */
  evaluate(font: FontLicenseInfo, operation: FontOperation): PolicyDecision {
    return decide(font, operation);
  }

  /** Register a license for a font ID (typically the content hash). */
  registerLicense(fontId: string, license: FontLicenseInfo): void {
    this.licenses.set(fontId, license);
  }

  /** Retrieve the registered license for a font ID. */
  getLicense(fontId: string): FontLicenseInfo | undefined {
    return this.licenses.get(fontId);
  }

  /** Return the required attribution string, or null if none. */
  getRequiredAttribution(fontId: string): string | null {
    const info = this.licenses.get(fontId);
    if (!info?.attribution) return null;
    return info.attribution;
  }

  /** Shorthand: can this font be embedded in a document? */
  canEmbedInDocument(fontId: string): boolean {
    const info = this.licenses.get(fontId);
    if (!info) return false;
    return info.permissions.documentEmbedding;
  }

  /** Shorthand: can this font be redistributed? */
  canRedistribute(fontId: string): boolean {
    const info = this.licenses.get(fontId);
    if (!info) return false;
    return info.permissions.redistribution;
  }

  /** Shorthand: can this font be subsetted? */
  canSubset(fontId: string): boolean {
    const info = this.licenses.get(fontId);
    if (!info) return false;
    return this.evaluate(info, 'subset').allowed;
  }
}
