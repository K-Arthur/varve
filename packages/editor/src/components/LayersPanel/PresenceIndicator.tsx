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
    <section
      className="layers-row__presence"
      aria-label={`${presences.length} collaborators`}
    >
      {visible.map((p) => (
        <div
          key={p.userId}
          className="layers-row__presence-avatar"
          style={{ backgroundColor: p.color }}
          title={p.label}
          aria-label={p.label}
          role="img"
        >
          {p.label.charAt(0).toUpperCase()}
        </div>
      ))}
      {overflow > 0 && (
        <span className="layers-row__presence-overflow" title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </section>
  );
}
