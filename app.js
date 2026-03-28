(function () {
  "use strict";

  const OH = window.OHCreditsEngine;
  if (!OH) throw new Error("Load oh-engine.js before app.js");

  const EPISODE_ID = OH.EPISODE_ID;
  const PEOPLE_MAX_PER_GROUP = OH.PEOPLE_MAX_PER_GROUP;

  /** Commit this file next to `player.html` for short player URLs (`?url=…`). */
  const EXPORT_DESIGN_FILENAME = "ohcredits-design.json";

  const LS_REMOTE_EVENT = "ohcredits_remote_event";
  const LS_REMOTE_FN = "ohcredits_remote_function_url";
  const LS_REMOTE_SECRET = "ohcredits_remote_publish_secret";
  const LS_REMOTE_EVENT_LIST = "ohcredits_remote_event_list";

  /** Shown in the Event quick-pick until you save your own list. */
  const DEFAULT_EVENT_PRESETS = ["OfficeHours"];

  /**
   * Usable vertical space (px) per page at playout scale — tuned so ~3 simple credits
   * (role + one short name each) fit comfortably in both formats; 9:16 gets more room
   * because the portrait frame is taller. Organizer box height is aligned to 16:9 budget.
   */
  const BUDGET_PX = { "169": 225, "916": 410 };

  /** Chars per line heuristic for wrapped name lines in narrow vs wide boxes */
  const CPL = { "169": 44, "916": 20 };

  /** Per-credit stack: role + names + gap below block (matches tightened CSS margins) */
  const LINE_PX = 22;
  const ROLE_BLOCK_PX = 18;
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
    episodeTrayHost: document.getElementById("episode-tray-host"),
    btnPreview: document.getElementById("btn-preview"),
    btnPlayBoth: document.getElementById("btn-play-both"),
    btnPlay169: document.getElementById("btn-play-169"),
    btnPlay916: document.getElementById("btn-play-916"),
    btnStop: document.getElementById("btn-stop"),
    btnAddPage: document.getElementById("btn-add-page"),
    btnCopyPlayer169: document.getElementById("btn-copy-player-169"),
    btnCopyPlayer916: document.getElementById("btn-copy-player-916"),
    btnCopyPlayer169Json: document.getElementById("btn-copy-player-169-json"),
    btnCopyPlayer916Json: document.getElementById("btn-copy-player-916-json"),
    btnExportDesignJson: document.getElementById("btn-export-design-json"),
    toggleRemote: document.getElementById("btn-toggle-remote"),
    remotePanel: document.getElementById("remote-panel"),
    remoteEventPreset: document.getElementById("remote-event-preset"),
    remoteEvent: document.getElementById("remote-event"),
    remoteFunctionUrl: document.getElementById("remote-function-url"),
    remotePublishSecret: document.getElementById("remote-publish-secret"),
    btnRemotePublish: document.getElementById("btn-remote-publish"),
    btnCopyPlayer169Event: document.getElementById("btn-copy-player-169-event"),
    btnCopyPlayer916Event: document.getElementById("btn-copy-player-916-event"),
    btnToolbarCopy169Event: document.getElementById("btn-toolbar-copy-169-event"),
    btnToolbarCopy916Event: document.getElementById("btn-toolbar-copy-916-event"),
    btnTogglePublishSecret: document.getElementById("btn-toggle-publish-secret"),
    remoteStatus: document.getElementById("remote-status"),
    toolbarEventUrlStatus: document.getElementById("toolbar-event-url-status"),
  };

  /** @type {string | null} */
  let episodeHtml = null;
  /** @type {Map<string, { role: string, people: string[] }>} */
  let itemsById = new Map();
  /** @type {string[][]} shared page layout for both 16:9 and 9:16 */
  let pages = [[]];

  let playAbort = null;

  function sleep(ms) {
    return OH.sleep(ms);
  }

  function setJsonStatus(message, kind) {
    els.jsonStatus.textContent = message || "";
    els.jsonStatus.classList.remove("error", "ok");
    if (kind) els.jsonStatus.classList.add(kind);
  }

  function setRemoteStatus(message, kind) {
    if (!els.remoteStatus) return;
    els.remoteStatus.textContent = message || "";
    els.remoteStatus.classList.remove("error", "ok");
    if (kind) els.remoteStatus.classList.add(kind);
  }

  function setToolbarEventUrlStatus(message, kind) {
    if (!els.toolbarEventUrlStatus) return;
    els.toolbarEventUrlStatus.textContent = message || "";
    els.toolbarEventUrlStatus.classList.remove("error", "ok");
    if (kind) els.toolbarEventUrlStatus.classList.add(kind);
  }

  function validateEventSlug(s) {
    return typeof s === "string" && /^[\w-]{1,64}$/.test(s);
  }

  function getRemoteEventList() {
    try {
      const raw = localStorage.getItem(LS_REMOTE_EVENT_LIST);
      if (!raw) return [...DEFAULT_EVENT_PRESETS];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [...DEFAULT_EVENT_PRESETS];
      const ok = arr.filter((x) => typeof x === "string" && validateEventSlug(x.trim()));
      return ok.length ? [...new Set(ok)] : [...DEFAULT_EVENT_PRESETS];
    } catch {
      return [...DEFAULT_EVENT_PRESETS];
    }
  }

  function setRemoteEventList(list) {
    try {
      const uniq = [...new Set(list.filter((x) => validateEventSlug(x)))];
      localStorage.setItem(LS_REMOTE_EVENT_LIST, JSON.stringify(uniq));
    } catch {
      /* ignore */
    }
  }

  function rememberRemoteEventCode(code) {
    if (!validateEventSlug(code)) return;
    const list = getRemoteEventList();
    if (!list.includes(code)) {
      list.push(code);
      setRemoteEventList(list);
    }
    populateRemoteEventSelect();
  }

  function populateRemoteEventSelect() {
    const sel = els.remoteEventPreset;
    if (!sel) return;
    const current = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    const list = getRemoteEventList();
    sel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Saved events —";
    sel.append(placeholder);
    for (const e of list) {
      const opt = document.createElement("option");
      opt.value = e;
      opt.textContent = e;
      sel.append(opt);
    }
    if (current && list.includes(current)) {
      sel.value = current;
    } else {
      sel.value = "";
    }
  }

  function loadRemoteFields() {
    try {
      if (els.remoteEvent) els.remoteEvent.value = localStorage.getItem(LS_REMOTE_EVENT) || "";
      if (els.remoteFunctionUrl) els.remoteFunctionUrl.value = localStorage.getItem(LS_REMOTE_FN) || "";
      if (els.remotePublishSecret) els.remotePublishSecret.value = localStorage.getItem(LS_REMOTE_SECRET) || "";
    } catch {
      /* private mode */
    }
    populateRemoteEventSelect();
  }

  function saveRemoteFields() {
    try {
      if (els.remoteEvent) localStorage.setItem(LS_REMOTE_EVENT, els.remoteEvent.value.trim());
      if (els.remoteFunctionUrl) localStorage.setItem(LS_REMOTE_FN, els.remoteFunctionUrl.value.trim());
      if (els.remotePublishSecret) localStorage.setItem(LS_REMOTE_SECRET, els.remotePublishSecret.value);
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {{ role: string, people: string[] }} item
   * @param {'169'|'916'} aspect
   */
  function estimateItemPx(item, aspect) {
    const cpl = CPL[aspect];
    const scale = aspect === "916" ? 13 / 17 : 1;
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
   * @param {'169'|'916'} aspect
   */
  function estimateEpisodePx(aspect) {
    const scale = aspect === "916" ? 13 / 17 : 1;
    return Math.round((40 + 30 + BLOCK_GAP_PX) * scale);
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

  /**
   * Keep empty pages (e.g. trailing blanks). Collapse to a single [[]] only when no page has any roles.
   * @param {string[][]} p
   */
  function normalizePages(p) {
    if (p.length === 0) return [[]];
    const anyContent = p.some((pg) => pg.length > 0);
    if (!anyContent) return [[]];
    return p;
  }

  function creditBlockHtml(item, id) {
    return `<div class="slide-credit-block credit-draggable" draggable="true" data-credit-id="${OH.escapeHtml(id)}">${OH.creditInnerHtml(item)}</div>`;
  }

  function episodeBlockHtml() {
    if (!episodeHtml) return "";
    return `<div class="slide-credit-block slide-episode-block credit-draggable" draggable="true" data-credit-id="${EPISODE_ID}">${episodeHtml}</div>`;
  }

  function episodeOnAPage() {
    return pages.some((pg) => pg.includes(EPISODE_ID));
  }

  function renderEpisodeTray() {
    const host = els.episodeTrayHost;
    if (!host) return;
    if (!episodeHtml) {
      host.innerHTML = "";
      return;
    }
    const onPage = episodeOnAPage();
    host.innerHTML = onPage
      ? `<div class="episode-tray" data-episode-tray-drop="1" aria-label="Drop zone to remove episode from show">
          <p class="episode-tray-sink-msg">Drop the <strong>title & date</strong> block here to omit it from the show (or drag it between pages below).</p>
        </div>`
      : `<div class="episode-tray" data-episode-tray-drop="1">
          <p class="layout-hint episode-tray-hint" style="margin:0 0 10px;">
            Drag <strong>title & date</strong> onto a page below to include them, or leave here to skip. Use a <strong>blank first page</strong> to fade from black into title or credits.
          </p>
          <div class="episode-tray-chip-wrap">${episodeBlockHtml()}</div>
        </div>`;
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
      if (title) h += `<h1 class="slide-episode-title">${OH.escapeHtml(title)}</h1>`;
      if (date) h += `<p class="slide-episode-date">${OH.escapeHtml(date)}</p>`;
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
      const names = OH.sortPeopleNames(
        people
          .map((p) => (typeof p === "string" ? p.trim() : String(p)))
          .filter(Boolean)
      );
      const roleStr = role || "—";
      const groups = OH.chunkPeopleGroups(names);
      if (groups.length === 0) {
        const id = `c-${i}-0`;
        itemsById.set(id, { role: roleStr, people: [] });
        order.push(id);
      } else {
        groups.forEach((chunk, gi) => {
          const id = `c-${i}-g${gi}`;
          itemsById.set(id, { role: roleStr, people: chunk });
          order.push(id);
        });
      }
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
        `${n} credit block(s) · ${pages.length} page(s) · long roles split into ≤${PEOPLE_MAX_PER_GROUP} names per block; drag each block separately.`,
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
  function stripEpisodeFromPages() {
    for (const pg of pages) {
      let idx;
      while ((idx = pg.indexOf(EPISODE_ID)) !== -1) pg.splice(idx, 1);
    }
  }

  function moveCredit(id, toPageIndex, insertBeforeIndex) {
    if (id === EPISODE_ID && !episodeHtml) return;
    if (!pages[toPageIndex]) return;

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

    if (id !== EPISODE_ID && fromPi === -1) return;

    if (id === EPISODE_ID) {
      stripEpisodeFromPages();
    } else {
      pages[fromPi].splice(fromIi, 1);
    }

    let ins = insertBeforeIndex == null ? pages[toPageIndex].length : insertBeforeIndex;
    if (ins < 0) ins = 0;
    if (fromPi === toPageIndex && id !== EPISODE_ID && fromIi < ins) ins -= 1;

    pages[toPageIndex].splice(ins, 0, id);
    pages = normalizePages(pages);
    renderPageStrip();
  }

  function removeEpisodeFromShow() {
    stripEpisodeFromPages();
    pages = normalizePages(pages);
    renderPageStrip();
  }

  function addEmptyPage() {
    pages.push([]);
    renderPageStrip();
  }

  function buildPageBoxHtml(pageIndex, ids, pageCount) {
    let est169 = 0;
    let est916 = 0;
    for (const id of ids) {
      if (id === EPISODE_ID) {
        est169 += estimateEpisodePx("169");
        est916 += estimateEpisodePx("916");
        continue;
      }
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

    const metaText =
      ids.length === 0
        ? "Blank page"
        : `16:9 ~${Math.round(est169)}/${b169}px · 9:16 ~${Math.round(est916)}/${b916}px`;

    const inner =
      ids.length === 0
        ? `<p class="slide-empty" style="margin:12px 0;">Drop roles here</p>`
        : ids
            .map((id) => {
              if (id === EPISODE_ID) return episodeBlockHtml();
              const item = itemsById.get(id);
              return item ? creditBlockHtml(item, id) : "";
            })
            .join("");

    const showRemove = ids.length === 0 && pageCount > 1;
    const removeBtn = showRemove
      ? `<button type="button" class="page-box-remove" data-page-index="${pageIndex}" aria-label="Remove empty page" title="Remove this page">×</button>`
      : "";

    const fitKey = metaClass.replace("page-box-meta--", "");
    return `
      <div class="page-box page-box--organizer" data-page="${pageIndex}">
        ${removeBtn}
        <div class="page-box-header">
          <span class="page-box-title">Page ${pageIndex + 1}</span>
          <span class="page-box-meta ${metaClass}" data-estimate="${OH.escapeHtml(metaText)}" data-fit="${fitKey}" title="Estimated content height vs usable height for each format">${metaText}</span>
        </div>
        <div class="page-box-viewport" data-drop-page="${pageIndex}">
          <div class="page-box-inner">${inner}</div>
        </div>
        <div class="page-box-drop-zone" data-page="${pageIndex}">Drop at end of page</div>
      </div>
    `;
  }

  function renderPageStrip() {
    renderEpisodeTray();

    if (itemsById.size === 0 && !episodeHtml) {
      els.pageStrip.innerHTML =
        '<p class="slide-empty" style="font-size:13px;padding:8px 0;">Apply JSON to see page boxes.</p>';
      return;
    }

    if (itemsById.size === 0 && episodeHtml) {
      els.pageStrip.innerHTML = pages.map((ids, i) => buildPageBoxHtml(i, ids, pages.length)).join("");
      requestAnimationFrame(() => measurePageOverflow(els.pageStrip));
      return;
    }

    els.pageStrip.innerHTML = pages.map((ids, i) => buildPageBoxHtml(i, ids, pages.length)).join("");

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

  /** Same slide HTML for both aspects; frames differ only in CSS. */
  function buildSlidesForAspect(_aspect) {
    return OH.buildSlides({ episodeHtml, pages, items: itemsById });
  }

  function setPlayingUi(playing) {
    els.btnPlayBoth.disabled = playing;
    els.btnPlay169.disabled = playing;
    els.btnPlay916.disabled = playing;
    els.btnStop.disabled = !playing;
    els.btnPreview.disabled = playing;
    els.toggleJson.disabled = playing;
    if (els.btnCopyPlayer169) els.btnCopyPlayer169.disabled = playing;
    if (els.btnCopyPlayer916) els.btnCopyPlayer916.disabled = playing;
    if (els.btnCopyPlayer169Json) els.btnCopyPlayer169Json.disabled = playing;
    if (els.btnCopyPlayer916Json) els.btnCopyPlayer916Json.disabled = playing;
    if (els.btnExportDesignJson) els.btnExportDesignJson.disabled = playing;
    if (els.toggleRemote) els.toggleRemote.disabled = playing;
    if (els.btnRemotePublish) els.btnRemotePublish.disabled = playing;
    if (els.btnCopyPlayer169Event) els.btnCopyPlayer169Event.disabled = playing;
    if (els.btnCopyPlayer916Event) els.btnCopyPlayer916Event.disabled = playing;
    if (els.btnToolbarCopy169Event) els.btnToolbarCopy169Event.disabled = playing;
    if (els.btnToolbarCopy916Event) els.btnToolbarCopy916Event.disabled = playing;
    if (els.btnTogglePublishSecret) els.btnTogglePublishSecret.disabled = playing;
  }

  function designStateForShare() {
    return {
      v: 1,
      episodeHtml,
      pages,
      items: Object.fromEntries(itemsById),
    };
  }

  function playerUrlForView(viewParam) {
    const u = new URL("player.html", window.location.href);
    u.searchParams.set("view", viewParam);
    u.hash = "d=" + OH.encodeDesignState(designStateForShare());
    return u.href;
  }

  function playerUrlForJsonFile(viewParam) {
    const u = new URL("player.html", window.location.href);
    u.searchParams.set("view", viewParam);
    u.searchParams.set("url", EXPORT_DESIGN_FILENAME);
    return u.href;
  }

  async function copyPlayerLink(viewParam, label) {
    if (itemsById.size === 0 && !episodeHtml) {
      setJsonStatus("Apply JSON and arrange pages before copying a player link.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(playerUrlForView(viewParam));
      setJsonStatus(`Copied ${label} player link (full layout is in the URL; very long casts may hit browser limits).`, "ok");
    } catch {
      setJsonStatus("Could not copy — try another browser or paste from devtools.", "error");
    }
  }

  async function copyPlayerFileLink(viewParam, label) {
    if (itemsById.size === 0 && !episodeHtml) {
      setJsonStatus("Apply JSON and arrange pages before copying a player link.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(playerUrlForJsonFile(viewParam));
      setJsonStatus(
        `Copied ${label} player URL using ${EXPORT_DESIGN_FILENAME} — save that file next to player.html and commit.`,
        "ok"
      );
    } catch {
      setJsonStatus("Could not copy — try another browser or paste from devtools.", "error");
    }
  }

  async function exportDesignJson() {
    if (itemsById.size === 0 && !episodeHtml) {
      setJsonStatus("Nothing to export — apply JSON and arrange pages first.", "error");
      return;
    }
    const json = JSON.stringify(designStateForShare(), null, 2);
    if (window.showSaveFilePicker && window.FileSystemWritableFileStream) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: EXPORT_DESIGN_FILENAME,
          types: [
            {
              description: "OHCredits design",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setJsonStatus(`Saved — commit this file with your site so player ?url= links work.`, "ok");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = EXPORT_DESIGN_FILENAME;
    a.click();
    URL.revokeObjectURL(a.href);
    setJsonStatus(
      `Downloaded ${EXPORT_DESIGN_FILENAME} — move it into your GitHub project next to player.html and commit.`,
      "ok"
    );
  }

  async function publishRemote() {
    if (itemsById.size === 0 && !episodeHtml) {
      setRemoteStatus("Apply JSON and arrange pages before publishing.", "error");
      return;
    }
    const code = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    const fn = els.remoteFunctionUrl ? els.remoteFunctionUrl.value.trim() : "";
    const sec = els.remotePublishSecret ? els.remotePublishSecret.value.trim() : "";
    if (!validateEventSlug(code)) {
      setRemoteStatus("Event code: 1–64 chars — letters, numbers, hyphens, underscores only.", "error");
      return;
    }
    if (!fn || !sec) {
      setRemoteStatus("Publish function URL and publish secret are required.", "error");
      return;
    }
    saveRemoteFields();
    let res;
    try {
      res = await fetch(fn, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sec}`,
        },
        body: JSON.stringify({
          event_code: code,
          design: designStateForShare(),
        }),
      });
    } catch {
      setRemoteStatus("Network error — check the function URL and browser console.", "error");
      return;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = data && data.error ? String(data.error) : res.statusText;
      setRemoteStatus(`Publish failed: ${err}`, "error");
      return;
    }
    rememberRemoteEventCode(code);
    setRemoteStatus(
      `Published as “${code}”. Ensure player-config.json is on your site so ?event= links resolve.`,
      "ok"
    );
  }

  /**
   * @param {string} viewParam
   * @param {string} label
   * @param {(msg: string, kind?: string) => void} [reportStatus]
   */
  async function copyPlayerEventUrl(viewParam, label, reportStatus) {
    const report = typeof reportStatus === "function" ? reportStatus : setRemoteStatus;
    const code = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    if (!validateEventSlug(code)) {
      report("Set a valid event code (Cloud events → Event code, e.g. OfficeHours).", "error");
      return;
    }
    const u = new URL("player.html", window.location.href);
    u.searchParams.set("view", viewParam);
    u.searchParams.set("event", code);
    try {
      await navigator.clipboard.writeText(u.href);
      report(`Copied ${label} player URL (?event=${code}).`, "ok");
    } catch {
      report("Could not copy to clipboard.", "error");
    }
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
        OH.runPlayoutOnElement(els.slide169, s169, ac),
        OH.runPlayoutOnElement(els.slide916, s916, ac),
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
      await OH.runPlayoutOnElement(el, slides, ac);
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
    if (itemsById.size === 0 && !episodeHtml) {
      applyJsonFromInput();
      if (itemsById.size === 0 && !episodeHtml) return;
    }
    const s169 = buildSlidesForAspect("169");
    const s916 = buildSlidesForAspect("916");
    els.slide169.classList.remove("is-hidden");
    els.slide916.classList.remove("is-hidden");
    OH.renderSlideInto(els.slide169, s169, 0);
    OH.renderSlideInto(els.slide916, s916, 0);
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
    document.querySelectorAll(".episode-tray").forEach((n) => n.classList.remove("episode-tray--drop-target"));
  });

  document.addEventListener("dragover", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const zone = t.closest("[data-drop-page], .page-box-drop-zone, .credit-draggable, [data-episode-tray-drop]");
    if (!zone) return;
    const payload = e.dataTransfer?.types.includes("application/x-ohcredit");
    if (!payload) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });

  document.addEventListener("dragenter", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (!e.dataTransfer?.types.includes("application/x-ohcredit")) return;
    const tray = t.closest("[data-episode-tray-drop]");
    if (tray) {
      tray.classList.add("episode-tray--drop-target");
      return;
    }
    const zone = t.closest(".page-box-viewport, .page-box-drop-zone");
    if (!zone) return;
    zone.classList.add("page-box-drop-target");
  });

  document.addEventListener("dragleave", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const tray = t.closest("[data-episode-tray-drop]");
    if (tray) {
      if (!tray.contains(/** @type {Node} */ (e.relatedTarget))) {
        tray.classList.remove("episode-tray--drop-target");
      }
      return;
    }
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
    document.querySelectorAll(".episode-tray").forEach((n) => n.classList.remove("episode-tray--drop-target"));

    const trayDrop = t.closest("[data-episode-tray-drop]");
    if (trayDrop && payload.id === EPISODE_ID) {
      removeEpisodeFromShow();
      return;
    }

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

  if (els.toggleRemote && els.remotePanel) {
    els.toggleRemote.addEventListener("click", () => {
      const isHidden = els.remotePanel.hidden;
      els.remotePanel.hidden = !isHidden;
      els.remotePanel.classList.toggle("hidden", !isHidden);
      els.toggleRemote.setAttribute("aria-expanded", String(isHidden));
      if (isHidden) loadRemoteFields();
    });
  }

  if (els.btnRemotePublish) {
    els.btnRemotePublish.addEventListener("click", () => {
      void publishRemote();
    });
  }
  if (els.btnCopyPlayer169Event) {
    els.btnCopyPlayer169Event.addEventListener("click", () => {
      void copyPlayerEventUrl("16x9", "16:9", setRemoteStatus);
    });
  }
  if (els.btnCopyPlayer916Event) {
    els.btnCopyPlayer916Event.addEventListener("click", () => {
      void copyPlayerEventUrl("9x16", "9:16", setRemoteStatus);
    });
  }
  if (els.btnToolbarCopy169Event) {
    els.btnToolbarCopy169Event.addEventListener("click", () => {
      void copyPlayerEventUrl("16x9", "16:9", setToolbarEventUrlStatus);
    });
  }
  if (els.btnToolbarCopy916Event) {
    els.btnToolbarCopy916Event.addEventListener("click", () => {
      void copyPlayerEventUrl("9x16", "9:16", setToolbarEventUrlStatus);
    });
  }

  if (els.btnTogglePublishSecret && els.remotePublishSecret) {
    els.btnTogglePublishSecret.addEventListener("click", () => {
      const hidden = els.remotePublishSecret.type === "password";
      els.remotePublishSecret.type = hidden ? "text" : "password";
      els.btnTogglePublishSecret.textContent = hidden ? "Hide" : "Show";
      els.btnTogglePublishSecret.setAttribute("aria-pressed", String(hidden));
    });
  }

  if (els.remoteEventPreset) {
    els.remoteEventPreset.addEventListener("change", () => {
      const v = els.remoteEventPreset.value;
      if (v && els.remoteEvent) {
        els.remoteEvent.value = v;
        saveRemoteFields();
        populateRemoteEventSelect();
      }
    });
  }
  if (els.remoteEvent) {
    els.remoteEvent.addEventListener("input", () => {
      if (!els.remoteEventPreset) return;
      const t = els.remoteEvent.value.trim();
      if (els.remoteEventPreset.value && els.remoteEventPreset.value !== t) {
        els.remoteEventPreset.value = "";
      }
    });
  }

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

  if (els.btnCopyPlayer169) {
    els.btnCopyPlayer169.addEventListener("click", () => {
      void copyPlayerLink("16x9", "16:9");
    });
  }
  if (els.btnCopyPlayer916) {
    els.btnCopyPlayer916.addEventListener("click", () => {
      void copyPlayerLink("9x16", "9:16");
    });
  }

  if (els.btnExportDesignJson) {
    els.btnExportDesignJson.addEventListener("click", () => {
      void exportDesignJson();
    });
  }
  if (els.btnCopyPlayer169Json) {
    els.btnCopyPlayer169Json.addEventListener("click", () => {
      void copyPlayerFileLink("16x9", "16:9");
    });
  }
  if (els.btnCopyPlayer916Json) {
    els.btnCopyPlayer916Json.addEventListener("click", () => {
      void copyPlayerFileLink("9x16", "9:16");
    });
  }

  els.pageStrip.addEventListener("click", (e) => {
    const btn = e.target.closest(".page-box-remove");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (itemsById.size === 0 && !episodeHtml) return;
    const pi = parseInt(btn.getAttribute("data-page-index") || "-1", 10);
    if (Number.isNaN(pi) || pi < 0 || pages.length <= 1) return;
    const pg = pages[pi];
    if (pg && pg.length === 0) {
      pages.splice(pi, 1);
      pages = normalizePages(pages);
      renderPageStrip();
    }
  });

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

  loadRemoteFields();

  renderPlayoutEmpty();
  renderPageStrip();
})();
