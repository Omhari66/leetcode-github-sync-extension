// content_isolated.js — normal extension content-script world.
// Has access to chrome.* APIs, but not to the page's window.fetch/monaco
// directly — that's why content_main.js does the detection and hands
// data over via window.postMessage.

const QUICK_TAGS = [
  "Two Pointers",
  "Sliding Window",
  "Binary Search",
  "DP",
  "Greedy",
  "BFS/DFS",
  "Heap",
  "Backtracking",
  "Graph",
  "Hashing",
];

let pendingSubmission = null;

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

function showPanel(submission) {
  pendingSubmission = submission;
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

  const textarea = el("textarea", {
    class: "lgs-textarea",
    placeholder:
      "What was your approach? What did you try first? Complexity? (optional but worth it)",
  });

  const status = el("div", { class: "lgs-status", text: "" });

  const syncBtn = el("button", { class: "lgs-btn lgs-btn-primary", text: "Save & Push to GitHub" });
  const skipBtn = el("button", { class: "lgs-btn lgs-btn-ghost", text: "Skip notes, push code only" });
  const closeBtn = el("button", { class: "lgs-close", text: "✕" });

  async function doSync(notesText) {
    status.textContent = "Pushing to GitHub…";
    syncBtn.disabled = true;
    skipBtn.disabled = true;

    const payload = {
      ...pendingSubmission,
      notes: { text: notesText, tags: Array.from(selectedTags) },
    };

    chrome.runtime.sendMessage({ type: "SYNC_SUBMISSION", payload }, (res) => {
      if (res?.ok) {
        status.textContent = `✓ Synced to ${res.result.folder}`;
        setTimeout(() => panel.remove(), 2000);
      } else {
        status.textContent = `✗ ${res?.error || "Sync failed"}`;
        syncBtn.disabled = false;
        skipBtn.disabled = false;
      }
    });
  }

  syncBtn.addEventListener("click", () => doSync(textarea.value));
  skipBtn.addEventListener("click", () => doSync(""));
  closeBtn.addEventListener("click", () => panel.remove());

  const panel = el(
    "div",
    { id: "lgs-panel", class: "lgs-panel" },
    [
      el("div", { class: "lgs-header" }, [
        el("span", { text: `✓ Accepted — #${submission.qNum} ${submission.title}` }),
        closeBtn,
      ]),
      el("div", { class: "lgs-sub", text: "Quick tags" }),
      tagRow,
      textarea,
      el("div", { class: "lgs-actions" }, [skipBtn, syncBtn]),
      status,
    ]
  );

  document.body.appendChild(panel);
}

// Messages coming from content_main.js (page world) via window.postMessage.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const { source, type, payload } = event.data || {};
  if (source !== "lgs-main") return;

  if (type === "ACCEPTED_SUBMISSION") {
    showPanel(payload);
  }

  if (type === "MANUAL_SNAPSHOT") {
    // Triggered by the popup's manual sync button — push immediately
    // with whatever notes the user gives right now, no "accepted" gate.
    showPanel(payload);
  }
});

// Messages coming from the popup.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "REQUEST_MANUAL_SYNC") {
    window.postMessage({ source: "lgs-isolated", type: "REQUEST_SNAPSHOT" }, "*");
  }
});
