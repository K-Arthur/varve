// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { addChild, createDocument, makeShapeNode } from '@varve/scene';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../../../context';
import { AppearancePanel } from './AppearancePanel';

afterEach(cleanup);

function SelectRect() {
  const editor = useEditor();
  useEffect(() => {
    editor.setSelection('appearance-test-rect');
  }, []);
  return null;
}

function appearanceDocument() {
  const initial = createDocument('appearance-panel-test');
  return addChild(
    initial,
    initial.pages?.[0]?.contentRoot as string,
    makeShapeNode('appearance-test-rect', { kind: 'rect', x: 0, y: 0, w: 200, h: 120 }),
  );
}

describe('AppearancePanel', () => {
  it('keeps Appearance as a compact Studio launch point rather than mounting the gallery', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(appearanceDocument())}>
        <SelectRect />
        <AppearancePanel />
      </EditorProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Creative treatments' })).toBeInTheDocument(),
    );

    expect(screen.getByRole('button', { name: 'Open Studio' })).toBeInTheDocument();
    expect(document.querySelector('[data-effect-studio]')).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search treatments' })).toBeNull();
  });
});
