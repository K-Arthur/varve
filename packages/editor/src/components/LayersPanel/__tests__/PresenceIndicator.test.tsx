import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PresenceIndicator, type PresenceData } from '../PresenceIndicator';
import { globalPresenceStore } from '../presenceStore';

describe('PresenceIndicator component', () => {
  it('renders nothing when no presences', () => {
    const { container } = render(<PresenceIndicator presences={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows avatar for single presence', () => {
    const presences: PresenceData[] = [{ userId: 'user1', label: 'Alice', color: '#ff0000' }];
    render(<PresenceIndicator presences={presences} />);
    const avatar = screen.getByText('A');
    expect(avatar).not.toBeNull();
    expect(avatar.className).toContain('layers-row__presence-avatar');
  });

  it('shows overflow count when > maxAvatars', () => {
    const presences: PresenceData[] = [
      { userId: 'u1', label: 'Alice', color: '#ff0000' },
      { userId: 'u2', label: 'Bob', color: '#00ff00' },
      { userId: 'u3', label: 'Charlie', color: '#0000ff' },
      { userId: 'u4', label: 'Diana', color: '#ffff00' },
    ];
    render(<PresenceIndicator presences={presences} maxAvatars={3} />);
    const overflow = screen.getByText('+1');
    expect(overflow).not.toBeNull();
    expect(overflow.className).toContain('layers-row__presence-overflow');
  });

  it('shows up to maxAvatars avatars', () => {
    const presences: PresenceData[] = [
      { userId: 'u1', label: 'Alice', color: '#ff0000' },
      { userId: 'u2', label: 'Bob', color: '#00ff00' },
      { userId: 'u3', label: 'Charlie', color: '#0000ff' },
      { userId: 'u4', label: 'Diana', color: '#ffff00' },
    ];
    render(<PresenceIndicator presences={presences} maxAvatars={2} />);
    // Should show 2 avatars (A, B) and +2
    expect(screen.getByText('A')).not.toBeNull();
    expect(screen.getByText('B')).not.toBeNull();
    expect(screen.getByText('+2')).not.toBeNull();
  });

  it('uses first letter of label as avatar text', () => {
    const presences: PresenceData[] = [{ userId: 'u1', label: 'Charlie', color: '#0000ff' }];
    render(<PresenceIndicator presences={presences} />);
    const avatar = screen.getByText('C');
    expect(avatar).not.toBeNull();
  });

  it('has role="group" with correct aria-label', () => {
    const presences: PresenceData[] = [
      { userId: 'u1', label: 'Alice', color: '#ff0000' },
      { userId: 'u2', label: 'Bob', color: '#00ff00' },
    ];
    const { container } = render(<PresenceIndicator presences={presences} />);
    const group = container.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group?.getAttribute('aria-label')).toBe('2 collaborators');
  });
});

describe('presenceStore', () => {
  it('setPresence stores presence data', () => {
    globalPresenceStore.setPresence('node1', {
      userId: 'alice',
      label: 'Alice',
      color: '#ff0000',
    });
    const presences = globalPresenceStore.getPresences('node1');
    expect(presences).toHaveLength(1);
    expect(presences[0]?.userId).toBe('alice');
  });

  it('getPresences returns stored data', () => {
    globalPresenceStore.setPresence('node1', {
      userId: 'alice',
      label: 'Alice',
      color: '#ff0000',
    });
    globalPresenceStore.setPresence('node1', {
      userId: 'bob',
      label: 'Bob',
      color: '#00ff00',
    });
    const presences = globalPresenceStore.getPresences('node1');
    expect(presences).toHaveLength(2);
  });

  it('removePresence removes specific user', () => {
    globalPresenceStore.setPresence('node1', {
      userId: 'alice',
      label: 'Alice',
      color: '#ff0000',
    });
    globalPresenceStore.setPresence('node1', {
      userId: 'bob',
      label: 'Bob',
      color: '#00ff00',
    });
    globalPresenceStore.removePresence('node1', 'alice');
    const presences = globalPresenceStore.getPresences('node1');
    expect(presences).toHaveLength(1);
    expect(presences[0]?.userId).toBe('bob');
  });

  it('clearUser removes all presence for user', () => {
    globalPresenceStore.setPresence('node1', {
      userId: 'alice',
      label: 'Alice',
      color: '#ff0000',
    });
    globalPresenceStore.setPresence('node2', {
      userId: 'alice',
      label: 'Alice',
      color: '#ff0000',
    });
    globalPresenceStore.setPresence('node1', {
      userId: 'bob',
      label: 'Bob',
      color: '#00ff00',
    });
    globalPresenceStore.clearUser('alice');
    expect(globalPresenceStore.getPresences('node1')).toHaveLength(1);
    expect(globalPresenceStore.getPresences('node1')[0]?.userId).toBe('bob');
    expect(globalPresenceStore.getPresences('node2')).toHaveLength(0);
  });

  it('subscribe/notify pattern works', () => {
    let called = 0;
    const unsubscribe = globalPresenceStore.subscribe(() => {
      called++;
    });
    globalPresenceStore.setPresence('node3', {
      userId: 'alice',
      label: 'Alice',
      color: '#ff0000',
    });
    expect(called).toBe(1);
    globalPresenceStore.removePresence('node3', 'alice');
    expect(called).toBe(2);
    unsubscribe();
    globalPresenceStore.setPresence('node3', {
      userId: 'bob',
      label: 'Bob',
      color: '#00ff00',
    });
    expect(called).toBe(2);
  });

  it('returns empty array for unknown node', () => {
    const presences = globalPresenceStore.getPresences('nonexistent');
    expect(presences).toEqual([]);
  });
});
