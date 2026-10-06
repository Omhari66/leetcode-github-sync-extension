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

function buildSolutionPath(folder, lang, approachName) {
  const ext = LANG_EXT[(lang || "").toLowerCase()] || "txt";
  const safeApproachName = (approachName || "Solution").replace(/[^a-zA-Z0-9-]/g, '-');
  return `${folder}/${safeApproachName}.${ext}`;
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
  
  const approachName = payload.notes?.approachName || "Solution";
  const solutionPath = buildSolutionPath(folder, payload.language, approachName);
  const readmePath = `${folder}/README.md`;

  const problem = {
    qNum: payload.qNum,
    title: payload.title,
    difficulty: payload.difficulty,
    tags: payload.tags,
    url: payload.url,
    folder,
  };

  // 1. Ensure solution file exists
  await putFile(
    owner,
    repo,
    solutionPath,
    payload.code,
    `feat(solution): #${payload.qNum} ${payload.slug} [${payload.difficulty}] (${payload.language})`,
    pat
  );

  // 2. Setup problem README (Append approach notes)
  let existingReadme = await getFileText(owner, repo, readmePath, pat);
  
  const approachSection = `## Approach: ${approachName}

${payload.notes?.timeSpent ? `⏱️ **Time Spent:** ${payload.notes.timeSpent}\n` : ""}
- **Time Complexity:** ${payload.notes?.complexity?.time || "O(?)"}
- **Space Complexity:** ${payload.notes?.complexity?.space || "O(?)"}

${payload.notes?.text || "*No notes provided.*"}

---`;

  let newReadmeContent = "";
  if (existingReadme) {
    newReadmeContent = existingReadme.trimEnd() + "\n\n" + approachSection;
  } else {
    newReadmeContent = `# ${payload.title}\n\n[View on LeetCode](${payload.url})\n\n**Difficulty:** ${getDifficultyEmoji(payload.difficulty)}\n**Tags:** ${(payload.notes?.tags || []).join(", ") || "None"}\n\n---\n\n${approachSection}`;
  }

  await putFile(
    owner,
    repo,
    readmePath,
    newReadmeContent,
    `docs: update notes for ${payload.title} (${approachName})`,
    pat
  );

  // 3. Update root README table
  await upsertRootReadme(owner, repo, problem, pat);

  // 4. Inject Smart Portfolio Web  // 4. Always push the latest Smart Portfolio Website so repos stay up-to-date.
  const portfolioHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LeetCode Portfolio</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
header{background:#161b22;border-bottom:1px solid #30363d;padding:18px 40px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.logo{display:flex;align-items:center;gap:8px;font-size:1.1rem;font-weight:700;color:#fff}
.logo-dot{width:10px;height:10px;border-radius:50%;background:#00d26a}
.stats-bar{display:flex;gap:24px}
.stat{text-align:center}
.stat-num{font-size:1.4rem;font-weight:700;line-height:1}
.stat-label{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:#8b949e;margin-top:2px}
.stat.total .stat-num{color:#58a6ff}
.stat.easy .stat-num{color:#2ecc71}
.stat.medium .stat-num{color:#f39c12}
.stat.hard .stat-num{color:#e74c3c}
main{padding:28px 40px;max-width:1080px;margin:0 auto}
.controls{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:22px;align-items:center}
input[type=search]{flex:1;min-width:180px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:8px 14px;color:#c9d1d9;font-size:.88rem;outline:none;transition:.15s}
input[type=search]:focus{border-color:#58a6ff}
.filter-group{display:flex;gap:6px}
.fb{padding:5px 13px;border-radius:20px;border:1px solid #30363d;background:transparent;color:#8b949e;font-size:.78rem;cursor:pointer;transition:.15s;font-family:inherit}
.fb:hover{border-color:#8b949e;color:#c9d1d9}
.fb.active{font-weight:600}
.fb[data-diff=all].active{background:#58a6ff22;border-color:#58a6ff;color:#58a6ff}
.fb[data-diff=easy].active{background:#2ecc7122;border-color:#2ecc71;color:#2ecc71}
.fb[data-diff=medium].active{background:#f39c1222;border-color:#f39c12;color:#f39c12}
.fb[data-diff=hard].active{background:#e74c3c22;border-color:#e74c3c;color:#e74c3c}
.topic-section{margin-bottom:28px}
.topic-header{display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer;user-select:none;padding:4px 0}
.topic-title{font-size:.95rem;font-weight:600;color:#e6edf3}
.topic-count{background:#21262d;color:#8b949e;font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:10px}
.topic-chevron{color:#8b949e;transition:.2s;margin-left:auto;font-size:.75rem}
.collapsed .topic-chevron{transform:rotate(-90deg)}
.collapsed .topic-grid{display:none}
.topic-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:8px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px 14px;display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;transition:.15s}
.card:hover{border-color:#58a6ff;transform:translateY(-1px);box-shadow:0 4px 14px rgba(88,166,255,.1)}
.card-num{font-size:.72rem;font-weight:700;color:#8b949e;min-width:30px;flex-shrink:0}
.card-title{font-size:.83rem;font-weight:500;color:#e6edf3;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dd.easy{background:#2ecc71}.dd.medium{background:#f39c12}.dd.hard{background:#e74c3c}.dd.unknown{background:#8b949e}
.empty{text-align:center;padding:60px;color:#8b949e;font-size:.9rem}
@media(max-width:600px){header,main{padding:16px 20px}.stats-bar{gap:16px}}
</style>
</head>
<body>
<header>
  <div class="logo"><div class="logo-dot"></div>LeetCode Portfolio</div>
  <div class="stats-bar">
    <div class="stat total"><div class="stat-num" id="s-total">-</div><div class="stat-label">Solved</div></div>
    <div class="stat easy"><div class="stat-num" id="s-easy">-</div><div class="stat-label">Easy</div></div>
    <div class="stat medium"><div class="stat-num" id="s-medium">-</div><div class="stat-label">Medium</div></div>
    <div class="stat hard"><div class="stat-num" id="s-hard">-</div><div class="stat-label">Hard</div></div>
  </div>
</header>
<main>
  <div class="controls">
    <input type="search" id="search" placeholder="Search by title, number, or topic...">
    <div class="filter-group">
      <button class="fb active" data-diff="all">All</button>
      <button class="fb" data-diff="easy">Easy</button>
      <button class="fb" data-diff="medium">Medium</button>
      <button class="fb" data-diff="hard">Hard</button>
    </div>
  </div>
  <div id="content"><div class="empty">Loading your solutions...</div></div>
</main>
<script>
let allProblems=[],activeDiff='all';
function dd(e){const s=(e||'').toLowerCase();if(s.includes('easy'))return'easy';if(s.includes('medium'))return'medium';if(s.includes('hard'))return'hard';return'unknown';}
function parseReadme(txt){const rows=[];for(const ln of txt.split('\n')){const m=ln.match(/^\|\s*(\d+)\s*\|\s*\[(.+?)\]\((.+?)\)\s*\|\s*(.*?)\s*\|\s*\[\x60(.+?)\x60\]/);if(!m)continue;const parts=m[5].trim().split('/');rows.push({num:m[1],title:m[2],url:m[3],diff:dd(m[4]),topic:parts.length>1?parts[0]:'Uncategorized'});}return rows;}
function render(){const q=document.getElementById('search').value.toLowerCase();const f=allProblems.filter(p=>(activeDiff==='all'||p.diff===activeDiff)&&(!q||p.title.toLowerCase().includes(q)||p.num.includes(q)||p.topic.toLowerCase().includes(q)));const g={};f.forEach(p=>{(g[p.topic]=g[p.topic]||[]).push(p);});const topics=Object.keys(g).sort((a,b)=>a==='Uncategorized'?1:b==='Uncategorized'?-1:a.localeCompare(b));const el=document.getElementById('content');if(!topics.length){el.innerHTML='<div class="empty">No problems match your filters.</div>';return;}el.innerHTML=topics.map(t=>{const ps=g[t];return '<div class="topic-section"><div class="topic-header" onclick="this.parentElement.classList.toggle(\'collapsed\')"><span class="topic-title">'+t+'</span><span class="topic-count">'+ps.length+'</span><span class="topic-chevron">&#9662;</span></div><div class="topic-grid">'+ps.map(p=>'<a class="card" href="'+p.url+'" target="_blank"><span class="card-num">#'+p.num+'</span><span class="card-title" title="'+p.title+'">'+p.title+'</span><span class="dd '+p.diff+'"></span></a>').join('')+'</div></div>';}).join('');}
fetch('README.md').then(r=>r.text()).then(txt=>{const sm=txt.match(/>.*?(\d+).*?solved.*?(\d+)\s*Easy.*?(\d+)\s*Medium.*?(\d+)\s*Hard/);allProblems=parseReadme(txt);document.getElementById('s-total').textContent=sm?sm[1]:allProblems.length;document.getElementById('s-easy').textContent=sm?sm[2]:allProblems.filter(p=>p.diff==='easy').length;document.getElementById('s-medium').textContent=sm?sm[3]:allProblems.filter(p=>p.diff==='medium').length;document.getElementById('s-hard').textContent=sm?sm[4]:allProblems.filter(p=>p.diff==='hard').length;render();}).catch(()=>{document.getElementById('content').innerHTML='<div class="empty">Enable GitHub Pages in repo Settings to view this portfolio.</div>';});
document.getElementById('search').addEventListener('input',render);
document.querySelector('.filter-group').addEventListener('click',e=>{const b=e.target.closest('[data-diff]');if(!b)return;activeDiff=b.dataset.diff;document.querySelectorAll('[data-diff]').forEach(x=>x.classList.remove('active'));b.classList.add('active');render();});
</script>
</body>
</html>`;
  await putFile(owner, repo, "index.html", portfolioHtml, "chore: update smart portfolio website", pat);

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
