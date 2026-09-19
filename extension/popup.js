const patEl = document.getElementById("pat");
const ownerEl = document.getElementById("owner");
const repoEl = document.getElementById("repo");
const autoCreateEl = document.getElementById("autoCreateRepo");
const settingsStatus = document.getElementById("settingsStatus");
const togglePatBtn = document.getElementById("togglePat");

const historyList = document.getElementById("historyList");
const statTotal = document.getElementById("statTotal");
const statEasy = document.getElementById("statEasy");
const statMed = document.getElementById("statMed");
const statHard = document.getElementById("statHard");

function getDiffColor(difficulty) {
  if (!difficulty) return "#888";
  const d = difficulty.toLowerCase();
  if (d === "easy") return "#2ecc71";
  if (d === "medium") return "#f39c12";
  if (d === "hard") return "#e74c3c";
  return "#888";
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function renderHistory(history) {
  if (!history || history.length === 0) {
    historyList.innerHTML = `<div class="empty-state">No history yet. Go solve a problem!</div>`;
    return;
  }

  historyList.innerHTML = "";
  let easy = 0, med = 0, hard = 0;

  history.forEach(item => {
    // Tally stats
    const d = (item.difficulty || "").toLowerCase();
    if (d === "easy") easy++;
    else if (d === "medium") med++;
    else if (d === "hard") hard++;

    // Create item DOM
    const div = document.createElement("div");
    div.className = "history-item";
    
    const dot = document.createElement("div");
    dot.className = "history-dot";
    dot.style.backgroundColor = getDiffColor(item.difficulty);

    const qnum = document.createElement("div");
    qnum.className = "history-qnum";
    qnum.textContent = `#${item.qNum}`;

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = item.title;
    title.title = item.title; // tooltip

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = timeAgo(item.time);

    div.appendChild(dot);
    div.appendChild(qnum);
    div.appendChild(title);
    div.appendChild(time);
    historyList.appendChild(div);
  });

  statTotal.textContent = history.length;
  statEasy.textContent = easy;
  statMed.textContent = med;
  statHard.textContent = hard;
}

function loadSettings() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
    if (!s) return;
    patEl.value = s.pat || "";
    ownerEl.value = s.owner || "";
    repoEl.value = s.repo || "";
    autoCreateEl.checked = s.autoCreateRepo !== false;
    
    renderHistory(s.syncHistory);
  });
}

document.getElementById("save").addEventListener("click", () => {
  const settings = {
    pat: patEl.value.trim(),
    owner: ownerEl.value.trim(),
    repo: repoEl.value.trim(),
    autoCreateRepo: autoCreateEl.checked,
  };
  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    settingsStatus.textContent = "Saved successfully.";
    settingsStatus.style.color = "#2ecc71";
    setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
  });
});

document.getElementById("test").addEventListener("click", () => {
  settingsStatus.textContent = "Testing connection...";
  settingsStatus.style.color = "#888";
  
  const settings = {
    pat: patEl.value.trim(),
    owner: ownerEl.value.trim(),
    repo: repoEl.value.trim(),
    autoCreateRepo: autoCreateEl.checked,
  };
  
  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }, (res) => {
      if (res.ok) {
        settingsStatus.textContent = "✓ Connected to repo!";
        settingsStatus.style.color = "#2ecc71";
      } else {
        settingsStatus.textContent = `✗ ${res.error}`;
        settingsStatus.style.color = "#e74c3c";
      }
    });
  });
});

document.getElementById("manualSync").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("leetcode.com/problems/")) {
    settingsStatus.textContent = "Open a LeetCode problem tab first.";
    settingsStatus.style.color = "#f39c12";
    setTimeout(() => { settingsStatus.textContent = ""; }, 3000);
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "REQUEST_MANUAL_SYNC" }).catch((err) => {
    settingsStatus.textContent = "Please refresh the LeetCode tab first!";
    settingsStatus.style.color = "#e74c3c";
  });
});

togglePatBtn.addEventListener("click", () => {
  if (patEl.type === "password") {
    patEl.type = "text";
    togglePatBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
  } else {
    patEl.type = "password";
    togglePatBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  }
});

loadSettings();
