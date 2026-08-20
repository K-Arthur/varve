/**
 * Demo usage measurement — opt-in, aggregate, and nothing else.
 *
 * The demo bundle is otherwise network-silent: with no analytics domain
 * configured, `configureDesktopAnalytics` selects the no-op provider and every
 * event is discarded before it is built. A deployment that wants counts sets
 * VITE_VARVE_ANALYTICS_DOMAIN, which selects the Plausible provider — cookieless
 * and aggregate.
 *
 * Consent is not re-implemented here. `AnalyticsClient.track()` compares the
 * event's category against stored consent and returns false without queueing
 * anything, so a visitor who has not opted in cannot have an event sent no
 * matter what this module does. The default is 'unknown', which is not
 * 'granted' — silence until someone actively chooses otherwise.
 *
 * One event, already approved in the schema: `browser_demo_launched`, carrying
 * only `entry`. No document content, no filenames, no layer names, no
 * identifiers, nothing per-visitor.
 */

import {
  getDesktopAnalytics,
  loadSettings,
  updateDesktopAnalyticsConsent,
  updateSettings,
} from '@varve/editor';

/** Fired at most once per tab, so a reload is not a second "launch". */
const LAUNCH_KEY = 'varve-demo-launch-counted';

export type DemoAnalyticsChoice = 'unknown' | 'granted' | 'denied';

export function readDemoAnalyticsChoice(): DemoAnalyticsChoice {
  try {
    return loadSettings().privacy.usageAnalytics;
  } catch {
    // Settings live in localStorage, which throws in strict privacy modes.
    // Treat that as "not asked", which behaves as denied.
    return 'unknown';
  }
}

/**
 * Count one demo launch. Safe to call unconditionally: without consent the
 * client drops it, and without a configured domain there is nowhere to send it.
 */
export function trackDemoLaunched(): void {
  try {
    if (sessionStorage.getItem(LAUNCH_KEY) === '1') return;
    const sent = getDesktopAnalytics().track('browser_demo_launched', { entry: 'direct' });
    // Only mark it counted if it was actually accepted, so granting consent
    // later in the same visit still records the launch.
    if (sent) sessionStorage.setItem(LAUNCH_KEY, '1');
  } catch {
    // Never let measurement break the demo.
  }
}

/**
 * Record the visitor's choice and apply it immediately.
 *
 * Granting also counts the launch that consent was not yet available for, so
 * opting in mid-visit is not silently lost.
 */
export function setDemoAnalyticsChoice(choice: 'granted' | 'denied'): void {
  try {
    const next = updateSettings({ privacy: { usageAnalytics: choice } });
    updateDesktopAnalyticsConsent(next.privacy);
    if (choice === 'granted') trackDemoLaunched();
  } catch {
    // A visitor who cannot persist a choice keeps the default: no tracking.
  }
}
