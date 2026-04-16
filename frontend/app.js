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
  // Check if running inside Tauri
  if (!window.__TAURI__) {
    console.log("Not running in Tauri, skipping event listeners");
    return;
  }

  const { listen, emit } = window.__TAURI__.event;

  // Mic indicator: pulse while active
  micIndicator.classList.add("active");

  // Track visible paragraph and emit scroll position
  let scrollTimeout = null;
  container.addEventListener("scroll", () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const visibleParagraph = getVisibleParagraph(container);
      if (visibleParagraph) {
        emit("scroll-position", visibleParagraph);
      }
    }, 200);
  });

  // Emit initial scroll position
  setTimeout(() => {
    const visibleParagraph = getVisibleParagraph(container);
    if (visibleParagraph) {
      emit("scroll-position", visibleParagraph);
    }
  }, 500);

  // Listen for transcription segments
  await listen("transcription-segment", (event) => {
    const { text, timestamp, paragraphId } = event.payload;
    addTranscriptionSegment(text, timestamp, paragraphId);
  });
});

/**
 * Find the paragraph closest to the vertical center of the document column.
 */
function getVisibleParagraph(container) {
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
      closest = p.id;
    }
  }

  return closest;
}

/**
 * Add a transcription segment to the sidebar.
 */
function addTranscriptionSegment(text, timestamp, paragraphId) {
  const list = document.getElementById("transcription-list");

  const segment = document.createElement("div");
  segment.className = "transcription-segment";

  const meta = document.createElement("div");
  meta.className = "segment-meta";
  meta.textContent = `${timestamp} · ${paragraphId}`;

  const content = document.createElement("div");
  content.className = "segment-text";
  content.textContent = text;

  segment.appendChild(meta);
  segment.appendChild(content);
  list.appendChild(segment);

  // Scroll to the latest segment
  list.scrollTop = list.scrollHeight;
}
