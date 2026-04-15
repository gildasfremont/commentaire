export interface PositionEntry {
  paragraphIndex: number;
  timestamp: number;
  dwellMs?: number;
}

export interface PositionTracker {
  entries: PositionEntry[];
}

export function createPositionTracker(): PositionTracker {
  return { entries: [] };
}

export function recordPosition(
  tracker: PositionTracker,
  input: { paragraphIndex: number; timestamp: number }
): void {
  tracker.entries.push({
    paragraphIndex: input.paragraphIndex,
    timestamp: input.timestamp,
  });
}

/**
 * Returns the timeline sorted chronologically, with dwell times computed.
 * Dwell time = time spent on a position before moving to the next one.
 */
export function getTimeline(tracker: PositionTracker): PositionEntry[] {
  const sorted = [...tracker.entries].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < sorted.length - 1; i++) {
    sorted[i].dwellMs = sorted[i + 1].timestamp - sorted[i].timestamp;
  }

  return sorted;
}

/**
 * Returns sorted unique paragraph indices that have been visited.
 */
export function getReadParagraphs(tracker: PositionTracker): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const entry of tracker.entries) {
    if (!seen.has(entry.paragraphIndex)) {
      seen.add(entry.paragraphIndex);
      result.push(entry.paragraphIndex);
    }
  }

  return result;
}

export function hasBeenRead(
  tracker: PositionTracker,
  paragraphIndex: number
): boolean {
  return tracker.entries.some((e) => e.paragraphIndex === paragraphIndex);
}
