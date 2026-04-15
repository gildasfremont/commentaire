"use client";

import { useCallback, useRef, useState } from "react";
import { createDocument, parseIntoParagraphs } from "@/lib/document";
import {
  createComment,
  updateComment,
  deleteComment,
  type Comment,
  type CommentIntent,
  type CommentSource,
  type CommentStore,
} from "@/lib/comment";
import {
  createPositionTracker,
  recordPosition,
  getReadParagraphs,
  getTimeline,
  type PositionTracker,
} from "@/lib/position";
import {
  createVersionStore,
  commit,
  getHistory,
  getVersion,
  type VersionStore,
  type VersionEntry,
} from "@/lib/versioning";
import type { AppState } from "@/lib/store";

const SAMPLE_DOC = `# La mémoire des machines

Les ordinateurs n'oublient rien, mais ils ne se souviennent de rien non plus. Ce qu'on appelle mémoire informatique est un abus de langage : c'est du stockage, pas du souvenir. La différence est fondamentale.

Le souvenir humain est reconstructif. Chaque fois qu'on se rappelle quelque chose, on le reconstruit à partir de fragments, et ce faisant on le modifie. C'est un bug du point de vue de l'ingénieur, mais c'est ce qui nous permet d'apprendre : le souvenir évolue avec nous.

Le stockage informatique est reproductif. Un fichier relu mille fois rend mille fois la même séquence de bits. Il ne s'use pas, ne se déforme pas, ne s'enrichit pas. C'est fiable, mais c'est mort.

## Le paradoxe de l'archivage

Plus on stocke, moins on retrouve. Le problème n'est pas la capacité — on sait stocker des exaoctets. Le problème est la pertinence : dans un océan de données, comment savoir ce qui compte maintenant ?

Les moteurs de recherche répondent par le ranking. Les bases de données répondent par les index. Mais ni l'un ni l'autre ne répondent à la vraie question : qu'est-ce que je devrais relire, que j'ai oublié avoir écrit ?

## Vers une mémoire augmentée

L'IA change la donne. Non pas parce qu'elle stocke mieux — elle stocke pareil — mais parce qu'elle peut reconstruire du sens à partir de fragments. En cela, elle se rapproche davantage de la mémoire humaine que de la mémoire informatique.

Un système de lecture assistée par IA n'est pas un moteur de recherche. C'est un compagnon de relecture qui sait ce que vous avez lu, ce que vous avez annoté, et ce qui pourrait mériter d'être revisité.

La question n'est plus "où est ce fichier ?" mais "qu'est-ce que je pensais quand j'ai écrit ça, et qu'est-ce que j'en pense maintenant ?"`;

export function useCommentaire() {
  const [state, setState] = useState<AppState>(() => {
    const doc = createDocument("memoire-machines.md", SAMPLE_DOC);
    const paragraphs = parseIntoParagraphs(SAMPLE_DOC);
    return {
      documentId: doc.id,
      filename: doc.filename,
      source: SAMPLE_DOC,
      paragraphs,
      comments: { comments: [] },
      position: createPositionTracker(),
      versions: createVersionStore(SAMPLE_DOC),
      activeParagraph: null,
      selectedCommentId: null,
    };
  });

  const setActiveParagraph = useCallback((index: number | null) => {
    setState((prev) => ({ ...prev, activeParagraph: index }));
  }, []);

  const addComment = useCallback(
    (
      paragraphIndex: number,
      text: string,
      intent: CommentIntent,
      source: CommentSource = "user"
    ) => {
      setState((prev) => {
        const newStore: CommentStore = {
          comments: [...prev.comments.comments],
        };
        createComment(newStore, { paragraphIndex, text, intent, source });
        return { ...prev, comments: newStore };
      });
    },
    []
  );

  const editComment = useCallback((id: string, text: string) => {
    setState((prev) => {
      const newStore: CommentStore = {
        comments: prev.comments.comments.map((c) => ({ ...c })),
      };
      updateComment(newStore, id, { text });
      return { ...prev, comments: newStore };
    });
  }, []);

  const removeComment = useCallback((id: string) => {
    setState((prev) => {
      const newStore: CommentStore = {
        comments: prev.comments.comments.filter((c) => c.id !== id),
      };
      return { ...prev, comments: newStore };
    });
  }, []);

  const trackPosition = useCallback((paragraphIndex: number) => {
    setState((prev) => {
      const newTracker: PositionTracker = {
        entries: [...prev.position.entries],
      };
      recordPosition(newTracker, {
        paragraphIndex,
        timestamp: Date.now(),
      });
      return { ...prev, position: newTracker };
    });
  }, []);

  const commitVersion = useCallback(
    (content: string, message: string, triggeredBy: string) => {
      setState((prev) => {
        const newVersions: VersionStore = {
          versions: [...prev.versions.versions],
        };
        commit(newVersions, { content, message, triggeredBy });
        return { ...prev, versions: newVersions };
      });
    },
    []
  );

  return {
    state,
    setActiveParagraph,
    addComment,
    editComment,
    removeComment,
    trackPosition,
    commitVersion,
  };
}
