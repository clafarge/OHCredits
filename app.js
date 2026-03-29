(function () {
  "use strict";

  const OH = window.OHCreditsEngine;
  if (!OH) throw new Error("Load oh-engine.js before app.js");

  const EPISODE_ID = OH.EPISODE_ID;
  const TLALOC_ID = OH.TLALOC_ID;
  const PEOPLE_MAX_PER_GROUP = OH.PEOPLE_MAX_PER_GROUP;

  const LS_REMOTE_EVENT = "ohcredits_remote_event";
  /** @deprecated removed from UI; clear if present */
  const LS_REMOTE_FN_LEGACY = "ohcredits_remote_function_url";
  const LS_REMOTE_SECRET = "ohcredits_remote_publish_secret";
  const LS_REMOTE_EVENT_LIST = "ohcredits_remote_event_list";
  const LS_JSON_URL = "ohcredits_last_json_url";

  /** Shown in the Event quick-pick until you save your own list. */
  const DEFAULT_EVENT_PRESETS = ["OfficeHours"];

  /** Supabase Edge Function for Publish credits (this repo’s project). */
  const DEFAULT_PUBLISH_FUNCTION_URL =
    "https://uyufnbroqmwjtzvcsosv.supabase.co/functions/v1/publish-credits";

  /** Panelists share page 1 with Host/Reader when total panelist names are 0–6 (fewer than 7). */
  const PANELISTS_MERGE_ON_PAGE1_MAX = 6;

  /** `episode` JSON key for Tláloc Traversal line on the title card (label fixed; value from JSON). */
  const EPISODE_TLALOC_KEY = "Tláloc Traversal";

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
  const STARTER_SHORT_ROLES_PER_PAGE = 3;

  /** Map known abbreviations to full role titles when loading from JSON or custom cards. */
  function roleDisplayNameFromJson(roleTrimmed) {
    if (!roleTrimmed) return "";
    if (/^psc$/i.test(roleTrimmed)) return "Pre-Show Coordinator";
    return roleTrimmed;
  }

  /** Next row index for `c-{n}-*` ids so merges stay compatible with groupItemOrderByCreditRow. */
  function nextCreditRowBaseIndex() {
    let max = -1;
    for (const id of itemsById.keys()) {
      const m = /^c-(\d+)-/.exec(id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }

  /**
   * @param {unknown[]} credits
   * @param {number} baseRowIndex First JSON row maps to this credit row index (0 for a fresh replace).
   * @returns {{ items: Map<string, { role: string, people: string[] }>, order: string[] }}
   */
  function buildCreditItemsMap(credits, baseRowIndex) {
    const items = new Map();
    /** @type {string[]} */
    const order = [];
    for (let i = 0; i < credits.length; i++) {
      const row = credits[i];
      if (!row || typeof row !== "object") continue;
      const rowIndex = baseRowIndex + i;
      const role = typeof row.role === "string" ? row.role.trim() : "";
      let people = row.people;
      if (!Array.isArray(people)) people = [];
      const names = OH.sortPeopleNames(
        people
          .map((p) => (typeof p === "string" ? p.trim() : String(p)))
          .filter(Boolean)
      );
      const roleStr = role ? roleDisplayNameFromJson(role) : "—";
      const isCustomCard =
        row &&
        typeof row === "object" &&
        /** @type {{ kind?: string }} */ (row).kind === "customCard";
      const groups = OH.chunkPeopleGroups(names);
      if (groups.length === 0) {
        const id = `c-${rowIndex}-0`;
        items.set(
          id,
          isCustomCard ? { role: roleStr, people: [], kind: "customCard" } : { role: roleStr, people: [] }
        );
        order.push(id);
      } else {
        groups.forEach((chunk, gi) => {
          const id = `c-${rowIndex}-g${gi}`;
          items.set(
            id,
            isCustomCard ? { role: roleStr, people: chunk, kind: "customCard" } : { role: roleStr, people: chunk }
          );
          order.push(id);
        });
      }
    }
    return { items, order };
  }

  const els = {
    toggleJson: document.getElementById("btn-toggle-json"),
    jsonPanel: document.getElementById("json-panel"),
    jsonInput: document.getElementById("json-input"),
    jsonStatus: document.getElementById("json-status"),
    btnAddJson: document.getElementById("btn-add-json"),
    btnClearJson: document.getElementById("btn-clear-json"),
    slide169: document.getElementById("slide-content-169"),
    slide916: document.getElementById("slide-content-916"),
    pageStrip: document.getElementById("page-strip"),
    episodeTrayHost: document.getElementById("episode-tray-host"),
    btnPreview: document.getElementById("btn-preview"),
    btnPlayBoth: document.getElementById("btn-play-both"),
    btnStop: document.getElementById("btn-stop"),
    btnAddPage: document.getElementById("btn-add-page"),
    btnPublishCredits: document.getElementById("btn-publish-credits"),
    toolbarPublishStatus: document.getElementById("toolbar-publish-status"),
    btnCopyCloud169: document.getElementById("btn-copy-cloud-169"),
    btnCopyData169: document.getElementById("btn-copy-data-169"),
    btnCopyCloud916: document.getElementById("btn-copy-cloud-916"),
    btnCopyData916: document.getElementById("btn-copy-data-916"),
    toggleRemote: document.getElementById("btn-toggle-remote"),
    remotePanel: document.getElementById("remote-panel"),
    remoteEventPreset: document.getElementById("remote-event-preset"),
    remoteEvent: document.getElementById("remote-event"),
    remotePublishSecret: document.getElementById("remote-publish-secret"),
    btnTogglePublishSecret: document.getElementById("btn-toggle-publish-secret"),
    jsonUrlInput: document.getElementById("json-url-input"),
    btnLoadJsonUrl: document.getElementById("btn-load-json-url"),
    newCardRole: document.getElementById("new-card-role"),
    newCardBody: document.getElementById("new-card-body"),
    btnAddCustomCard: document.getElementById("btn-add-custom-card"),
    customCardShadowbox: document.getElementById("custom-card-shadowbox"),
    btnCustomCardCancel: document.getElementById("btn-custom-card-cancel"),
    btnAddCustomCardSubmit: document.getElementById("btn-add-custom-card-submit"),
  };

  /** @type {string | null} */
  let episodeHtml = null;
  /** @type {Map<string, { role: string, people: string[] }>} */
  let itemsById = new Map();
  /** @type {string[][]} shared page layout for both 16:9 and 9:16 */
  let pages = [[]];

  /** Credit ids off all pages (staged with title/date area); not shown in play until placed on a page. */
  let parkedIds = [];

  let playAbort = null;

  /** Cached supabaseAnonKey from player-config.json (same origin as the editor). */
  let playerConfigAnonKeyCache = null;
  let playerConfigAnonKeyLoaded = false;

  /**
   * Public anon / publishable key for Supabase gateway JWT checks on POST.
   * Falls back to empty if player-config.json is missing (then use verify_jwt off + Bearer secret only).
   * @returns {Promise<string>}
   */
  async function getSupabaseAnonKeyForPublish() {
    if (playerConfigAnonKeyLoaded) return playerConfigAnonKeyCache || "";
    playerConfigAnonKeyLoaded = true;
    try {
      const r = await fetch(new URL("player-config.json", window.location.href));
      if (!r.ok) {
        playerConfigAnonKeyCache = "";
        return "";
      }
      const j = await r.json();
      const k = typeof j.supabaseAnonKey === "string" ? j.supabaseAnonKey.trim() : "";
      playerConfigAnonKeyCache = k;
      return k;
    } catch {
      playerConfigAnonKeyCache = "";
      return "";
    }
  }

  function sleep(ms) {
    return OH.sleep(ms);
  }

  /**
   * Clipboard API often fails on http/file origins; fall back to execCommand.
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function setJsonStatus(message, kind) {
    els.jsonStatus.textContent = message || "";
    els.jsonStatus.classList.remove("error", "ok");
    if (kind) els.jsonStatus.classList.add(kind);
  }

  function setToolbarPublishStatus(message, kind) {
    if (!els.toolbarPublishStatus) return;
    els.toolbarPublishStatus.textContent = message || "";
    els.toolbarPublishStatus.classList.remove("error", "ok");
    if (kind) els.toolbarPublishStatus.classList.add(kind);
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
      const seen = new Set();
      const out = [];
      for (const x of arr) {
        if (typeof x !== "string") continue;
        const t = x.trim();
        if (!validateEventSlug(t) || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out.length ? out : [...DEFAULT_EVENT_PRESETS];
    } catch {
      return [...DEFAULT_EVENT_PRESETS];
    }
  }

  function setRemoteEventList(list) {
    try {
      const seen = new Set();
      const out = [];
      for (const x of list) {
        if (!validateEventSlug(x) || seen.has(x)) continue;
        seen.add(x);
        out.push(x);
        if (out.length >= 24) break;
      }
      localStorage.setItem(LS_REMOTE_EVENT_LIST, JSON.stringify(out));
    } catch {
      /* ignore */
    }
  }

  /** Pin event to top of quick-pick (most recently used first). */
  function rememberRemoteEventCode(code) {
    if (!validateEventSlug(code)) return;
    const rest = getRemoteEventList().filter((x) => x !== code);
    setRemoteEventList([code, ...rest]);
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
      if (els.remotePublishSecret) els.remotePublishSecret.value = localStorage.getItem(LS_REMOTE_SECRET) || "";
      if (els.jsonUrlInput) els.jsonUrlInput.value = localStorage.getItem(LS_JSON_URL) || "";
    } catch {
      /* private mode */
    }
    populateRemoteEventSelect();
  }

  /** Ensure stored event code appears in quick-pick and stays selected. */
  function syncStoredEventIntoQuickPick() {
    const t = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    if (validateEventSlug(t)) {
      rememberRemoteEventCode(t);
    } else {
      populateRemoteEventSelect();
    }
  }

  /** Persist event code and publish secret only (never the function URL). */
  function saveRemoteFields() {
    try {
      if (els.remoteEvent) localStorage.setItem(LS_REMOTE_EVENT, els.remoteEvent.value.trim());
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
   * True when each name fits on one line in 9:16 (narrowest) and at most 2 names per block —
   * height-based packing would squeeze ~4 of these per page; we prefer 3-per-page balance instead.
   * @param {string} id
   */
  function isCompactSingleLineCredit(id) {
    const item = itemsById.get(id);
    if (!item) return false;
    if (item.people.length > 2) return false;
    const narrowCpl = CPL["916"];
    for (const p of item.people) {
      const lines = Math.max(1, Math.ceil(p.length / narrowCpl));
      if (lines > 1) return false;
    }
    return true;
  }

  /**
   * At most {@link STARTER_SHORT_ROLES_PER_PAGE} credit cards per page; n≡1 (mod 3), n≥4 → 2+2+…+3 pattern.
   * @param {string[]} ids
   * @returns {string[][]}
   */
  function paginateIdsThreePerPage(ids) {
    const n = ids.length;
    if (n === 0) return [];
    const per = STARTER_SHORT_ROLES_PER_PAGE;
    /** @type {string[][]} */
    const pageIdLists = [];
    let i = 0;
    if (n % per === 1 && n >= per + 1) {
      const firstSize = 2;
      pageIdLists.push(ids.slice(0, firstSize));
      i = firstSize;
      while (i < n) {
        const take = Math.min(per, n - i);
        pageIdLists.push(ids.slice(i, i + take));
        i += take;
      }
      return pageIdLists;
    }
    while (i < n) {
      pageIdLists.push(ids.slice(i, i + per));
      i += per;
    }
    return pageIdLists;
  }

  /**
   * Height-based pages for non-compact or multi-line credits (both aspects must fit budget).
   * @param {string[]} orderedIds
   * @returns {string[][]}
   */
  function autoPaginateByHeight(orderedIds) {
    if (!orderedIds.length) return [];
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
   * Mix compact one-line credits (≤3 per page, balanced) with height-based segments. Without this, a single
   * non-compact row (e.g. long names or many producers) forced height packing for the entire list and could
   * squeeze four short roles onto one 16:9 page.
   * @param {string[]} orderedIds
   */
  function autoPaginateShared(orderedIds) {
    if (!orderedIds.length) return [[]];
    /** @type {string[][]} */
    const pages = [];
    let idx = 0;
    while (idx < orderedIds.length) {
      let j = idx;
      while (j < orderedIds.length && isCompactSingleLineCredit(orderedIds[j])) j++;
      if (j > idx) {
        for (const pg of paginateIdsThreePerPage(orderedIds.slice(idx, j))) {
          if (pg.length) pages.push(pg);
        }
        idx = j;
      }
      if (idx >= orderedIds.length) break;
      let k = idx;
      while (k < orderedIds.length && !isCompactSingleLineCredit(orderedIds[k])) k++;
      for (const pg of autoPaginateByHeight(orderedIds.slice(idx, k))) {
        if (pg.length) pages.push(pg);
      }
      idx = k;
    }
    return pages.length ? pages : [[]];
  }

  /**
   * Group flat block ids (c-0-0, c-2-g1, …) into consecutive runs per credits[] row index.
   * @param {string[]} orderedIds
   * @returns {{ row: number, ids: string[] }[]}
   */
  function groupItemOrderByCreditRow(orderedIds) {
    /** @type {{ row: number, ids: string[] }[]} */
    const runs = [];
    for (const id of orderedIds) {
      const m = /^c-(\d+)-/.exec(id);
      const row = m ? parseInt(m[1], 10) : -1;
      const last = runs[runs.length - 1];
      if (last && last.row === row) last.ids.push(id);
      else runs.push({ row, ids: [id] });
    }
    return runs;
  }

  /**
   * Page layout for `_designerPageHint: "starter-v1"`: Host + Reader together, then 3 roles per
   * page for two pages, then height-based pages for middle/heavy rows, last row on its own page.
   * @param {string[]} itemOrder
   * @returns {string[][]}
   */
  function paginateStarterLayout(itemOrder) {
    const runs = groupItemOrderByCreditRow(itemOrder);
    if (runs.length === 0) return [[]];

    const pages = [];
    let idx = 0;

    function takeRunCount(count) {
      const ids = [];
      for (let k = 0; k < count && idx < runs.length; k++) {
        ids.push(...runs[idx++].ids);
      }
      return ids;
    }

    const p1 = takeRunCount(2);
    if (p1.length) pages.push(p1);

    for (let slab = 0; slab < 2; slab++) {
      if (idx >= runs.length - 1) break;
      const slabIds = takeRunCount(3);
      if (slabIds.length) pages.push(slabIds);
    }

    const middleIds = [];
    while (idx < runs.length - 1) {
      middleIds.push(...runs[idx++].ids);
    }
    if (middleIds.length) {
      pages.push(...autoPaginateShared(middleIds));
    }

    if (idx < runs.length) {
      pages.push([...runs[idx].ids]);
    }

    return pages.length ? pages : [[]];
  }

  function normalizeRoleKey(role) {
    return (role || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function totalPeopleInRun(run) {
    let n = 0;
    for (const id of run.ids) {
      const it = itemsById.get(id);
      if (it) n += it.people.length;
    }
    return n;
  }

  function flattenRuns(runList) {
    const out = [];
    for (const r of runList) out.push(...r.ids);
    return out;
  }

  /**
   * Short roles (1–2 names each): aim for {@link STARTER_SHORT_ROLES_PER_PAGE} roles per page.
   * When the count is 4,7,10,… (n≡1 mod 3, n≥4), use 2+2+…+3 pattern instead of 3+…+1 so pages stay even.
   * @param {{ row: number, ids: string[] }[]} runs
   * @returns {string[][]}
   */
  function paginateShortRunsThreePerPage(runs) {
    return paginateIdsThreePerPage(flattenRuns(runs));
  }

  /**
   * `_designerPageHint: "starter-v2"`. Page 1 is Host + Reader only, except Panelists may share
   * page 1 when their total name count is fewer than 7 (see PANELISTS_MERGE_ON_PAGE1_MAX).
   * @param {string[]} itemOrder
   * @returns {string[][]}
   */
  function paginateSemanticStarterLayout(itemOrder) {
    const runs = groupItemOrderByCreditRow(itemOrder);
    /** @type {{ row: number, ids: string[] }[]} */
    const host = [];
    /** @type {{ row: number, ids: string[] }[]} */
    const reader = [];
    /** @type {{ row: number, ids: string[] }[]} */
    const panelists = [];
    /** @type {{ row: number, ids: string[] }[]} */
    const contributors = [];
    /** @type {{ row: number, ids: string[] }[]} */
    const shortRuns = [];
    /** @type {{ row: number, ids: string[] }[]} */
    const largeRuns = [];
    /** @type {{ row: number, ids: string[] }[]} */
    const closingRuns = [];

    for (const run of runs) {
      const it0 = itemsById.get(run.ids[0]);
      if (!it0) continue;
      const key = normalizeRoleKey(it0.role);
      const tp = totalPeopleInRun(run);

      if (key === "host") host.push(run);
      else if (key === "reader") reader.push(run);
      else if (key === "panelist" || key === "panelists") panelists.push(run);
      else if (key === "contributor" || key === "contributors") contributors.push(run);
      else if (key === "special thanks") closingRuns.push(run);
      else if (tp <= 2) shortRuns.push(run);
      else largeRuns.push(run);
    }

    let panelNameTotal = 0;
    for (const r of panelists) panelNameTotal += totalPeopleInRun(r);
    const panelIds = flattenRuns(panelists);
    const mergePanelOnPage1 =
      panelIds.length > 0 && panelNameTotal <= PANELISTS_MERGE_ON_PAGE1_MAX;

    const pages = [];
    const page1 = [...flattenRuns(host), ...flattenRuns(reader)];
    if (mergePanelOnPage1) page1.push(...panelIds);
    if (page1.length) pages.push(page1);

    if (!mergePanelOnPage1 && panelIds.length) pages.push(panelIds);

    const contribIds = flattenRuns(contributors);
    if (contribIds.length) pages.push(...autoPaginateShared(contribIds));

    for (const idPage of paginateShortRunsThreePerPage(shortRuns)) {
      if (idPage.length) pages.push(idPage);
    }

    const largeIds = flattenRuns(largeRuns);
    if (largeIds.length) pages.push(...autoPaginateShared(largeIds));

    const closingIds = flattenRuns(closingRuns);
    if (closingIds.length) pages.push(...autoPaginateShared(closingIds));

    return pages.length ? pages : [[]];
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
    const safeId = OH.escapeHtml(id);
    return `<div class="slide-credit-block credit-draggable credit-draggable--with-controls" draggable="true" data-credit-id="${safeId}">
      <button type="button" class="credit-card-remove" data-remove-credit="${safeId}" draggable="false" aria-label="Remove this card from the design" title="Remove">×</button>
      <div class="credit-draggable-body">${OH.creditInnerHtml(item)}</div>
    </div>`;
  }

  function episodeBlockHtml() {
    if (!episodeHtml) return "";
    return `<div class="slide-credit-block slide-episode-block credit-draggable credit-draggable--with-controls credit-draggable--title-card" draggable="true" data-credit-id="${EPISODE_ID}">
      <button type="button" class="credit-card-remove credit-card-remove--episode" data-remove-credit="${EPISODE_ID}" draggable="false" aria-label="Remove title card from design" title="Remove title card">×</button>
      <div class="credit-draggable-body">${episodeHtml}</div>
    </div>`;
  }

  function episodeOnAPage() {
    return pages.some((pg) => pg.includes(EPISODE_ID));
  }

  function tlalocOnAPage() {
    return pages.some((pg) => pg.includes(TLALOC_ID));
  }

  /** Keep TLALOC_ID in parkedIds when staged so design share / player round-trip matches the editor. */
  function syncTlalocParkedState() {
    if (!itemsById.has(TLALOC_ID)) {
      parkedIds = parkedIds.filter((id) => id !== TLALOC_ID);
      return;
    }
    if (tlalocOnAPage()) {
      parkedIds = parkedIds.filter((id) => id !== TLALOC_ID);
    } else if (!parkedIds.includes(TLALOC_ID)) {
      parkedIds.push(TLALOC_ID);
    }
  }

  function renderEpisodeTray() {
    const host = els.episodeTrayHost;
    if (!host) return;

    parkedIds = parkedIds.filter((id) => itemsById.has(id));
    syncTlalocParkedState();

    const hasSomething = itemsById.size > 0 || episodeHtml || parkedIds.length > 0;
    if (!hasSomething) {
      host.innerHTML = "";
      return;
    }

    const onPage = episodeOnAPage();
    const parkedHtml = parkedIds
      .filter((pid) => pid !== TLALOC_ID)
      .map((pid) => {
        const item = itemsById.get(pid);
        return item ? creditBlockHtml(item, pid) : "";
      })
      .join("");

    let episodeSlot = "";
    if (episodeHtml) {
      if (onPage) {
        episodeSlot = `<p class="episode-tray-sink-msg layout-hint" style="margin:0 0 8px;">The title card is on a page — drop it here to return it to staging, or drop credit cards here to stage them.</p>`;
      } else {
        episodeSlot = `<p class="episode-tray-slot-label">Title card</p>
          <div class="episode-tray-chip-wrap episode-tray-chip-wrap--title">${episodeBlockHtml()}</div>`;
      }
    }

    let tlalocSlot = "";
    const tlalocItem = itemsById.get(TLALOC_ID);
    if (tlalocItem) {
      if (tlalocOnAPage()) {
        tlalocSlot = `<p class="episode-tray-sink-msg layout-hint" style="margin:0 0 8px;">The Tláloc Traversal card is on a page — drop it here to stage it, or drop other credit cards here to stage them.</p>`;
      } else {
        tlalocSlot = `<p class="episode-tray-slot-label">Tláloc Traversal</p>
          <div class="episode-tray-chip-wrap episode-tray-chip-wrap--tlaloc">${creditBlockHtml(tlalocItem, TLALOC_ID)}</div>`;
      }
    }

    const parkedSlot =
      parkedHtml.length > 0
        ? `<p class="episode-tray-slot-label">Staged credit cards (hidden in play)</p>
           <div class="episode-tray-chip-wrap episode-tray-chip-wrap--parked">${parkedHtml}</div>`
        : "";

    host.innerHTML = `${episodeSlot}${tlalocSlot}${parkedSlot}`;
  }

  function hasExistingDesign() {
    if (episodeHtml) return true;
    if (itemsById.size > 0) return true;
    if (parkedIds.length > 0) return true;
    return pages.some((pg) => pg.length > 0);
  }

  /**
   * @param {string} text
   * @param {boolean} merge When true, use unique row ids so new credits can be appended to itemsById.
   */
  function parseCreditsPayload(text, merge) {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Root must be an object");

    const credits = Array.isArray(data.credits) ? data.credits : null;
    if (!credits) throw new Error('Missing "credits" array');

    const episodeKeyInJson = Object.prototype.hasOwnProperty.call(data, "episode");

    let epHtml = null;
    let tlalocValue = null;
    let tlalocInEpisode = false;
    const episode = data.episode;
    if (episode != null && typeof episode === "object") {
      tlalocInEpisode = Object.prototype.hasOwnProperty.call(episode, EPISODE_TLALOC_KEY);
      const rawTlaloc = episode[EPISODE_TLALOC_KEY];
      let tlalocVal = "";
      if (typeof rawTlaloc === "string") tlalocVal = rawTlaloc.trim();
      else if (rawTlaloc != null && rawTlaloc !== "") tlalocVal = String(rawTlaloc).trim();
      if (tlalocVal) tlalocValue = tlalocVal;

      const title = typeof episode.title === "string" ? episode.title.trim() : "";
      const date = typeof episode.date === "string" ? episode.date.trim() : "";
      if (title || date) {
        let h = "";
        if (title) h += `<h1 class="slide-episode-title">${OH.escapeHtml(title)}</h1>`;
        if (date) h += `<p class="slide-episode-date">${OH.escapeHtml(date)}</p>`;
        epHtml = h;
      }
    }

    const baseRow = merge ? nextCreditRowBaseIndex() : 0;
    const { items, order } = buildCreditItemsMap(credits, baseRow);

    if (order.length === 0 && !epHtml && !tlalocValue) {
      if (!merge || !episodeKeyInJson) {
        throw new Error(
          merge
            ? "Nothing to add — include credits or an episode object in the JSON."
            : "No credits or episode content"
        );
      }
    }

    const designerPageHint =
      typeof data._designerPageHint === "string" ? data._designerPageHint.trim() : "";
    return {
      items,
      itemOrder: order,
      episodeHtml: epHtml,
      episodeKeyInJson,
      tlalocValue,
      tlalocInEpisode,
      designerPageHint,
    };
  }

  function stripTlalocFromPages() {
    for (const pg of pages) {
      let idx;
      while ((idx = pg.indexOf(TLALOC_ID)) !== -1) pg.splice(idx, 1);
    }
  }

  function applyTlalocFromParsed(parsed, merging) {
    if (!merging) {
      if (parsed.tlalocValue) {
        itemsById.set(TLALOC_ID, { role: EPISODE_TLALOC_KEY, people: [parsed.tlalocValue] });
      } else {
        itemsById.delete(TLALOC_ID);
        parkedIds = parkedIds.filter((id) => id !== TLALOC_ID);
        stripTlalocFromPages();
      }
      return;
    }
    if (parsed.episodeKeyInJson && parsed.tlalocInEpisode) {
      if (parsed.tlalocValue) {
        itemsById.set(TLALOC_ID, { role: EPISODE_TLALOC_KEY, people: [parsed.tlalocValue] });
      } else {
        itemsById.delete(TLALOC_ID);
        parkedIds = parkedIds.filter((id) => id !== TLALOC_ID);
        stripTlalocFromPages();
      }
    }
  }

  /**
   * @param {string[]} itemOrder
   * @param {string} designerPageHint
   * @returns {string[][]}
   */
  function layoutPagesForOrder(itemOrder, designerPageHint) {
    if (!itemOrder.length) return [];
    if (designerPageHint === "starter-v2") return paginateSemanticStarterLayout(itemOrder);
    if (designerPageHint === "starter-v1") return paginateStarterLayout(itemOrder);
    return autoPaginateShared(itemOrder);
  }

  function clearDesignFromJson() {
    itemsById = new Map();
    episodeHtml = null;
    pages = [[]];
    parkedIds = [];
    if (els.jsonInput) els.jsonInput.value = "";
    setJsonStatus("Cleared credits, pages, and title/date.", "ok");
    renderEpisodeTray();
    renderPageStrip();
    renderPlayoutEmpty();
  }

  /**
   * @param {string} text
   * @param {(msg: string, kind?: string) => void} [setStatus]
   * @returns {boolean}
   */
  function addJsonFromText(text, setStatus) {
    const report = setStatus || setJsonStatus;
    const t = (text || "").trim();
    if (!t) {
      report("Paste JSON first, then Add JSON.", "error");
      return false;
    }
    const merging = hasExistingDesign();
    try {
      const parsed = parseCreditsPayload(t, merging);
      const n = parsed.itemOrder.length;
      const hint = parsed.designerPageHint;
      const layoutNote =
        hint === "starter-v2"
          ? " Starter layout v2: Host+Reader (Panelists if fewer than 7 names), Contributors, then ~3 short roles (1-2 names) per page, large groups, thanks."
          : hint === "starter-v1"
            ? " Starter page layout (Host+Reader, ~3 roles/page, heavy lists then thanks)."
            : "";

      if (!merging) {
        itemsById = parsed.items;
        parkedIds = [];
        if (parsed.episodeKeyInJson) {
          episodeHtml = parsed.episodeHtml;
        } else {
          episodeHtml = null;
        }
        applyTlalocFromParsed(parsed, false);
        if (n) {
          pages = layoutPagesForOrder(parsed.itemOrder, hint);
        } else {
          pages = [[]];
        }
        syncTlalocParkedState();
        report(
          `${n} credit block(s) · ${pages.length} page(s) · long roles split into ≤${PEOPLE_MAX_PER_GROUP} names per block; drag each block separately.${layoutNote}`,
          "ok"
        );
      } else {
        for (const [id, it] of parsed.items) {
          itemsById.set(id, it);
        }
        if (parsed.episodeKeyInJson) {
          episodeHtml = parsed.episodeHtml;
        }
        applyTlalocFromParsed(parsed, true);
        const prevPageCount = pages.length;
        if (n) {
          const newPages = layoutPagesForOrder(parsed.itemOrder, hint);
          pages = normalizePages([...pages, ...newPages]);
          const addedPages = pages.length - prevPageCount;
          report(
            `Merged ${n} new credit block(s) · +${addedPages} page(s) (${pages.length} total) · split into ≤${PEOPLE_MAX_PER_GROUP} names per block when long.${layoutNote}`,
            "ok"
          );
        } else if (parsed.episodeKeyInJson) {
          report("Updated episode / title card / Tláloc from JSON (no new credits).", "ok");
        }
      }
      renderEpisodeTray();
      renderPageStrip();
      renderPlayoutEmpty();
      return true;
    } catch (e) {
      if (!merging) {
        itemsById = new Map();
        episodeHtml = null;
        pages = [[]];
        parkedIds = [];
        renderPageStrip();
        renderPlayoutEmpty();
      }
      report(e instanceof Error ? e.message : String(e), "error");
      return false;
    }
  }

  function addJsonFromInput() {
    addJsonFromText(els.jsonInput.value, setJsonStatus);
  }

  async function loadCreditsJsonFromUrl() {
    const url = els.jsonUrlInput ? els.jsonUrlInput.value.trim() : "";
    if (!url) {
      setJsonStatus("Enter a JSON URL.", "error");
      return;
    }
    try {
      localStorage.setItem(LS_JSON_URL, url);
    } catch {
      /* ignore */
    }
    let res;
    try {
      res = await fetch(url, { mode: "cors", cache: "no-store" });
    } catch {
      setJsonStatus(
        "Could not fetch (network or CORS). Use a same-site URL or one that sends Access-Control-Allow-Origin for your site.",
        "error"
      );
      return;
    }
    if (!res.ok) {
      setJsonStatus(`Could not load JSON (HTTP ${res.status}).`, "error");
      return;
    }
    let text;
    try {
      text = await res.text();
    } catch {
      setJsonStatus("Could not read response body.", "error");
      return;
    }
    els.jsonInput.value = text;
    setJsonStatus("Loaded from URL into the box — click Add JSON to apply (or merge if a layout already exists).", "ok");
  }

  function renderPlayoutEmpty() {
    const msg = `<p class="slide-empty">No data — paste JSON and use Add JSON, or Clear JSON to start fresh.</p>`;
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
    if (id === TLALOC_ID && !itemsById.has(TLALOC_ID)) return;
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

    const fromParked = parkedIds.indexOf(id) !== -1;
    const tlalocStagedInTray =
      id === TLALOC_ID && itemsById.has(TLALOC_ID) && !tlalocOnAPage() && !fromParked;
    if (id !== EPISODE_ID && id !== TLALOC_ID && fromPi === -1 && !fromParked) return;
    if (id === EPISODE_ID && fromPi === -1 && !fromParked && !episodeHtml) return;
    if (id === TLALOC_ID && fromPi === -1 && !fromParked && !tlalocStagedInTray) return;

    if (id === EPISODE_ID) {
      stripEpisodeFromPages();
    } else if (fromParked) {
      const pi = parkedIds.indexOf(id);
      if (pi !== -1) parkedIds.splice(pi, 1);
    } else {
      pages[fromPi].splice(fromIi, 1);
    }

    let ins = insertBeforeIndex == null ? pages[toPageIndex].length : insertBeforeIndex;
    if (ins < 0) ins = 0;
    if (fromPi === toPageIndex && id !== EPISODE_ID && fromIi < ins) ins -= 1;

    pages[toPageIndex].splice(ins, 0, id);
    pages = normalizePages(pages);
    if (id === TLALOC_ID) {
      parkedIds = parkedIds.filter((x) => x !== TLALOC_ID);
    }
    renderPageStrip();
    renderEpisodeTray();
  }

  function parkCredit(id) {
    if (id === EPISODE_ID) {
      removeEpisodeFromShow();
      return;
    }
    for (let pi = 0; pi < pages.length; pi++) {
      const ix = pages[pi].indexOf(id);
      if (ix !== -1) pages[pi].splice(ix, 1);
    }
    pages = normalizePages(pages);
    if (!parkedIds.includes(id)) parkedIds.push(id);
    renderPageStrip();
    renderEpisodeTray();
  }

  function removeCreditOrEpisodeFromDesign(id) {
    if (id === EPISODE_ID) {
      stripEpisodeFromPages();
      episodeHtml = null;
    } else {
      for (let pi = 0; pi < pages.length; pi++) {
        const ix = pages[pi].indexOf(id);
        if (ix !== -1) pages[pi].splice(ix, 1);
      }
      itemsById.delete(id);
      parkedIds = parkedIds.filter((x) => x !== id);
    }
    pages = normalizePages(pages);
    renderEpisodeTray();
    renderPageStrip();
    if (itemsById.size === 0 && !episodeHtml) {
      renderPlayoutEmpty();
    }
  }

  function addCustomCardToLayout() {
    const rawRole = (els.newCardRole && els.newCardRole.value.trim()) || "";
    const role = roleDisplayNameFromJson(rawRole) || (rawRole ? rawRole : "Card");
    const raw = (els.newCardBody && els.newCardBody.value.trim()) || "";
    let people = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (people.length === 0) people = ["New card — add lines via design JSON or merge."];
    const row = nextCreditRowBaseIndex();
    const id = `c-${row}-0`;
    itemsById.set(id, { role, people, kind: "customCard" });
    if (pages.length === 0) pages = [[]];
    pages[pages.length - 1].push(id);
    pages = normalizePages(pages);
    renderPageStrip();
    renderEpisodeTray();
    setJsonStatus("Added custom card on the last page — drag to reorder or stage above.", "ok");
  }

  function removeEpisodeFromShow() {
    stripEpisodeFromPages();
    pages = normalizePages(pages);
    renderPageStrip();
    renderEpisodeTray();
  }

  function addEmptyPage() {
    pages.push([]);
    renderPageStrip();
  }

  /**
   * Move a page to a new index (insert before `toIndex` in the pre-move list).
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  function movePageBefore(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= pages.length) return;
    /* toIndex === pages.length means “append as last page”. */
    if (toIndex < 0 || toIndex > pages.length) return;
    const block = pages[fromIndex];
    pages.splice(fromIndex, 1);
    let insertAt = toIndex;
    if (fromIndex < toIndex) insertAt = toIndex - 1;
    pages.splice(insertAt, 0, block);
    pages = normalizePages(pages);
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
    const dragHandle =
      pageCount > 1
        ? `<button type="button" class="page-box-drag-handle" draggable="true" data-page-drag-index="${pageIndex}" aria-label="Drag to reorder page" title="Drag page onto another page to change order">
            <span class="page-box-drag-glyph" aria-hidden="true"></span>
          </button>`
        : "";
    return `
      <div class="page-box page-box--organizer" data-page="${pageIndex}">
        ${removeBtn}
        <div class="page-box-header">
          <div class="page-box-header-row">
            ${dragHandle}
            <span class="page-box-title">Page ${pageIndex + 1}</span>
          </div>
          <span class="page-box-meta ${metaClass}" data-estimate="${OH.escapeHtml(metaText)}" data-fit="${fitKey}" title="Estimated content height vs usable height for each format">${metaText}</span>
        </div>
        <div class="page-box-viewport" data-drop-page="${pageIndex}">
          <div class="page-box-inner">${inner}</div>
        </div>
        <div class="page-box-drop-zone" data-page="${pageIndex}">Drop at end of page</div>
      </div>
    `;
  }

  /** Drop zone to move a page to the end (drop-on-last only inserts before last). */
  function pageStripEndDropHtml() {
    return pages.length > 1
      ? `<div class="page-strip-end-drop" data-page-reorder-end="1" title="Drop here to make this page last" aria-label="Drop page to move to end">Last</div>`
      : "";
  }

  function renderPageStrip() {
    renderEpisodeTray();

    if (itemsById.size === 0 && !episodeHtml) {
      els.pageStrip.innerHTML =
        '<p class="slide-empty" style="font-size:13px;padding:8px 0;">Add JSON (or Clear JSON and add) to see page boxes.</p>';
      return;
    }

    if (itemsById.size === 0 && episodeHtml) {
      els.pageStrip.innerHTML =
        pages.map((ids, i) => buildPageBoxHtml(i, ids, pages.length)).join("") + pageStripEndDropHtml();
      requestAnimationFrame(() => measurePageOverflow(els.pageStrip));
      return;
    }

    els.pageStrip.innerHTML =
      pages.map((ids, i) => buildPageBoxHtml(i, ids, pages.length)).join("") + pageStripEndDropHtml();

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
    els.btnStop.disabled = !playing;
    els.btnPreview.disabled = playing;
    els.toggleJson.disabled = playing;
    if (els.btnAddJson) els.btnAddJson.disabled = playing;
    if (els.btnClearJson) els.btnClearJson.disabled = playing;
    if (els.toggleRemote) els.toggleRemote.disabled = playing;
    if (els.btnPublishCredits) els.btnPublishCredits.disabled = playing;
    if (els.btnCopyCloud169) els.btnCopyCloud169.disabled = playing;
    if (els.btnCopyData169) els.btnCopyData169.disabled = playing;
    if (els.btnCopyCloud916) els.btnCopyCloud916.disabled = playing;
    if (els.btnCopyData916) els.btnCopyData916.disabled = playing;
    if (els.btnTogglePublishSecret) els.btnTogglePublishSecret.disabled = playing;
    if (els.btnLoadJsonUrl) els.btnLoadJsonUrl.disabled = playing;
    if (els.btnAddCustomCard) els.btnAddCustomCard.disabled = playing;
    if (els.newCardRole) els.newCardRole.disabled = playing;
    if (els.newCardBody) els.newCardBody.disabled = playing;
    if (els.btnCustomCardCancel) els.btnCustomCardCancel.disabled = playing;
    if (els.btnAddCustomCardSubmit) els.btnAddCustomCardSubmit.disabled = playing;
  }

  function designStateForShare() {
    return {
      v: 1,
      episodeHtml,
      pages,
      parkedIds: [...parkedIds],
      items: Object.fromEntries(itemsById),
    };
  }

  function playerUrlForView(viewParam) {
    const u = new URL("player.html", window.location.href);
    u.searchParams.set("view", viewParam);
    u.hash = "d=" + OH.encodeDesignState(designStateForShare());
    return u.href;
  }

  /**
   * @param {(msg: string, kind?: string) => void} report
   */
  async function copyPlayerLink(viewParam, label, report) {
    const r = report || setJsonStatus;
    if (itemsById.size === 0 && !episodeHtml) {
      r("Add JSON and arrange pages before copying a player link.", "error");
      return;
    }
    const ok = await copyTextToClipboard(playerUrlForView(viewParam));
    if (ok) {
      r(`Copied ${label} link (full layout in URL; may be very long).`, "ok");
    } else {
      r("Copy failed — try HTTPS/localhost or copy the URL manually.", "error");
    }
  }

  /**
   * Edge Functions live at /functions/v1/<name>, not at the bare Project API URL.
   * @returns {{ url: string, hint?: string }}
   */
  function resolvePublishFunctionUrl(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { url: "" };
    let u;
    try {
      u = new URL(trimmed);
    } catch {
      return { url: "" };
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { url: "" };

    const host = u.hostname.toLowerCase();
    const pathNorm = u.pathname.replace(/\/+$/, "") || "";

    if (host.endsWith(".supabase.co")) {
      if (pathNorm.includes("/functions/v1/")) {
        return { url: u.toString() };
      }
      if (pathNorm === "" || pathNorm === "/") {
        u.pathname = "/functions/v1/publish-credits";
        const fixed = u.toString();
        return {
          url: fixed,
          hint: "Added /functions/v1/publish-credits — that is the Edge Function path, not the API root.",
        };
      }
      if (pathNorm.includes("/rest/v1")) {
        return {
          url: "",
          hint: "That URL is the REST API (PostgREST), not an Edge Function. Use …/functions/v1/publish-credits (see Edge Functions in Supabase).",
        };
      }
      return {
        url: "",
        hint: "Supabase URL must include /functions/v1/publish-credits (deploy the publish-credits function first).",
      };
    }

    return { url: u.toString() };
  }

  async function publishRemote() {
    if (itemsById.size === 0 && !episodeHtml) {
      setToolbarPublishStatus("Add JSON and arrange pages before publishing.", "error");
      return;
    }
    if (window.location.protocol === "file:") {
      setToolbarPublishStatus(
        "Editor opened as file:// — publish cannot reach Supabase. Use http://localhost or your HTTPS site (GitHub Pages).",
        "error"
      );
      return;
    }
    const code = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    const sec = els.remotePublishSecret ? els.remotePublishSecret.value.trim() : "";
    if (!validateEventSlug(code)) {
      setToolbarPublishStatus("Event code: 1–64 chars — letters, numbers, hyphens, underscores.", "error");
      return;
    }
    const fnRaw = DEFAULT_PUBLISH_FUNCTION_URL;
    if (!sec) {
      setToolbarPublishStatus("Enter publish secret (Cloud settings) — saved only in this browser.", "error");
      return;
    }

    const resolved = resolvePublishFunctionUrl(fnRaw);
    if (!resolved.url) {
      setToolbarPublishStatus(resolved.hint || "Invalid publish endpoint URL.", "error");
      return;
    }
    const fn = resolved.url;

    saveRemoteFields();

    const anon = await getSupabaseAnonKeyForPublish();
    /** @type {Record<string, string>} */
    const headers = { "Content-Type": "application/json" };
    if (anon) {
      headers.Authorization = `Bearer ${anon}`;
      headers.apikey = anon;
      headers["X-OHCredits-Publish-Secret"] = sec;
    } else {
      headers.Authorization = `Bearer ${sec}`;
    }

    let res;
    try {
      res = await fetch(fn, {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers,
        body: JSON.stringify({
          event_code: code,
          design: designStateForShare(),
        }),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const hint =
        detail === "Failed to fetch"
          ? " (browser blocked the request: open DevTools → Network, confirm the function URL; redeploy publish-credits with CORS; avoid file://; check ad blockers.)"
          : "";
      setToolbarPublishStatus(`Request failed (${detail}).${hint}`, "error");
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
      setToolbarPublishStatus(`Publish failed: ${err}`, "error");
      return;
    }
    rememberRemoteEventCode(code);
    setToolbarPublishStatus(`Published “${code}”.`, "ok");
  }

  /**
   * @param {string} viewParam
   * @param {string} label
   * @param {(msg: string, kind?: string) => void} [reportStatus]
   */
  async function copyPlayerEventUrl(viewParam, label, reportStatus) {
    const report = typeof reportStatus === "function" ? reportStatus : setJsonStatus;
    const code = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    if (!validateEventSlug(code)) {
      report("Set a valid event code under Cloud settings (e.g. OfficeHours).", "error");
      return;
    }
    const u = new URL("player.html", window.location.href);
    u.searchParams.set("view", viewParam);
    u.searchParams.set("event", code);
    const ok = await copyTextToClipboard(u.href);
    if (ok) {
      report(`Copied ${label} — ${u.pathname}${u.search}`, "ok");
    } else {
      report("Copy failed — try HTTPS/localhost.", "error");
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
    closeCustomCardShadowbox();
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

  function stopPlayout() {
    if (playAbort) playAbort.abort();
  }

  function previewFirstSlide() {
    stopPlayout();
    if (itemsById.size === 0 && !episodeHtml) {
      addJsonFromInput();
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

  /** @param {DragEvent} e */
  function dragPagePayload(e) {
    let raw = e.dataTransfer?.getData("application/x-ohcredit-page");
    if (!raw) {
      const plain = (e.dataTransfer?.getData("text/plain") || "").trim();
      const m = /^ohcredit-page:(\d+)$/.exec(plain);
      if (m) return { fromIndex: parseInt(m[1], 10) };
    }
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      const fromIndex = typeof o.fromIndex === "number" ? o.fromIndex : parseInt(String(o.fromIndex), 10);
      if (Number.isNaN(fromIndex)) return null;
      return { fromIndex };
    } catch {
      return null;
    }
  }

  document.addEventListener("dragstart", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const handle = t.closest(".page-box-drag-handle");
    if (handle && e.dataTransfer) {
      const fromIndex = parseInt(handle.getAttribute("data-page-drag-index") || "-1", 10);
      if (Number.isNaN(fromIndex) || fromIndex < 0) return;
      const payload = JSON.stringify({ fromIndex });
      e.dataTransfer.setData("application/x-ohcredit-page", payload);
      e.dataTransfer.setData("text/plain", `ohcredit-page:${fromIndex}`);
      e.dataTransfer.effectAllowed = "move";
      handle.closest(".page-box")?.classList.add("page-box--page-source");
      return;
    }
    if (t.closest(".credit-card-remove")) return;
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
    document.querySelectorAll(".page-box--page-drop-target").forEach((n) => n.classList.remove("page-box--page-drop-target"));
    document.querySelectorAll(".page-box--page-source").forEach((n) => n.classList.remove("page-box--page-source"));
  });

  document.addEventListener("dragover", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (e.dataTransfer?.types.includes("application/x-ohcredit-page")) {
      const end = t.closest("[data-page-reorder-end]");
      const box = t.closest(".page-box--organizer");
      if (!end && !box) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      return;
    }
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
    if (e.dataTransfer?.types.includes("application/x-ohcredit-page")) {
      const end = t.closest("[data-page-reorder-end]");
      const box = t.closest(".page-box--organizer");
      if (!end && !box) return;
      document.querySelectorAll(".page-box--page-drop-target").forEach((n) => n.classList.remove("page-box--page-drop-target"));
      (end || box)?.classList.add("page-box--page-drop-target");
      return;
    }
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
    if (e.dataTransfer?.types.includes("application/x-ohcredit-page")) {
      const end = t.closest("[data-page-reorder-end]");
      const box = t.closest(".page-box--organizer");
      const zone = end || box;
      if (zone && !zone.contains(/** @type {Node} */ (e.relatedTarget))) {
        zone.classList.remove("page-box--page-drop-target");
      }
      return;
    }
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

    document.querySelectorAll(".page-box-drop-target").forEach((n) => n.classList.remove("page-box-drop-target"));
    document.querySelectorAll(".episode-tray").forEach((n) => n.classList.remove("episode-tray--drop-target"));
    document.querySelectorAll(".page-box--page-drop-target").forEach((n) => n.classList.remove("page-box--page-drop-target"));

    const pageMove = dragPagePayload(e);
    if (pageMove) {
      if (t.closest("[data-page-reorder-end]")) {
        movePageBefore(pageMove.fromIndex, pages.length);
        return;
      }
      const targetBox = t.closest(".page-box--organizer");
      if (targetBox) {
        const toIndex = parseInt(targetBox.getAttribute("data-page") || "0", 10);
        movePageBefore(pageMove.fromIndex, toIndex);
      }
      return;
    }

    const payload = dragPayload(e);
    if (!payload) return;

    const trayDrop = t.closest("[data-episode-tray-drop]");
    if (trayDrop) {
      if (payload.id === EPISODE_ID) {
        removeEpisodeFromShow();
      } else {
        parkCredit(payload.id);
      }
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

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    const rm = t.closest("[data-remove-credit]");
    if (!rm) return;
    e.preventDefault();
    e.stopPropagation();
    const id = rm.getAttribute("data-remove-credit");
    if (id) removeCreditOrEpisodeFromDesign(id);
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
      if (isHidden) {
        loadRemoteFields();
      }
    });
  }

  if (els.remotePublishSecret) {
    els.remotePublishSecret.addEventListener("blur", () => {
      saveRemoteFields();
    });
  }
  if (els.remoteEvent) {
    els.remoteEvent.addEventListener("blur", () => {
      saveRemoteFields();
      const t = els.remoteEvent.value.trim();
      if (validateEventSlug(t)) rememberRemoteEventCode(t);
    });
  }

  if (els.btnPublishCredits) {
    els.btnPublishCredits.addEventListener("click", () => {
      void publishRemote();
    });
  }

  if (els.btnCopyCloud169) {
    els.btnCopyCloud169.addEventListener("click", () => {
      void copyPlayerEventUrl("16x9", "16:9", setJsonStatus);
    });
  }
  if (els.btnCopyData169) {
    els.btnCopyData169.addEventListener("click", () => {
      void copyPlayerLink("16x9", "16:9", setJsonStatus);
    });
  }
  if (els.btnCopyCloud916) {
    els.btnCopyCloud916.addEventListener("click", () => {
      void copyPlayerEventUrl("9x16", "9:16", setJsonStatus);
    });
  }
  if (els.btnCopyData916) {
    els.btnCopyData916.addEventListener("click", () => {
      void copyPlayerLink("9x16", "9:16", setJsonStatus);
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
        rememberRemoteEventCode(v);
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

  if (els.btnAddJson) {
    els.btnAddJson.addEventListener("click", addJsonFromInput);
  }
  if (els.btnClearJson) {
    els.btnClearJson.addEventListener("click", clearDesignFromJson);
  }

  els.btnPreview.addEventListener("click", previewFirstSlide);

  els.btnPlayBoth.addEventListener("click", () => {
    void runPlayoutBoth();
  });

  els.btnStop.addEventListener("click", stopPlayout);

  els.btnAddPage.addEventListener("click", addEmptyPage);

  if (els.btnLoadJsonUrl) {
    els.btnLoadJsonUrl.addEventListener("click", () => {
      void loadCreditsJsonFromUrl();
    });
  }
  /** @returns {boolean} */
  function isCustomCardShadowboxOpen() {
    return !!(els.customCardShadowbox && !els.customCardShadowbox.hasAttribute("hidden"));
  }

  function openCustomCardShadowbox() {
    if (!els.customCardShadowbox) return;
    els.customCardShadowbox.removeAttribute("hidden");
    els.customCardShadowbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (els.newCardRole) {
      els.newCardRole.disabled = false;
      els.newCardRole.focus();
    }
    if (els.newCardBody) els.newCardBody.disabled = false;
  }

  function closeCustomCardShadowbox() {
    if (!els.customCardShadowbox) return;
    els.customCardShadowbox.setAttribute("hidden", "");
    els.customCardShadowbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (els.btnAddCustomCard) els.btnAddCustomCard.focus();
  }

  if (els.customCardShadowbox) {
    els.customCardShadowbox.addEventListener("click", (e) => {
      const t = /** @type {HTMLElement} */ (e.target);
      if (t.closest("[data-oh-shadowbox-close]")) closeCustomCardShadowbox();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isCustomCardShadowboxOpen()) return;
    e.preventDefault();
    closeCustomCardShadowbox();
  });

  if (els.btnAddCustomCard) {
    els.btnAddCustomCard.addEventListener("click", () => {
      openCustomCardShadowbox();
    });
  }
  if (els.btnCustomCardCancel) {
    els.btnCustomCardCancel.addEventListener("click", () => {
      closeCustomCardShadowbox();
    });
  }
  if (els.btnAddCustomCardSubmit) {
    els.btnAddCustomCardSubmit.addEventListener("click", () => {
      addCustomCardToLayout();
      closeCustomCardShadowbox();
    });
  }
  if (els.jsonUrlInput) {
    els.jsonUrlInput.addEventListener("blur", () => {
      try {
        const u = els.jsonUrlInput.value.trim();
        if (u) localStorage.setItem(LS_JSON_URL, u);
      } catch {
        /* ignore */
      }
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

  try {
    localStorage.removeItem(LS_REMOTE_FN_LEGACY);
  } catch {
    /* ignore */
  }

  void (async function boot() {
    loadRemoteFields();
    syncStoredEventIntoQuickPick();
    renderPlayoutEmpty();
    renderPageStrip();
  })();
})();
