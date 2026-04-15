import { randomUUID } from "node:crypto";

export interface Document {
  id: string;
  filename: string;
  source: string;
  createdAt: Date;
}

export interface Paragraph {
  index: number;
  offset: number;
  text: string;
}

export function createDocument(filename: string, source: string): Document {
  return {
    id: randomUUID(),
    filename,
    source,
    createdAt: new Date(),
  };
}

/**
 * Split source text into paragraphs separated by blank lines.
 * Each paragraph records its index and character offset in the source.
 */
export function parseIntoParagraphs(source: string): Paragraph[] {
  if (source === "") return [];

  const paragraphs: Paragraph[] = [];
  const blocks = source.split(/\n\n+/);
  let offset = 0;

  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i];
    // Find the actual offset of this block in the source
    const actualOffset = source.indexOf(text, offset);
    paragraphs.push({ index: i, offset: actualOffset, text });
    offset = actualOffset + text.length;
  }

  return paragraphs;
}

/**
 * Find the paragraph containing a given character offset.
 */
export function getParagraphAt(
  paragraphs: Paragraph[],
  charOffset: number
): Paragraph | undefined {
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (charOffset >= p.offset && charOffset < p.offset + p.text.length) {
      return p;
    }
  }
  return undefined;
}

/**
 * Get a slice of paragraphs by index range [from, to).
 */
export function getTextSlice(
  paragraphs: Paragraph[],
  from: number,
  to: number
): Paragraph[] {
  return paragraphs.filter((p) => p.index >= from && p.index < to);
}
