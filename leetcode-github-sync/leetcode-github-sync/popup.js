const patEl = document.getElementById("pat");
const ownerEl = document.getElementById("owner");
const repoEl = document.getElementById("repo");
const autoCreateEl = document.getElementById("autoCreateRepo");
const settingsStatus = document.getElementById("settingsStatus");
const lastSyncEl = document.getElementById("lastSync");

function loadSettings() {
  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
    if (!s) return;
    patEl.value = s.pat || "";
    ownerEl.value = s.owner || "";
    repoEl.value = s.repo || "";
    autoCreateEl.checked = s.autoCreateRepo !== false;
    if (s.lastSync) {
      const d = new Date(s.lastSync.time);
      lastSyncEl.textContent = `Last synced: #${s.lastSync.qNum} ${s.lastSync.title} — ${d.toLocaleString()}`;
    }
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
    settingsStatus.textContent = "Saved.";
    setTimeout(() => (settingsStatus.textContent = ""), 2000);
  });
});

document.getElementById("test").addEventListener("click", () => {
  settingsStatus.textContent = "Testing…";
  // Save first so the background worker checks against latest values.
  const settings = {
    pat: patEl.value.trim(),
    owner: ownerEl.value.trim(),
    repo: repoEl.value.trim(),
    autoCreateRepo: autoCreateEl.checked,
  };
  chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
    chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }, (res) => {
      settingsStatus.textContent = res.ok
        ? "✓ Connected — repo is ready."
        : `✗ ${res.error}`;
    });
  });
});

document.getElementById("manualSync").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("leetcode.com/problems/")) {
    settingsStatus.textContent = "Open a LeetCode problem tab first.";
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "REQUEST_MANUAL_SYNC" });
  window.close(); // the notes panel appears on the LeetCode tab itself
});

loadSettings();
