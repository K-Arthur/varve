import { addChild, createDocument, DEFAULT_EMAIL_PROFILE, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { getEmailCompilation } from './emailCompilation';

function makeEmailDocument() {
  const initial = createDocument('Compiler cache');
  const rootId = initial.pages?.[0]?.contentRoot;
  if (!rootId) throw new Error('The email fixture needs a page root.');
  const withCopy = addChild(initial, rootId, makeTextNode('email-copy', 'Hello {{firstName}}'));
  return {
    ...withCopy,
    emailProfile: DEFAULT_EMAIL_PROFILE,
    emailSemantics: {
      nodes: {},
      nodeLinks: {},
      textRangeLinks: {},
      variables: [
        { id: 'first-name', name: 'firstName', type: 'text' as const, sampleValue: 'Avery' },
      ],
      customHtmlBlocks: {},
      assets: {},
      diagnostics: [],
    },
  };
}

describe('Email compiler snapshot sharing', () => {
  it('shares canonical output and isolates sample substitutions for preview', () => {
    const document = makeEmailDocument();
    const authoring = getEmailCompilation(document);
    const output = getEmailCompilation(document);
    const preview = getEmailCompilation(document, { previewVariables: true });

    expect(authoring).not.toBeNull();
    expect(output).toBe(authoring);
    expect(preview).not.toBe(authoring);
    expect(authoring?.output.html).toContain('{{firstName}}');
    expect(authoring?.output.html).not.toContain('Avery');
    expect(preview?.output.html).toContain('Avery');
  });

  it('does not compile an ordinary document unless a caller needs compatibility analysis', () => {
    const document = createDocument('Normal design');
    expect(getEmailCompilation(document)).toBeNull();
    expect(getEmailCompilation(document, { allowUnprofiled: true })).not.toBeNull();
  });
});
