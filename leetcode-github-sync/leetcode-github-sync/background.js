// background.js — service worker
// Owns every GitHub API call. Content scripts never talk to GitHub directly;
// they just send a message here. Keeps the PAT out of the page context.

const GITHUB_API = "https://api.github.com";

// ---------- settings ----------

async function getSettings() {
  const s = await chrome.storage.local.get([
    "pat",
    "owner",
    "repo",
    "autoCreateRepo",
    "lastSync",
  ]);
  return {
    pat: s.pat || "",
    owner: s.owner || "",
    repo: s.repo || "",
    autoCreateRepo: s.autoCreateRepo !== false, // default true
    lastSync: s.lastSync || null,
  };
}

async function setLastSync(entry) {
  await chrome.storage.local.set({ lastSync: entry });
}

// ---------- low-level GitHub helpers ----------

function authHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(url, pat, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(pat),
      ...(options.headers || {}),
    },
  });
  return res;
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
  await new Promise((r) => setTimeout(r, 1500));
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
  const decoded = decodeURIComponent(
    atob(json.content.replace(/\n/g, ""))
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("")
  );
  return decoded;
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
};

function slugFolder(qNum, slug) {
  const num = String(qNum || "0000").padStart(4, "0");
  return `${num}-${slug}`;
}

function buildSolutionPath(folder, lang) {
  const ext = LANG_EXT[(lang || "").toLowerCase()] || "txt";
  return `${folder}/solution.${ext}`;
}

function buildProblemReadme(problem, notes) {
  const { title, difficulty, tags, url, qNum } = problem;
  const tagLine = (tags || []).length ? tags.join(", ") : "—";
  const notesBlock = notes && notes.text ? notes.text.trim() : "_(no notes written)_";
  const quickTags = notes && notes.tags && notes.tags.length
    ? notes.tags.map((t) => `\`${t}\``).join(" ")
    : "";

  return `# ${qNum}. ${title}

**Difficulty:** ${difficulty || "Unknown"}
**Topics:** ${tagLine}
**Link:** ${url}

## Approach
${notesBlock}

${quickTags ? `**Patterns used:** ${quickTags}\n` : ""}
---
_Synced automatically by LeetCode → GitHub Sync._
`;
}

function tableRow(problem) {
  const { qNum, title, difficulty, url, folder } = problem;
  return `| ${qNum} | [${title}](${url}) | ${difficulty || "—"} | [\`${folder}\`](./${folder}) |`;
}

async function upsertRootReadme(owner, repo, problem, pat) {
  const path = "README.md";
  const header = `# My LeetCode Progress

Auto-synced solutions with my own approach notes for each problem.

| # | Problem | Difficulty | Folder |
|---|---------|------------|--------|
`;
  let existing = await getFileText(owner, repo, path, pat);
  const row = tableRow(problem);

  if (!existing) {
    existing = header + row + "\n";
  } else if (existing.includes(`](${problem.url})`)) {
    // Already listed (resync/update) — leave the table row as-is, no duplicate.
  } else if (existing.includes("| # | Problem")) {
    // Append new row right after the table header line.
    const lines = existing.split("\n");
    const headerIdx = lines.findIndex((l) => l.startsWith("|---"));
    if (headerIdx >= 0) {
      lines.splice(headerIdx + 1, 0, row);
      existing = lines.join("\n");
    } else {
      existing += row + "\n";
    }
  } else {
    existing = header + row + "\n";
  }

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

  const folder = slugFolder(payload.qNum, payload.slug);
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

  await putFile(
    owner,
    repo,
    solutionPath,
    payload.code,
    `feat: solve #${payload.qNum} ${payload.title} (${payload.language})`,
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

  const lastSync = {
    title: payload.title,
    qNum: payload.qNum,
    time: new Date().toISOString(),
  };
  await setLastSync(lastSync);

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
