// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_APP_VERSION } from './featureVersions';
import { NewFeatureBadge } from './NewFeatureBadge';

afterEach(cleanup);

describe('NewFeatureBadge', () => {
  it('badge shows when feature is newer than lastSeenVersion', () => {
    const { container } = render(
      <NewFeatureBadge featureId="tool:pen" lastSeenVersion="0.5.0">
        <button type="button">Pen Tool</button>
      </NewFeatureBadge>,
    );
    const badge = container.querySelector('.new-feature-badge__dot');
    expect(badge).toBeTruthy();
  });

  it('badge hidden when lastSeenVersion matches current version', () => {
    const { container } = render(
      <NewFeatureBadge featureId="tool:pen" lastSeenVersion={CURRENT_APP_VERSION}>
        <button type="button">Pen Tool</button>
      </NewFeatureBadge>,
    );
    const badge = container.querySelector('.new-feature-badge__dot');
    expect(badge).toBeFalsy();
  });

  it('badge has correct aria-label', () => {
    const { container } = render(
      <NewFeatureBadge featureId="tool:pen" lastSeenVersion="0.5.0">
        <button type="button">Pen Tool</button>
      </NewFeatureBadge>,
    );
    const badge = container.querySelector('.new-feature-badge__dot');
    expect(badge).toHaveAttribute('aria-label', 'New: tool:pen');
  });

  it('interaction with child clears badge (calls onSee)', () => {
    const onSee = vi.fn();
    const { container } = render(
      <NewFeatureBadge featureId="tool:pen" lastSeenVersion="0.5.0" onSee={onSee}>
        <button type="button">Pen Tool</button>
      </NewFeatureBadge>,
    );
    const btn = screen.getByText('Pen Tool');
    fireEvent.click(btn);
    expect(onSee).toHaveBeenCalledWith('tool:pen');
    // Badge should be removed
    const badge = container.querySelector('.new-feature-badge__dot');
    expect(badge).toBeFalsy();
  });

  it('no badge shown for unknown feature ID', () => {
    const { container } = render(
      <NewFeatureBadge featureId="unknown:feature" lastSeenVersion="0.5.0">
        <button type="button">Something</button>
      </NewFeatureBadge>,
    );
    const badge = container.querySelector('.new-feature-badge__dot');
    expect(badge).toBeFalsy();
  });

  it('multiple badges can display simultaneously', () => {
    const { container } = render(
      <div>
        <NewFeatureBadge featureId="tool:pen" lastSeenVersion="0.5.0">
          <button type="button">Pen</button>
        </NewFeatureBadge>
        <NewFeatureBadge featureId="tool:pencil" lastSeenVersion="0.5.0">
          <button type="button">Pencil</button>
        </NewFeatureBadge>
      </div>,
    );
    const badges = container.querySelectorAll('.new-feature-badge__dot');
    expect(badges.length).toBe(2);
  });
});
