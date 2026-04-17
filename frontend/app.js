// Commentaire front-end — CLA-27 margin anchoring.
//
// Layout: a shared scrollable `.reading-area` contains the document on the
// left and a `.comments-margin` on the right. Each comment is rendered as a
// stack positioned absolutely at the y coordinate of its target paragraph.

const DEFAULT_STATUS = "idle";

// Track all comment stacks so we can restack on new arrivals.
const stacksByParagraph = new Map(); // paragraphId -> HTMLElement

// Index of Opus ack/response blocks keyed by questionId (to update in place).
const responseBlocksById = new Map();

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("document");
  const readingArea = document.getElementById("reading-area");
  const marginEl = document.getElementById("comments-margin");

  // Load and render the document
  const response = await fetch("document.md");
  const markdown = await response.text();
  container.innerHTML = marked.parse(markdown);

  // Assign stable paragraph IDs
  const paragraphs = container.querySelectorAll("p");
  paragraphs.forEach((p, index) => {
    p.id = `p-${index}`;
    // Allow clicking the density marker to scroll to the first comment
    p.addEventListener("click", (e) => {
      if (e.offsetX < 0) {
        // Click in the gutter where the marker sits
        const stack = stacksByParagraph.get(p.id);
        if (stack) stack.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  });

  // --- Tauri integration ---
  if (!window.__TAURI__) {
    console.log("Not running in Tauri, skipping event listeners");
    return;
  }

  const { listen, emit } = window.__TAURI__.event;
  const { invoke } = window.__TAURI__.core;

  // Scroll position: emit the paragraph visible at the center (same as before)
  let scrollTimeout = null;
  readingArea.addEventListener("scroll", () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => emitScrollPosition(container, readingArea, emit), 200);
  });
  setTimeout(() => emitScrollPosition(container, readingArea, emit), 500);

  // Classified segments → anchored in margin
  await listen("classified-segment", (event) => {
    const { segmentType, text, rawText, timestamp, paragraphId } = event.payload;
    addClassifiedSegment(segmentType, text, rawText, timestamp, paragraphId, marginEl);
    setStatus("idle");
  });

  await listen("ack-response", (event) => {
    const { text, questionId } = event.payload;
    showAcknowledgment(questionId, text);
  });

  await listen("opus-response", (event) => {
    const { text, questionId, isFinal } = event.payload;
    updateOpusResponse(questionId, text, isFinal);
  });

  // --- Push-to-talk controls ---
  const recordBtn = document.getElementById("record-btn");
  const amplitudeBar = document.getElementById("amplitude-bar");
  let isRecording = false;

  const toggleRecording = async () => {
    if (isRecording) {
      isRecording = false;
      recordBtn.classList.remove("recording");
      recordBtn.textContent = "Enregistrer";
      setStatus("processing");
      try {
        const sampleCount = await invoke("stop_recording");
        if (sampleCount === 0) setStatus("idle");
      } catch (err) {
        console.error("stop_recording failed", err);
        setStatus("idle");
      }
    } else {
      try {
        await invoke("start_recording");
        isRecording = true;
        recordBtn.classList.add("recording");
        recordBtn.textContent = "Arrêter";
        setStatus("recording");
      } catch (err) {
        console.error("start_recording failed", err);
      }
    }
  };

  if (recordBtn) recordBtn.addEventListener("click", toggleRecording);

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    toggleRecording();
  });

  await listen("recording-started", () => {
    isRecording = true;
    if (recordBtn) {
      recordBtn.classList.add("recording");
      recordBtn.textContent = "Arrêter";
    }
    setStatus("recording");
  });

  await listen("recording-stopped", () => {
    isRecording = false;
    if (recordBtn) {
      recordBtn.classList.remove("recording");
      recordBtn.textContent = "Enregistrer";
    }
  });

  await listen("amplitude-tick", (event) => {
    const { rms, recording } = event.payload;
    updateAmplitude(amplitudeBar, rms, recording);
  });

  // Simulate-question input (for testing without mic)
  const simInput = document.getElementById("simulate-input");
  if (simInput) {
    simInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && simInput.value.trim()) {
        const p = getVisibleParagraph(container, readingArea);
        if (p) {
          invoke("simulate_question", {
            text: simInput.value.trim(),
            paragraphId: p.id,
          });
          simInput.value = "";
        }
      }
    });
  }

  setStatus(DEFAULT_STATUS);
});

/**
 * Emit the current scroll position with paragraph ID and text.
 */
function emitScrollPosition(container, readingArea, emit) {
  const p = getVisibleParagraph(container, readingArea);
  if (p) {
    emit("scroll-position", {
      paragraphId: p.id,
      paragraphText: p.textContent || "",
    });
  }
}

/**
 * Find the paragraph closest to the vertical center of the reading area.
 */
