import { useMemo, useRef } from 'react';

export interface PerfProfileProps {
  fileCount: number;
  renderStartTime: number;
  searchResultCount: number;
}

export function PerfProfile({
  fileCount,
  renderStartTime,
  searchResultCount,
}: PerfProfileProps) {
  const renderTime = useMemo(
    () => Math.round(performance.now() - renderStartTime),
    [renderStartTime],
  );
  const stableFileCount = useRef(fileCount);
  stableFileCount.current = fileCount;

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="perf-profile" aria-label="Performance profile" role="status">
      <span className="perf-profile__stat">
        <span className="perf-profile__label">files</span>
        <span className="perf-profile__value">{fileCount}</span>
      </span>
      <span className="perf-profile__divider" aria-hidden />
      <span className="perf-profile__stat">
        <span className="perf-profile__label">render</span>
        <span className="perf-profile__value">{renderTime}ms</span>
      </span>
      <span className="perf-profile__divider" aria-hidden />
      <span className="perf-profile__stat">
        <span className="perf-profile__label">results</span>
        <span className="perf-profile__value">{searchResultCount}</span>
      </span>
    </div>
  );
}
