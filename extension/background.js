// background.js — service worker
// Owns every GitHub API call. Keeps the PAT out of the page context.

const GITHUB_API = "https://api.github.com";
const MAX_HISTORY = 20;

// ---------- settings & history ----------

async function getSettings() {
  const s = await chrome.storage.local.get([
    "pat",
    "owner",
    "repo",
    "autoCreateRepo",
    "syncHistory"
  ]);
  return {
    pat: s.pat || "",
    owner: s.owner || "",
    repo: s.repo || "",
    autoCreateRepo: s.autoCreateRepo !== false, // default true
    syncHistory: s.syncHistory || []
  };
}

async function addSyncHistory(entry) {
  const { syncHistory } = await getSettings();
  // Insert at the front, keep up to MAX_HISTORY
  syncHistory.unshift(entry);
  if (syncHistory.length > MAX_HISTORY) {
    syncHistory.pop();
  }
  await chrome.storage.local.set({ syncHistory });
}

// ---------- low-level GitHub helpers ----------

function authHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Enhanced fetch with exponential backoff for rate limits/server errors
async function ghFetch(url, pat, options = {}, retries = 3) {
  let delay = 1000;
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders(pat),
        ...(options.headers || {}),
      },
    });

    // 403 (Rate Limit) or 429 (Too Many Requests) or 5xx (Server Error)
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      if (i < retries - 1) {
        console.warn(`GitHub API ${res.status}, retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
    }
    return res;
  }
}

async function repoExists(owner, repo, pat) {
  const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}`, pat);
  return res.status === 200;
}

async function createRepo(repo, pat, isPrivate = true) {
  const res = await ghFetch(`${GITHUB_API}/user/repos`, pat, {
    method: "POST",
    body: JSON.stringify({
      name: repo,
      private: isPrivate,
      auto_init: true, // creates an initial commit so the default branch exists
      description: "My LeetCode solutions + approach notes, synced automatically.",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create repo: ${res.status} ${body}`);
  }
  return res.json();
}

async function ensureRepo(owner, repo, pat, autoCreate) {
  const exists = await repoExists(owner, repo, pat);
  if (exists) return;
  if (!autoCreate) {
    throw new Error(
      `Repo ${owner}/${repo} does not exist and auto-create is off.`
    );
  }
  await createRepo(repo, pat, true);
  // Give GitHub a moment to fully provision the repo before first push.
  await sleep(1500);
}

async function getFileSha(owner, repo, path, pat) {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    ).replace(/%2F/g, "/")}`,
    pat
  );
  if (res.status === 200) {
    const json = await res.json();
    return json.sha;
  }
  return null; // file doesn't exist yet
}

function toBase64Utf8(str) {
  // Safe UTF-8 -> base64 (handles non-ASCII in notes/code).
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function putFile(owner, repo, path, content, message, pat) {
  const sha = await getFileSha(owner, repo, path, pat);
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    ).replace(/%2F/g, "/")}`,
    pat,
    {
      method: "PUT",
      body: JSON.stringify({
        message,
        content: toBase64Utf8(content),
        ...(sha ? { sha } : {}),
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to write ${path}: ${res.status} ${body}`);
  }
  return res.json();
}

async function getFileText(owner, repo, path, pat) {
  const res = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(
      path
    ).replace(/%2F/g, "/")}`,
    pat
  );
  if (res.status !== 200) return null;
  const json = await res.json();
  
  // FIX: Properly decode base64 containing Unicode (fixes B2)
  const b64 = json.content.replace(/\n/g, "");
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

// ---------- LeetCode-specific formatting ----------

const LANG_EXT = {
  python: "py",
  python3: "py",
  java: "java",
  "c++": "cpp",
  cpp: "cpp",
  c: "c",
  "c#": "cs",
  csharp: "cs",
  javascript: "js",
  typescript: "ts",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  dart: "dart",
  go: "go",
  golang: "go",
  ruby: "rb",
  scala: "scala",
  rust: "rs",
  racket: "rkt",
  erlang: "erl",
  elixir: "ex",
  mysql: "sql",
  mssql: "sql",
  oraclesql: "sql",
  postgresql: "sql"
};

function slugFolder(qNum, slug) {
  const num = String(qNum || "0000").padStart(4, "0");
  return `${num}-${slug}`;
}

function buildSolutionPath(folder, lang) {
  const ext = LANG_EXT[(lang || "").toLowerCase()] || "txt";
  return `${folder}/solution.${ext}`;
}

function getDifficultyEmoji(difficulty) {
  if (!difficulty) return "—";
  if (difficulty.toLowerCase() === "easy") return "🟢 Easy";
  if (difficulty.toLowerCase() === "medium") return "🟡 Medium";
  if (difficulty.toLowerCase() === "hard") return "🔴 Hard";
  return difficulty;
}

function buildProblemReadme(problem, notes) {
  const { title, difficulty, tags, url, qNum } = problem;
  const tagLine = (tags || []).length ? tags.join(", ") : "—";
  const notesBlock = notes && notes.text ? notes.text.trim() : "_(no notes written)_";
  
  const compTime = (notes && notes.complexity && notes.complexity.time) ? notes.complexity.time : "O(?)";
  const compSpace = (notes && notes.complexity && notes.complexity.space) ? notes.complexity.space : "O(?)";
  const hasComplexity = notes && notes.complexity && (notes.complexity.time || notes.complexity.space);

  const quickTags = notes && notes.tags && notes.tags.length
    ? notes.tags.map((t) => `\`${t}\``).join(" ")
    : "";

  return `# ${qNum}. ${title}

**Difficulty:** ${getDifficultyEmoji(difficulty)}
**Topics:** ${tagLine}
**Link:** ${url}

## Approach
${notesBlock}

${hasComplexity ? `## Complexity
- **Time:** ${compTime}
- **Space:** ${compSpace}

