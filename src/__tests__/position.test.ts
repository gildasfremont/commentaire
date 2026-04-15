import { describe, it, expect, beforeEach } from "vitest";
import {
  createPositionTracker,
  recordPosition,
  getReadParagraphs,
  hasBeenRead,
  getTimeline,
  type PositionTracker,
} from "../lib/position.js";

describe("Reading position tracker", () => {
  let tracker: PositionTracker;

  beforeEach(() => {
    tracker = createPositionTracker();
  });

  describe("recordPosition", () => {
    it("records a position with timestamp", () => {
      recordPosition(tracker, { paragraphIndex: 0, timestamp: 1000 });
      const timeline = getTimeline(tracker);
      expect(timeline.length).toBe(1);
      expect(timeline[0].paragraphIndex).toBe(0);
      expect(timeline[0].timestamp).toBe(1000);
    });

    it("records multiple positions in sequence", () => {
      recordPosition(tracker, { paragraphIndex: 0, timestamp: 1000 });
      recordPosition(tracker, { paragraphIndex: 1, timestamp: 2000 });
      recordPosition(tracker, { paragraphIndex: 2, timestamp: 3000 });
      expect(getTimeline(tracker).length).toBe(3);
    });
  });

  describe("getReadParagraphs", () => {
    it("returns unique paragraph indices that have been visited", () => {
      recordPosition(tracker, { paragraphIndex: 0, timestamp: 1000 });
      recordPosition(tracker, { paragraphIndex: 2, timestamp: 2000 });
      recordPosition(tracker, { paragraphIndex: 0, timestamp: 3000 }); // revisit
      const read = getReadParagraphs(tracker);
      expect(read).toEqual([0, 2]);
    });

    it("returns empty array when nothing recorded", () => {
      expect(getReadParagraphs(tracker)).toEqual([]);
    });
  });

  describe("hasBeenRead", () => {
    it("returns true for visited paragraphs", () => {
      recordPosition(tracker, { paragraphIndex: 5, timestamp: 1000 });
      expect(hasBeenRead(tracker, 5)).toBe(true);
    });

    it("returns false for unvisited paragraphs", () => {
      recordPosition(tracker, { paragraphIndex: 5, timestamp: 1000 });
      expect(hasBeenRead(tracker, 3)).toBe(false);
    });
  });

  describe("getTimeline", () => {
    it("returns positions in chronological order", () => {
      recordPosition(tracker, { paragraphIndex: 2, timestamp: 3000 });
      recordPosition(tracker, { paragraphIndex: 0, timestamp: 1000 });
      recordPosition(tracker, { paragraphIndex: 1, timestamp: 2000 });
      const timeline = getTimeline(tracker);
      expect(timeline.map((e) => e.timestamp)).toEqual([1000, 2000, 3000]);
    });

    it("distinguishes read from skimmed based on dwell time", () => {
      // Paragraph 0: stayed 3 seconds (read)
      recordPosition(tracker, { paragraphIndex: 0, timestamp: 1000 });
      // Paragraph 1: stayed 0.3 seconds (skimmed)
      recordPosition(tracker, { paragraphIndex: 1, timestamp: 4000 });
      // Paragraph 2: arrived
      recordPosition(tracker, { paragraphIndex: 2, timestamp: 4300 });

      const timeline = getTimeline(tracker);
      // Dwell time is computed as diff between consecutive entries
      expect(timeline[0].dwellMs).toBe(3000);
      expect(timeline[1].dwellMs).toBe(300);
      // Last entry has no dwell yet
      expect(timeline[2].dwellMs).toBeUndefined();
    });
  });
});
