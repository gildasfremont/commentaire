"use client";

import type { VersionEntry } from "@/lib/versioning";

interface VersionTimelineProps {
  versions: VersionEntry[];
  currentIndex: number;
}

export function VersionTimeline({
  versions,
  currentIndex,
}: VersionTimelineProps) {
  if (versions.length <= 1) return null;

  return (
    <div className="border-t border-border bg-white px-6 py-3 font-sans">
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted whitespace-nowrap">
          v{currentIndex + 1}/{versions.length}
        </span>
        <input
          type="range"
          min={0}
          max={versions.length - 1}
          value={currentIndex}
          readOnly
          className="flex-1 h-1 accent-accent"
        />
        <span className="text-xs text-stone-600 truncate max-w-48">
          {versions[currentIndex]?.message}
        </span>
      </div>
    </div>
  );
}
