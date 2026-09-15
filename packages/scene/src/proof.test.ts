import { describe, expect, it } from 'vitest';
import type { Document } from './document';
import { defaultProofConfig, setDocumentProofConfig, validateProofConfig } from './proof';

function makeDoc(): Document {
  return {
    id: 'd1',
    name: 't',
    formatVersion: '2.14',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
  };
}

describe('defaultProofConfig', () => {
  it('uses a print-condition default with warnings off', () => {
    const config = defaultProofConfig();
    expect(config.profileId).toBe('fogra39');
    expect(config.renderingIntent).toBe('relative');
    expect(config.blackPointCompensation).toBe(true);
    expect(config.gamutWarning.enabled).toBe(false);
    expect(config.gamutWarning.opacity).toBeGreaterThan(0);
  });
});

describe('validateProofConfig', () => {
  it('accepts a default config', () => {
    expect(validateProofConfig(defaultProofConfig())).toEqual([]);
  });

  it('rejects missing profile and invalid intent', () => {
    const config = { ...defaultProofConfig(), profileId: '' };
    expect(validateProofConfig(config)).toContain('proof profile id is required');
    const bad = { ...defaultProofConfig(), renderingIntent: 'silly' as never };
    expect(validateProofConfig(bad)).toContain('invalid proof rendering intent');
  });

  it('rejects out-of-range warning opacity', () => {
    const config = {
      ...defaultProofConfig(),
      gamutWarning: { enabled: true, opacity: 1.5 },
    };
    expect(validateProofConfig(config)).toContain('gamut warning opacity must be in [0, 1]');
  });
});

describe('setDocumentProofConfig', () => {
  it('stores the config without touching colors and never mutates the source', () => {
    const doc = makeDoc();
    const config = defaultProofConfig();
    const out = setDocumentProofConfig(doc, config);
    expect(out.proofConfig).toBe(config);
    expect(doc.proofConfig).toBeUndefined();
  });
});
