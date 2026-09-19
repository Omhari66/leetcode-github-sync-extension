# LeetCode → GitHub Sync (with Approach Journaling) v0.3

A Chrome extension that goes beyond blindly backing up your LeetCode code. It prompts you to actively log your **approach**, **time/space complexity**, and **pattern tags** right on the LeetCode success screen, then pushes everything to a beautifully organized GitHub repository.

## 🚀 New in v0.3 (Pro Features)
- **Time Tracking:** A built-in SPA timer automatically tracks how long you spend on a problem and saves it in your notes. (Editable in the panel).
- **Multiple Solutions:** Submit brute force and optimal solutions for the same problem. Name your approach, and the extension will save them cleanly without overwriting your old notes!
- **Smart Portfolio Website:** The extension automatically injects an `index.html` file into your repo. Just enable GitHub Pages, and you instantly have a beautiful, dark-mode portfolio dashboard displaying your LeetCode progress!
- **Migration Script:** Included `migrate_repo.js` to automatically reorganize your old flat folders into the new pattern-based folder structure.

## Features

- **In-Page Journaling:** The moment your submission is accepted, a sleek glassmorphism panel slides in. Log your Big O complexity, select pattern tags, and write out your thought process without ever leaving the page.
- **Pattern-Wise Organization:** Automatically groups your solutions into folders based on the primary pattern (e.g., `Two Pointers/0042-trapping-rain-water`), making it incredibly easy to review concepts later.
- **Auto-Generated Master Table:** Maintains a beautiful `README.md` at the root of your repo with a chronological table of all your solved problems, complete with difficulty badges and direct links.
- **Per-Problem READMEs:** Alongside your code file, it generates a markdown file for the specific problem containing your personal approach notes and tags.
- **Bulletproof Interception:** Hooked directly into LeetCode's `/check/` API rather than relying on fragile DOM-scraping, meaning UI updates won't break the sync.
- **Secure & Serverless:** Uses a fine-grained Personal Access Token (PAT) stored locally in your browser. No third-party servers see your data.

## Installation

### 1. Load the Extension
1. Clone this repository or download the source code.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the `extension` folder from this repository.

### 2. Configure GitHub Authentication
1. Go to [GitHub Developer Settings](https://github.com/settings/tokens?type=beta) to generate a Fine-grained Personal Access Token.
2. Select the repository you want to sync your solutions to (e.g., `leetcode-solutions`).
3. Under **Repository permissions**, grant **Read and write** access to **Contents**.
4. Generate and copy the token.
5. Click the green Octocat icon in your Chrome toolbar to open the extension popup. Paste your token, username, and repository name. Click **Save Settings**.

## Usage

1. Solve a problem on LeetCode and click **Submit**.
2. When the result is **Accepted**, the notes panel will automatically slide in from the bottom right.
3. Fill out your time/space complexity, name your approach (optional), select relevant pattern tags, and jot down your approach.
4. Click **Save & Push**.
5. Check your GitHub repository—your code and notes will be beautifully organized and synced!

*(Note: If the panel doesn't auto-appear or you navigate away, you can always open the extension popup and click "Sync Tab Now ↺" while on a problem page).*

## Architecture

- **`content_main.js`**: Injected into the MAIN world to intercept LeetCode's native `fetch` requests and reliably detect Accepted submissions. Tracks time spent on the page.
- **`content_isolated.js`**: Injected into the ISOLATED world to safely inject the UI panel (HTML/CSS) without conflicting with LeetCode's styling.
- **`background.js`**: Service worker that handles all direct communication with the GitHub API (creating files, decoding base64, managing exponential backoff for rate limits, building the smart portfolio).
- **`popup.html/js/css`**: The control center for managing your GitHub PAT and viewing your sync history.
