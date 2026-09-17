/**
 * Registry-mode DisclosureSection contract.
 *
 * - Top-level registry sections take their default expansion from the section
 *   registry; a call-site `defaultExpanded` must not silently disagree with
 *   the section manager's "Restore defaults".
 * - Subsections have no registry entry, so their call-site default (or a
 *   stored preference) decides. This was previously ignored: the Variable Font
 *   Axes subsection asked to be collapsed and always rendered expanded.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider } from '../../../context';
import { DisclosureSection } from './DisclosureSection';

afterEach(cleanup);

function buildDocJson() {
  return JSON.stringify({
    id: 'doc1',
    name: 'Test',
    formatVersion: '2.3',
    nodes: {
      f1: {
        id: 'f1',
        kind: 'frame',
        name: 'Frame',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        rotation: 0,
        order: 'a0',
        w: 300,
        h: 200,
        fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
        strokes: [],
        effects: [],
        children: [],
        transform: [1, 0, 0, 1, 0, 0],
      },
    },
    rootChildren: ['f1'],
    pages: [],
    components: {},
    nextId: 1,
  });
}

function renderWithProvider(element: React.ReactElement) {
  return render(<EditorProvider initialDocumentJson={buildDocJson()}>{element}</EditorProvider>);
}

describe('DisclosureSection registry mode', () => {
  it('lets the section registry own the top-level default, not the call-site prop', () => {
    // 'document-proof' is collapsed by default in the registry.
    renderWithProvider(
      <DisclosureSection title="Soft Proof" sectionId="document-proof" defaultExpanded>
        <div>proof-content</div>
      </DisclosureSection>,
    );
    expect(screen.getByRole('button', { name: /soft proof/i }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(screen.queryByText('proof-content')).toBeNull();
  });

  it('reads a subsection default declared in the section registry', () => {
    // `typography` declares variableFontAxes as collapsed by default. The
    // component passes no prop: the registry is the single source of truth,
    // and the first toggle must open (not write a redundant collapse).
    renderWithProvider(
      <DisclosureSection
        title="Variable font axes"
        sectionId="typography"
        subsectionId="variableFontAxes"
      >
        <div>axes-content</div>
      </DisclosureSection>,
    );
    const trigger = screen.getByRole('button', { name: /variable font axes/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('axes-content')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('axes-content')).toBeTruthy();
  });

  it('treats a subsection with no registry default as expanded', () => {
    renderWithProvider(
      <DisclosureSection title="Advanced" sectionId="typography" subsectionId="advanced">
        <div>advanced-content</div>
      </DisclosureSection>,
    );
    expect(screen.getByRole('button', { name: /advanced/i }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByText('advanced-content')).toBeTruthy();
  });
});
