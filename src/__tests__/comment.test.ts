import { describe, it, expect } from "vitest";
import {
  createComment,
  updateComment,
  deleteComment,
  getCommentsForParagraph,
  getCommentsInRange,
  type CommentStore,
  type CommentIntent,
} from "../comment.js";

describe("Comment model", () => {
  function emptyStore(): CommentStore {
    return { comments: [] };
  }

  describe("createComment", () => {
    it("creates a comment anchored to a paragraph index", () => {
      const store = emptyStore();
      const comment = createComment(store, {
        paragraphIndex: 3,
        text: "This seems unclear",
        intent: "note",
      });
      expect(comment.id).toBeDefined();
      expect(comment.paragraphIndex).toBe(3);
      expect(comment.text).toBe("This seems unclear");
      expect(comment.intent).toBe("note");
      expect(comment.createdAt).toBeInstanceOf(Date);
      expect(store.comments).toContain(comment);
    });

    it("supports all intent types", () => {
      const intents: CommentIntent[] = [
        "note",
        "question",
        "modification",
        "reaction",
        "inconsistency",
      ];
      for (const intent of intents) {
        const store = emptyStore();
        const c = createComment(store, {
          paragraphIndex: 0,
          text: "test",
          intent,
        });
        expect(c.intent).toBe(intent);
      }
    });

    it("assigns unique ids", () => {
      const store = emptyStore();
      const a = createComment(store, { paragraphIndex: 0, text: "a", intent: "note" });
      const b = createComment(store, { paragraphIndex: 0, text: "b", intent: "note" });
      expect(a.id).not.toBe(b.id);
    });

    it("stores source as 'user' by default", () => {
      const store = emptyStore();
      const c = createComment(store, { paragraphIndex: 0, text: "x", intent: "note" });
      expect(c.source).toBe("user");
    });

    it("can store AI-sourced comments", () => {
      const store = emptyStore();
      const c = createComment(store, {
        paragraphIndex: 0,
        text: "x",
        intent: "note",
        source: "ai",
      });
      expect(c.source).toBe("ai");
    });
  });

  describe("updateComment", () => {
    it("updates text of an existing comment", () => {
      const store = emptyStore();
      const c = createComment(store, { paragraphIndex: 0, text: "old", intent: "note" });
      const updated = updateComment(store, c.id, { text: "new" });
      expect(updated?.text).toBe("new");
      expect(updated?.paragraphIndex).toBe(0);
    });

    it("returns undefined for unknown id", () => {
      const store = emptyStore();
      const result = updateComment(store, "nonexistent", { text: "x" });
      expect(result).toBeUndefined();
    });
  });

  describe("deleteComment", () => {
    it("removes a comment from the store", () => {
      const store = emptyStore();
      const c = createComment(store, { paragraphIndex: 0, text: "bye", intent: "note" });
      const deleted = deleteComment(store, c.id);
      expect(deleted).toBe(true);
      expect(store.comments.length).toBe(0);
    });

    it("returns false for unknown id", () => {
      const store = emptyStore();
      expect(deleteComment(store, "nope")).toBe(false);
    });
  });

  describe("getCommentsForParagraph", () => {
    it("returns only comments for the given paragraph", () => {
      const store = emptyStore();
      createComment(store, { paragraphIndex: 0, text: "a", intent: "note" });
      createComment(store, { paragraphIndex: 1, text: "b", intent: "note" });
      createComment(store, { paragraphIndex: 0, text: "c", intent: "question" });

      const result = getCommentsForParagraph(store, 0);
      expect(result.length).toBe(2);
      expect(result.every((c) => c.paragraphIndex === 0)).toBe(true);
    });
  });

  describe("getCommentsInRange", () => {
    it("returns comments within a paragraph index range", () => {
      const store = emptyStore();
      createComment(store, { paragraphIndex: 0, text: "a", intent: "note" });
      createComment(store, { paragraphIndex: 2, text: "b", intent: "note" });
      createComment(store, { paragraphIndex: 5, text: "c", intent: "note" });
      createComment(store, { paragraphIndex: 3, text: "d", intent: "note" });

      const result = getCommentsInRange(store, 1, 4);
      expect(result.length).toBe(2);
      expect(result.map((c) => c.paragraphIndex).sort()).toEqual([2, 3]);
    });
  });
});
