/**
 * Privacy-first usage time tracking for /try/ browser demo.
 *
 * Respects DNT/GPC, requires opt-in consent, no cookies, no IDs.
 * Tracks only active time (tab visible, not idle >60s).
 * Sends ONE bucketed event per session on pagehide via sendBeacon.
 */

const IDLE_THRESHOLD_MS = 60_000; // 60 seconds
const CHECK_INTERVAL_MS = 1000; // 1 second
const GOATCOUNTER_DOMAIN = 'varve.goatcounter.com';

type TimeBucket =
  | 'demo-time-lt1m'
  | 'demo-time-1-5m'
  | 'demo-time-5-15m'
  | 'demo-time-15-30m'
  | 'demo-time-30m-plus';

interface UsageTimeTracker {
  start(): void;
  stop(): void;
}

function hasConsent(): boolean {
  // Check DNT/GPC signals
  const nav = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    doNotTrack?: string | null;
    msDoNotTrack?: string | null;
  };

  if (nav.globalPrivacyControl === true) return false;
  if (nav.doNotTrack === '1' || nav.msDoNotTrack === '1') return false;

  // Check localStorage consent (same key as website analytics)
  try {
    const consent = localStorage.getItem('varve-analytics-consent');
    return consent === 'granted';
  } catch {
    return false;
  }
}

function bucketTime(milliseconds: number): TimeBucket {
  const minutes = milliseconds / 60_000;
  if (minutes < 1) return 'demo-time-lt1m';
  if (minutes < 5) return 'demo-time-1-5m';
  if (minutes < 15) return 'demo-time-5-15m';
  if (minutes < 30) return 'demo-time-15-30m';
  return 'demo-time-30m-plus';
}

function sendBeacon(bucket: TimeBucket): void {
  if (!hasConsent()) return;

  const endpoint = `https://${GOATCOUNTER_DOMAIN}/count`;
  const url = new URL(endpoint);
  url.searchParams.set('p', bucket);
  url.searchParams.set('e', 'true'); // Mark as event, not pageview
  url.searchParams.set('ns', 'true'); // No session tracking

  try {
    // Use sendBeacon for reliable delivery during page unload
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url.toString());
    } else {
      // Fallback for browsers without sendBeacon
      fetch(url.toString(), {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
      }).catch(() => {
        // Ignore errors during unload
      });
    }
  } catch {
    // Ignore errors
  }
}

export function createUsageTimeTracker(): UsageTimeTracker {
  let activeTimeMs = 0;
  let lastActivityTime = Date.now();
  let isVisible = !document.hidden;
  let intervalId: number | null = null;
  let beaconSent = false;

  function updateActivity() {
    lastActivityTime = Date.now();
  }

  function tick() {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;

    // Only count time if tab is visible and not idle
    if (isVisible && timeSinceActivity < IDLE_THRESHOLD_MS) {
      activeTimeMs += CHECK_INTERVAL_MS;
    }
  }

  function handleVisibilityChange() {
    isVisible = !document.hidden;
    if (isVisible) {
      // Reset activity time when tab becomes visible again
      updateActivity();
    }
  }

  function sendUsageBeacon() {
    if (beaconSent) return; // Only send once per session
    if (activeTimeMs === 0) return; // Don't send if no active time

    const bucket = bucketTime(activeTimeMs);
    sendBeacon(bucket);
    beaconSent = true;
  }

  function start() {
    if (!hasConsent()) return;

    // Track user activity
    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    for (const event of activityEvents) {
      document.addEventListener(event, updateActivity, { passive: true });
    }

    // Track visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start interval timer
    intervalId = window.setInterval(tick, CHECK_INTERVAL_MS);

    // Send beacon on page unload
    window.addEventListener('pagehide', sendUsageBeacon, { capture: true });
    window.addEventListener('beforeunload', sendUsageBeacon, { capture: true });

    // Also send when visibility is hidden (for mobile browsers)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        sendUsageBeacon();
      }
    });
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    sendUsageBeacon();
  }

  return { start, stop };
}
