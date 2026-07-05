// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type EditorContextValue, EditorProvider, useEditor } from '../context';

afterEach(() => {
  vi.restoreAllMocks();
});

function createTestPageDoc() {
  return {
    id: 'test-doc',
    name: 'Test',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
    formatVersion: '1.2',
    pages: [
      {
        id: 'page-1',
        name: 'Page 1',
        width: 210,
        height: 297,
        backgrounds: [],
        contentRoot: 'root-1',
      },
    ],
  };
}

describe('page-level bleed/safe-area/slug config', () => {
  it('setPageBleed updates the bleed on a specific page', async () => {
    let ctx: EditorContextValue | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setPageBleed?.('page-1', {
              top: 5,
              right: 5,
              bottom: 5,
              left: 5,
              linked: true,
              unit: 'mm',
            });
          }}
        >
          set bleed
        </button>
      );
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(createTestPageDoc())}>
        <Test />
      </EditorProvider>,
    );
    screen.getByText('set bleed').click();
    await waitFor(() => {
      const page = ctx?.state.document.pages?.find((p) => p.id === 'page-1');
      expect(page?.bleed).toBeDefined();
      expect(page!.bleed!.top).toBe(5);
      expect(page!.bleed!.unit).toBe('mm');
    });
  });

  it('setPageSafeArea updates the safe area on a specific page', async () => {
    let ctx: EditorContextValue | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setPageSafeArea?.('page-1', {
              top: 10,
              right: 10,
              bottom: 10,
              left: 10,
              unit: 'mm',
              enabled: true,
            });
          }}
        >
          set safe area
        </button>
      );
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(createTestPageDoc())}>
        <Test />
      </EditorProvider>,
    );
    screen.getByText('set safe area').click();
    await waitFor(() => {
      const page = ctx?.state.document.pages?.find((p) => p.id === 'page-1');
      expect(page?.safeArea).toBeDefined();
      expect(page!.safeArea!.top).toBe(10);
      expect(page!.safeArea!.enabled).toBe(true);
    });
  });

  it('setPageSlug updates the slug on a specific page', async () => {
    let ctx: EditorContextValue | undefined;
    function Test() {
      ctx = useEditor();
      return (
        <button
          type="button"
          onClick={() => {
            ctx?.setPageSlug?.('page-1', {
              top: 15,
              right: 15,
              bottom: 15,
              left: 15,
              unit: 'mm',
              enabled: true,
            });
          }}
        >
          set slug
        </button>
      );
    }
    render(
      <EditorProvider initialDocumentJson={JSON.stringify(createTestPageDoc())}>
        <Test />
      </EditorProvider>,
    );
    screen.getByText('set slug').click();
    await waitFor(() => {
      const page = ctx?.state.document.pages?.find((p) => p.id === 'page-1');
      expect(page?.slug).toBeDefined();
      expect(page!.slug!.top).toBe(15);
      expect(page!.slug!.enabled).toBe(true);
    });
  });

  it('does not fail when pages array is undefined', () => {
    let ctx: EditorContextValue | undefined;
    function Test() {
      ctx = useEditor();
      // Should not throw for pages-less documents
      return <div>ok</div>;
    }
    render(
      <EditorProvider>
        <Test />
      </EditorProvider>,
    );
    expect(() => ctx?.setPageBleed?.('p1', undefined as never)).not.toThrow();
    expect(() => ctx?.setPageSafeArea?.('p1', undefined as never)).not.toThrow();
    expect(() => ctx?.setPageSlug?.('p1', undefined as never)).not.toThrow();
  });
});
