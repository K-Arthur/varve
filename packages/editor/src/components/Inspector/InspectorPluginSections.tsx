/**
 * Host renderer for trusted, in-process Inspector contributions.
 *
 * This is the route bundled contributions have into the panel. The host:
 * - subscribes to the contribution registry (register/disable/hide lifecycle),
 * - filters by tab and evaluates availability through safeCheckAvailability
 *   (a throwing predicate cannot crash the panel),
 * - quarantines a plugin after a synchronous predicate/render failure and
 *   shows a diagnostic with an explicit retry action,
 * - wraps bodies in the shared disclosure grammar. Trusted render callbacks
 *   can still render arbitrary content inside that host-owned shell.
 *
 * The summary context limits accidental coupling. It does not confine code
 * running in the editor realm. React boundaries do not catch event-handler
 * errors or rejected promises.
 */
import { Component, type ReactNode, useEffect, useState } from 'react';
import { DisclosureSection } from './controls/DisclosureSection';
import {
  getContributionsForTab,
  getRegisteredPlugins,
  markPluginError,
  onContributionsChange,
  type PluginSectionContribution,
  type PluginSectionHostContext,
  qualifyContribution,
  retryPlugin,
  safeCheckAvailability,
} from './pluginSections';

interface BoundaryState {
  failed: boolean;
}

/**
 * Section-scoped boundary: a synchronous render failure quarantines its
 * plugin, while the rest of the panel stays mounted.
 */
class ContributionBoundary extends Component<
  { contrib: PluginSectionContribution; children: ReactNode },
  BoundaryState
> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    markPluginError(this.props.contrib.pluginId, error.message);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Invokes the factory in its own component so a throw happens in a CHILD of
 * the boundary — an error boundary cannot catch exceptions raised during its
 * own subtree construction above it.
 */
function FactoryInvoke({
  contrib,
  host,
}: {
  contrib: PluginSectionContribution;
  host: PluginSectionHostContext;
}) {
  if (!contrib.render) return null;
  return <>{contrib.render(Object.freeze({ ...host }))}</>;
}

function PluginSectionBody({
  contrib,
  host,
}: {
  contrib: PluginSectionContribution;
  host: PluginSectionHostContext;
}) {
  return (
    <ContributionBoundary contrib={contrib}>
      <FactoryInvoke contrib={contrib} host={host} />
    </ContributionBoundary>
  );
}

interface PluginSectionsSnapshot {
  contributions: PluginSectionContribution[];
  errors: { pluginId: string; name: string; error: string }[];
}

function readSnapshot(tab: string): PluginSectionsSnapshot {
  const canonicalTab = tab === 'document' ? 'properties' : tab;
  return {
    contributions: getContributionsForTab(canonicalTab),
    errors: getRegisteredPlugins()
      .filter(
        (plugin) =>
          plugin.status === 'error' &&
          plugin.manifest.contributions.some((contrib) => contrib.targetTab === canonicalTab),
      )
      .map((plugin) => ({
        pluginId: plugin.manifest.id,
        name: plugin.manifest.name,
        error: plugin.error ?? 'Unknown error',
      })),
  };
}

/** Stable, injective key for legacy disclosure persistence; DOM IDs use React useId. */
export function contributionDisclosureId(contrib: PluginSectionContribution): string {
  return `plugin-${encodeURIComponent(qualifyContribution(contrib))}`;
}

export function PluginSections({ tab, host }: { tab: string; host: PluginSectionHostContext }) {
  const [snapshot, setSnapshot] = useState<PluginSectionsSnapshot>(() => readSnapshot(tab));

  useEffect(() => {
    const sync = () => setSnapshot(readSnapshot(tab));
    sync();
    return onContributionsChange(sync);
  }, [tab]);

  const predicateErrors: { pluginId: string; name: string; error: string }[] = [];
  const available = snapshot.contributions.filter((contrib) => {
    const result = safeCheckAvailability(contrib, host);
    if (result.error) {
      predicateErrors.push({
        pluginId: contrib.pluginId,
        name: contrib.display.title,
        error: result.error,
      });
    }
    return result.ok;
  });

  useEffect(() => {
    for (const failure of predicateErrors) markPluginError(failure.pluginId, failure.error);
  });

  const errors = [...snapshot.errors, ...predicateErrors].filter(
    (error, index, all) =>
      all.findIndex((candidate) => candidate.pluginId === error.pluginId) === index,
  );

  const requestRetry = (pluginId: string) => {
    const event = new CustomEvent('varve:plugin-recovery', {
      cancelable: true,
      detail: { pluginId },
    });
    if (window.dispatchEvent(event)) retryPlugin(pluginId);
  };

  if (available.length === 0 && errors.length === 0) return null;

  return (
    <div className="insp-plugin-sections" data-inspector-plugin-sections={tab}>
      {errors.map((failure) => (
        <div className="insp-empty-message" role="alert" key={`error-${failure.pluginId}`}>
          {failure.name} stopped: {failure.error}.{' '}
          <button type="button" onClick={() => requestRetry(failure.pluginId)}>
            Retry plugin
          </button>
        </div>
      ))}
      {available.map((contrib) => {
        const qualifiedId = qualifyContribution(contrib);
        return (
          <DisclosureSection
            key={qualifiedId}
            title={contrib.display.title}
            id={contributionDisclosureId(contrib)}
            defaultExpanded={contrib.defaultExpanded ?? true}
          >
            <PluginSectionBody contrib={contrib} host={host} />
          </DisclosureSection>
        );
      })}
    </div>
  );
}
