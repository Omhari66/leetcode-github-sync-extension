# LeetCode → GitHub Sync (Personal Build)

Auto-pushes accepted LeetCode submissions — code + your own written approach —
to a GitHub repo. Built for personal use first; auth uses a GitHub Personal
Access Token stored only in your browser's local extension storage (never
sent anywhere except directly to api.github.com).

## 1. Create a GitHub token

1. GitHub → Settings → Developer settings → **Personal access tokens** → **Fine-grained tokens** → Generate new token.
2. Repository access: **Only select repositories** → pick (or pre-create) the repo you'll sync to, e.g. `leetcode-solutions`.
   - If you want the extension to auto-create the repo for you, choose **All repositories** instead (it needs repo-creation scope, which fine-grained tokens can't grant per-repo since the repo doesn't exist yet) — or just create the empty repo yourself first and use "Only select repositories".
3. Permissions → **Repository permissions → Contents: Read and write**.
4. Generate, copy the token (starts with `github_pat_...`). You won't see it again.

## 2. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**, select this `leetcode-github-sync` folder.
4. Click the extension icon in the toolbar.

## 3. Configure

In the popup:
- Paste your token.
- Enter your GitHub username and the repo name.
- Leave "create repo automatically" checked if the repo doesn't exist yet
  (only works if your token has org/account-wide repo-creation rights — see step 1).
- Click **Save Settings**, then **Test Connection** to confirm.

## 4. Use it

1. Solve a problem on `leetcode.com/problems/...` and submit.
2. When it comes back **Accepted**, a small panel appears bottom-right —
   write your approach, tap any pattern tags that fit, hit **Save & Push**.
3. Check your GitHub repo — you'll get:
   - `NNNN-problem-slug/solution.<ext>`
   - `NNNN-problem-slug/README.md` (your notes + problem metadata)
   - a root `README.md` progress table, kept up to date automatically.

If the panel doesn't appear after an accepted submission (LeetCode's UI
changes sometimes break auto-detection), open the extension popup on that
tab and click **Sync Current Problem Now** — it grabs whatever's in the
editor right then.

## Known fragile points (heads up)

LeetCode doesn't publish a stable API for this, so a few things are
best-effort and may need small selector tweaks if LeetCode ships a UI
change:
- Language detection reads the visible language-picker button text.
- Code extraction prefers `window.monaco` (clean) and falls back to
  scraping rendered editor lines (works, but can occasionally lose exact
  whitespace).
- Problem metadata is read from LeetCode's own embedded `__NEXT_DATA__`
  JSON first (reliable), falling back to the page `<title>`.

If auto-detect ever silently breaks, manual sync always works as a backup.
