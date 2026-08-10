import type { Platform } from '@varve/platform';
import { formatRelativeTime } from '@varve/platform';
import { Icon, InlineActivityIndicator, Tooltip } from '@varve/ui';
import { Fragment, useCallback, useEffect, useState } from 'react';

export interface ActivityFeedProps {
  platform: Platform;
  workspaceId: string;
  onOpenFile?: (fileId: string) => void;
  filterTypes?: string[];
  viewAllLink?: boolean;
  onViewAll?: () => void;
}

type TimePeriod = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'older';

const PERIOD_LABELS: Record<TimePeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
};

const PERIOD_ORDER: TimePeriod[] = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'older'];

interface RawEvent {
  id: string;
  workspaceId: string;
  fileId?: string;
  projectId?: string;
  type: string;
  timestamp: number;
  metadata?: Record<string, string>;
}

function getPeriod(timestamp: number, now: number): TimePeriod {
  const diff = now - timestamp;
  if (diff < 86400000) return 'today';
  if (diff < 172800000) return 'yesterday';
  if (diff < 604800000) return 'thisWeek';
  if (diff < 2592000000) return 'thisMonth';
  return 'older';
}

const EVENT_ICONS: Record<string, 'FilePlus' | 'FilePenLine' | 'Share2' | 'Trash2' | 'RotateCcw'> =
  {
    created: 'FilePlus',
    modified: 'FilePenLine',
    shared: 'Share2',
    trashed: 'Trash2',
    restored: 'RotateCcw',
  };

const EVENT_VERBS: Record<string, string> = {
  created: 'created',
  modified: 'modified',
  shared: 'shared',
  trashed: 'moved to trash',
  restored: 'restored',
};

interface EventDisplay {
  id: string;
  type: string;
  timestamp: number;
  label: string;
  verb: string;
  fileName?: string;
  icon: 'FilePlus' | 'FilePenLine' | 'Share2' | 'Trash2' | 'RotateCcw';
  onOpen?: () => void;
}

interface PeriodGroup {
  period: TimePeriod;
  label: string;
  events: EventDisplay[];
}

function groupEvents(events: RawEvent[], onOpenFile?: (fileId: string) => void): PeriodGroup[] {
  const now = Date.now();
  const groups = new Map<TimePeriod, EventDisplay[]>();

  for (const event of events) {
    const period = getPeriod(event.timestamp, now);
    const list = groups.get(period) ?? [];
    list.push({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      label: EVENT_VERBS[event.type] ?? event.type,
      verb: EVENT_VERBS[event.type] ?? event.type,
      fileName: event.metadata?.fileName,
      icon: EVENT_ICONS[event.type] ?? 'FilePenLine',
      onOpen: event.fileId && onOpenFile ? () => onOpenFile(event.fileId!) : undefined,
    });
    groups.set(period, list);
  }

  return PERIOD_ORDER.filter((p) => groups.has(p)).map((period) => ({
    period,
    label: PERIOD_LABELS[period],
    events: (groups.get(period) ?? []).sort((a, b) => b.timestamp - a.timestamp),
  }));
}

export function ActivityFeed({
  platform,
  workspaceId,
  onOpenFile,
  filterTypes,
  viewAllLink,
  onViewAll,
}: ActivityFeedProps) {
  const [events, setEvents] = useState<RawEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await platform.listActivity(workspaceId, 50);
      setEvents(list as unknown as RawEvent[]);
    } catch {
      setError('Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, platform]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const filteredEvents = filterTypes ? events.filter((e) => filterTypes.includes(e.type)) : events;

  const groups = groupEvents(filteredEvents, onOpenFile);

  if (loading) {
    return (
      <section className="activity-feed" aria-label="Activity feed">
        <div className="activity-feed__loading" role="status">
          <InlineActivityIndicator label="Loading activity" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="activity-feed" aria-label="Activity feed">
        <div className="activity-feed__error" role="alert">
          <Icon name="CircleAlert" label={undefined} />
          <span>{error}</span>
        </div>
      </section>
    );
  }

  const isEmpty = filteredEvents.length === 0;

  return (
    <section
      className={`activity-feed${isEmpty ? ' activity-feed--empty' : ''}`}
      aria-label="Activity feed"
    >
      {isEmpty ? (
        <div className="activity-feed__empty">
          <Icon name="ClockArrowUp" size={40} label={undefined} />
          <p className="activity-feed__empty-title">No recent activity</p>
          <p className="activity-feed__empty-desc">
            Activity from your workspace will appear here.
          </p>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.period} className="activity-feed__group">
            <div className="activity-feed__group-label">{group.label}</div>
            <div className="activity-feed__events">
              {group.events.map((event) => {
                const trigger = (
                  <button
                    key={event.id}
                    type="button"
                    className="activity-feed__event"
                    onClick={event.onOpen}
                    disabled={!event.onOpen}
                  >
                    <div className="activity-feed__event-icon" aria-hidden>
                      <Icon name={event.icon} label={undefined} />
                    </div>
                    <div className="activity-feed__event-body">
                      <span className="activity-feed__event-text">
                        {event.fileName ? (
                          <>
                            <strong>{event.fileName}</strong> {event.verb}
                          </>
                        ) : (
                          event.verb
                        )}
                      </span>
                      <span className="activity-feed__event-time">
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </div>
                  </button>
                );
                return event.onOpen && event.fileName ? (
                  <Tooltip key={event.id} label={`Open ${event.fileName}`}>
                    {trigger}
                  </Tooltip>
                ) : (
                  <Fragment key={event.id}>{trigger}</Fragment>
                );
              })}
            </div>
          </div>
        ))
      )}
      {viewAllLink && onViewAll && (
        <button type="button" className="activity-feed__view-all" onClick={onViewAll}>
          View all activity
        </button>
      )}
    </section>
  );
}
