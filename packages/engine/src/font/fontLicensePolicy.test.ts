import { describe, it, expect } from 'vitest';
import {
  FontLicensePolicy,
  KNOWN_LICENSES,
  getLicenseFromEmbeddingRights,
} from './fontLicensePolicy';
import type { FontLicenseInfo } from './fontLicensePolicy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOflLicense(overrides: Partial<FontLicenseInfo> = {}): FontLicenseInfo {
  return {
    familyName: 'Test Font',
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
    ...overrides,
  };
}

function makeProprietaryLicense(): FontLicenseInfo {
  return {
    familyName: 'Proprietary Font',
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
  };
}

function makeDesktopOnlyLicense(): FontLicenseInfo {
  return {
    familyName: 'Desktop Font',
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FontLicensePolicy', () => {
  describe('evaluate', () => {
    const policy = new FontLicensePolicy();

    it('OFL allows all operations', () => {
      const ofl = makeOflLicense();
      const ops: Array<import('./fontLicensePolicy').FontOperation> = [
        'download',
        'install',
        'embed-document',
        'embed-web',
        'redistribute',
        'modify',
        'subset',
      ];

      for (const op of ops) {
        const result = policy.evaluate(ofl, op);
        expect(result.allowed, `Expected "${op}" to be allowed`).toBe(true);
      }
    });

    it('Proprietary blocks embedding and redistribution', () => {
      const prop = makeProprietaryLicense();

      expect(policy.evaluate(prop, 'embed-document').allowed).toBe(false);
      expect(policy.evaluate(prop, 'embed-web').allowed).toBe(false);
      expect(policy.evaluate(prop, 'redistribute').allowed).toBe(false);
      expect(policy.evaluate(prop, 'modify').allowed).toBe(false);
    });

    it('Proprietary allows install', () => {
      const prop = makeProprietaryLicense();
      expect(policy.evaluate(prop, 'install').allowed).toBe(true);
    });

    it('Desktop-Only blocks redistribution and web embedding', () => {
      const desktop = makeDesktopOnlyLicense();

      expect(policy.evaluate(desktop, 'redistribute').allowed).toBe(false);
      expect(policy.evaluate(desktop, 'embed-web').allowed).toBe(false);
      expect(policy.evaluate(desktop, 'modify').allowed).toBe(false);
    });

    it('Desktop-Only allows install and print', () => {
      const desktop = makeDesktopOnlyLicense();

      expect(policy.evaluate(desktop, 'install').allowed).toBe(true);
      expect(policy.evaluate(desktop, 'embed-document').allowed).toBe(false);
    });

    it('requiresConfirmation when attribution is present', () => {
      const ofl = makeOflLicense();
      const result = policy.evaluate(ofl, 'redistribute');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.attribution).toBe('This font is licensed under the SIL Open Font License 1.1.');
    });

    it('does not requireConfirmation when no attribution', () => {
      const noAttr = makeOflLicense({ attribution: undefined });
      const result = policy.evaluate(noAttr, 'redistribute');
      expect(result.requiresConfirmation).toBe(false);
      expect(result.attribution).toBeUndefined();
    });
  });

  describe('registerLicense / getLicense', () => {
    const policy = new FontLicensePolicy();
    const license = makeOflLicense({ familyName: 'My Font' });

    it('registers and retrieves a license', () => {
      policy.registerLicense('hash-123', license);
      expect(policy.getLicense('hash-123')).toBe(license);
    });

    it('returns undefined for unknown font ID', () => {
      expect(policy.getLicense('unknown-id')).toBeUndefined();
    });

    it('overwrites existing license on re-register', () => {
      const updated = makeOflLicense({ familyName: 'Updated Font' });
      policy.registerLicense('hash-123', updated);
      expect(policy.getLicense('hash-123')?.familyName).toBe('Updated Font');
    });
  });

  describe('getRequiredAttribution', () => {
    const policy = new FontLicensePolicy();

    it('returns attribution when present', () => {
      policy.registerLicense('f1', makeOflLicense());
      expect(policy.getRequiredAttribution('f1')).toBe(
        'This font is licensed under the SIL Open Font License 1.1.',
      );
    });

    it('returns null when no attribution', () => {
      policy.registerLicense('f2', makeProprietaryLicense());
      expect(policy.getRequiredAttribution('f2')).toBeNull();
    });

    it('returns null for unknown font', () => {
      expect(policy.getRequiredAttribution('no-such-id')).toBeNull();
    });
  });

  describe('canEmbedInDocument / canRedistribute / canSubset', () => {
    const policy = new FontLicensePolicy();

    policy.registerLicense('ofl', makeOflLicense());
    policy.registerLicense('prop', makeProprietaryLicense());
    policy.registerLicense('desk', makeDesktopOnlyLicense());

    it('canEmbedInDocument', () => {
      expect(policy.canEmbedInDocument('ofl')).toBe(true);
      expect(policy.canEmbedInDocument('prop')).toBe(false);
      expect(policy.canEmbedInDocument('desk')).toBe(false);
      expect(policy.canEmbedInDocument('missing')).toBe(false);
    });

    it('canRedistribute', () => {
      expect(policy.canRedistribute('ofl')).toBe(true);
      expect(policy.canRedistribute('prop')).toBe(false);
      expect(policy.canRedistribute('desk')).toBe(false);
      expect(policy.canRedistribute('missing')).toBe(false);
    });

    it('canSubset', () => {
      expect(policy.canSubset('ofl')).toBe(true);
      expect(policy.canSubset('prop')).toBe(false);
      expect(policy.canSubset('desk')).toBe(false);
      expect(policy.canSubset('missing')).toBe(false);
    });
  });
});

