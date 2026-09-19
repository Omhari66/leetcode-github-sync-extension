// content_main.js — runs in the PAGE's own JS context ("world": "MAIN")
// Can access window.fetch, window.monaco, and __NEXT_DATA__ directly.
// Never touches chrome.* APIs — posts window messages to content_isolated.js instead.

(function () {
  "use strict";

  const CHECK_URL_RE = /\/submissions\/detail\/(\d+)\/check/;
  const SUBMIT_URL_RE = /\/problems\/([a-z0-9-]+)\/submit/;

  // State from the most recent submission API response.
  // These are more reliable than DOM scraping.
  let lastApiLang = null;
  let lastApiQNum = null;
  let lastApiTitleSlug = null;
  let lastSlugFromSubmit = null;

  // SPA Timer
  let problemStartTime = Date.now();
  let currentSlug = "";

  function formatTime(ms) {
    if (ms < 0) return "0s";
    const totalSecs = Math.floor(ms / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const match = lastUrl.match(/\/problems\/([a-z0-9-]+)/);
      if (match) {
        const slug = match[1];
        if (slug !== currentSlug) {
          currentSlug = slug;
          problemStartTime = Date.now();
        }
      }
    }
  }).observe(document, { subtree: true, childList: true });

  const initialMatch = location.href.match(/\/problems\/([a-z0-9-]+)/);
  if (initialMatch) currentSlug = initialMatch[1];

  function post(type, payload) {
    window.postMessage({ source: "lgs-main", type, payload }, "*");
  }

  // ---------- metadata extraction ----------

  /**
   * Tries to extract full problem metadata from LeetCode's embedded __NEXT_DATA__ blob.
   * This is the best source for difficulty, topicTags, and full title.
   * Falls back to document.title / URL parsing.
   */
  function getProblemMeta() {
    try {
      const el = document.getElementById("__NEXT_DATA__");
      if (el) {
        const data = JSON.parse(el.textContent);

        // LeetCode's Next.js structure has moved around; walk several likely spots.
        const q =
          data?.props?.pageProps?.dehydratedState?.queries?.find(
            (q) => q?.state?.data?.question
          )?.state?.data?.question ||
          data?.props?.pageProps?.question;

        if (q) {
          return {
            qNum: String(q.questionFrontendId || q.questionId || "0"),
            title: q.title || "",
            slug: q.titleSlug || "",
            difficulty: q.difficulty || null,
            tags: (q.topicTags || []).map((t) => t.name),
          };
        }
      }
    } catch (_e) {
      // fall through to DOM fallback
    }

    // DOM fallback — parse "42. Trapping Rain Water - LeetCode" from the page title.
    const m = document.title.match(/^(\d+)\.\s*(.+?)\s*-\s*LeetCode/);
    const slugMatch = location.pathname.match(/\/problems\/([a-z0-9-]+)/);

    return {
      qNum: m ? m[1] : (lastApiQNum || "0"),
      title: m ? m[2] : document.title,
      slug: slugMatch
        ? slugMatch[1]
        : (lastApiTitleSlug || lastSlugFromSubmit || "unknown-problem"),
      difficulty: null,
      tags: [],
    };
  }

  /**
   * Reads the active editor code.
   * Primary: window.monaco (clean, exact whitespace).
   * Fallback: rendered .view-line elements (can lose some whitespace).
   */
  function getEditorCode() {
    try {
      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length) {
          // Prefer the model with the most content — LeetCode sometimes
          // keeps a second empty model open for the test-case panel.
          return models.reduce((a, b) =>
            a.getValue().length >= b.getValue().length ? a : b
          ).getValue();
        }
      }
    } catch (_e) {
      /* fall through */
    }

    const lines = Array.from(
      document.querySelectorAll(".view-lines .view-line")
    );
    if (lines.length) {
      return lines.map((l) => l.textContent).join("\n");
    }
    return "";
  }

  /**
   * DOM-only language detection — used only as a fallback when the API
   * response doesn't include a 'lang' field.
   */
  function getLanguageFromDOM() {
    const btn = document.querySelector('[id^="headlessui-listbox-button"]');
    if (btn && btn.textContent.trim()) return btn.textContent.trim();

    const alt = document.querySelector(
      "button.rounded.items-center.whitespace-nowrap"
    );
    if (alt && alt.textContent.trim()) return alt.textContent.trim();

    return null;
  }

  // ---------- fetch interceptor ----------

  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const url =
      typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    // Cache the slug at submit time — useful if the /check/ response
    // doesn't include title_slug.
    const submitMatch = url.match(SUBMIT_URL_RE);
    if (submitMatch) {
      console.log("[LGS] Detected submit API call:", url);
      lastSlugFromSubmit = submitMatch[1];
    }

    const response = await originalFetch.apply(this, args);

    const checkMatch = url.match(CHECK_URL_RE);
    if (checkMatch) {
      console.log("[LGS] Detected check API call:", url);
      // Clone so we don't consume the body LeetCode's own app is waiting on.
      response
        .clone()
        .json()
        .then((data) => {
          console.log("[LGS] Check API response:", data);
          if (
            data &&
            data.state === "SUCCESS" &&
            data.status_msg === "Accepted"
          ) {
            // ---- Primary sources: fields from the API response itself ----
            // These are more reliable than any DOM extraction.
            if (data.lang) lastApiLang = data.lang;
            if (data.question_id) lastApiQNum = String(data.question_id);
            if (data.title_slug) lastApiTitleSlug = data.title_slug;

            // ---- Secondary source: __NEXT_DATA__ (best for difficulty + tags) ----
            const meta = getProblemMeta();

            // Merge: API data wins for IDs; __NEXT_DATA__ wins for difficulty/tags/title.
            if (lastApiQNum && (meta.qNum === "0" || !meta.qNum)) {
              meta.qNum = lastApiQNum;
            }
            if (
              lastApiTitleSlug &&
              (meta.slug === "unknown-problem" || !meta.slug)
            ) {
              meta.slug = lastApiTitleSlug;
            }

            // Language: API lang (primary) → DOM picker (fallback)
            const language = lastApiLang || getLanguageFromDOM() || "unknown";
            const code = getEditorCode();

            // Warn if we still couldn't determine the problem slug.
            if (meta.slug === "unknown-problem" || meta.qNum === "0") {
              post("WARN_MISSING_META", {
                message:
                  "Couldn't auto-detect problem info. Check the push result and edit if needed.",
              });
            }

            const timeSpentMs = Date.now() - problemStartTime;
            const timeSpent = formatTime(timeSpentMs);

            post("ACCEPTED_SUBMISSION", {
              ...meta,
              code,
              language,
              timeSpent,
              url: `https://leetcode.com/problems/${meta.slug}/`,
            });
          }
        })
        .catch((err) => {
          console.error("[LGS] Error parsing check response:", err);
        });
    }

    return response;
  };

  // ---------- manual snapshot (triggered by popup "Sync Now" button) ----------

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (
      event.data?.source === "lgs-isolated" &&
      event.data?.type === "REQUEST_SNAPSHOT"
    ) {
      const meta = getProblemMeta();

      // Merge any API data we cached from a previous submission on this page.
      if (lastApiQNum && (meta.qNum === "0" || !meta.qNum)) {
        meta.qNum = lastApiQNum;
      }
      if (
        lastApiTitleSlug &&
        (meta.slug === "unknown-problem" || !meta.slug)
      ) {
        meta.slug = lastApiTitleSlug;
      }

      // For manual snapshot, DOM is the only available language source
      // (unless they submitted earlier this session and we cached the API lang).
      const language = lastApiLang || getLanguageFromDOM() || "unknown";

      post("MANUAL_SNAPSHOT", {
        ...meta,
        code: getEditorCode(),
        language,
        url: `https://leetcode.com/problems/${meta.slug}/`,
      });
    }
  });
})();
