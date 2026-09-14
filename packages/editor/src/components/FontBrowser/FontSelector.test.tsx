import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getFontRegistry } from '@varve/engine';
import { getFontSemanticCatalog } from '@varve/engine/font';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontSelector } from './FontSelector';

afterEach(cleanup);

describe('FontSelector', () => {
  it('keeps combobox and listbox relationships unique when mounted twice', async () => {
    render(
      <>
        <FontSelector value="Inter" onChange={() => {}} />
        <FontSelector value="Georgia" onChange={() => {}} />
      </>,
    );

    const inputs = screen.getAllByRole('combobox');
    expect(inputs).toHaveLength(2);
    const inputIds = inputs.map((input) => input.id);
    const controls = inputs.map((input) => input.getAttribute('aria-controls'));
    expect(new Set(inputIds).size).toBe(2);
    expect(new Set(controls).size).toBe(2);
    for (const id of controls) {
      expect(id).toBeTruthy();
    }
    expect(inputs[0]).toHaveAttribute('aria-haspopup', 'listbox');
    fireEvent.focus(inputs[0]!);
    await screen.findByRole('listbox', { name: 'Font families' });
    expect(document.getElementById(controls[0]!)).toHaveAttribute('role', 'listbox');
    fireEvent.blur(inputs[0]!);
    fireEvent.focus(inputs[1]!);
    await screen.findAllByRole('listbox', { name: 'Font families' });
    expect(document.getElementById(controls[1]!)).toHaveAttribute('role', 'listbox');
  });

  it('leaves Home and End available for editing the query', () => {
    render(<FontSelector value="Inter" onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
  });

  it('opens from Alt+ArrowDown without changing the query', async () => {
    render(<FontSelector value="Inter" onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Font families' })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Alt' });
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    expect(await screen.findByRole('listbox', { name: 'Font families' })).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('dismisses the open picker without bubbling Escape to the toolbar', async () => {
    const onDocumentKeyDown = vi.fn();
    document.addEventListener('keydown', onDocumentKeyDown);
    render(<FontSelector value="Inter" onChange={() => {}} />);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(await screen.findByRole('listbox', { name: 'Font families' })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: 'Font families' })).not.toBeInTheDocument();
    expect(onDocumentKeyDown).not.toHaveBeenCalled();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDocumentKeyDown).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', onDocumentKeyDown);
  });

  it('keeps literal family options mounted before the portaled viewport is measured', async () => {
    render(<FontSelector value="Inter" onChange={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'Font family' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'IBM Plex Sans Variable' } });

    expect(
      await screen.findByRole('option', { name: /IBM Plex Sans Variable/ }),
    ).toBeInTheDocument();
  });

  it('bounds the pre-measure menu while retaining the active option', async () => {
    render(<FontSelector value="Inter" onChange={() => {}} />);
    const input = screen.getByRole('combobox', { name: 'Font family' });
    fireEvent.focus(input);
    await screen.findByRole('listbox', { name: 'Font families' });

    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(120);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const activeId = input.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option');
  });

  it('keeps a 60-character family name intact and labelled', () => {
    // Regression guard for the inspector truncation audit: a long family
    // name must not be truncated in the data layer (the input scrolls, it
    // does not lose characters) and must keep its accessible name.
    const longName = 'Iowan Old Style Black Italic Display Swash Alternate Wide Display';
    expect(longName.length).toBeGreaterThanOrEqual(60);
    render(<FontSelector value={longName} onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue(longName);
    expect(input).toHaveAccessibleName('Font family');
  });

  it('surfaces an exact-face fallback when the family exists but the requested artifact does not', () => {
    render(
      <FontSelector
        value="Inter"
        fontReference={{ artifactHash: 'a'.repeat(64), collectionIndex: 0 }}
        onChange={() => {}}
      />,
    );

    expect(
      screen.getByRole('img', { name: /Exact font face is not installed/i }),
    ).toBeInTheDocument();
  });

  it('shows a mixed family value without reporting a missing-face warning', () => {
    render(
      <FontSelector
        value="Inter"
        mixed
        fontReference={{ artifactHash: 'a'.repeat(64), collectionIndex: 0 }}
        onChange={() => {}}
      />,
    );

    const input = screen.getByRole('combobox', { name: 'Font family' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Mixed fonts');
    expect(screen.queryByRole('img', { name: /not installed/i })).not.toBeInTheDocument();
  });

  it('shows favorites in the compact picker and records selections as recent', async () => {
    const semantic = getFontSemanticCatalog();
    const record = semantic.findByFamilyName('IBM Plex Sans Variable');
    expect(record).toBeDefined();
    const previousFavorite = record?.isFavorite ?? false;
    const markRecentlyUsed = vi.spyOn(semantic, 'markRecentlyUsed');
    const onChange = vi.fn();

    semantic.setFavorite(record!.familyId, true);
    try {
      render(<FontSelector value="Inter" onChange={onChange} />);
      const input = screen.getByRole('combobox', { name: 'Font family' });
      fireEvent.focus(input);
      await screen.findByRole('listbox', { name: 'Font families' });
      expect(screen.getByText('Favorites')).toBeInTheDocument();

      fireEvent.change(input, { target: { value: 'IBM Plex Sans Variable' } });
      const option = await screen.findByRole('option', { name: /IBM Plex Sans Variable/ });
      fireEvent.mouseDown(option);
      expect(onChange).toHaveBeenCalledWith('IBM Plex Sans Variable');
      expect(markRecentlyUsed).toHaveBeenCalledWith(record!.familyId);
      expect(document.activeElement).toBe(input);
    } finally {
      semantic.setFavorite(record!.familyId, previousFavorite);
      markRecentlyUsed.mockRestore();
    }
  });

  it('expands registered faces and preserves an exact face selection', async () => {
    const registry = getFontRegistry();
    const semantic = getFontSemanticCatalog();
    const firstFaceKey = `sha256:${'b'.repeat(64)}:single`;
    const secondFaceKey = `sha256:${'b'.repeat(64)}:1`;
    registry.register({
      family: 'Toolbar Face Fixture',
      weight: 400,
      style: 'normal',
      source: 'user',
      faceKey: firstFaceKey,
      postScriptName: 'ToolbarFace-Regular',
    });
    registry.register({
      family: 'Toolbar Face Fixture',
      weight: 700,
      style: 'normal',
      source: 'user',
      faceKey: secondFaceKey,
      collectionIndex: 1,
      postScriptName: 'ToolbarFace-Bold',
    });
    semantic.syncRegistry(registry);
    const onSelectFace = vi.fn();
    try {
      render(
        <FontSelector
          value="Toolbar Face Fixture"
          onChange={() => {}}
          onSelectFace={onSelectFace}
        />,
      );
      const input = screen.getByRole('combobox', { name: 'Font family' });
      fireEvent.focus(input);
      await screen.findByRole('option', { name: /Toolbar Face Fixture/ });
      const expand = screen.getByRole('button', { name: /Expand Toolbar Face Fixture faces/ });
      fireEvent.click(expand);
      const boldFace = await screen.findByRole('option', { name: /700/ });
      fireEvent.mouseDown(boldFace);
      expect(onSelectFace).toHaveBeenCalledWith(
        expect.objectContaining({
          family: 'Toolbar Face Fixture',
          weight: 700,
          postScriptName: 'ToolbarFace-Bold',
          fontReference: {
            artifactHash: 'b'.repeat(64),
            collectionIndex: 1,
            postScriptName: 'ToolbarFace-Bold',
          },
        }),
      );
      expect(input).toHaveValue('Toolbar Face Fixture');
    } finally {
      registry.unregisterFace({ faceKey: firstFaceKey });
      registry.unregisterFace({ faceKey: secondFaceKey });
    }
  });

  it('navigates expanded faces with the keyboard and activates the exact face', async () => {
    const registry = getFontRegistry();
    const semantic = getFontSemanticCatalog();
    const regularFaceKey = `sha256:${'c'.repeat(64)}:single`;
    const boldFaceKey = `sha256:${'c'.repeat(64)}:1`;
    registry.register({
      family: 'Keyboard Face Fixture',
      weight: 400,
      style: 'normal',
      source: 'user',
      faceKey: regularFaceKey,
      postScriptName: 'KeyboardFace-Regular',
    });
    registry.register({
      family: 'Keyboard Face Fixture',
      weight: 700,
      style: 'normal',
      source: 'user',
      faceKey: boldFaceKey,
      collectionIndex: 1,
      postScriptName: 'KeyboardFace-Bold',
    });
    semantic.syncRegistry(registry);
    const onSelectFace = vi.fn();
    try {
      render(
        <FontSelector
          value="Keyboard Face Fixture"
          onChange={() => {}}
          onSelectFace={onSelectFace}
        />,
      );
      const input = screen.getByRole('combobox', { name: 'Font family' });
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Keyboard Face Fixture' } });
      await screen.findByRole('option', { name: /Keyboard Face Fixture/ });
      fireEvent.keyDown(input, { key: 'ArrowRight' });
      expect(
        await screen.findByRole('button', { name: /Collapse Keyboard Face Fixture faces/ }),
      ).toHaveAttribute('aria-expanded', 'true');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const regularActiveId = input.getAttribute('aria-activedescendant');
      expect(regularActiveId).toBeTruthy();
      expect(document.getElementById(regularActiveId!)).toHaveTextContent('400');

      fireEvent.keyDown(input, { key: 'ArrowDown' });
      const boldActiveId = input.getAttribute('aria-activedescendant');
      expect(boldActiveId).toBeTruthy();
      expect(document.getElementById(boldActiveId!)).toHaveTextContent('700');

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelectFace).toHaveBeenCalledWith(
        expect.objectContaining({
          family: 'Keyboard Face Fixture',
          weight: 700,
          postScriptName: 'KeyboardFace-Bold',
          fontReference: {
            artifactHash: 'c'.repeat(64),
            collectionIndex: 1,
            postScriptName: 'KeyboardFace-Bold',
          },
        }),
      );
    } finally {
      registry.unregisterFace({ faceKey: regularFaceKey });
      registry.unregisterFace({ faceKey: boldFaceKey });
    }
  });
});
