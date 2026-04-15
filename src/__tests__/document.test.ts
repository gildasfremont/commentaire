import { describe, it, expect } from "vitest";
import {
  createDocument,
  parseIntoParagraphs,
  getParagraphAt,
  getTextSlice,
} from "../lib/document.js";

describe("Document model", () => {
  const sampleMarkdown = [
    "# Introduction",
    "",
    "This is the first paragraph of the document. It contains some text.",
    "",
    "This is the second paragraph. It has different content.",
    "",
    "## Section Two",
    "",
    "A third paragraph under a new heading.",
    "",
    "Final paragraph with concluding thoughts.",
  ].join("\n");

  describe("createDocument", () => {
    it("creates a document from markdown source", () => {
      const doc = createDocument("test.md", sampleMarkdown);
      expect(doc.id).toBeDefined();
      expect(doc.filename).toBe("test.md");
      expect(doc.source).toBe(sampleMarkdown);
      expect(doc.createdAt).toBeInstanceOf(Date);
    });

    it("assigns unique ids to different documents", () => {
      const a = createDocument("a.md", "aaa");
      const b = createDocument("b.md", "bbb");
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("parseIntoParagraphs", () => {
    it("splits markdown into paragraph blocks", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      expect(paragraphs.length).toBe(6);
    });

    it("each paragraph has an index, offset, and text", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      const first = paragraphs[0];
      expect(first.index).toBe(0);
      expect(first.offset).toBe(0);
      expect(first.text).toBe("# Introduction");
    });

    it("offsets are correct character positions", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      for (const p of paragraphs) {
        expect(sampleMarkdown.substring(p.offset, p.offset + p.text.length)).toBe(
          p.text
        );
      }
    });

    it("returns a single paragraph for text without blank lines", () => {
      const paragraphs = parseIntoParagraphs("just one line");
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].text).toBe("just one line");
    });

    it("returns empty array for empty string", () => {
      const paragraphs = parseIntoParagraphs("");
      expect(paragraphs.length).toBe(0);
    });
  });

  describe("getParagraphAt", () => {
    it("returns the paragraph containing a given character offset", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      const p = getParagraphAt(paragraphs, 0);
      expect(p?.index).toBe(0);
    });

    it("returns the correct paragraph for mid-document offset", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      // offset pointing into "This is the second paragraph"
      const secondStart = paragraphs[2].offset;
      const p = getParagraphAt(paragraphs, secondStart + 5);
      expect(p?.index).toBe(2);
    });

    it("returns undefined for offset beyond document", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      const p = getParagraphAt(paragraphs, 99999);
      expect(p).toBeUndefined();
    });
  });

  describe("getTextSlice", () => {
    it("extracts a range of paragraphs by index", () => {
      const paragraphs = parseIntoParagraphs(sampleMarkdown);
      const slice = getTextSlice(paragraphs, 1, 3);
      expect(slice.length).toBe(2);
      expect(slice[0].index).toBe(1);
      expect(slice[1].index).toBe(2);
    });
  });
});
