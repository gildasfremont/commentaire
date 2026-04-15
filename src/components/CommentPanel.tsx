"use client";

import { useState } from "react";
import type { Comment, CommentIntent } from "@/lib/comment";

interface CommentPanelProps {
  activeParagraph: number | null;
  activeParagraphText: string | null;
  comments: Comment[];
  onAdd: (
    paragraphIndex: number,
    text: string,
    intent: CommentIntent
  ) => void;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}

const INTENT_LABELS: Record<CommentIntent, string> = {
  note: "Note",
  question: "Question",
  modification: "Modification",
  reaction: "Reaction",
  inconsistency: "Inconsistency",
};

const INTENT_COLORS: Record<CommentIntent, string> = {
  note: "bg-amber-100 text-amber-800",
  question: "bg-blue-100 text-blue-800",
  modification: "bg-purple-100 text-purple-800",
  reaction: "bg-green-100 text-green-800",
  inconsistency: "bg-red-100 text-red-800",
};

export function CommentPanel({
  activeParagraph,
  activeParagraphText,
  comments,
  onAdd,
  onEdit,
  onDelete,
}: CommentPanelProps) {
  const [newText, setNewText] = useState("");
  const [newIntent, setNewIntent] = useState<CommentIntent>("note");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const paragraphComments =
    activeParagraph !== null
      ? comments.filter((c) => c.paragraphIndex === activeParagraph)
      : [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeParagraph === null || !newText.trim()) return;
    onAdd(activeParagraph, newText.trim(), newIntent);
    setNewText("");
  };

  const handleEditSave = (id: string) => {
    if (editText.trim()) {
      onEdit(id, editText.trim());
    }
    setEditingId(null);
    setEditText("");
  };

  if (activeParagraph === null) {
    return (
      <div className="w-80 border-l border-border bg-white p-6 flex items-center justify-center">
        <p className="text-muted text-sm font-sans text-center">
          Click a paragraph to view or add comments
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-border bg-white flex flex-col">
      {/* Context: which paragraph is selected */}
      <div className="p-4 border-b border-border">
        <p className="text-xs font-sans text-muted uppercase tracking-wide mb-1">
          Paragraph {activeParagraph + 1}
        </p>
        {activeParagraphText && (
          <p className="text-sm text-stone-600 line-clamp-3 italic">
            {activeParagraphText.replace(/^#+\s*/, "")}
          </p>
        )}
      </div>

      {/* Existing comments */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {paragraphComments.length === 0 && (
          <p className="text-sm text-muted font-sans">No comments yet.</p>
        )}
        {paragraphComments.map((c) => (
          <div
            key={c.id}
            className={`
              rounded-lg p-3 text-sm
              ${c.source === "ai" ? "bg-comment-ai" : "bg-comment-user"}
            `}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-sans font-medium px-1.5 py-0.5 rounded ${INTENT_COLORS[c.intent]}`}
              >
                {INTENT_LABELS[c.intent]}
              </span>
              <span className="text-xs text-muted font-sans">
                {c.source === "ai" ? "AI" : "You"}
              </span>
            </div>
            {editingId === c.id ? (
              <div className="mt-1">
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full text-sm border border-border rounded p-1.5 font-sans resize-none"
                  rows={2}
                  autoFocus
                />
                <div className="flex gap-1 mt-1">
                  <button
                    onClick={() => handleEditSave(c.id)}
                    className="text-xs font-sans text-accent hover:underline"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs font-sans text-muted hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="leading-relaxed">{c.text}</p>
            )}
            {editingId !== c.id && (
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={() => {
                    setEditingId(c.id);
                    setEditText(c.text);
                  }}
                  className="text-xs font-sans text-muted hover:text-foreground"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(c.id)}
                  className="text-xs font-sans text-muted hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New comment form */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border space-y-2"
      >
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Write a comment..."
          className="w-full text-sm border border-border rounded-lg p-2.5 font-sans resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
          rows={3}
        />
        <div className="flex items-center gap-2">
          <select
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value as CommentIntent)}
            className="text-xs font-sans border border-border rounded px-2 py-1 bg-white"
          >
            {Object.entries(INTENT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newText.trim()}
            className="
              ml-auto text-sm font-sans font-medium
              bg-accent text-white rounded-lg px-4 py-1.5
              hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
