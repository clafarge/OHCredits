(function () {
  "use strict";

  const DISPLAY_MS = 5000;
  const FADE_MS = 500;

  /** Inner content budgets (px) — tuned to match .page-box-inner padding + viewport */
  const BUDGET_PX = { "169": 118, "916": 312 };

  /** Chars per line heuristic for wrapped name lines in narrow vs wide boxes */
  const CPL = { "169": 40, "916": 18 };

  const LINE_PX = 24;
  const ROLE_BLOCK_PX = 26;
  const BLOCK_GAP_PX = 14;

  const els = {
    toggleJson: document.getElementById("btn-toggle-json"),
    jsonPanel: document.getElementById("json-panel"),
    jsonInput: document.getElementById("json-input"),
    jsonStatus: document.getElementById("json-status"),
    applyJson: document.getElementById("btn-apply-json"),
    slide169: document.getElementById("slide-content-169"),
    slide916: document.getElementById("slide-content-916"),
    strip169: document.getElementById("page-strip-169"),
    strip916: document.getElementById("page-strip-916"),
    btnPreview: document.getElementById("btn-preview"),
    btnPlay169: document.getElementById("btn-play-169"),
    btnPlay916: document.getElementById("btn-play-916"),
    btnStop: document.getElementById("btn-stop"),
  };

  /** @type {string | null} */
  let episodeHtml = null;
  /** @type {Map<string, { role: string, people: string[] }>} */
  let itemsById = new Map();
  /** @type {string[][]} */
  let pages169 = [[]];
  /** @type {string[][]} */
  let pages916 = [[]];

  let playAbort = null;
  /** @type {HTMLElement | null} */
  let playoutEl = null;

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

  /**
   * @param {{ role: string, people: string[] }} item
   * @param {'169'|'916'} aspect
   */
  function estimateItemPx(item, aspect) {
    const cpl = CPL[aspect];
    let h = ROLE_BLOCK_PX;
    if (item.people.length === 0) h += LINE_PX;
    else {
      for (const p of item.people) {
        const lines = Math.max(1, Math.ceil(p.length / cpl));
        h += lines * LINE_PX;
      }
    }
    h += BLOCK_GAP_PX;
    return h;
  }

  /**
   * @param {string[]} orderedIds
   * @param {'169'|'916'} aspect
   */
  function autoPaginate(orderedIds, aspect) {
    const budget = BUDGET_PX[aspect];
    /** @type {string[][]} */
    const pages = [[]];
    let used = 0;
    for (const id of orderedIds) {
      const item = itemsById.get(id);
      if (!item) continue;
      const need = estimateItemPx(item, aspect);
      if (used + need > budget && pages[pages.length - 1].length > 0) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(id);
      used += need;
    }
    return pages.length ? pages : [[]];
  }

  function normalizePages(pages) {
    const nonEmpty = pages.filter((p) => p.length > 0);
    return nonEmpty.length ? nonEmpty : [[]];
  }

  function creditInnerHtml(item) {
    const roleHtml = escapeHtml(item.role || "—");
    const list =
      item.people.length === 0
        ? `<p class="slide-empty">No names listed</p>`
        : `<ul class="slide-people">${item.people.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;
    return `<h2 class="slide-role">${roleHtml}</h2>${list}`;
  }

  function creditBlockHtml(item, id, aspect) {
    return `<div class="slide-credit-block credit-draggable" draggable="true" data-credit-id="${escapeHtml(id)}" data-aspect="${aspect}">${creditInnerHtml(item)}</div>`;
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
      pages169 = itemOrder.length ? autoPaginate(itemOrder, "169") : [[]];
      pages916 = itemOrder.length ? autoPaginate(itemOrder, "916") : [[]];
      const n = itemOrder.length;
      setJsonStatus(
        `${n} role row(s) · ~${pages169.length} page(s) 16:9 · ~${pages916.length} page(s) 9:16 (estimated).`,
        "ok"
      );
      renderPageStrips();
      renderPlayoutEmpty();
    } catch (e) {
      itemsById = new Map();
      episodeHtml = null;
      pages169 = [[]];
      pages916 = [[]];
      setJsonStatus(e instanceof Error ? e.message : String(e), "error");
      renderPageStrips();
      renderPlayoutEmpty();
    }
  }

  function renderPlayoutEmpty() {
    const msg = `<p class="slide-empty">No data — paste JSON and Apply.</p>`;
    els.slide169.innerHTML = msg;
    els.slide916.innerHTML = msg;
  }

  function getPages(aspect) {
    return aspect === "169" ? pages169 : pages916;
  }

  /**
   * @param {'169'|'916'} aspect
   * @param {string} id
   * @param {number} toPageIndex
   * @param {number | null} insertBeforeIndex in target page list (null = append)
   */
  function moveCredit(aspect, id, toPageIndex, insertBeforeIndex) {
    const pages = getPages(aspect);
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

    if (aspect === "169") pages169 = normalizePages(pages);
    else pages916 = normalizePages(pages);

    renderPageStrips();
  }

  function addEmptyPage(aspect) {
    const pages = getPages(aspect);
    pages.push([]);
    if (aspect === "169") pages169 = pages;
    else pages916 = pages;
    renderPageStrips();
  }

  function buildPageBoxHtml(aspect, pageIndex, ids) {
    const budget = BUDGET_PX[aspect];
    let est = 0;
    for (const id of ids) {
      const item = itemsById.get(id);
      if (item) est += estimateItemPx(item, aspect);
    }
    let metaClass = "page-box-meta--ok";
    let metaText = `~${Math.round(est)} / ${budget}px`;
    if (est > budget * 1.05) metaClass = "page-box-meta--warn";
    if (est > budget * 1.2) metaClass = "page-box-meta--bad";

    const inner =
      ids.length === 0
        ? `<p class="slide-empty" style="font-size:12px;margin:12px 0;">Drop roles here</p>`
        : ids.map((id) => {
            const item = itemsById.get(id);
            return item ? creditBlockHtml(item, id, aspect) : "";
          }).join("");

    const fitKey = metaClass.replace("page-box-meta--", "");
    return `
      <div class="page-box page-box--${aspect}" data-aspect="${aspect}" data-page="${pageIndex}">
        <div class="page-box-header">
          <span class="page-box-title">Page ${pageIndex + 1}</span>
          <span class="page-box-meta ${metaClass}" data-estimate="${escapeHtml(metaText)}" data-fit="${fitKey}" title="Estimated content height vs usable page height">${metaText}</span>
        </div>
        <div class="page-box-viewport" data-drop-page="${pageIndex}">
          <div class="page-box-inner" data-aspect-inner="${aspect}">${inner}</div>
        </div>
        <div class="page-box-drop-zone" data-aspect="${aspect}" data-page="${pageIndex}">Drop at end of page</div>
      </div>
    `;
  }

  function renderPageStrips() {
    if (itemsById.size === 0) {
      const msg = episodeHtml
        ? '<p class="slide-empty" style="font-size:13px;padding:8px 0;">No role rows — only episode title/date. Add credits in JSON for page boxes.</p>'
        : '<p class="slide-empty" style="font-size:13px;padding:8px 0;">Apply JSON to see page boxes.</p>';
      els.strip169.innerHTML = msg;
      els.strip916.innerHTML = msg;
      return;
    }

    els.strip169.innerHTML = pages169
      .map((ids, i) => buildPageBoxHtml("169", i, ids))
      .join("");
    els.strip916.innerHTML = pages916
      .map((ids, i) => buildPageBoxHtml("916", i, ids))
      .join("");

    requestAnimationFrame(() => {
      measurePageOverflow(els.strip169);
      measurePageOverflow(els.strip916);
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
        meta.textContent = base ? `${base} · scroll overflow` : "overflow";
      } else {
        const fit = meta.getAttribute("data-fit") || "ok";
        meta.classList.remove("page-box-meta--ok", "page-box-meta--warn", "page-box-meta--bad");
        meta.classList.add(`page-box-meta--${fit}`);
        meta.textContent = base;
      }
    });
  }

  /**
   * @param {'169'|'916'} aspect
   */
  function buildSlidesForAspect(aspect) {
    const pages = getPages(aspect);
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

  async function runPlayout(aspect) {
    const slides = buildSlidesForAspect(aspect);
    if (slides.length === 0) {
      setJsonStatus("Load JSON before play.", "error");
      return;
    }

    const el = aspect === "169" ? els.slide169 : els.slide916;
    const ac = new AbortController();
    playAbort = ac;
    playoutEl = el;
    els.btnPlay169.disabled = true;
    els.btnPlay916.disabled = true;
    els.btnStop.disabled = false;
    els.btnPreview.disabled = true;
    els.toggleJson.disabled = true;

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
      els.btnPlay169.disabled = false;
      els.btnPlay916.disabled = false;
      els.btnStop.disabled = true;
      els.btnPreview.disabled = false;
      els.toggleJson.disabled = false;
      playAbort = null;
      playoutEl = null;
      if (slides.length && lastShownIndex >= 0) {
        renderSlideInto(el, slides, lastShownIndex);
      }
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
      return /** @type {{ aspect: '169'|'916', id: string }} */ (JSON.parse(raw));
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
    const aspect = /** @type {'169'|'916'} */ (card.dataset.aspect);
    if (!id || !aspect) return;
    card.classList.add("is-dragging");
    e.dataTransfer.setData("application/x-ohcredit", JSON.stringify({ aspect, id }));
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
      const aspect = /** @type {'169'|'916'} */ (dropZone.dataset.aspect);
      const pageIndex = parseInt(dropZone.dataset.page || "0", 10);
      if (aspect !== payload.aspect) return;
      moveCredit(aspect, payload.id, pageIndex, null);
      return;
    }

    const card = t.closest(".credit-draggable");
    if (card && card.dataset.aspect === payload.aspect) {
      const pageBox = card.closest(".page-box");
      if (!pageBox) return;
      const aspect = /** @type {'169'|'916'} */ (pageBox.dataset.aspect);
      const pageIndex = parseInt(pageBox.dataset.page || "0", 10);
      const inner = pageBox.querySelector(".page-box-inner");
      const id = payload.id;
      const siblings = inner ? Array.from(inner.querySelectorAll(".credit-draggable")) : [];
      const insertBefore = siblings.indexOf(card);
      if (insertBefore >= 0) moveCredit(aspect, id, pageIndex, insertBefore);
      return;
    }

    const viewport = t.closest(".page-box-viewport");
    if (viewport) {
      const pageBox = viewport.closest(".page-box");
      if (!pageBox) return;
      const aspect = /** @type {'169'|'916'} */ (pageBox.dataset.aspect);
      const pageIndex = parseInt(pageBox.dataset.page || "0", 10);
      if (aspect !== payload.aspect) return;
      moveCredit(aspect, payload.id, pageIndex, null);
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

  els.btnPlay169.addEventListener("click", () => {
    void runPlayout("169");
  });

  els.btnPlay916.addEventListener("click", () => {
    void runPlayout("916");
  });

  els.btnStop.addEventListener("click", stopPlayout);

  document.querySelectorAll(".btn-add-page").forEach((btn) => {
    btn.addEventListener("click", () => {
      const aspect = /** @type {'169'|'916'} */ (btn.getAttribute("data-aspect"));
      if (aspect === "169" || aspect === "916") addEmptyPage(aspect);
    });
  });

  renderPlayoutEmpty();
  renderPageStrips();
})();
