/**
 * Shared credit rendering + playout (editor + player pages).
 * Load before app.js or player.js.
 */
(function () {
  "use strict";

  const DISPLAY_MS = 5000;
  const FADE_MS = 500;
  /** Full black before first slide content */
  const LEAD_BLACK_MS = 1000;

  const EPISODE_ID = "__episode__";
  const PEOPLE_MAX_PER_GROUP = 12;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sortPeopleNames(names) {
    return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  }

  function chunkPeopleGroups(sortedNames) {
    const n = sortedNames.length;
    if (n === 0) return [];
    if (n <= PEOPLE_MAX_PER_GROUP) return [sortedNames];
    const numGroups = Math.ceil(n / PEOPLE_MAX_PER_GROUP);
    const base = Math.floor(n / numGroups);
    const remainder = n % numGroups;
    /** @type {string[][]} */
    const groups = [];
    let idx = 0;
    for (let g = 0; g < numGroups; g++) {
      const size = base + (g < remainder ? 1 : 0);
      groups.push(sortedNames.slice(idx, idx + size));
      idx += size;
    }
    return groups;
  }

  function pluralizeWordLower(lower) {
    if (!lower) return lower;
    if (/[bcdfghjklmnpqrstvwxyz]y$/.test(lower)) return lower.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh)$/.test(lower)) return lower + "es";
    return lower + "s";
  }

  function matchCaseWord(original, pluralLower) {
    if (!original) return pluralLower;
    if (original === original.toUpperCase()) return pluralLower.toUpperCase();
    if (
      original.length > 0 &&
      original[0] === original[0].toUpperCase() &&
      original.slice(1) === original.slice(1).toLowerCase()
    ) {
      return pluralLower.charAt(0).toUpperCase() + pluralLower.slice(1);
    }
    return pluralLower;
  }

  function pluralizeToken(originalToken) {
    const t = originalToken.trim();
    if (!t) return t;
    if (t.includes("-")) {
      const parts = t.split("-");
      const last = parts[parts.length - 1];
      const pl = pluralizeWordLower(last.toLowerCase());
      parts[parts.length - 1] = matchCaseWord(last, pl);
      return parts.join("-");
    }
    const pl = pluralizeWordLower(t.toLowerCase());
    return matchCaseWord(t, pl);
  }

  function pluralizeRolePhrase(role) {
    const t = role.trim();
    if (!t) return role;
    const parts = t.split(/\s+/);
    if (parts.length === 0) return role;
    const pluralizeFirst = /\s+in\s+/i.test(t) || /\s+of\s+/i.test(t);
    const idx = pluralizeFirst ? 0 : parts.length - 1;
    parts[idx] = pluralizeToken(parts[idx]);
    return parts.join(" ");
  }

  function roleForDisplay(item) {
    const base = item.role || "—";
    if (item.people.length <= 1) return base;
    return pluralizeRolePhrase(base);
  }

  function creditInnerHtml(item) {
    const roleHtml = escapeHtml(roleForDisplay(item));
    if (item.people.length === 0) {
      return `<h2 class="slide-role">${roleHtml}</h2><p class="slide-empty">No names listed</p>`;
    }
    const list = `<ul class="slide-people">${item.people.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;
    return `<h2 class="slide-role">${roleHtml}</h2>${list}`;
  }

  /**
   * @param {{ episodeHtml: string | null, pages: string[][], items: Map<string, { role: string, people: string[] }> | Record<string, { role: string, people: string[] }> }} state
   */
  function buildSlides(state) {
    const episodeHtml = state.episodeHtml;
    const pages = state.pages;
    const raw = state.items;
    const items =
      raw instanceof Map ? raw : new Map(Object.entries(raw && typeof raw === "object" ? raw : {}));

    /** @type {{ html: string }[]} */
    const slides = [];
    for (const ids of pages) {
      if (ids.length === 0) {
        slides.push({
          html: `<div class="slide-page slide-page--blank" aria-label="Blank page"></div>`,
        });
        continue;
      }
      const blocks = ids
        .map((id) => {
          if (id === EPISODE_ID && episodeHtml) {
            return `<div class="slide-credit-block slide-episode-block">${episodeHtml}</div>`;
          }
          const item = items.get(id);
          return item ? `<div class="slide-credit-block">${creditInnerHtml(item)}</div>` : "";
        })
        .filter(Boolean);
      const gaps = blocks.length > 1 ? blocks.join('<div class="slide-credit-gap"></div>') : blocks[0];
      slides.push({ html: `<div class="slide-page">${gaps}</div>` });
    }
    return slides;
  }

  function renderSlideInto(el, slides, index) {
    if (index < 0 || index >= slides.length) {
      el.innerHTML = `<p class="slide-empty">No slide.</p>`;
      return;
    }
    el.innerHTML = slides[index].html;
  }

  /**
   * @param {HTMLElement} el
   * @param {{ html: string }[]} slides
   * @param {AbortController} ac
   */
  async function runPlayoutOnElement(el, slides, ac) {
    if (slides.length === 0) return -1;
    el.style.transition = `opacity ${FADE_MS}ms ease`;
    let lastShownIndex = -1;
    try {
      el.innerHTML =
        '<div class="oh-lead-black" aria-hidden="true"></div>';
      el.classList.remove("is-hidden");
      await sleep(LEAD_BLACK_MS);
      if (ac.signal.aborted) return -1;

      for (let i = 0; i < slides.length; i++) {
        if (ac.signal.aborted) break;

        el.innerHTML = slides[i].html;
        lastShownIndex = i;
        el.classList.add("is-hidden");
        await sleep(0);
        void el.offsetHeight;
        el.classList.remove("is-hidden");
        await sleep(FADE_MS);

        if (ac.signal.aborted) break;
        await sleep(DISPLAY_MS);
        if (ac.signal.aborted) break;

        const hasNext = i < slides.length - 1;
        if (hasNext) {
          el.classList.add("is-hidden");
          await sleep(FADE_MS);
        }
      }
    } finally {
      el.classList.remove("is-hidden");
      if (slides.length && lastShownIndex >= 0) {
        renderSlideInto(el, slides, lastShownIndex);
      }
    }
    return lastShownIndex;
  }

  function encodeDesignState(obj) {
    const json = JSON.stringify(obj);
    return encodeURIComponent(btoa(unescape(encodeURIComponent(json))));
  }

  function decodeDesignState(encoded) {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
    return JSON.parse(json);
  }

  window.OHCreditsEngine = {
    DISPLAY_MS,
    FADE_MS,
    LEAD_BLACK_MS,
    EPISODE_ID,
    PEOPLE_MAX_PER_GROUP,
    sleep,
    escapeHtml,
    sortPeopleNames,
    chunkPeopleGroups,
    creditInnerHtml,
    roleForDisplay,
    buildSlides,
    renderSlideInto,
    runPlayoutOnElement,
    encodeDesignState,
    decodeDesignState,
  };
})();
