// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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
    const cssTab = container.querySelectorAll('[role="tab"]')[0]!;
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
});
