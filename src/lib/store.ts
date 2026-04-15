import type { Paragraph } from "./document";
import type { Comment, CommentIntent, CommentSource, CommentStore } from "./comment";
import type { PositionTracker } from "./position";
import type { VersionStore } from "./versioning";

/**
 * Top-level application state for a Commentaire session.
 * This is a plain data structure — React state management wraps it.
 */
export interface AppState {
  documentId: string;
  filename: string;
  source: string;
  paragraphs: Paragraph[];
  comments: CommentStore;
  position: PositionTracker;
  versions: VersionStore;
  activeParagraph: number | null;
  selectedCommentId: string | null;
}
