import { formatShortcut, SHORTCUT_DEFS } from '../shortcuts/ShortcutManager';
import type { ActionTracker } from './actionTracker';

export interface ShortcutRecommendation {
  actionId: string;
  shortcutId: string;
  shortcutLabel: string;
  usageCount: number;
  message: string;
}

function actionToShortcutId(actionId: string): string | null {
  if (actionId.startsWith('menu:')) {
    return actionId.slice(5);
  }
  if (actionId.startsWith('tool:')) {
    const suffix = actionId.slice(5);
    return `tool${suffix.charAt(0).toUpperCase() + suffix.slice(1)}`;
  }
  return null;
}

function isMenuOrToolAction(actionId: string): boolean {
  return actionId.startsWith('menu:') || actionId.startsWith('tool:');
}

export function recommendShortcuts(
  tracker: ActionTracker,
  maxResults: number = 3,
): ShortcutRecommendation[] {
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const recentActions = tracker.getRecentActions(windowMs);

  const freqMap = new Map<string, number>();
  for (const r of recentActions) {
    freqMap.set(r.actionId, (freqMap.get(r.actionId) ?? 0) + 1);
  }

  const recommendations: ShortcutRecommendation[] = [];

  for (const [actionId, count] of freqMap) {
    if (count <= 5) continue;
    if (!isMenuOrToolAction(actionId)) continue;

    const shortcutId = actionToShortcutId(actionId);
    if (!shortcutId) continue;
    if (!(shortcutId in SHORTCUT_DEFS)) continue;

    const shortcutDef = SHORTCUT_DEFS[shortcutId as keyof typeof SHORTCUT_DEFS];
    if (!shortcutDef) continue;

    const shortcutActionId = `shortcut:${shortcutId}`;
    const shortcutCount = freqMap.get(shortcutActionId) ?? 0;
    if (shortcutCount >= 2) continue;

    const bindingStr = formatShortcut(shortcutDef.binding);
    const actionName = shortcutDef.label;

    recommendations.push({
      actionId,
      shortcutId,
      shortcutLabel: actionName,
      usageCount: count,
      message: `You've used ${actionName} ${count} times this week. Try ${bindingStr}.`,
    });
  }

  return recommendations.sort((a, b) => b.usageCount - a.usageCount).slice(0, maxResults);
}
