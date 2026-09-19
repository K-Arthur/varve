/**
 * PluginSections — the governed host renderer for plugin-contributed
 * Inspector sections.
 *
 * This is the ONLY route a plugin contribution has into the panel. The host:
 * - subscribes to the contribution registry (install/disable/hide lifecycle),
 * - filters by tab and evaluates availability through safeCheckAvailability
 *   (a throwing predicate cannot crash the panel),
 * - renders each contribution inside a section-scoped error boundary (a
 *   throwing render factory marks its plugin errored and shows a quiet
 *   placeholder),
 * - wraps bodies in the shared disclosure grammar so contributions cannot
 *   introduce arbitrary chrome, ordering, or accessibility patterns.
 *
 * Plugins never receive document or editor state — only the read-only
 * PluginSectionHostContext. See pluginSections.ts for the contract and
 * docs/architecture/inspector-feature-ownership.md for the host boundary.
 */
import { Component, type ReactNode, useEffect, useState } from 'react';
import { DisclosureSection } from './controls/DisclosureSection';
import {
  getContributionsForTab,
  markPluginError,
  onContributionsChange,
  type PluginSectionContribution,
  type PluginSectionHostContext,
  qualifyContribution,
  safeCheckAvailability,
} from './pluginSections';

interface BoundaryState {
  failed: boolean;
}

/**
 * Section-scoped boundary: one broken contribution costs one placeholder, not
 * the panel. The app-level ErrorBoundary is deliberately not used here — its
 * reload chrome targets page-level surfaces.
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
    if (this.state.failed) {
      return (
        <p className="insp-empty-message" role="status">
          {this.props.contrib.display.title} could not be rendered. The plugin that provides it was
          disabled.
        </p>
      );
    }
    return this.props.children;
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
  return <>{contrib.render(host)}</>;
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

export function PluginSections({ tab, host }: { tab: string; host: PluginSectionHostContext }) {
  const [contributions, setContributions] = useState<PluginSectionContribution[]>(() =>
    getContributionsForTab(tab),
  );

  useEffect(() => {
    const sync = () => setContributions(getContributionsForTab(tab));
    sync();
    return onContributionsChange(sync);
  }, [tab]);

  const available = contributions.filter((contrib) => safeCheckAvailability(contrib, host).ok);

  if (available.length === 0) return null;

  return (
    <div className="insp-plugin-sections" data-inspector-plugin-sections={tab}>
      {available.map((contrib) => {
        const qualifiedId = qualifyContribution(contrib);
        return (
          <DisclosureSection
            key={qualifiedId}
            title={contrib.display.title}
            id={`plugin-${qualifiedId.replace(/\//g, '-')}`}
            defaultExpanded={contrib.defaultExpanded ?? true}
          >
            <PluginSectionBody contrib={contrib} host={host} />
          </DisclosureSection>
        );
      })}
    </div>
  );
}