` : ""}
${quickTags ? `**Patterns used:** ${quickTags}\n` : ""}
---
_Synced automatically by LeetCode → GitHub Sync._
`;
}

function tableRow(problem) {
  const { qNum, title, difficulty, url, folder } = problem;
  return `| ${qNum} | [${title}](${url}) | ${getDifficultyEmoji(difficulty)} | [\`${folder}\`](./${encodeURI(folder)}) |`;
}

function generateStatsLine(historyData) {
  // We can only generate stats for what we know in history, but we could parse the root readme instead.
  return `> Solved automatically using LeetCode → GitHub Sync`;
}

async function upsertRootReadme(owner, repo, problem, pat) {
  const path = "README.md";
  const row = tableRow(problem);

  let existing = await getFileText(owner, repo, path, pat);

  if (!existing) {
    const header = `# My LeetCode Progress\n\n> Auto-synced solutions with my own approach notes for each problem.\n\n| # | Problem | Difficulty | Folder |\n|---|---------|------------|--------|\n`;
    existing = header + row + "\n";
  } else if (existing.includes(`](${problem.url})`)) {
    // Already listed (resync/update) — leave the table row as-is, no duplicate.
  } else if (existing.includes("|---|---------|")) {
    // Append new row AT THE END of the table
    existing = existing.trimEnd() + "\n" + row + "\n";
  } else {
    // Malformed README, just append
    existing = existing + "\n\n" + row + "\n";
  }

  // Update stats summary line
  const totalMatches = existing.match(/\| \d+ \| \[/g);
  const total = totalMatches ? totalMatches.length : 1;
  const easy = (existing.match(/🟢/g) || []).length;
  const med = (existing.match(/🟡/g) || []).length;
  const hard = (existing.match(/🔴/g) || []).length;

  const statsStr = `> **${total}** solved — ${easy} Easy · ${med} Medium · ${hard} Hard`;
  existing = existing.replace(/> .*(?:solved|Auto-synced).*/, statsStr);

  await putFile(
    owner,
    repo,
    path,
    existing,
    `chore: update progress table (#${problem.qNum} ${problem.title})`,
    pat
  );
}

// ---------- main sync entrypoint ----------

async function syncSubmission(payload) {
  const { pat, owner, repo, autoCreateRepo } = await getSettings();
  if (!pat || !owner || !repo) {
    throw new Error("Missing GitHub settings — open the extension popup and fill them in.");
  }

  await ensureRepo(owner, repo, pat, autoCreateRepo);

  const primaryTag = payload.notes?.tags?.[0] || "Uncategorized";
  const problemFolder = slugFolder(payload.qNum, payload.slug);
  const folder = `${primaryTag}/${problemFolder}`;
  
  const solutionPath = buildSolutionPath(folder, payload.language);
  const readmePath = `${folder}/README.md`;

  const problem = {
    qNum: payload.qNum,
    title: payload.title,
    difficulty: payload.difficulty,
    tags: payload.tags,
    url: payload.url,
    folder,
  };

  const diffStr = problem.difficulty ? ` [${problem.difficulty}]` : "";
  await putFile(
    owner,
    repo,
    solutionPath,
    payload.code,
    `feat(solution): #${payload.qNum} ${payload.title}${diffStr} (${payload.language})`,
    pat
  );

  await putFile(
    owner,
    repo,
    readmePath,
    buildProblemReadme(problem, payload.notes),
    `docs: notes for #${payload.qNum} ${payload.title}`,
    pat
  );

  await upsertRootReadme(owner, repo, problem, pat);

  const historyEntry = {
    title: payload.title,
    qNum: payload.qNum,
    slug: payload.slug,
    difficulty: payload.difficulty,
    time: new Date().toISOString(),
  };
  await addSyncHistory(historyEntry);

  return { ok: true, folder };
}

// ---------- message router ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "SYNC_SUBMISSION") {
    syncSubmission(msg.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // keep the message channel open for async sendResponse
  }

  if (msg?.type === "GET_SETTINGS") {
    getSettings().then((s) => sendResponse(s));
    return true;
  }

  if (msg?.type === "SAVE_SETTINGS") {
    chrome.storage.local
      .set({
        pat: msg.settings.pat,
        owner: msg.settings.owner,
        repo: msg.settings.repo,
        autoCreateRepo: msg.settings.autoCreateRepo,
      })
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === "TEST_CONNECTION") {
    (async () => {
      try {
        const { pat, owner, repo, autoCreateRepo } = await getSettings();
        if (!pat || !owner || !repo) throw new Error("Fill in all fields first.");
        await ensureRepo(owner, repo, pat, autoCreateRepo);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  }
});
