#!/usr/bin/env python3
"""Append a single SegmentLatency JSON line to logs/latency.jsonl.

Usage:
  log_entry.py SEGMENT_ID SEGMENT_TYPE TEXT_PREVIEW \
               WHISPER_MS HAIKU_MS ACK_MS OPUS_FIRST_TOKEN_MS OPUS_TOTAL_MS

Use empty string "" for metrics that don't apply (produces JSON null).
"""
import json
import sys
from datetime import datetime

def to_int_or_none(s):
    if s == "" or s is None:
        return None
    try:
        return int(s)
    except ValueError:
        return None

def main():
    if len(sys.argv) != 9:
        print(f"Usage: {sys.argv[0]} ID TYPE PREVIEW WHISPER HAIKU ACK OPUS_FIRST OPUS_TOTAL", file=sys.stderr)
        sys.exit(1)

    sid, stype, preview, whisper, haiku, ack, opus_first, opus_total = sys.argv[1:]

    entry = {
        "timestamp": datetime.now().astimezone().isoformat(),
        "segment_id": sid,
        "segment_type": stype,
        "text_preview": preview,
        "whisper_ms": to_int_or_none(whisper),
        "haiku_ms": to_int_or_none(haiku),
        "ack_ms": to_int_or_none(ack),
        "opus_first_token_ms": to_int_or_none(opus_first),
        "opus_total_ms": to_int_or_none(opus_total),
    }

    # Write to logs/latency.jsonl (relative to cwd)
    with open("logs/latency.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

if __name__ == "__main__":
    main()
