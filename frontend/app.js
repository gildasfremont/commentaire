document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("document");

  // Load the markdown document
  const response = await fetch("document.md");
  const markdown = await response.text();
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

  // --- Scroll position tracking (unchanged) ---
  let scrollTimeout = null;
  container.addEventListener("scroll", () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => emitScrollPosition(container, emit), 200);
  });
  setTimeout(() => emitScrollPosition(container, emit), 500);

  // --- Classified segments ---
  await listen("classified-segment", (event) => {
    const { segmentType, text, rawText, confidence, timestamp, paragraphId } = event.payload;
    addClassifiedSegment(segmentType, text, rawText, confidence, timestamp, paragraphId);
    // After classification, we're back to idle (unless a question triggered Opus)
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

  // --- Push-to-talk ---
  const recordBtn = document.getElementById("record-btn");
  const amplitudeBar = document.getElementById("amplitude-bar");

  let isRecording = false;

  const toggleRecording = async () => {
    if (isRecording) {
      // Stop: UI goes to processing immediately; backend will emit classified-segment later
      isRecording = false;
      recordBtn.classList.remove("recording");
      recordBtn.textContent = "Enregistrer";
      setStatus("processing");
      try {
        const sampleCount = await invoke("stop_recording");
        if (sampleCount === 0) {
          // Too short / aborted
          setStatus("idle");
        }
      } catch (err) {
        console.error("stop_recording failed", err);
        setStatus("idle");
      }
    } else {
      // Start
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

  if (recordBtn) {
    recordBtn.addEventListener("click", toggleRecording);
  }

  // Spacebar shortcut — ignored when the user is typing in an input
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    toggleRecording();
  });

  // Backend confirms start/stop — use it to stay in sync if another path
  // triggers them (e.g. future hardware button).
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
    // Status will transition to "processing" (set above) or stay recording
    // if the backend rejected the stop (too short). setStatus("processing")
    // already happened in toggleRecording.
  });

  // Amplitude ticks (30Hz) update the visual bar
  await listen("amplitude-tick", (event) => {
    const { rms, recording } = event.payload;
    updateAmplitude(amplitudeBar, rms, recording);
  });

  // --- Simulate question via input field (kept for testing without mic) ---
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
 * Update the status indicator.
 * States: idle | recording | processing | classifying
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

/**
 * Drive the amplitude bar from the backend RMS events.
 * RMS typically in [0, 0.3] for normal speech; map to 0-100% with a soft ceiling.
 */
function updateAmplitude(bar, rms, recording) {
  if (!bar) return;
  const capped = Math.min(1, rms * 5); // rms 0.2 ≈ full bar
  bar.style.width = `${Math.round(capped * 100)}%`;
  bar.classList.toggle("active", recording);
}
