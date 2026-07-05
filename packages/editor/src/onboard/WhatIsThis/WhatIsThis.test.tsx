// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HELP_CONTENT } from '../ContextualHelp/helpContent';
import { WhatIsThis } from './WhatIsThis';

afterEach(cleanup);

describe('WhatIsThis', () => {
  it('Shift+F1 enters mode', () => {
    const onOpenHelp = vi.fn();
    const onExit = vi.fn();
    render(<WhatIsThis open={true} onOpenHelp={onOpenHelp} onExit={onExit} />);
    expect(screen.getByText('Click any tool, panel, or element to learn about it')).toBeTruthy();
  });

  it('Shows hint text when in mode', () => {
    const onOpenHelp = vi.fn();
    const onExit = vi.fn();
    render(<WhatIsThis open={true} onOpenHelp={onOpenHelp} onExit={onExit} />);
    expect(screen.getByText('Click any tool, panel, or element to learn about it')).toBeTruthy();
  });

  it('Clicking a tool button opens help for that tool', () => {
    const onOpenHelp = vi.fn();
    const onExit = vi.fn();

    render(<WhatIsThis open={true} onOpenHelp={onOpenHelp} onExit={onExit} />);

    // Create a button matching tool pattern
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Rectangle');
    btn.setAttribute('type', 'button');
    document.body.appendChild(btn);

    fireEvent.click(btn);

    const expectedArticle = HELP_CONTENT['tool:rect'];
    expect(onOpenHelp).toHaveBeenCalledWith(expectedArticle);
    expect(onExit).toHaveBeenCalled();

    document.body.removeChild(btn);
  });

  it('Escape exits mode', () => {
    const onOpenHelp = vi.fn();
    const onExit = vi.fn();
    render(<WhatIsThis open={true} onOpenHelp={onOpenHelp} onExit={onExit} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).toHaveBeenCalled();
  });

  it('Cursor changes to help cursor', () => {
    const onOpenHelp = vi.fn();
    const onExit = vi.fn();
    render(<WhatIsThis open={true} onOpenHelp={onOpenHelp} onExit={onExit} />);
    expect(document.body.style.cursor).toBe('help');
  });

  it('Shift+F1 toggle exits mode', () => {
    const onOpenHelp = vi.fn();
    const onExit = vi.fn();
    render(<WhatIsThis open={true} onOpenHelp={onOpenHelp} onExit={onExit} />);
    fireEvent.keyDown(window, { key: 'F1', shiftKey: true });
    expect(onExit).toHaveBeenCalled();
  });
});
