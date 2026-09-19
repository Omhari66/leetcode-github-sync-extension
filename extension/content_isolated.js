// content_isolated.js — normal extension content-script world.

const QUICK_TAGS = [
  // Approach
  "DP",
  "Greedy",
  "Binary Search",
  "BFS/DFS",
  "Backtracking",
  "Two Pointers",
  "Sliding Window",
  // Data Structures
  "Heap",
  "Trie",
  "Graph",
  "Union-Find",
  "Stack/Queue",
  "Hashing",
  "Segment Tree",
  "Linked List",
  "Math"
];

// Map of QNum+Slug to the last payload we saw
const pendingSubmissions = new Map();
let currentSubmissionKey = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.appendChild(c));
  return node;
}

function getDiffColor(difficulty) {
  if (!difficulty) return "#888";
  const d = difficulty.toLowerCase();
  if (d === "easy") return "#2ecc71";
  if (d === "medium") return "#f39c12";
  if (d === "hard") return "#e74c3c";
  return "#888";
}

function showPanel(submission) {
  currentSubmissionKey = `${submission.qNum}-${submission.slug}`;
  pendingSubmissions.set(currentSubmissionKey, submission);

  document.getElementById("lgs-panel")?.remove();

  const tagRow = el("div", { class: "lgs-tags" });
  const selectedTags = new Set();
  QUICK_TAGS.forEach((t) => {
    const chip = el("button", { class: "lgs-chip", type: "button", text: t });
    chip.addEventListener("click", () => {
      chip.classList.toggle("lgs-chip-active");
      if (selectedTags.has(t)) selectedTags.delete(t);
      else selectedTags.add(t);
    });
    tagRow.appendChild(chip);
  });

  const warnBannerContainer = el("div", { id: "lgs-warn-container" });

  const textarea = el("textarea", {
    class: "lgs-textarea",
    placeholder: "Approach Example: I used a Two Pointer approach. One pointer starts at the beginning, one at the end. We move them towards the center based on which height is smaller, because the water trapped depends on the smaller boundary.",
  });

  const compTime = el("input", { class: "lgs-comp-input", placeholder: "O(n)" });
  const compSpace = el("input", { class: "lgs-comp-input", placeholder: "O(1)" });
  const complexityRow = el("div", { class: "lgs-complexity-row" }, [
    el("div", { class: "lgs-comp-group" }, [el("span", { text: "Time:" }), compTime]),
    el("div", { class: "lgs-comp-group" }, [el("span", { text: "Space:" }), compSpace]),
  ]);

  const statusIcon = el("span", { class: "lgs-status-icon", text: "" });
  const statusText = el("span", { text: "" });
  const statusContainer = el("div", { class: "lgs-status" }, [statusIcon, statusText]);

  const syncBtn = el("button", { class: "lgs-btn lgs-btn-primary", text: "Save & Push" });
  const skipBtn = el("button", { class: "lgs-btn lgs-btn-ghost", text: "Push code only" });
  const closeBtn = el("button", { class: "lgs-close", text: "✕" });

  async function doSync(notesText) {
    statusIcon.className = "lgs-status-icon lgs-spinner";
    statusText.textContent = "Pushing to GitHub…";
    syncBtn.disabled = true;
    skipBtn.disabled = true;

    // Use latest stored for this key
    const payload = pendingSubmissions.get(currentSubmissionKey) || submission;
    const finalPayload = {
      ...payload,
      notes: { 
        text: notesText, 
        tags: Array.from(selectedTags),
        complexity: {
          time: compTime.value.trim(),
          space: compSpace.value.trim()
        }
      },
    };

    chrome.runtime.sendMessage({ type: "SYNC_SUBMISSION", payload: finalPayload }, (res) => {
      statusIcon.className = "lgs-status-icon";
      if (res?.ok) {
        statusIcon.textContent = "✓";
        statusIcon.style.color = "#2ecc71";
        statusText.textContent = `Synced to ${res.result.folder}`;
        setTimeout(() => panel.classList.add("lgs-slide-out"), 2000);
        setTimeout(() => panel.remove(), 2400);
      } else {
        statusIcon.textContent = "✗";
        statusIcon.style.color = "#e74c3c";
        statusText.textContent = `${res?.error || "Sync failed"}`;
        syncBtn.disabled = false;
        skipBtn.disabled = false;
      }
    });
  }

  syncBtn.addEventListener("click", () => doSync(textarea.value));
  skipBtn.addEventListener("click", () => doSync(""));
  
  closeBtn.addEventListener("click", () => {
    panel.classList.add("lgs-slide-out");
    setTimeout(() => panel.remove(), 400);
  });

  const diffBadge = el("span", { class: "lgs-diff-dot" });
  diffBadge.style.backgroundColor = getDiffColor(submission.difficulty);

  const titleRow = el("div", { class: "lgs-title-wrap" }, [
    diffBadge,
    el("span", { text: `Accepted — #${submission.qNum} ${submission.title}` })
  ]);

  const panel = el(
    "div",
    { id: "lgs-panel", class: "lgs-panel lgs-slide-in" },
    [
      el("div", { class: "lgs-header" }, [titleRow, closeBtn]),
      warnBannerContainer,
      textarea,
      complexityRow,
      el("div", { class: "lgs-sub", text: "Patterns & Structures" }),
      tagRow,
      el("div", { class: "lgs-actions" }, [skipBtn, syncBtn]),
      statusContainer,
    ]
  );

  document.body.appendChild(panel);
}

function showWarnBanner(message) {
  const container = document.getElementById("lgs-warn-container");
  if (container) {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "lgs-warn-banner", text: message }));
  }
}

// Messages coming from content_main.js
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const { source, type, payload } = event.data || {};
  if (source !== "lgs-main") return;

  if (type === "ACCEPTED_SUBMISSION" || type === "MANUAL_SNAPSHOT") {
    showPanel(payload);
  }

  if (type === "WARN_MISSING_META") {
    // If the panel is open, show a banner.
    showWarnBanner(payload.message);
  }
});

// Messages coming from the popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "REQUEST_MANUAL_SYNC") {
    window.postMessage({ source: "lgs-isolated", type: "REQUEST_SNAPSHOT" }, "*");
  }
});
