import type { NodeId } from '@strata/scene';

export interface PresenceData {
  userId: string;
  label: string;
  color: string;
}

export function PresenceIndicator({
  presences,
  maxAvatars = 3,
}: {
  presences: PresenceData[];
  maxAvatars?: number;
}) {
  if (presences.length === 0) return null;

  const visible = presences.slice(0, maxAvatars);
  const overflow = presences.length - maxAvatars;

  return (
    <span
      className="layers-row__presence"
      role="group"
      aria-label={`${presences.length} collaborators`}
    >
      {visible.map((p) => (
        <span
          key={p.userId}
          className="layers-row__presence-avatar"
          style={{ backgroundColor: p.color }}
          title={p.label}
          aria-label={p.label}
        >
          {p.label.charAt(0).toUpperCase()}
        </span>
      ))}
      {overflow > 0 && (
        <span className="layers-row__presence-overflow" title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </span>
  );
}
