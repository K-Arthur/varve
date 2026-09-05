// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs } from './Tabs';

const tabs = [
  { value: 'css', label: 'CSS' },
  { value: 'tailwind', label: 'Tailwind' },
  { value: 'svg', label: 'SVG' },
] as const;

function fireKey(el: HTMLElement, key: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('Tabs', () => {
  it('renders tablist with correct aria-label', () => {
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="css" onTabChange={() => {}}>
        <div>CSS content</div>
        <div>Tailwind content</div>
        <div>SVG content</div>
      </Tabs>,
    );
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute('aria-label')).toBe('Code language');
  });

  it('renders all tab buttons', () => {
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="css" onTabChange={() => {}}>
        <div>CSS</div>
        <div>Tailwind</div>
        <div>SVG</div>
      </Tabs>,
    );
    expect(container.querySelectorAll('[role="tab"]').length).toBe(3);
  });

  it('marks active tab as aria-selected', () => {
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="tailwind" onTabChange={() => {}}>
        <div>CSS</div>
        <div>Tailwind</div>
        <div>SVG</div>
      </Tabs>,
    );
    const tabs_ = container.querySelectorAll('[role="tab"]');
    expect(tabs_.length).toBe(3);
    expect(tabs_[0]?.getAttribute('aria-selected')).toBe('false');
    expect(tabs_[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs_[2]?.getAttribute('aria-selected')).toBe('false');
  });

  it('shows only active tabpanel', () => {
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="css" onTabChange={() => {}}>
        <div>CSS content</div>
        <div>Tailwind content</div>
        <div>SVG content</div>
      </Tabs>,
    );
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels.length).toBe(3);
    expect(panels[0]?.hasAttribute('hidden')).toBe(false);
    expect(panels[1]?.hasAttribute('hidden')).toBe(true);
    expect(panels[2]?.hasAttribute('hidden')).toBe(true);
  });

  it('wires aria-controls and aria-labelledby', () => {
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="css" onTabChange={() => {}}>
        <div>CSS content</div>
        <div>Tailwind</div>
        <div>SVG</div>
      </Tabs>,
    );
    const cssTab = container.querySelectorAll('[role="tab"]')[0];
    if (!cssTab) throw new Error('cssTab not found');
    const panelId = cssTab.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = container.querySelector(`#${panelId}`);
    expect(panel?.getAttribute('aria-labelledby')).toBe(cssTab.id);
  });

  it('calls onTabChange on click', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="css" onTabChange={onChange}>
        <div>CSS</div>
        <div>Tailwind</div>
        <div>SVG</div>
      </Tabs>,
    );
    (container.querySelectorAll('[role="tab"]')[1] as HTMLElement).click();
    expect(onChange).toHaveBeenCalledWith('tailwind');
  });

  it('navigates on ArrowRight', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="css" onTabChange={onChange}>
        <div>CSS</div>
        <div>Tailwind</div>
        <div>SVG</div>
      </Tabs>,
    );
    const tablist = container.querySelector('[role="tablist"]') as HTMLElement;
    fireKey(tablist, 'ArrowRight');
    expect(onChange).toHaveBeenCalledWith('tailwind');
  });

  it('navigates to home on Home key', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab="svg" onTabChange={onChange}>
        <div>CSS</div>
        <div>Tailwind</div>
        <div>SVG</div>
      </Tabs>,
    );
    const tablist = container.querySelector('[role="tablist"]') as HTMLElement;
    fireKey(tablist, 'Home');
    expect(onChange).toHaveBeenCalledWith('css');
  });

  it('falls back to the first enabled tab when a controlled value is stale', () => {
    const { container } = render(
      <Tabs label="Code language" tabs={tabs} activeTab={'removed' as 'css'} onTabChange={() => {}}>
        <div>CSS content</div>
        <div>Tailwind content</div>
        <div>SVG content</div>
      </Tabs>,
    );
    const tabButtons = container.querySelectorAll('[role="tab"]');
    expect(tabButtons[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabButtons[0]).toHaveAttribute('tabindex', '0');
    expect(container.querySelectorAll('[role="tabpanel"]')[0]).not.toHaveAttribute('hidden');
  });

  it('uses stable value-based panel ids and value-keyed renderers', () => {
    render(
      <Tabs
        label="Code language"
        tabs={tabs}
        activeTab="tailwind"
        onTabChange={() => {}}
        renderPanel={(tab) => <div>{tab.value} panel</div>}
      />,
    );
    const activeTab = screen.getByRole('tab', { name: 'Tailwind' });
    const panel = document.getElementById(activeTab.getAttribute('aria-controls') ?? '');
    expect(panel).toHaveTextContent('tailwind panel');
    expect(panel).toHaveAttribute('aria-labelledby', activeTab.id);
  });

  it('only renders the active panel callback when inactive panels unmount', () => {
    const renderPanel = vi.fn((tab: (typeof tabs)[number]) => <div>{tab.label} panel</div>);
    render(
      <Tabs
        label="Code language"
        tabs={tabs}
        activeTab="tailwind"
        onTabChange={() => {}}
        renderPanel={renderPanel}
      />,
    );
    expect(renderPanel).toHaveBeenCalledTimes(1);
    expect(renderPanel).toHaveBeenCalledWith(tabs[1], 1);
  });

  it('supports manual activation without consuming arrow focus', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Code language"
        tabs={tabs}
        activeTab="css"
        onTabChange={onChange}
        activation="manual"
      >
        <div>CSS content</div>
        <div>Tailwind content</div>
        <div>SVG content</div>
      </Tabs>,
    );
    const css = screen.getByRole('tab', { name: 'CSS' });
    const tailwind = screen.getByRole('tab', { name: 'Tailwind' });
    css.focus();
    fireEvent.keyDown(css, { key: 'ArrowRight' });
    expect(tailwind).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(tailwind, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('tailwind');
  });

  it('only consumes arrow keys on the tablist axis and skips disabled tabs', () => {
    const onChange = vi.fn();
    const verticalTabs = [
      { value: 'one', label: 'One' },
      { value: 'two', label: 'Two', disabled: true },
      { value: 'three', label: 'Three' },
    ] as const;
    render(
      <Tabs
        label="Sections"
        tabs={verticalTabs}
        activeTab="one"
        onTabChange={onChange}
        orientation="vertical"
      >
        <div>One content</div>
        <div>Two content</div>
        <div>Three content</div>
      </Tabs>,
    );
    const tablist = screen.getByRole('tablist', { name: 'Sections' });
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
    const one = screen.getByRole('tab', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowDown' });
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith('three');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Three' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
