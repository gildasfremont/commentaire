"use client";

import { useMemo, useCallback } from "react";
import { useCommentaire } from "@/hooks/useCommentaire";
import { DocumentViewer } from "@/components/DocumentViewer";
import { CommentPanel } from "@/components/CommentPanel";
import { VersionTimeline } from "@/components/VersionTimeline";
import { getReadParagraphs } from "@/lib/position";
import { getHistory } from "@/lib/versioning";

export default function Home() {
  const {
    state,
    setActiveParagraph,
    addComment,
    removeComment,
    editComment,
    trackPosition,
  } = useCommentaire();

  const readSet = useMemo(
    () => new Set(getReadParagraphs(state.position)),
    [state.position]
  );

  const versions = useMemo(() => getHistory(state.versions), [state.versions]);

  const activeParagraphText =
    state.activeParagraph !== null
      ? state.paragraphs[state.activeParagraph]?.text ?? null
      : null;

  const handleParagraphVisible = useCallback(
    (index: number) => {
      trackPosition(index);
    },
    [trackPosition]
  );

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="border-b border-border bg-white px-6 py-3 flex items-center justify-between font-sans">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Commentaire</h1>
          <span className="text-sm text-muted">{state.filename}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
          <span>{state.paragraphs.length} paragraphs</span>
          <span>{state.comments.comments.length} comments</span>
          <span>{readSet.size} read</span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <DocumentViewer
          paragraphs={state.paragraphs}
          comments={state.comments.comments}
          activeParagraph={state.activeParagraph}
          readParagraphs={readSet}
          onParagraphClick={setActiveParagraph}
          onParagraphVisible={handleParagraphVisible}
        />
        <CommentPanel
          activeParagraph={state.activeParagraph}
          activeParagraphText={activeParagraphText}
          comments={state.comments.comments}
          onAdd={addComment}
          onEdit={editComment}
          onDelete={removeComment}
        />
      </div>

      {/* Version timeline */}
      <VersionTimeline versions={versions} currentIndex={versions.length - 1} />
    </div>
  );
}
