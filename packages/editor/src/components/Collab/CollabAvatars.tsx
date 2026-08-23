import { Tooltip } from '@varve/ui';
import { useCollab } from './CollabProvider';

const MAX_VISIBLE = 3;

export function CollabAvatars() {
  const { users } = useCollab();
  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = Math.max(0, users.length - MAX_VISIBLE);

  if (users.length === 0) return null;

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: div with role="group" is intentional for flex layout */}
      <div className="collab-avatars" role="group" aria-label="Active collaborators">
        {visible.map((user) => (
          <Tooltip key={user.id} label={user.name}>
            <div
              className="collab-avatars__item"
              role="img"
              aria-label={`Collaborator: ${user.name}`}
              style={{ background: user.color }}
            >
              {user.avatar ? (
                <img src={user.avatar} alt={user.name} className="collab-avatars__img" />
              ) : (
                <span className="collab-avatars__initial">{user.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
          </Tooltip>
        ))}
        {overflow > 0 && (
          <Tooltip label={`${overflow} more collaborator${overflow > 1 ? 's' : ''}`}>
            <div
              className="collab-avatars__item collab-avatars__item--overflow"
              role="img"
              aria-label={`${overflow} more collaborators`}
            >
              <span className="collab-avatars__initial">+{overflow}</span>
            </div>
          </Tooltip>
        )}
      </div>
    </>
  );
}
