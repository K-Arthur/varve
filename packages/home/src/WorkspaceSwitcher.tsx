import { SolidIcon, Popover, SOLID_CHROME_ICONS } from '@strata/ui';
import { type KeyboardEvent, useCallback, useState } from 'react';

export interface WorkspaceSwitcherProps {
  workspaces: Array<{ id: string; name: string; kind: string }>;
  activeId: string;
  onSwitch: (id: string) => void;
}

export function WorkspaceSwitcher({ workspaces, activeId, onSwitch }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);

  const activeWorkspace = workspaces.find((w) => w.id === activeId);
  const label = activeWorkspace?.name ?? 'Personal';

  const handleKeyDown = useCallback(
    (e: KeyboardEvent, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSwitch(id);
        setOpen(false);
      }
    },
    [onSwitch],
  );

  const popover = (
    <div className="workspace-switcher__dropdown">
      <div className="workspace-switcher__header">Workspaces</div>
      {workspaces.length === 0 ? (
        <div className="workspace-switcher__empty">No workspaces</div>
      ) : (
        workspaces.map((w) => {
          const isActive = w.id === activeId;
          return (
            <button
              key={w.id}
              type="button"
              className={`workspace-switcher__item ${isActive ? 'workspace-switcher__item--active' : ''}`}
              onClick={() => {
                onSwitch(w.id);
                setOpen(false);
              }}
              onKeyDown={(e) => handleKeyDown(e, w.id)}
              role="option"
              aria-selected={isActive}
            >
              <span className="workspace-switcher__item-icon">
                <SolidIcon
                  name={w.kind === 'team' ? SOLID_CHROME_ICONS.users : SOLID_CHROME_ICONS.user}
                  label={undefined}
                  size="1em"
                />
              </span>
              <span className="workspace-switcher__item-name">{w.name}</span>
              {isActive && (
                <SolidIcon
                  name={SOLID_CHROME_ICONS.check}
                  label={undefined}
                  size="0.85em"
                  className="workspace-switcher__check"
                />
              )}
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <Popover popover={popover} placement="bottom" open={open} onOpenChange={setOpen}>
      <button type="button" className="workspace-switcher" aria-label="Switch workspace">
        <SolidIcon name={SOLID_CHROME_ICONS.layoutGrid} label={undefined} size="1em" />
        <span className="workspace-switcher__label">{label}</span>
        <SolidIcon name={SOLID_CHROME_ICONS.chevronDown} label={undefined} size="0.85em" />
      </button>
    </Popover>
  );
}
