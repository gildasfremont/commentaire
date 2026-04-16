document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("document");
  const transcriptionList = document.getElementById("transcription-list");
  const micIndicator = document.getElementById("mic-indicator");

  // Load the markdown document
  const response = await fetch("document.md");
  const markdown = await response.text();

  // Render markdown to HTML
  container.innerHTML = marked.parse(markdown);

  // Assign stable IDs to all paragraphs
  const paragraphs = container.querySelectorAll("p");
  paragraphs.forEach((p, index) => {
    p.id = `p-${index}`;
  });

  // --- Tauri integration ---
  if (!window.__TAURI__) {
    console.log("Not running in Tauri, skipping event listeners");
    return;
  }

  const { listen, emit } = window.__TAURI__.event;

  // Mic indicator: pulse while active
  micIndicator.classList.add("active");

  // Track visible paragraph and emit scroll position with text
  let scrollTimeout = null;
  container.addEventListener("scroll", () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      emitScrollPosition(container, emit);
    }, 200);
  });

  // Emit initial scroll position
  setTimeout(() => emitScrollPosition(container, emit), 500);

  // Listen for classified segments (from Haiku)
  await listen("classified-segment", (event) => {
    const { segmentType, text, rawText, confidence, timestamp, paragraphId } = event.payload;
    addClassifiedSegment(segmentType, text, rawText, confidence, timestamp, paragraphId);
  });
});

/**
 * Emit the current scroll position with paragraph ID and text.
 */
function emitScrollPosition(container, emit) {
  const paragraphs = container.querySelectorAll("p[id]");
  const containerRect = container.getBoundingClientRect();
  const centerY = containerRect.top + containerRect.height / 2;

  let closest = null;
  let closestDist = Infinity;

  for (const p of paragraphs) {
    const rect = p.getBoundingClientRect();
    const dist = Math.abs(rect.top + rect.height / 2 - centerY);
    if (dist < closestDist) {
      closestDist = dist;
      closest = p;
    }
  }

  if (closest) {
    emit("scroll-position", {
      paragraphId: closest.id,
      paragraphText: closest.textContent || "",
    });
  }
}

/**
 * Add a classified segment to the sidebar.
 */
function addClassifiedSegment(type, text, rawText, confidence, timestamp, paragraphId) {
  const list = document.getElementById("transcription-list");

  const segment = document.createElement("div");
  segment.className = `transcription-segment segment-${type}`;

  const meta = document.createElement("div");
  meta.className = "segment-meta";

  const typeLabel = document.createElement("span");
  typeLabel.className = `segment-type-label type-${type}`;
  typeLabel.textContent = type === "question" ? "? Question" :
                          type === "instruction" ? "! Instruction" :
                          "Commentaire";

  const metaInfo = document.createElement("span");
  metaInfo.textContent = ` · ${timestamp} · ${paragraphId}`;

  meta.appendChild(typeLabel);
  meta.appendChild(metaInfo);

  const content = document.createElement("div");
  content.className = "segment-text";
  content.textContent = text || rawText;

  segment.appendChild(meta);
  segment.appendChild(content);
  list.appendChild(segment);

  // Scroll to the latest segment
  list.scrollTop = list.scrollHeight;
}