describe('KNOWN_LICENSES', () => {
  it('contains OFL-1.1 with full permissions', () => {
    const ofl = KNOWN_LICENSES.get('OFL-1.1');
    expect(ofl).toBeDefined();
    expect(ofl!.permissions.documentEmbedding).toBe(true);
    expect(ofl!.permissions.redistribution).toBe(true);
    expect(ofl!.attribution).toBeTruthy();
  });

  it('contains Apache-2.0 with full permissions', () => {
    const apache = KNOWN_LICENSES.get('Apache-2.0');
    expect(apache).toBeDefined();
    expect(apache!.permissions.commercial).toBe(true);
    expect(apache!.permissions.webEmbedding).toBe(true);
  });

  it('contains MIT with full permissions', () => {
    const mit = KNOWN_LICENSES.get('MIT');
    expect(mit).toBeDefined();
    expect(mit!.permissions.editableEmbedding).toBe(true);
  });

  it('Proprietary blocks all embedding', () => {
    const prop = KNOWN_LICENSES.get('Proprietary');
    expect(prop).toBeDefined();
    expect(prop!.permissions.documentEmbedding).toBe(false);
    expect(prop!.permissions.webEmbedding).toBe(false);
    expect(prop!.permissions.redistribution).toBe(false);
  });

  it('Desktop-Only blocks web and document embedding', () => {
    const desk = KNOWN_LICENSES.get('Desktop-Only');
    expect(desk).toBeDefined();
    expect(desk!.permissions.webEmbedding).toBe(false);
    expect(desk!.permissions.documentEmbedding).toBe(false);
    expect(desk!.permissions.printEmbedding).toBe(true);
  });
});

describe('getLicenseFromEmbeddingRights', () => {
  it('installable permits all embedding', () => {
    const p = getLicenseFromEmbeddingRights('installable');
    expect(p.documentEmbedding).toBe(true);
    expect(p.webEmbedding).toBe(true);
    expect(p.printEmbedding).toBe(true);
    expect(p.editableEmbedding).toBe(true);
  });

  it('restricted permits only desktop install', () => {
    const p = getLicenseFromEmbeddingRights('restricted');
    expect(p.desktopInstall).toBe(true);
    expect(p.documentEmbedding).toBe(false);
    expect(p.webEmbedding).toBe(false);
    expect(p.printEmbedding).toBe(false);
    expect(p.editableEmbedding).toBe(false);
  });

  it('preview-and-print permits print but not document', () => {
    const p = getLicenseFromEmbeddingRights('preview-and-print');
    expect(p.printEmbedding).toBe(true);
    expect(p.documentEmbedding).toBe(false);
    expect(p.editableEmbedding).toBe(false);
  });

  it('editable permits document and editable but not web', () => {
    const p = getLicenseFromEmbeddingRights('editable');
    expect(p.documentEmbedding).toBe(true);
    expect(p.editableEmbedding).toBe(true);
    expect(p.webEmbedding).toBe(false);
  });

  it('unknown returns all false', () => {
    const p = getLicenseFromEmbeddingRights('unknown');
    expect(p.desktopInstall).toBe(false);
    expect(p.documentEmbedding).toBe(false);
    expect(p.webEmbedding).toBe(false);
  });

  it('no-subsetting permits all embedding', () => {
    const p = getLicenseFromEmbeddingRights('no-subsetting');
    expect(p.documentEmbedding).toBe(true);
    expect(p.webEmbedding).toBe(true);
    expect(p.editableEmbedding).toBe(true);
  });
});
