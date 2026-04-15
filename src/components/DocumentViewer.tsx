"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Paragraph } from "@/lib/document";
import type { Comment } from "@/lib/comment";

interface DocumentViewerProps {
  paragraphs: Paragraph[];
  comments: Comment[];
  activeParagraph: number | null;
  readParagraphs: Set<number>;
  onParagraphClick: (index: number) => void;
  onParagraphVisible: (index: number) => void;
}

export function DocumentViewer({
  paragraphs,
  comments,
  activeParagraph,
  readParagraphs,
  onParagraphClick,
  onParagraphVisible,
}: DocumentViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Track which paragraphs are visible via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute("data-paragraph-index"));
            if (!isNaN(idx)) onParagraphVisible(idx);
          }
        }
      },
      { threshold: 0.5 }
    );

    for (const el of paragraphRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [paragraphs, onParagraphVisible]);

  const setRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      if (el) paragraphRefs.current.set(index, el);
      else paragraphRefs.current.delete(index);
    },
    []
  );

  const commentCountFor = (index: number) =>
    comments.filter((c) => c.paragraphIndex === index).length;

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-8 py-12">
      <div className="max-w-2xl mx-auto">
        {paragraphs.map((p) => {
          const isActive = activeParagraph === p.index;
          const isHeading = p.text.startsWith("#");
          const commentCount = commentCountFor(p.index);
          const wasRead = readParagraphs.has(p.index);

          return (
            <div
              key={p.index}
              ref={setRef(p.index)}
              data-paragraph-index={p.index}
              onClick={() => onParagraphClick(p.index)}
              className={`
                relative group cursor-pointer rounded-sm px-4 py-2 my-1
                transition-colors duration-150
                ${isActive ? "bg-accent-light ring-2 ring-accent" : "hover:bg-stone-100"}
              `}
            >
              {/* Read indicator */}
              <div
                className={`
                  absolute left-0 top-0 bottom-0 w-0.5 rounded-full transition-colors
                  ${wasRead ? "bg-accent" : "bg-transparent"}
                `}
              />

              {/* Paragraph text */}
              {isHeading ? (
                <h2
                  className={`
                    font-sans font-semibold tracking-tight
                    ${p.text.startsWith("## ") ? "text-xl mt-8 mb-2" : "text-2xl mt-10 mb-3"}
                  `}
                >
                  {p.text.replace(/^#+\s*/, "")}
                </h2>
              ) : (
                <p className="text-lg leading-8 text-stone-800">{p.text}</p>
              )}

              {/* Comment badge */}
              {commentCount > 0 && (
                <span
                  className="
                    absolute -right-2 top-2
                    inline-flex items-center justify-center
                    w-5 h-5 rounded-full
                    bg-accent text-white text-xs font-sans font-medium
                  "
                >
                  {commentCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
