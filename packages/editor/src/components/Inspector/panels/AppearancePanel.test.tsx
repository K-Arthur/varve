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
  it('hosts the focused appearance surfaces without duplicating the Studio launch point', async () => {
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(appearanceDocument())}>
        <SelectRect />
        <AppearancePanel />
      </EditorProvider>,
    );

    // The Studio launch point lives in the registry AppearanceSection; the
    // merged panel must not render a second launcher in the Design tab.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Object Filters' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'Creative treatments' })).toBeNull();
    expect(screen.queryByTestId('open-effect-studio')).toBeNull();
    expect(document.querySelector('[data-effect-studio]')).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search treatments' })).toBeNull();
  });
});
