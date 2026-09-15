export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ClassificationResult {
  level: SkillLevel;
  confidence: number;
  reasons: string[];
}

export interface ActionStats {
  /** Number of keyboard shortcut uses */
  shortcutCount: number;
  /** Whether user opened an existing file vs new */
  openedExistingFile: boolean;
  /** Whether user created a frame with children */
  createdFrameWithChildren: boolean;
  /** Average time between actions in seconds */
  avgActionTimeSec: number;
  /** Whether user used color picker or typography controls */
  usedStyleControls: boolean;
  /** Number of nodes created */
  nodesCreated: number;
  /** Total session time in seconds */
  sessionTimeSec: number;
  /** Number of unique tools used */
  uniqueToolsUsed: number;
}

export function classifySkill(stats: ActionStats): ClassificationResult {
  const reasons: string[] = [];

  if (stats.shortcutCount >= 3 && stats.avgActionTimeSec < 3) {
    reasons.push('Uses keyboard shortcuts frequently');
    reasons.push('Fast action cadence');
    return { level: 'advanced', confidence: 0.9, reasons };
  }

  if (stats.shortcutCount >= 1) {
    reasons.push('Uses keyboard shortcuts');
  }

  if (stats.usedStyleControls) {
    reasons.push('Uses color/typography controls');
  }

  if (stats.openedExistingFile) {
    reasons.push('Opened existing file');
    if (stats.uniqueToolsUsed >= 4) {
      reasons.push('Uses diverse toolset');
      return { level: 'intermediate', confidence: 0.7, reasons };
    }
  }

  if (stats.createdFrameWithChildren && stats.nodesCreated >= 3) {
    reasons.push('Creates structured content (frames with children)');
    if (stats.uniqueToolsUsed >= 3) {
      return { level: 'intermediate', confidence: 0.65, reasons };
    }
  }

  if (stats.nodesCreated >= 3 && stats.sessionTimeSec < 300) {
    reasons.push('Creates content at moderate pace');
    return { level: 'intermediate', confidence: 0.55, reasons };
  }

  reasons.push('No advanced patterns detected — starting with basics');
  return { level: 'beginner', confidence: 0.8, reasons };
}

export function classifyFromActionTracker(tracker: {
  getCount: (id: string, windowMs?: number) => number;
  getRecentActions: (windowMs: number) => Array<{ actionId: string; timestamp: number }>;
  getTotalCount: () => number;
}): ClassificationResult {
  const recentActions = tracker.getRecentActions(120_000);
  void tracker.getTotalCount();

  if (recentActions.length < 2) {
    return { level: 'beginner', confidence: 0.5, reasons: ['Not enough data yet'] };
  }

  const shortcutCount = tracker.getCount('shortcut:', 120_000);

  const toolActions = recentActions.filter((a) => a.actionId.startsWith('tool:'));
  const uniqueTools = new Set(toolActions.map((a) => a.actionId));
  const styleActions = recentActions.filter(
    (a) =>
      a.actionId.startsWith('menu:color') ||
      a.actionId.startsWith('menu:fill') ||
      a.actionId.startsWith('menu:typography'),
  );

  let totalTime = 0;
  if (recentActions.length >= 2) {
    const lastTs = recentActions[recentActions.length - 1]?.timestamp;
    const firstTs = recentActions[0]?.timestamp;
    if (lastTs != null && firstTs != null) {
      totalTime = lastTs - firstTs;
    }
  }
  const avgActionTimeSec =
    recentActions.length > 1 ? totalTime / (recentActions.length - 1) / 1000 : 0;

  const stats: ActionStats = {
    shortcutCount,
    openedExistingFile:
      tracker.getCount('menu:openFile', 300_000) > 0 ||
      tracker.getCount('menu:openRecent', 300_000) > 0,
    createdFrameWithChildren: tracker.getCount('tool:frame', 300_000) > 0,
    avgActionTimeSec,
    usedStyleControls: styleActions.length > 0,
    nodesCreated: tracker.getCount('op:createNode', 300_000),
    sessionTimeSec: Math.min(totalTime / 1000, 600),
    uniqueToolsUsed: uniqueTools.size,
  };

  return classifySkill(stats);
}
