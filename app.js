(function () {
  "use strict";

  const DISPLAY_MS = 5000;
  const FADE_MS = 500;

  /**
   * Usable vertical space (px) per page at playout scale — tuned so ~3 simple credits
   * (role + one short name each) fit comfortably in both formats; 9:16 gets more room
   * because the portrait frame is taller. Organizer box height is aligned to 16:9 budget.
   */
  const BUDGET_PX = { "169": 225, "916": 410 };

  /** Chars per line heuristic for wrapped name lines in narrow vs wide boxes */
  const CPL = { "169": 44, "916": 20 };

  /** Per-credit stack: role + names + gap below block (matches real CSS ~17px/15px type) */
  const LINE_PX = 22;
  const ROLE_BLOCK_PX = 20;
  const BLOCK_GAP_PX = 14;

  const els = {
    toggleJson: document.getElementById("btn-toggle-json"),
    jsonPanel: document.getElementById("json-panel"),
    jsonInput: document.getElementById("json-input"),
    jsonStatus: document.getElementById("json-status"),
    applyJson: document.getElementById("btn-apply-json"),
    slide169: document.getElementById("slide-content-169"),
    slide916: document.getElementById("slide-content-916"),
    pageStrip: document.getElementById("page-strip"),
    btnPreview: document.getElementById("btn-preview"),
    btnPlayBoth: document.getElementById("btn-play-both"),
    btnPlay169: document.getElementById("btn-play-169"),
    btnPlay916: document.getElementById("btn-play-916"),
    btnStop: document.getElementById("btn-stop"),
    btnAddPage: document.getElementById("btn-add-page"),
  };

  /** @type {string | null} */
  let episodeHtml = null;
  /** @type {Map<string, { role: string, people: string[] }>} */
  let itemsById = new Map();
  /** @type {string[][]} shared page layout for both 16:9 and 9:16 */
  let pages = [[]];

  let playAbort = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setJsonStatus(message, kind) {
    els.jsonStatus.textContent = message || "";
    els.jsonStatus.classList.remove("error", "ok");
    if (kind) els.jsonStatus.classList.add(kind);
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pluralizeWordLower(lower) {
    if (!lower) return lower;
    if (/[bcdfghjklmnpqrstvwxyz]y$/.test(lower)) return lower.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh)$/.test(lower)) return lower + "es";
    return lower + "s";
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

  /**
   * @param {{ role: string, people: string[] }} item
   * @param {'169'|'916'} aspect
   */
  function estimateItemPx(item, aspect) {
    const cpl = CPL[aspect];
    const scale = aspect === "916" ? 15 / 17 : 1;
    let h = ROLE_BLOCK_PX * scale;
    const line = LINE_PX * scale;
    if (item.people.length === 0) h += line;
    else {
      for (const p of item.people) {
        const lines = Math.max(1, Math.ceil(p.length / cpl));
        h += lines * line;
      }
    }
    h += BLOCK_GAP_PX * scale;
    return h;
  }

  /**
   * Start a new page when adding the next role would exceed budget in either aspect.
   * @param {string[]} orderedIds
   */
  function autoPaginateShared(orderedIds) {
    const b169 = BUDGET_PX["169"];
    const b916 = BUDGET_PX["916"];
    /** @type {string[][]} */
    const out = [[]];
    let used169 = 0;
    let used916 = 0;
    for (const id of orderedIds) {
      const item = itemsById.get(id);
      if (!item) continue;
      const n169 = estimateItemPx(item, "169");
      const n916 = estimateItemPx(item, "916");
      const over169 = used169 + n169 > b169;
      const over916 = used916 + n916 > b916;
      if ((over169 || over916) && out[out.length - 1].length > 0) {
        out.push([]);
        used169 = 0;
        used916 = 0;
      }
      out[out.length - 1].push(id);
      used169 += n169;
      used916 += n916;
    }
    return out.length ? out : [[]];
  }

  function normalizePages(p) {
    const nonEmpty = p.filter((x) => x.length > 0);
    return nonEmpty.length ? nonEmpty : [[]];
  }

  function creditInnerHtml(item) {
    const roleHtml = escapeHtml(roleForDisplay(item));
    const list =
      item.people.length === 0
        ? `<p class="slide-empty">No names listed</p>`
        : `<ul class="slide-people">${item.people.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;
    return `<h2 class="slide-role">${roleHtml}</h2>${list}`;
  }

  function creditBlockHtml(item, id) {
    return `<div class="slide-credit-block credit-draggable" draggable="true" data-credit-id="${escapeHtml(id)}">${creditInnerHtml(item)}</div>`;
  }

  function parseCreditsPayload(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Root must be an object");

    const episode = data.episode && typeof data.episode === "object" ? data.episode : null;
    const credits = Array.isArray(data.credits) ? data.credits : null;
    if (!credits) throw new Error('Missing "credits" array');

    let epHtml = null;
    const title = episode && typeof episode.title === "string" ? episode.title.trim() : "";
    const date = episode && typeof episode.date === "string" ? episode.date.trim() : "";
    if (title || date) {
      let h = "";
      if (title) h += `<h1 class="slide-episode-title">${escapeHtml(title)}</h1>`;
      if (date) h += `<p class="slide-episode-date">${escapeHtml(date)}</p>`;
      epHtml = h;
    }

    /** @type {string[]} */
    const order = [];
    itemsById = new Map();

    for (let i = 0; i < credits.length; i++) {
      const row = credits[i];
      if (!row || typeof row !== "object") continue;
      const role = typeof row.role === "string" ? row.role.trim() : "";
      let people = row.people;
      if (!Array.isArray(people)) people = [];
      const names = people
        .map((p) => (typeof p === "string" ? p.trim() : String(p)))
        .filter(Boolean);
      const id = `c-${i}`;
      itemsById.set(id, { role: role || "—", people: names });
      order.push(id);
    }

    if (order.length === 0 && !epHtml) throw new Error("No credits or episode content");
    return { episodeHtml: epHtml, itemOrder: order };
  }

  function applyJsonFromInput() {
    const text = els.jsonInput.value.trim();
    if (!text) {
      setJsonStatus("Paste JSON first.", "error");
      return;
    }
    try {
      const { episodeHtml: ep, itemOrder } = parseCreditsPayload(text);
      episodeHtml = ep;
      pages = itemOrder.length ? autoPaginateShared(itemOrder) : [[]];
      const n = itemOrder.length;
      setJsonStatus(
        `${n} role row(s) · ${pages.length} shared page(s) · auto-split when either format would overflow (estimate).`,
        "ok"
      );
      renderPageStrip();
      renderPlayoutEmpty();
    } catch (e) {
      itemsById = new Map();
      episodeHtml = null;
      pages = [[]];
      setJsonStatus(e instanceof Error ? e.message : String(e), "error");
      renderPageStrip();
      renderPlayoutEmpty();
    }
  }

  function renderPlayoutEmpty() {
    const msg = `<p class="slide-empty">No data — paste JSON and Apply.</p>`;
    els.slide169.innerHTML = msg;
    els.slide916.innerHTML = msg;
  }

  /**
   * @param {string} id
   * @param {number} toPageIndex
   * @param {number | null} insertBeforeIndex
   */
  function moveCredit(id, toPageIndex, insertBeforeIndex) {
    let fromPi = -1;
    let fromIi = -1;
    for (let pi = 0; pi < pages.length; pi++) {
      const ii = pages[pi].indexOf(id);
      if (ii !== -1) {
        fromPi = pi;
        fromIi = ii;
        break;
      }
    }
    if (fromPi === -1) return;

    pages[fromPi].splice(fromIi, 1);

    let ins = insertBeforeIndex == null ? pages[toPageIndex].length : insertBeforeIndex;
    if (ins < 0) ins = 0;
    if (fromPi === toPageIndex && fromIi < ins) ins -= 1;
    if (!pages[toPageIndex]) return;
    pages[toPageIndex].splice(ins, 0, id);

    pages = normalizePages(pages);
    renderPageStrip();
  }

  function addEmptyPage() {
    pages.push([]);
    renderPageStrip();
  }

  function buildPageBoxHtml(pageIndex, ids) {
    let est169 = 0;
    let est916 = 0;
    for (const id of ids) {
      const item = itemsById.get(id);
      if (!item) continue;
      est169 += estimateItemPx(item, "169");
      est916 += estimateItemPx(item, "916");
    }
    const b169 = BUDGET_PX["169"];
    const b916 = BUDGET_PX["916"];
    const ratio = Math.max(est169 / b169, est916 / b916);
    let metaClass = "page-box-meta--ok";
    if (ratio > 1.2) metaClass = "page-box-meta--bad";
    else if (ratio > 1.05) metaClass = "page-box-meta--warn";

    const metaText = `16:9 ~${Math.round(est169)}/${b169}px · 9:16 ~${Math.round(est916)}/${b916}px`;

    const inner =
      ids.length === 0
        ? `<p class="slide-empty" style="font-size:12px;margin:12px 0;">Drop roles here</p>`
        : ids
            .map((id) => {
              const item = itemsById.get(id);
              return item ? creditBlockHtml(item, id) : "";
            })
            .join("");

    const fitKey = metaClass.replace("page-box-meta--", "");
    return `
      <div class="page-box page-box--organizer" data-page="${pageIndex}">
        <div class="page-box-header">
          <span class="page-box-title">Page ${pageIndex + 1}</span>
          <span class="page-box-meta ${metaClass}" data-estimate="${escapeHtml(metaText)}" data-fit="${fitKey}" title="Estimated content height vs usable height for each format">${metaText}</span>
        </div>
        <div class="page-box-viewport" data-drop-page="${pageIndex}">
          <div class="page-box-inner">${inner}</div>
        </div>
        <div class="page-box-drop-zone" data-page="${pageIndex}">Drop at end of page</div>
      </div>
    `;
  }

  function renderPageStrip() {
    if (itemsById.size === 0) {
      const msg = episodeHtml
        ? '<p class="slide-empty" style="font-size:13px;padding:8px 0;">No role rows — only episode title/date. Add credits in JSON for page boxes.</p>'
        : '<p class="slide-empty" style="font-size:13px;padding:8px 0;">Apply JSON to see page boxes.</p>';
      els.pageStrip.innerHTML = msg;
      return;
    }

    els.pageStrip.innerHTML = pages.map((ids, i) => buildPageBoxHtml(i, ids)).join("");

    requestAnimationFrame(() => {
      measurePageOverflow(els.pageStrip);
    });
  }

  function measurePageOverflow(strip) {
    strip.querySelectorAll(".page-box-inner").forEach((inner) => {
      const el = /** @type {HTMLElement} */ (inner);
      const overflow = el.scrollHeight > el.clientHeight + 2;
      el.classList.toggle("page-box-inner--overflow", overflow);
      const meta = el.closest(".page-box")?.querySelector(".page-box-meta");
      if (!meta) return;
      const base = meta.getAttribute("data-estimate") || "";
      if (overflow) {
        meta.classList.remove("page-box-meta--ok", "page-box-meta--warn", "page-box-meta--bad");
        meta.classList.add("page-box-meta--bad");
        meta.textContent = base ? `${base} · 16:9 box scroll overflow` : "overflow";
      } else {
        const fit = meta.getAttribute("data-fit") || "ok";
        meta.classList.remove("page-box-meta--ok", "page-box-meta--warn", "page-box-meta--bad");
        meta.classList.add(`page-box-meta--${fit}`);
        meta.textContent = base;
      }
    });
  }

  function buildSlidesForAspect(aspect) {
    /** @type {{ html: string }[]} */
    const slides = [];
    if (episodeHtml) slides.push({ html: episodeHtml });
    for (const ids of pages) {
      if (ids.length === 0) continue;
      const blocks = ids
        .map((id) => {
          const item = itemsById.get(id);
          return item
            ? `<div class="slide-credit-block">${creditInnerHtml(item)}</div>`
            : "";
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

  function setPlayingUi(playing) {
    els.btnPlayBoth.disabled = playing;
    els.btnPlay169.disabled = playing;
    els.btnPlay916.disabled = playing;
    els.btnStop.disabled = !playing;
    els.btnPreview.disabled = playing;
    els.toggleJson.disabled = playing;
  }

  async function runPlayoutOnElement(el, slides, ac) {
    if (slides.length === 0) return -1;
    el.style.transition = `opacity ${FADE_MS}ms ease`;
    let lastShownIndex = -1;
    try {
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

  async function runPlayoutBoth() {
    const s169 = buildSlidesForAspect("169");
    const s916 = buildSlidesForAspect("916");
    if (s169.length === 0 && s916.length === 0) {
      setJsonStatus("Load JSON before play.", "error");
      return;
    }

    const ac = new AbortController();
    playAbort = ac;
    setPlayingUi(true);
    try {
      await Promise.all([
        runPlayoutOnElement(els.slide169, s169, ac),
        runPlayoutOnElement(els.slide916, s916, ac),
      ]);
    } finally {
      setPlayingUi(false);
      playAbort = null;
    }
  }

  async function runPlayout(aspect) {
    const slides = buildSlidesForAspect(aspect);
    if (slides.length === 0) {
      setJsonStatus("Load JSON before play.", "error");
      return;
    }

    const el = aspect === "169" ? els.slide169 : els.slide916;
    const ac = new AbortController();
    playAbort = ac;
    setPlayingUi(true);
    try {
      await runPlayoutOnElement(el, slides, ac);
    } finally {
      setPlayingUi(false);
      playAbort = null;
    }
  }

  function stopPlayout() {
    if (playAbort) playAbort.abort();
  }

  function previewFirstSlide() {
    stopPlayout();
    if (itemsById.size === 0) {
      applyJsonFromInput();
      if (itemsById.size === 0) return;
    }
    const s169 = buildSlidesForAspect("169");
    const s916 = buildSlidesForAspect("916");
    els.slide169.classList.remove("is-hidden");
    els.slide916.classList.remove("is-hidden");
    renderSlideInto(els.slide169, s169, 0);
    renderSlideInto(els.slide916, s916, 0);
  }

  /** @param {DragEvent} e */
  function dragPayload(e) {
    const raw = e.dataTransfer?.getData("application/x-ohcredit");
    if (!raw) return null;
    try {
      return /** @type {{ id: string }} */ (JSON.parse(raw));
    } catch {
      return null;
    }
  }

  document.addEventListener("dragstart", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const card = t.closest(".credit-draggable");
    if (!card || !e.dataTransfer) return;
    const id = card.dataset.creditId;
    if (!id) return;
    card.classList.add("is-dragging");
    e.dataTransfer.setData("application/x-ohcredit", JSON.stringify({ id }));
    e.dataTransfer.effectAllowed = "move";
  });

  document.addEventListener("dragend", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const card = t.closest(".credit-draggable");
    if (card) card.classList.remove("is-dragging");
    document.querySelectorAll(".page-box-drop-target").forEach((n) => n.classList.remove("page-box-drop-target"));
  });

  document.addEventListener("dragover", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const zone = t.closest("[data-drop-page], .page-box-drop-zone, .credit-draggable");
    if (!zone) return;
    const payload = e.dataTransfer?.types.includes("application/x-ohcredit");
    if (!payload) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });

  document.addEventListener("dragenter", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const zone = t.closest(".page-box-viewport, .page-box-drop-zone");
    if (!zone || !e.dataTransfer?.types.includes("application/x-ohcredit")) return;
    zone.classList.add("page-box-drop-target");
  });

  document.addEventListener("dragleave", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const zone = t.closest(".page-box-viewport, .page-box-drop-zone");
    if (!zone) return;
    if (!zone.contains(/** @type {Node} */ (e.relatedTarget))) {
      zone.classList.remove("page-box-drop-target");
    }
  });

  document.addEventListener("drop", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    e.preventDefault();
    const payload = dragPayload(e);
    if (!payload) return;

    document.querySelectorAll(".page-box-drop-target").forEach((n) => n.classList.remove("page-box-drop-target"));

    const dropZone = t.closest(".page-box-drop-zone");
    if (dropZone) {
      const pageIndex = parseInt(dropZone.dataset.page || "0", 10);
      moveCredit(payload.id, pageIndex, null);
      return;
    }

    const card = t.closest(".credit-draggable");
    if (card) {
      const pageBox = card.closest(".page-box");
      if (!pageBox) return;
      const pageIndex = parseInt(pageBox.dataset.page || "0", 10);
      const inner = pageBox.querySelector(".page-box-inner");
      const siblings = inner ? Array.from(inner.querySelectorAll(".credit-draggable")) : [];
      const insertBefore = siblings.indexOf(card);
      if (insertBefore >= 0) moveCredit(payload.id, pageIndex, insertBefore);
      return;
    }

    const viewport = t.closest(".page-box-viewport");
    if (viewport) {
      const pageBox = viewport.closest(".page-box");
      if (!pageBox) return;
      const pageIndex = parseInt(pageBox.dataset.page || "0", 10);
      moveCredit(payload.id, pageIndex, null);
    }
  });

  els.toggleJson.addEventListener("click", () => {
    const isHidden = els.jsonPanel.hidden;
    els.jsonPanel.hidden = !isHidden;
    els.jsonPanel.classList.toggle("hidden", !isHidden);
    els.toggleJson.setAttribute("aria-expanded", String(isHidden));
  });

  els.applyJson.addEventListener("click", applyJsonFromInput);

  els.btnPreview.addEventListener("click", previewFirstSlide);

  els.btnPlayBoth.addEventListener("click", () => {
    void runPlayoutBoth();
  });

  els.btnPlay169.addEventListener("click", () => {
    void runPlayout("169");
  });

  els.btnPlay916.addEventListener("click", () => {
    void runPlayout("916");
  });

  els.btnStop.addEventListener("click", stopPlayout);

  els.btnAddPage.addEventListener("click", addEmptyPage);

  function applyViewFromQuery() {
    const app = document.querySelector(".app");
    if (!app) return;
    const p = new URLSearchParams(window.location.search);
    const raw = (p.get("view") || p.get("format") || "").toLowerCase().replace(/_/g, "");
    app.classList.remove("app--169-only", "app--916-only");
    if (raw === "16x9" || raw === "169" || raw === "horizontal" || raw === "landscape") {
      app.classList.add("app--169-only");
    } else if (raw === "9x16" || raw === "916" || raw === "vertical" || raw === "portrait") {
      app.classList.add("app--916-only");
    }
  }

  applyViewFromQuery();

  renderPlayoutEmpty();
  renderPageStrip();
})();
