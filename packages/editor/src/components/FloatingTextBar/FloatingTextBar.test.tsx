import '@testing-library/jest-dom/vitest';
import type { TextNode } from '@strata/scene';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingTextBar, type FloatingTextBarProps } from './FloatingTextBar';

vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  autoUpdate: vi.fn(() => vi.fn()),
  flip: vi.fn(),
  shift: vi.fn(),
  offset: vi.fn(),
  size: vi.fn(),
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

  it('renders align buttons', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    expect(screen.getByLabelText('Align left')).toBeInTheDocument();
    expect(screen.getByLabelText('Align center')).toBeInTheDocument();
    expect(screen.getByLabelText('Align right')).toBeInTheDocument();
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

  it('shows correct align active state', () => {
    render(
      <FloatingTextBar {...defaultProps({ node: { ...BASE_TEXT_NODE, textAlign: 'center' } })} />,
    );
    expect(screen.getByLabelText('Align center')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Align left')).toHaveAttribute('aria-pressed', 'false');
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

  it('calls onUpdate with align value on align click', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    fireEvent.click(screen.getByLabelText('Align center'));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { textAlign: 'center' });
  });

  it('calls onUpdate with font size on size change', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    const input = screen.getByLabelText('Font size');
    fireEvent.change(input, { target: { value: '24' } });
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontSize: 24 });
  });

  it('calls onUpdate with font family on select change', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    fireEvent.click(screen.getByLabelText('Font family'));
    fireEvent.click(screen.getByRole('option', { name: /arial/i }));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontFamily: 'Arial' });
  });

  it('calls onUpdate with font weight on select change', () => {
    const onUpdate = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onUpdate })} />);
    fireEvent.click(screen.getByLabelText('Font weight'));
    fireEvent.click(screen.getByRole('option', { name: '700' }));
    expect(onUpdate).toHaveBeenCalledWith('text-1', { fontWeight: 700 });
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onClose })} />);
    fireEvent.keyDown(screen.getByRole('toolbar'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when window Escape is pressed', () => {
    const onClose = vi.fn();
    render(<FloatingTextBar {...defaultProps({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('positions above text when space permits', () => {
    const rect = { x: 100, y: 300, w: 200, h: 30 };
    render(<FloatingTextBar {...defaultProps({ textScreenRect: rect })} />);
    const el = screen.getByRole('toolbar');
    // Position: above (300 - 42 - 8 = 250)
    expect(el.style.top).toBe('250px');
    expect(el.style.left).toBe('100px');
  });

  it('positions below text when no space above', () => {
    // Put the text near the top of the viewport
    const rect = { x: 100, y: 10, w: 200, h: 30 };
    render(<FloatingTextBar {...defaultProps({ textScreenRect: rect })} />);
    const el = screen.getByRole('toolbar');
    // Position: below (10 + 30 + 8 = 48)
    expect(el.style.top).toBe('48px');
  });

  it('positions to the right when no space above or below', () => {
    // Make viewport too small for above or below
    window.innerHeight = 100;
    const rect = { x: 100, y: 30, w: 200, h: 30 };
    render(<FloatingTextBar {...defaultProps({ textScreenRect: rect })} />);
    const el = screen.getByRole('toolbar');
    // Position: to the right (100 + 200 + 8 = 308)
    expect(el.style.left).toBe('308px');
  });

  it('renders with toolbar role', () => {
    render(<FloatingTextBar {...defaultProps()} />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 'Text formatting');
  });
});
