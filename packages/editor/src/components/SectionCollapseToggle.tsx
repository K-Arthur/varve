/**
 * Collapse control for a sidebar section header.
 *
 * The left sidebar stacks several sections — minimap, masters, spreads,
 * variables, selection sets — above the layers tree in one fixed-height
 * column, so any section that cannot be put away keeps the tree short for the
 * whole session. Each section owns its own collapsed state; this is only the
 * shared affordance, so the chevron, its rotation, hit area and labelling stay
 * identical everywhere rather than being re-implemented per section.
 */
import { Tooltip } from '@strata/ui';
import './section-collapse.css';

export interface SectionCollapseToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Section name, used to build the accessible label ("Hide layers"). */
  label: string;
  /** Id of the region this controls, for `aria-controls`. */
  controls?: string;
}

export function SectionCollapseToggle({
  collapsed,
  onToggle,
  label,
  controls,
}: SectionCollapseToggleProps) {
  const action = collapsed ? `Show ${label}` : `Hide ${label}`;
  return (
    <Tooltip label={action}>
      <button
        type="button"
        className="section-collapse-btn"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={action}
        {...(controls ? { 'aria-controls': controls } : {})}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={collapsed ? 'section-collapse-btn__icon--collapsed' : undefined}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </Tooltip>
  );
}
