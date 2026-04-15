import { randomUUID } from "node:crypto";

export interface VersionEntry {
  id: string;
  parentId: string | null;
  content: string;
  message: string;
  triggeredBy: string;
  createdAt: Date;
}

export interface DiffChange {
  type: "added" | "removed" | "unchanged";
  text: string;
}

export interface VersionStore {
  versions: VersionEntry[];
}

export function createVersionStore(initialContent: string): VersionStore {
  const initial: VersionEntry = {
    id: randomUUID(),
    parentId: null,
    content: initialContent,
    message: "Initial version",
    triggeredBy: "system",
    createdAt: new Date(),
  };
  return { versions: [initial] };
}

export function commit(
  store: VersionStore,
  input: { content: string; message: string; triggeredBy: string }
): VersionEntry {
  const parent = store.versions[store.versions.length - 1];
  const entry: VersionEntry = {
    id: randomUUID(),
    parentId: parent.id,
    content: input.content,
    message: input.message,
    triggeredBy: input.triggeredBy,
    createdAt: new Date(),
  };
  store.versions.push(entry);
  return entry;
}

export function getHistory(store: VersionStore): VersionEntry[] {
  return [...store.versions];
}

export function getVersion(
  store: VersionStore,
  id: string
): VersionEntry | undefined {
  return store.versions.find((v) => v.id === id);
}

/**
 * Simple line-level diff between two versions.
 */
export function diff(
  store: VersionStore,
  fromId: string,
  toId: string
): DiffChange[] {
  const from = getVersion(store, fromId);
  const to = getVersion(store, toId);
  if (!from || !to) return [];

  const fromLines = from.content.split("\n");
  const toLines = to.content.split("\n");

  const changes: DiffChange[] = [];
  const maxLen = Math.max(fromLines.length, toLines.length);

  for (let i = 0; i < maxLen; i++) {
    const a = fromLines[i];
    const b = toLines[i];

    if (a === b) {
      changes.push({ type: "unchanged", text: a });
    } else {
      if (a !== undefined) {
        changes.push({ type: "removed", text: a });
      }
      if (b !== undefined) {
        changes.push({ type: "added", text: b });
      }
    }
  }

  return changes.filter((c) => c.type !== "unchanged");
}
