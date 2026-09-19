// content_main.js — runs in the PAGE's own JS context ("world": "MAIN"),
// so it can see the same window.fetch, window.monaco, and __NEXT_DATA__
// that LeetCode's own React app uses. It never touches chrome.* APIs
// directly (that's not allowed in MAIN world) — it just posts a
// window message that content_isolated.js relays to the extension.

(function () {
  const CHECK_URL_RE = /\/submissions\/detail\/(\d+)\/check\//;
  const SUBMIT_URL_RE = /\/problems\/([a-z0-9-]+)\/submit\//;

  let lastSlugFromSubmit = null;

  function post(type, payload) {
    window.postMessage({ source: "lgs-main", type, payload }, "*");
  }

  // ---- pull problem metadata out of LeetCode's own Next.js data blob ----
  function getProblemMeta() {
    try {
      const el = document.getElementById("__NEXT_DATA__");
      if (el) {
        const data = JSON.parse(el.textContent);
        // Shape has moved around across LeetCode redesigns — walk a few
        // likely spots instead of trusting one fixed path.
        const q =
          data?.props?.pageProps?.dehydratedState?.queries?.find((q) =>
            q?.state?.data?.question
          )?.state?.data?.question || data?.props?.pageProps?.question;
        if (q) {
          return {
            qNum: q.questionFrontendId || q.questionId,
            title: q.title,
            slug: q.titleSlug,
            difficulty: q.difficulty,
            tags: (q.topicTags || []).map((t) => t.name),
          };
        }
      }
    } catch (e) {
      // fall through to DOM fallback
    }

    // Fallback: scrape from document.title ("1. Two Sum - LeetCode") and URL.
    const m = document.title.match(/^(\d+)\.\s*(.+?)\s*-\s*LeetCode/);
    const slugMatch = location.pathname.match(/\/problems\/([a-z0-9-]+)/);
    return {
      qNum: m ? m[1] : "0",
      title: m ? m[2] : document.title,
      slug: slugMatch ? slugMatch[1] : lastSlugFromSubmit || "unknown-problem",
      difficulty: null,
      tags: [],
    };
  }

  // ---- pull the current editor code ----
  function getEditorCode() {
    try {
      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length) {
          // Prefer the model with the most content — LeetCode sometimes
          // keeps a second, empty model around for the test-case panel.
          return models.reduce((a, b) =>
            a.getValue().length >= b.getValue().length ? a : b
          ).getValue();
        }
      }
    } catch (e) {
      /* fall through */
    }
    // Fallback: scrape rendered Monaco lines (whitespace can be imperfect).
    const lines = Array.from(document.querySelectorAll(".view-lines .view-line"));
    if (lines.length) {
      return lines.map((l) => l.textContent).join("\n");
    }
    return "";
  }

  // ---- pull the currently selected language ----
  function getLanguage() {
    // The language picker button text is the most reliable visible signal.
    const btn = document.querySelector('[id^="headlessui-listbox-button"]');
    if (btn && btn.textContent.trim()) return btn.textContent.trim();
    const alt = document.querySelector('button.rounded.items-center.whitespace-nowrap');
    if (alt && alt.textContent.trim()) return alt.textContent.trim();
    return "unknown";
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    const submitMatch = url.match(SUBMIT_URL_RE);
    if (submitMatch) lastSlugFromSubmit = submitMatch[1];

    const response = await originalFetch.apply(this, args);

    const checkMatch = url.match(CHECK_URL_RE);
    if (checkMatch) {
      // Clone so we don't consume the body LeetCode's own app is waiting on.
      response
        .clone()
        .json()
        .then((data) => {
          if (data && data.state === "SUCCESS" && data.status_msg === "Accepted") {
            const meta = getProblemMeta();
            const code = getEditorCode();
            const language = getLanguage();
            post("ACCEPTED_SUBMISSION", {
              ...meta,
              code,
              language,
              url: `https://leetcode.com/problems/${meta.slug}/`,
            });
          }
        })
        .catch(() => {});
    }

    return response;
  };

  // Let the isolated-world script ask us for a fresh manual snapshot
  // (used by the popup's "Sync current page" button).
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source === "lgs-isolated" && event.data?.type === "REQUEST_SNAPSHOT") {
      const meta = getProblemMeta();
      post("MANUAL_SNAPSHOT", {
        ...meta,
        code: getEditorCode(),
        language: getLanguage(),
        url: `https://leetcode.com/problems/${meta.slug}/`,
      });
    }
  });
})();
