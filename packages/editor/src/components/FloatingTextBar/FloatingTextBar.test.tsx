import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TextNode } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingTextBar, type FloatingTextBarProps } from './FloatingTextBar';

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
  hide: vi.fn(),
}));

afterEach(cleanup);

const BASE_TEXT_NODE: TextNode = {
  id: 'text-1',
  kind: 'text',
  name: 'Text 1',
  text: 'Hello',
  transform: [1, 0, 0, 1, 100, 200],
  fontSize: 16,
  fontFamily: 'Inter',
  fontWeight: 400,
  fontStyle: 'normal',
  fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
  fills: [],
  strokes: [],
  effects: [],
  index: 0,
  order: 'a0',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  rotation: 0,
  textAlign: 'left',
  textAlignVertical: 'top',
  textResizing: 'autoWidth',
  textOverflow: 'visible',
  textCase: 'none',
  textDecoration: 'none',
  listStyle: 'none',
  lineHeight: 1.2,
  letterSpacing: 0,
  paragraphSpacing: 0,
};

function defaultProps(overrides?: Partial<FloatingTextBarProps>): FloatingTextBarProps {
  return {
    node: BASE_TEXT_NODE,
    onUpdate: vi.fn(),
    onClose: vi.fn(),
    textScreenRect: { x: 100, y: 200, w: 240, h: 32 },
    ...overrides,
  };
}

