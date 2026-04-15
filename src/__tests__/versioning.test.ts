import { describe, it, expect, beforeEach } from "vitest";
import {
  createVersionStore,
  commit,
  getHistory,
  getVersion,
  diff,
  type VersionStore,
} from "../versioning.js";

describe("Git-like versioning layer", () => {
  let store: VersionStore;

  beforeEach(() => {
    store = createVersionStore("Initial content of the document.");
  });

  describe("createVersionStore", () => {
    it("creates a store with an initial commit", () => {
      const history = getHistory(store);
      expect(history.length).toBe(1);
      expect(history[0].message).toBe("Initial version");
      expect(history[0].content).toBe("Initial content of the document.");
    });
  });

  describe("commit", () => {
    it("creates a new version with content and message", () => {
      const entry = commit(store, {
        content: "Updated content.",
        message: "Fix typo in introduction",
        triggeredBy: "user-edit",
      });
      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("Updated content.");
      expect(entry.message).toBe("Fix typo in introduction");
      expect(entry.triggeredBy).toBe("user-edit");
      expect(entry.createdAt).toBeInstanceOf(Date);
    });

    it("appends to history", () => {
      commit(store, {
        content: "v2",
        message: "second",
        triggeredBy: "user-edit",
      });
      commit(store, {
        content: "v3",
        message: "third",
        triggeredBy: "ai-modification",
      });
      expect(getHistory(store).length).toBe(3);
    });

    it("stores the parent id linking versions", () => {
      const first = getHistory(store)[0];
      const second = commit(store, {
        content: "v2",
        message: "change",
        triggeredBy: "user-edit",
      });
      expect(second.parentId).toBe(first.id);
    });
  });

  describe("getVersion", () => {
    it("retrieves a specific version by id", () => {
      const entry = commit(store, {
        content: "specific",
        message: "test",
        triggeredBy: "user-edit",
      });
      const retrieved = getVersion(store, entry.id);
      expect(retrieved?.content).toBe("specific");
    });

    it("returns undefined for unknown id", () => {
      expect(getVersion(store, "fake")).toBeUndefined();
    });
  });

  describe("diff", () => {
    it("returns line-level differences between two versions", () => {
      const v1 = getHistory(store)[0];
      const v2 = commit(store, {
        content: "Updated content of the document.",
        message: "update",
        triggeredBy: "user-edit",
      });
      const changes = diff(store, v1.id, v2.id);
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some((c) => c.type === "removed")).toBe(true);
      expect(changes.some((c) => c.type === "added")).toBe(true);
    });

    it("returns empty array when versions are identical", () => {
      const v1 = getHistory(store)[0];
      const v2 = commit(store, {
        content: "Initial content of the document.",
        message: "no-op",
        triggeredBy: "user-edit",
      });
      const changes = diff(store, v1.id, v2.id);
      expect(changes.length).toBe(0);
    });
  });
});
