import { randomUUID } from "node:crypto";

export type CommentIntent =
  | "note"
  | "question"
  | "modification"
  | "reaction"
  | "inconsistency";

export type CommentSource = "user" | "ai";

export interface Comment {
  id: string;
  paragraphIndex: number;
  text: string;
  intent: CommentIntent;
  source: CommentSource;
  createdAt: Date;
}

export interface CommentStore {
  comments: Comment[];
}

interface CreateCommentInput {
  paragraphIndex: number;
  text: string;
  intent: CommentIntent;
  source?: CommentSource;
}

interface UpdateCommentInput {
  text?: string;
  intent?: CommentIntent;
}

export function createComment(
  store: CommentStore,
  input: CreateCommentInput
): Comment {
  const comment: Comment = {
    id: randomUUID(),
    paragraphIndex: input.paragraphIndex,
    text: input.text,
    intent: input.intent,
    source: input.source ?? "user",
    createdAt: new Date(),
  };
  store.comments.push(comment);
  return comment;
}

export function updateComment(
  store: CommentStore,
  id: string,
  input: UpdateCommentInput
): Comment | undefined {
  const comment = store.comments.find((c) => c.id === id);
  if (!comment) return undefined;

  if (input.text !== undefined) comment.text = input.text;
  if (input.intent !== undefined) comment.intent = input.intent;

  return comment;
}

export function deleteComment(store: CommentStore, id: string): boolean {
  const index = store.comments.findIndex((c) => c.id === id);
  if (index === -1) return false;
  store.comments.splice(index, 1);
  return true;
}

export function getCommentsForParagraph(
  store: CommentStore,
  paragraphIndex: number
): Comment[] {
  return store.comments.filter((c) => c.paragraphIndex === paragraphIndex);
}

export function getCommentsInRange(
  store: CommentStore,
  from: number,
  to: number
): Comment[] {
  return store.comments.filter(
    (c) => c.paragraphIndex >= from && c.paragraphIndex < to
  );
}
