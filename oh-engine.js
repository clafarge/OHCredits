/**
 * Shared credit rendering + playout (editor + player pages).
 * Load before app.js or player.js.
 */
(function () {
  "use strict";

  const DISPLAY_MS = 5000;
  /** Final slide holds longer before end fade-to-black */
  const LAST_SLIDE_DISPLAY_MS = 10000;
  const FADE_MS = 500;
  /** Full black before first slide content */
  const LEAD_BLACK_MS = 1000;
  /** Hold on full black after the last slide fades out */
  const OUT_BLACK_HOLD_MS = 1000;

  const EPISODE_ID = "__episode__";
  /** Episode JSON field `Tláloc Traversal` becomes its own draggable credit card. */
  const TLALOC_ID = "__tlaloc__";
  /** Default closing slides: branded image cards (paths relative to site root). */
  const IMAGE_CLOUDFLEX_BROADCAST_ID = "__img_cloudflex_broadcast__";
  const IMAGE_ZOOM_THANKS_ID = "__img_zoom_thanks__";
  const IMAGE_OH_TITLE_ID = "__img_oh_title__";
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
    return chunkPeopleGroupsWithMax(sortedNames, PEOPLE_MAX_PER_GROUP);
  }

  /**
   * Same distribution as {@link chunkPeopleGroups} but with a custom max group size (clamped ≥1).
   * @param {string[]} sortedNames
   * @param {number} maxPerGroup
   */
  function chunkPeopleGroupsWithMax(sortedNames, maxPerGroup) {
    const n = sortedNames.length;
    if (n === 0) return [];
    const cap = Math.max(1, Math.min(999, Math.floor(Number(maxPerGroup)) || PEOPLE_MAX_PER_GROUP));
    if (n <= cap) return [sortedNames];
    const numGroups = Math.ceil(n / cap);
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

  /** True when a people string looks like a file path ending in GIF/JPG/JPEG/PNG (case-insensitive). */
  function looksLikeImagePathPeopleValue(s) {
    return /\.(gif|jpe?g|png)$/i.test(String(s || "").trim());
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

  /** Whole-word match only (e.g. Co-Director, not inside unrelated tokens). */
  function roleContainsTraineeTrainerDirector(role) {
    return /\b(trainee|trainer|director)\b/i.test(String(role || ""));
  }

  /** Whole-word "vmix" (any casing) → "vMix" for on-screen role titles. */
  function normalizeVmixInRoleText(s) {
    return String(s || "").replace(/\bvmix\b/gi, "vMix");
  }

  /**
   * Pluralize only Trainee / Trainer / Director wherever they appear as words.
   * Does not alter other words in the phrase.
   */
  function pluralizeTraineeTrainerDirectorWords(role) {
    const t = String(role);
    const words = ["trainee", "trainer", "director"];
    let out = t;
    for (const word of words) {
      const re = new RegExp(`\\b(${word})\\b`, "gi");
      out = out.replace(re, (m) => matchCaseWord(m, pluralizeWordLower(word)));
    }
    return out;
  }

  function roleForDisplay(item) {
    if (item.kind === "imageCard") return "";
    if (item.kind === "peopleImage") return normalizeVmixInRoleText(item.role || "—");
    const base = item.role || "—";
    if (item.kind === "customCard") return normalizeVmixInRoleText(base);
    const people = Array.isArray(item.people) ? item.people : [];
    if (people.length <= 1) return normalizeVmixInRoleText(base);
    const norm = base.trim().toLowerCase().replace(/\s+/g, " ");
    if (norm === "contributing producer") return normalizeVmixInRoleText(pluralizeRolePhrase(base));
    if (
      norm === "special thanks" ||
      norm === "tláloc traversal" ||
      norm === "contributing producers"
    )
      return normalizeVmixInRoleText(base);
    if (norm === "engineer in charge") {
      const parts = base.trim().split(/\s+/);
      const firstWord = parts[0] || "Engineer";
      const engineers = matchCaseWord(firstWord, "engineers");
      return normalizeVmixInRoleText(`${engineers} in Charge`);
    }
    if (roleContainsTraineeTrainerDirector(base))
      return normalizeVmixInRoleText(pluralizeTraineeTrainerDirectorWords(base));
    return normalizeVmixInRoleText(pluralizeRolePhrase(base));
  }

  function creditInnerHtml(item) {
    if (item.kind === "imageCard" && typeof item.src === "string" && item.src.trim()) {
      const rawSrc = item.src.trim();
      const src = escapeHtml(rawSrc);
      const alt = typeof item.alt === "string" ? escapeHtml(item.alt) : "";
      let imgModCls = "";
      if (/ZoomThanks\.png/i.test(rawSrc)) imgModCls = " slide-credit-img--zoom-thanks";
      else if (/CLOUDflex_Broadcast_Logo\.webp/i.test(rawSrc)) imgModCls = " slide-credit-img--cloudflex-broadcast";
      else if (/vMix-Logo-White\.png/i.test(rawSrc)) imgModCls = " slide-credit-img--vmix-logo";
      else if (/ecammlogo_centered\.png/i.test(rawSrc)) imgModCls = " slide-credit-img--ecamm-logo";
      else if (/mimolive-logo\.png/i.test(rawSrc)) imgModCls = " slide-credit-img--mimolive-logo";
      return `<div class="slide-credit-inner slide-credit-inner--image"><img class="slide-credit-img${imgModCls}" src="${src}" alt="${alt}" decoding="async" /></div>`;
    }
    if (item.kind === "peopleImage") {
      const people = Array.isArray(item.people) ? item.people : [];
      const rawSrc = people[0] != null ? String(people[0]).trim() : "";
      if (!rawSrc || !looksLikeImagePathPeopleValue(rawSrc)) {
        const roleHtml = escapeHtml(roleForDisplay(item));
        return `<div class="slide-credit-inner"><h2 class="slide-role">${roleHtml}</h2><p class="slide-empty">Invalid image path</p></div>`;
      }
      const src = escapeHtml(rawSrc);
      const roleHtml = escapeHtml(roleForDisplay(item));
      const alt = escapeHtml(item.role ? normalizeVmixInRoleText(item.role) : rawSrc);
      return `<div class="slide-credit-inner slide-credit-inner--image slide-credit-inner--people-image"><h2 class="slide-role">${roleHtml}</h2><img class="slide-credit-img slide-credit-img--people-path" src="${src}" alt="${alt}" decoding="async" /></div>`;
    }
    const roleHtml = escapeHtml(roleForDisplay(item));
    const cardClass = item.kind === "customCard" ? " slide-credit-block--custom-card" : "";
    const people = Array.isArray(item.people) ? item.people : [];
    if (people.length === 0) {
      return `<div class="slide-credit-inner${cardClass}"><h2 class="slide-role">${roleHtml}</h2><p class="slide-empty">No lines yet</p></div>`;
    }
    const list = `<ul class="slide-people">${people.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;
    return `<div class="slide-credit-inner${cardClass}"><h2 class="slide-role">${roleHtml}</h2>${list}</div>`;
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

  /**
   * Map `?platform=` token (case-insensitive) to closing-slide image. Add new keys here over time.
   * @param {string} token
   * @returns {{ idSlug: string, src: string, alt: string } | null}
   */
  function resolvePlatformLogoSpec(token) {
    const key = String(token || "").trim().toLowerCase();
    if (key === "cloudflex") {
      return {
        idSlug: "cloudflex",
        src: "images/CLOUDflex_Broadcast_Logo.webp",
        alt: "CLOUDflex Broadcast",
      };
    }
    if (key === "vmix") {
      return {
        idSlug: "vmix",
        src: "images/vMix-Logo-White.png",
        alt: "vMix",
      };
    }
    if (key === "ecamm") {
      return {
        idSlug: "ecamm",
        src: "images/ecammlogo_centered.png",
        alt: "Ecamm",
      };
    }
    if (key === "mimolive") {
      return {
        idSlug: "mimolive",
        src: "images/mimoLive-logo.png",
        alt: "mimoLive",
      };
    }
    return null;
  }

  /**
   * Player-only: strip legacy default CLOUDflex closing page from saved designs, then insert
   * partner logos from `?platform=a,b` in list order immediately before the Office Hours title slide.
   * @param {object} state
   * @param {string | null | undefined} platformQueryString
   * @returns {object}
   */
  function preparePlayerDesignState(state, platformQueryString) {
    if (!state || typeof state !== "object") return state;
    const pages =
      Array.isArray(state.pages) && state.pages.length
        ? state.pages.map((p) => (Array.isArray(p) ? [...p] : []))
        : [[]];
    const rawItems = state.items;
    const items =
      rawItems instanceof Map
        ? Object.fromEntries(rawItems)
        : { ...(rawItems && typeof rawItems === "object" ? rawItems : {}) };

    for (let i = pages.length - 1; i >= 0; i--) {
      const pg = pages[i];
      if (pg.length !== 1 || pg[0] !== IMAGE_CLOUDFLEX_BROADCAST_ID) continue;
      const it = items[pg[0]];
      if (
        it &&
        it.kind === "imageCard" &&
        typeof it.src === "string" &&
        /CLOUDflex_Broadcast_Logo\.webp/i.test(it.src)
      ) {
        pages.splice(i, 1);
        delete items[IMAGE_CLOUDFLEX_BROADCAST_ID];
      }
    }

    const raw = String(platformQueryString || "").trim();
    const parts = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
    /** @type {{ idSlug: string, src: string, alt: string }[]} */
    const logos = [];
    for (const part of parts) {
      const spec = resolvePlatformLogoSpec(part);
      if (spec) logos.push(spec);
    }

    let insertAt = -1;
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].length === 1 && pages[i][0] === IMAGE_OH_TITLE_ID) {
        insertAt = i;
        break;
      }
    }
    if (insertAt === -1) {
      for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i].includes(IMAGE_OH_TITLE_ID)) {
          insertAt = i;
          break;
        }
      }
    }

    let pf = 0;
    const toInsert = [];
    for (const spec of logos) {
      const id = `__img_pf_${spec.idSlug}_${pf++}__`;
      items[id] = {
        kind: "imageCard",
        role: "",
        people: [],
        src: spec.src,
        alt: spec.alt,
      };
      toInsert.push([id]);
    }
    if (toInsert.length) {
      if (insertAt === -1) pages.push(...toInsert);
      else pages.splice(insertAt, 0, ...toInsert);
    }

    return {
      ...state,
      pages,
      items,
      episodeHtml: state.episodeHtml != null ? state.episodeHtml : null,
    };
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
        const holdMs = i === slides.length - 1 ? LAST_SLIDE_DISPLAY_MS : DISPLAY_MS;
        await sleep(holdMs);
        if (ac.signal.aborted) break;

        const hasNext = i < slides.length - 1;
        if (hasNext) {
          el.classList.add("is-hidden");
          await sleep(FADE_MS);
        }
      }

      if (!ac.signal.aborted && lastShownIndex >= 0) {
        el.classList.add("is-hidden");
        await sleep(FADE_MS);
        if (!ac.signal.aborted) {
          el.innerHTML = '<div class="oh-lead-black" aria-hidden="true"></div>';
          el.classList.remove("is-hidden");
          await sleep(OUT_BLACK_HOLD_MS);
        }
      }
    } finally {
      el.classList.remove("is-hidden");
      if (ac.signal.aborted && slides.length && lastShownIndex >= 0) {
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
    LAST_SLIDE_DISPLAY_MS,
    FADE_MS,
    LEAD_BLACK_MS,
    OUT_BLACK_HOLD_MS,
    EPISODE_ID,
    TLALOC_ID,
    IMAGE_CLOUDFLEX_BROADCAST_ID,
    IMAGE_ZOOM_THANKS_ID,
    IMAGE_OH_TITLE_ID,
    PEOPLE_MAX_PER_GROUP,
    sleep,
    escapeHtml,
    sortPeopleNames,
    chunkPeopleGroups,
    chunkPeopleGroupsWithMax,
    looksLikeImagePathPeopleValue,
    creditInnerHtml,
    roleForDisplay,
    buildSlides,
    renderSlideInto,
    runPlayoutOnElement,
    encodeDesignState,
    decodeDesignState,
    preparePlayerDesignState,
  };
})();
