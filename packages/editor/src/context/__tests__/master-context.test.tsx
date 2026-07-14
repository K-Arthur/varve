import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorProvider, useEditor } from '../..';

describe('Master page context integration', () => {
  it('context methods exist', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    // Master methods exist
    expect(typeof getCtx().createMaster).toBe('function');
    expect(typeof getCtx().deleteMaster).toBe('function');
    expect(typeof getCtx().renameMaster).toBe('function');
    expect(typeof getCtx().duplicateMaster).toBe('function');
    expect(typeof getCtx().assignMasterToPage).toBe('function');
    expect(typeof getCtx().setMasterAppliesTo).toBe('function');
    expect(typeof getCtx().activePageNodesWithMaster).toBe('function');

    // Spread methods exist
    expect(typeof getCtx().rebuildSpreads).toBe('function');
    expect(typeof getCtx().getSpreadForPage).toBe('function');
    expect(typeof getCtx().getPageSide).toBe('function');
    expect(typeof getCtx().isPageOnLeftSide).toBe('function');

    // Page numbering methods exist
    expect(typeof getCtx().getPageNumber).toBe('function');
    expect(typeof getCtx().getFormattedPageNumber).toBe('function');

    // Facing pages methods exist
    expect(typeof getCtx().toggleFacingPages).toBe('function');
    expect(typeof getCtx().setFacingPagesEnabled).toBe('function');
  });

  it('createMaster adds a master to the document', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    // Initially there should be no masters
    expect(getCtx().state.document.masters).toBeUndefined();

    // Create a master
    getCtx().createMaster('My Master', 1920, 1080);

    await waitFor(() => {
      const masters = getCtx().state.document.masters;
      expect(masters).toBeDefined();
      const masterIds = masters ? Object.keys(masters) : [];
      expect(masterIds.length).toBe(1);
      const master = masters?.[masterIds[0]!];
      expect(master?.name).toBe('My Master');
      expect(master?.width).toBe(1920);
      expect(master?.height).toBe(1080);
    });
  });

  it('assignMasterToPage works', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    // First create a master
    getCtx().createMaster('Grid Master', 1920, 1080);

    await waitFor(() => {
      expect(getCtx().state.document.masters).toBeDefined();
    });

    // Get the master and page IDs
    const doc = getCtx().state.document;
    const masterId = doc.masters ? Object.keys(doc.masters)[0] : undefined;
    const pageId = doc.pages?.[0]?.id;

    expect(masterId).toBeDefined();
    expect(pageId).toBeDefined();

    if (!masterId || !pageId) throw new Error('Missing IDs');

    // Assign master to page
    getCtx().assignMasterToPage(pageId, masterId);

    await waitFor(() => {
      const page = getCtx().state.document.pages?.find((p) => p.id === pageId);
      expect(page?.masterPageId).toBe(masterId);
    });
  });

  it('activePageNodesWithMaster returns nodes', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    const nodeIds = getCtx().activePageNodesWithMaster();
    expect(Array.isArray(nodeIds)).toBe(true);
  });

  it('toggleFacingPages toggles state', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    // Initially undefined
    const initial = getCtx().state.document.facingPages;

    getCtx().toggleFacingPages();

    await waitFor(() => {
      const after = getCtx().state.document.facingPages;
      expect(after).toBeDefined();
      if (after && initial) {
        expect(after.enabled).toBe(!initial.enabled);
      } else if (after) {
        expect(after.enabled).toBe(true);
      }
    });
  });

  it('getPageNumber returns a number', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    const doc = getCtx().state.document;
    const pageId = doc.pages?.[0]?.id;
    expect(pageId).toBeDefined();

    if (!pageId) throw new Error('No page ID');

    const num = getCtx().getPageNumber(pageId);
    expect(typeof num).toBe('number');
    expect(num).toBeGreaterThanOrEqual(1);
  });

  it('getFormattedPageNumber returns a string', async () => {
    let ctx: ReturnType<typeof useEditor> | undefined;

    function TestComponent() {
      ctx = useEditor();
      return null;
    }

    render(
      <EditorProvider>
        <TestComponent />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(ctx).toBeDefined();
    });

    if (!ctx) throw new Error('ctx not found');
    const getCtx = () => ctx as NonNullable<typeof ctx>;

    const doc = getCtx().state.document;
    const pageId = doc.pages?.[0]?.id;
    expect(pageId).toBeDefined();

    if (!pageId) throw new Error('No page ID');

    const formatted = getCtx().getFormattedPageNumber(pageId);
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });
});