function getVisibleParagraph(container, readingArea) {
  const paragraphs = container.querySelectorAll("p[id]");
  const areaRect = readingArea.getBoundingClientRect();
  const centerY = areaRect.top + areaRect.height / 2;

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
 * Get (or create) the stack element for a given paragraph, positioned at the
 * paragraph's y coordinate within the reading area.
 */
function getOrCreateStack(paragraphId, marginEl) {
  let stack = stacksByParagraph.get(paragraphId);
  if (stack) return stack;

  stack = document.createElement("div");
  stack.className = "comment-stack";
  stack.dataset.paragraphId = paragraphId;

  const targetP = document.getElementById(paragraphId);
  if (targetP) {
    // offsetTop is relative to the positioned ancestor, which is .reading-area.
    // .comments-margin is in the same positioned ancestor chain, so aligning
    // the stack's top with offsetTop puts it next to the paragraph.
    const top = targetP.offsetTop;
    stack.style.top = `${top}px`;
  }

  marginEl.appendChild(stack);
  stacksByParagraph.set(paragraphId, stack);
  return stack;
}

/**
 * Update density marker (count + question flag) on the target paragraph.
 */
function updateDensityMarker(paragraphId) {
  const p = document.getElementById(paragraphId);
  if (!p) return;
  const stack = stacksByParagraph.get(paragraphId);
  if (!stack) return;
  const comments = stack.querySelectorAll(".comment-block");
  const count = comments.length;
  if (count === 0) {
    p.classList.remove("has-comments", "has-questions");
    p.removeAttribute("data-comment-count");
    return;
  }
  p.classList.add("has-comments");
  p.setAttribute("data-comment-count", count);
  const hasQuestion = stack.querySelector(".type-question") !== null;
  p.classList.toggle("has-questions", hasQuestion);
}

/**
 * Add a classified segment to its paragraph's stack.
 */
function addClassifiedSegment(type, text, rawText, timestamp, paragraphId, marginEl) {
  const stack = getOrCreateStack(paragraphId, marginEl);

  const block = document.createElement("div");
  block.className = `comment-block type-${type}`;

  const meta = document.createElement("div");
  meta.className = "meta";
  const typeLabel = document.createElement("span");
  typeLabel.className = "type-label";
  typeLabel.textContent =
    type === "question" ? "Question" :
    type === "instruction" ? "Instruction" :
    "Commentaire";
  const metaTime = document.createElement("span");
  metaTime.textContent = timestamp;
  meta.appendChild(typeLabel);
  meta.appendChild(metaTime);

  const textEl = document.createElement("div");
  textEl.className = "text";
  textEl.textContent = text || rawText;

  block.appendChild(meta);
  block.appendChild(textEl);
  stack.appendChild(block);

  // For questions, remember this block as the anchor for ack/opus responses.
  if (type === "question") {
    block.dataset.role = "question-anchor";
  }

  updateDensityMarker(paragraphId);
}

/**
 * Show a Haiku acknowledgment below the most recent question, in the same stack.
 */
function showAcknowledgment(questionId, text) {
  // Find the most recent question block (no explicit linking yet)
  const anchor = findLatestQuestionAnchor();
  if (!anchor) return;
  const stack = anchor.parentElement;

  let responseDiv = responseBlocksById.get(questionId);
  if (!responseDiv) {
    responseDiv = document.createElement("div");
    responseDiv.className = "ai-response ack-state";
    stack.appendChild(responseDiv);
    responseBlocksById.set(questionId, responseDiv);
  } else {
    responseDiv.className = "ai-response ack-state";
  }

  responseDiv.innerHTML = "";
  const label = document.createElement("div");
  label.className = "response-label";
  label.textContent = "Accusé";
  const content = document.createElement("div");
  content.className = "text";
  content.textContent = text;
  responseDiv.appendChild(label);
  responseDiv.appendChild(content);
}

/**
 * Update (or create) the Opus response. Replaces the ack in place.
 */
function updateOpusResponse(questionId, text, isFinal) {
  let responseDiv = responseBlocksById.get(questionId);
  if (!responseDiv) {
    const anchor = findLatestQuestionAnchor();
    if (!anchor) return;
    const stack = anchor.parentElement;
    responseDiv = document.createElement("div");
    stack.appendChild(responseDiv);
    responseBlocksById.set(questionId, responseDiv);
  }

  responseDiv.className = isFinal ? "ai-response opus-final" : "ai-response opus-streaming";
  responseDiv.innerHTML = "";
  const label = document.createElement("div");
  label.className = "response-label";
  label.textContent = isFinal ? "Opus" : "Opus…";
  const content = document.createElement("div");
  content.className = "text";
  content.textContent = text;
  responseDiv.appendChild(label);
  responseDiv.appendChild(content);
}

function findLatestQuestionAnchor() {
  const anchors = document.querySelectorAll('.comment-block[data-role="question-anchor"]');
  return anchors.length ? anchors[anchors.length - 1] : null;
}

/**
 * Update the status indicator in the bottom bar.
 */
function setStatus(status) {
  const indicator = document.getElementById("mic-indicator");
  const label = document.getElementById("mic-label");
  if (!indicator) return;

  indicator.className = "mic-indicator";
  if (status === "recording") {
    indicator.classList.add("recording");
    if (label) label.textContent = "Enregistrement…";
  } else if (status === "processing") {
    indicator.classList.add("processing");
    if (label) label.textContent = "Transcription…";
  } else if (status === "classifying") {
    indicator.classList.add("processing");
    if (label) label.textContent = "Classification…";
  } else {
    indicator.classList.add("idle");
    if (label) label.textContent = "Commentaires";
  }
}

function updateAmplitude(bar, rms, recording) {
  if (!bar) return;
  const capped = Math.min(1, rms * 5);
  bar.style.width = `${Math.round(capped * 100)}%`;
  bar.classList.toggle("active", recording);
}
