/**
 * Audit Profile Switcher
 *
 * Component for switching between audit profiles.
 * Profiles define which rules are enabled and their severity levels.
 * Workspace-aware profiles adapt to the current workspace mode.
 *
 * @module AuditProfileSwitcher
 */

import type { EditorMode, WorkspaceMode } from '@varve/shared';
import { Icon } from '@varve/ui';
import { useState } from 'react';
import './audit.css';

/**
 * Audit profile definition.
 */
export interface AuditProfile {
  /** Profile ID */
  id: string;

  /** Profile name */
  name: string;

  /** Profile description */
  description: string;

  /**
   * Contexts this profile applies to — either a workspace mode (e.g.
   * 'design', 'motion') or a transient editor mode (e.g. 'prototype-linking',
   * 'export-preflight'). The two are intentionally mixed here: a profile can
   * be scoped to a whole workspace or to a specific in-editor activity.
   */
  applicableModes: Array<WorkspaceMode | EditorMode>;

  /** Enabled rule IDs (empty = all rules enabled) */
  enabledRules?: string[];

  /** Disabled rule IDs */
  disabledRules?: string[];

  /** Severity overrides */
  severityOverrides?: Record<string, 'error' | 'warning' | 'suggestion' | 'advisory'>;

  /** Whether this is a workspace-specific profile */
  workspaceSpecific?: boolean;
}

/**
 * Default audit profiles.
 */
export const DEFAULT_PROFILES: AuditProfile[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'All rules with default severity',
    applicableModes: ['design', 'motion', 'prototype-linking', 'export-preflight'],
  },
  {
    id: 'strict',
    name: 'Strict',
    description: 'Elevated severity for warnings',
    applicableModes: ['design', 'motion', 'prototype-linking', 'export-preflight'],
  },
  {
    id: 'accessibility',
    name: 'Accessibility',
    description: 'Focus on accessibility rules',
    applicableModes: ['design', 'motion', 'prototype-linking', 'export-preflight'],
    enabledRules: ['contrast', 'touch-target', 'focus-order'],
  },
  {
    id: 'export',
    name: 'Export',
    description: 'Export-specific checks',
    applicableModes: ['export-preflight'],
    workspaceSpecific: true,
  },
  {
    id: 'prototype',
    name: 'Prototype',
    description: 'Prototype-specific checks',
    applicableModes: ['prototype-linking'],
    workspaceSpecific: true,
  },
  {
    id: 'design',
    name: 'Design',
    description: 'Design workspace checks',
    applicableModes: ['design'],
    workspaceSpecific: true,
  },
  {
    id: 'motion',
    name: 'Motion',
    description: 'Motion workspace checks',
    applicableModes: ['motion'],
    workspaceSpecific: true,
  },
];

interface AuditProfileSwitcherProps {
  /** Current profile ID */
  currentProfileId: string;

  /** Current workspace mode */
  currentMode: WorkspaceMode;

  /** On profile change */
  onProfileChange: (profileId: string) => void;

  /** Custom profiles (optional) */
  profiles?: AuditProfile[];
}

/**
 * Audit profile switcher component.
 */
export function AuditProfileSwitcher({
  currentProfileId,
  currentMode,
  onProfileChange,
  profiles = DEFAULT_PROFILES,
}: AuditProfileSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Filter profiles by current mode
  const applicableProfiles = profiles.filter((profile) =>
    profile.applicableModes.includes(currentMode),
  );

  // Separate workspace-specific profiles from general profiles
  const generalProfiles = applicableProfiles.filter((p) => !p.workspaceSpecific);
  const workspaceProfiles = applicableProfiles.filter((p) => p.workspaceSpecific);

  const currentProfile = applicableProfiles.find((p) => p.id === currentProfileId);

  return (
    <div className="audit-profile-switcher">
      <button
        type="button"
        className="audit-profile-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Icon name="Settings" size="1em" />
        <span className="audit-profile-label">{currentProfile?.name || 'Standard'}</span>
        <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size="0.8em" />
      </button>

      {isOpen && (
        <div className="audit-profile-dropdown" role="listbox">
          {/* General profiles */}
          {generalProfiles.length > 0 && (
            <div className="audit-profile-section">
              <span className="audit-profile-section-label">General</span>
              {generalProfiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  className={`audit-profile-option ${profile.id === currentProfileId ? 'active' : ''}`}
                  role="option"
                  aria-selected={profile.id === currentProfileId}
                  onClick={() => {
                    onProfileChange(profile.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="audit-profile-option-header">
                    <span className="audit-profile-option-name">{profile.name}</span>
                    {profile.id === currentProfileId && <Icon name="Check" size="1em" />}
                  </div>
                  <span className="audit-profile-option-description">{profile.description}</span>
                </button>
              ))}
            </div>
          )}

          {/* Workspace-specific profiles */}
          {workspaceProfiles.length > 0 && (
            <div className="audit-profile-section">
              <span className="audit-profile-section-label">
                {capitalize(currentMode)} Workspace
              </span>
              {workspaceProfiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  className={`audit-profile-option ${profile.id === currentProfileId ? 'active' : ''}`}
                  role="option"
                  aria-selected={profile.id === currentProfileId}
                  onClick={() => {
                    onProfileChange(profile.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="audit-profile-option-header">
                    <span className="audit-profile-option-name">{profile.name}</span>
                    {profile.id === currentProfileId && <Icon name="Check" size="1em" />}
                  </div>
                  <span className="audit-profile-option-description">{profile.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Capitalize first letter.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
