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
  const { invoke } = window.__TAURI__.core;

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
    // Reset speech indicator after transcription completes
    setTimeout(() => updateSpeechStatus("idle"), 500);
  });

  // Listen for acknowledgment (Haiku, fast)
  await listen("ack-response", (event) => {
    const { text, questionId } = event.payload;
    showAcknowledgment(questionId, text);
  });

  // Listen for Opus response (streamed)
  await listen("opus-response", (event) => {
    const { text, questionId, isFinal } = event.payload;
    updateOpusResponse(questionId, text, isFinal);
  });

  // Speech status indicator
  await listen("speech-status", (event) => {
    updateSpeechStatus(event.payload);
  });

  // Simulate question via input field
  const simInput = document.getElementById("simulate-input");
  if (simInput) {
    simInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && simInput.value.trim()) {
        const visibleP = getVisibleParagraph(container);
        if (visibleP) {
          invoke("simulate_question", {
            text: simInput.value.trim(),
            paragraphId: visibleP.id,
          });
          simInput.value = "";
        }
      }
    });
  }
});

/**
 * Emit the current scroll position with paragraph ID and text.
 */
function emitScrollPosition(container, emit) {
  const p = getVisibleParagraph(container);
  if (p) {
    emit("scroll-position", {
      paragraphId: p.id,
      paragraphText: p.textContent || "",
    });
  }
}

/**
 * Find the paragraph closest to the vertical center.
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
      closest = p;
    }
  }
  return closest;
}

/**
 * Add a classified segment to the sidebar.
 */
function addClassifiedSegment(type, text, rawText, confidence, timestamp, paragraphId) {
  const list = document.getElementById("transcription-list");

  const segment = document.createElement("div");
  segment.className = `transcription-segment segment-${type}`;

  // For questions, add a data attribute for ack/response targeting
  if (type === "question") {
    segment.dataset.questionAnchor = "true";
  }

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

  list.scrollTop = list.scrollHeight;
}

/**
 * Show a Haiku acknowledgment under the latest question.
 */
function showAcknowledgment(questionId, text) {
  const list = document.getElementById("transcription-list");

  // Create or find the response container for this question
  let responseDiv = document.getElementById(`response-${questionId}`);
  if (!responseDiv) {
    responseDiv = document.createElement("div");
    responseDiv.id = `response-${questionId}`;
    responseDiv.className = "ai-response ack-state";
    list.appendChild(responseDiv);
  }

  responseDiv.innerHTML = "";

  const label = document.createElement("div");
  label.className = "response-label";
  label.textContent = "...";

  const content = document.createElement("div");
  content.className = "response-text ack-text";
  content.textContent = text;

  responseDiv.appendChild(label);
  responseDiv.appendChild(content);

  list.scrollTop = list.scrollHeight;
}

/**
 * Update the Opus response (replaces ack).
 */
function updateOpusResponse(questionId, text, isFinal) {
  const list = document.getElementById("transcription-list");

  let responseDiv = document.getElementById(`response-${questionId}`);
  if (!responseDiv) {
    responseDiv = document.createElement("div");
    responseDiv.id = `response-${questionId}`;
    responseDiv.className = "ai-response";
    list.appendChild(responseDiv);
  }

  // Transition from ack to response
  responseDiv.className = isFinal ? "ai-response opus-final" : "ai-response opus-streaming";

  responseDiv.innerHTML = "";

  const label = document.createElement("div");
  label.className = "response-label";
  label.textContent = isFinal ? "Opus" : "Opus...";

  const content = document.createElement("div");
  content.className = "response-text opus-text";
  content.textContent = text;

  responseDiv.appendChild(label);
  responseDiv.appendChild(content);

  list.scrollTop = list.scrollHeight;
}

/**
 * Update the speech status indicator.
 * States: "idle" (grey dot), "speaking" (red pulse), "processing" (amber)
 */
function updateSpeechStatus(status) {
  const indicator = document.getElementById("mic-indicator");
  const label = document.getElementById("mic-label");
  if (!indicator) return;

  indicator.className = "mic-indicator";
  if (status === "speaking") {
    indicator.classList.add("speaking");
    if (label) label.textContent = "Parole...";
  } else if (status === "processing") {
    indicator.classList.add("processing");
    if (label) label.textContent = "Transcription...";
  } else {
    indicator.classList.add("active");
    if (label) label.textContent = "Commentaires";
  }
}