describe('FloatingTextBar', () => {
  beforeEach(() => {
    window.innerHeight = 900;
    window.innerWidth = 1440;
  });

  async function settledToolbar(): Promise<HTMLElement> {
    return waitFor(() => screen.getByRole('toolbar'));
  }

  it('renders font family select', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    expect(screen.getByLabelText('Font family')).toBeInTheDocument();
  });

  it('renders font weight select', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    expect(screen.getByLabelText('Font weight')).toBeInTheDocument();
  });

  it('renders bold toggle', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    const bold = screen.getByLabelText('Bold');
    expect(bold).toBeInTheDocument();
    expect(bold).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders italic toggle', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    const italic = screen.getByLabelText('Italic');
    expect(italic).toBeInTheDocument();
    expect(italic).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders font size input', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    const size = screen.getByLabelText('Font size') as HTMLInputElement;
    expect(size).toBeInTheDocument();
    expect(size.value).toBe('16');
  });

  it('renders align buttons', async () => {
    render(<FloatingTextBar {...defaultProps()} />);
    await settledToolbar();
    expect(await screen.findByRole('radiogroup', { name: 'Text alignment' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Left' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Center' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Right' })).toBeInTheDocument();
  });

  it('renders list toggle', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    const list = screen.getByLabelText('List');
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders color swatch', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    expect(screen.getByLabelText('Text color')).toBeInTheDocument();
  });

  it('shows bold as active when fontWeight >= 600', () => {
    render(<FloatingTextBar {...defaultProps({ node: { ...BASE_TEXT_NODE, fontWeight: 700 } })} />);
    expect(screen.getByLabelText('Bold')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows italic as active when fontStyle is italic', () => {
    render(
      <FloatingTextBar {...defaultProps({ node: { ...BASE_TEXT_NODE, fontStyle: 'italic' } })} />,
    );
    expect(screen.getByLabelText('Italic')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows list as active when listStyle is not none', () => {
    render(
      <FloatingTextBar {...defaultProps({ node: { ...BASE_TEXT_NODE, listStyle: 'disc' } })} />,
    );
    expect(screen.getByLabelText('List')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows correct align active state', async () => {
    render(
      <FloatingTextBar {...defaultProps({ node: { ...BASE_TEXT_NODE, textAlign: 'center' } })} />,
    );
    await settledToolbar();
    expect(await screen.findByRole('radio', { name: 'Center' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Left' })).not.toBeChecked();
  });

  it('calls onUpdate with bold weight on bold click', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontWeight: 700 });
  });

  it('calls onUpdate with normal weight on bold click when already bold', () => {
    const onUpdate = vi.fn();
    render(
      <FloatingTextBar
        {...defaultProps({ node: { ...BASE_TEXT_NODE, fontWeight: 700 }, onUpdate })}
      />,
    );
    fireEvent.click(screen.getByLabelText('Bold'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontWeight: 400 });
  });

  it('calls onUpdate with italic on italic click', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    fireEvent.click(screen.getByLabelText('Italic'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontStyle: 'italic' });
  });

  it('calls onUpdate with normal style on italic click when already italic', () => {
    const onUpdate = vi.fn();
    render(
      <FloatingTextBar
        {...defaultProps({ node: { ...BASE_TEXT_NODE, fontStyle: 'italic' }, onUpdate })}
      />,
    );
    fireEvent.click(screen.getByLabelText('Italic'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontStyle: 'normal' });
  });

  it('calls onUpdate with list disc on list click', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    fireEvent.click(screen.getByLabelText('List'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { listStyle: 'disc' });
  });

  it('calls onUpdate with list none on list click when already list', () => {
    const onUpdate = vi.fn();
    render(
      <FloatingTextBar
        {...defaultProps({ node: { ...BASE_TEXT_NODE, listStyle: 'disc' }, onUpdate })}
      />,
    );
    fireEvent.click(screen.getByLabelText('List'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { listStyle: 'none' });
  });

  it('calls onUpdate with align value on align click', async () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    await settledToolbar();
    fireEvent.click(await screen.findByRole('radio', { name: 'Center' }));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { textAlign: 'center' });
  });

  it('calls onUpdate with font size on size change', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    const input = screen.getByLabelText('Font size');
    fireEvent.change(input, { target: { value: '24' } });
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontSize: 24 });
  });

  it('renders font selector with combobox', async () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    await settledToolbar();
    // FontSelector uses a combobox pattern
    const fontInput = screen.getByRole('combobox', { name: 'Font family' });
    expect(fontInput).toBeInTheDocument();
  });

  it('calls onUpdate with font weight on select change', async () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    await settledToolbar();
    fireEvent.click(screen.getByLabelText('Font weight'));
    fireEvent.click(await waitFor(() => screen.getByRole('option', { name: '700' })));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontWeight: 700 });
  });

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onClose })} />);
    fireEvent.keyDown(await settledToolbar(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when the owner-document Escape is pressed', async () => {
    const onClose = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onClose })} />);
    await settledToolbar();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('uses the shared fixed overlay placement for text', async () => {
    const rect = { x: 100, y: 300, w: 200, h: 30 };
    render(<FloatingTextBar {...defaultProps({ textScreenRect: rect })} />);
    const toolbar = await settledToolbar();
    const layer = toolbar.closest<HTMLElement>('[data-varve-overlay]');
    expect(layer).toHaveAttribute('data-overlay-state', 'visible');
    expect(layer?.style.position).toBe('fixed');
    expect(Number.isFinite(Number.parseFloat(layer?.style.left ?? ''))).toBe(true);
    expect(Number.isFinite(Number.parseFloat(layer?.style.top ?? ''))).toBe(true);
  });

  it('keeps the shared overlay mounted when the anchor is near the top', async () => {
    // Put the text near the top of the viewport
    const rect = { x: 100, y: 10, w: 200, h: 30 };
    render(<FloatingTextBar {...defaultProps({ textScreenRect: rect })} />);
    expect(await settledToolbar()).toBeInTheDocument();
  });

  it('keeps the shared overlay mounted in a short viewport', async () => {
    // Make viewport too small for above or below
    window.innerHeight = 100;
    const rect = { x: 100, y: 30, w: 200, h: 30 };
    render(<FloatingTextBar {...defaultProps({ textScreenRect: rect })} />);
    expect(await settledToolbar()).toBeInTheDocument();
  });

  it('renders with toolbar role', async () => {
    render(<FloatingTextBar {...defaultProps()} />);
    const toolbar = await settledToolbar();
    expect(toolbar).toHaveAttribute('aria-label', 'Text formatting');
  });
});
