(function () {
  "use strict";

  const OH = window.OHCreditsEngine;
  if (!OH) throw new Error("Load oh-engine.js before app.js");

  const EPISODE_ID = OH.EPISODE_ID;
  const PEOPLE_MAX_PER_GROUP = OH.PEOPLE_MAX_PER_GROUP;

  /** Commit this file next to `player.html` for short player URLs (`?url=…`). */
  const EXPORT_DESIGN_FILENAME = "ohcredits-design.json";

  const LS_REMOTE_EVENT = "ohcredits_remote_event";
  /** @deprecated removed from UI; clear if present */
  const LS_REMOTE_FN_LEGACY = "ohcredits_remote_function_url";
  const LS_REMOTE_SECRET = "ohcredits_remote_publish_secret";
  const LS_REMOTE_EVENT_LIST = "ohcredits_remote_event_list";
  const LS_JSON_URL = "ohcredits_last_json_url";

  /** Shown in the Event quick-pick until you save your own list. */
  const DEFAULT_EVENT_PRESETS = ["OfficeHours"];

  /** Panelists share page 1 with Host/Reader when total panelist names are 0–6 (fewer than 7). */
  const PANELISTS_MERGE_ON_PAGE1_MAX = 6;

  /**
   * First-load credits template. `_designerPageHint: "starter-v2"` (recommended): semantic pages —
   * Host + Reader on page 1; Panelists on page 1 only if fewer than 7 names, else their own page;
   * Contributors (height-paginated); short roles (≤2 names) ~3 per page; larger groups near the end;
   * "Special thanks" last. `starter-v1` keeps the older index-based layout.
   */
  const DEFAULT_CREDITS_JSON = `{
  "_designerPageHint": "starter-v2",
  "episode": {
    "title": "Your show title",
    "date": "Episode date"
  },
  "credits": [
    { "role": "Host", "people": ["Name"] },
    { "role": "Reader", "people": ["Name"] },
    { "role": "Panelists", "people": ["One", "Two", "Three", "Four", "Five"] },
    {
      "role": "Contributors",
      "people": [
        "Add many names here — this block follows Panelists",
        "Alex Kim", "Jordan Lee", "Sam Rivera", "Taylor Chen", "Riley Patel",
        "Casey Wu", "Morgan Diaz", "Jamie Ortiz", "Quinn Brooks", "Avery Ng",
        "Blake Fox", "Cameron Shah", "Drew Cole", "Emery Park", "Finley Gray"
      ]
    },
    { "role": "Executive producer", "people": ["Name"] },
    { "role": "Producer", "people": ["Name"] },
    { "role": "Director", "people": ["Name"] },
    { "role": "Senior producer", "people": ["Name"] },
    { "role": "Line producer", "people": ["Name"] },
    { "role": "Editor", "people": ["Name"] },
    {
      "role": "Production team",
      "people": [
        "Larger non-panel groups land toward the end",
        "Rae Santos", "Indigo Moore", "Sky Patel", "Ocean Cruz"
      ]
    },
    { "role": "Special thanks", "people": ["Community", "Sponsors", "Volunteers"] }
  ]
}`;

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
    btnStop: document.getElementById("btn-stop"),
    btnAddPage: document.getElementById("btn-add-page"),
    btnExportDesignJson: document.getElementById("btn-export-design-json"),
    btnPublishCredits: document.getElementById("btn-publish-credits"),
    toolbarPublishStatus: document.getElementById("toolbar-publish-status"),
    btnMenuLinks: document.getElementById("btn-menu-links"),
    panelMenuLinks: document.getElementById("panel-menu-links"),
    linksMenuStatus: document.getElementById("links-menu-status"),
    linksDropdown: document.getElementById("links-dropdown"),
    toggleRemote: document.getElementById("btn-toggle-remote"),
    remotePanel: document.getElementById("remote-panel"),
    remoteEventPreset: document.getElementById("remote-event-preset"),
    remoteEvent: document.getElementById("remote-event"),
    remoteEditorConfigUrl: document.getElementById("remote-editor-config-url"),
    btnReloadEditorConfig: document.getElementById("btn-reload-editor-config"),
    remotePublishSecret: document.getElementById("remote-publish-secret"),
    btnTogglePublishSecret: document.getElementById("btn-toggle-publish-secret"),
    jsonUrlInput: document.getElementById("json-url-input"),
    btnLoadJsonUrl: document.getElementById("btn-load-json-url"),
  };

  /** @type {string | null} */
  let episodeHtml = null;
  /** @type {Map<string, { role: string, people: string[] }>} */
  let itemsById = new Map();
  /** @type {string[][]} shared page layout for both 16:9 and 9:16 */
  let pages = [[]];

  let playAbort = null;

  /** Publish endpoint from editor-config.json (in-memory after fetch). */
  let editorPublishFunctionUrl = "";

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

  function setLinksMenuStatus(message, kind) {
    if (!els.linksMenuStatus) return;
    els.linksMenuStatus.textContent = message || "";
    els.linksMenuStatus.classList.remove("error", "ok");
    if (kind) els.linksMenuStatus.classList.add(kind);
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

  function updateEditorConfigDisplay() {
    const el = els.remoteEditorConfigUrl;
    if (!el) return;
    el.classList.remove("remote-editor-config-url--bad");
    if (!editorPublishFunctionUrl) {
      el.textContent =
        "No publishFunctionUrl — add editor-config.json next to index.html (see editor-config.example.json).";
      el.classList.add("remote-editor-config-url--bad");
      return;
    }
    el.textContent = editorPublishFunctionUrl;
  }

  async function loadEditorConfig() {
    editorPublishFunctionUrl = "";
    try {
      const res = await fetch(new URL("editor-config.json", window.location.href), { cache: "no-store" });
      if (!res.ok) {
        updateEditorConfigDisplay();
        return;
      }
      const j = await res.json();
      const url = typeof j.publishFunctionUrl === "string" ? j.publishFunctionUrl.trim() : "";
      if (url) editorPublishFunctionUrl = url;
    } catch {
      /* file missing or invalid */
    }
    updateEditorConfigDisplay();
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

    for (let i = 0; i < shortRuns.length; i += 3) {
      const ids = flattenRuns(shortRuns.slice(i, i + 3));
      if (ids.length) pages.push(ids);
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
    const designerPageHint =
      typeof data._designerPageHint === "string" ? data._designerPageHint.trim() : "";
    return { episodeHtml: epHtml, itemOrder: order, designerPageHint };
  }

  /**
   * @param {string} text
   * @param {(msg: string, kind?: string) => void} [setStatus]
   * @returns {boolean}
   */
  function applyJsonFromText(text, setStatus) {
    const report = setStatus || setJsonStatus;
    const t = (text || "").trim();
    if (!t) {
      report("Paste JSON first.", "error");
      return false;
    }
    try {
      const { episodeHtml: ep, itemOrder, designerPageHint } = parseCreditsPayload(t);
      episodeHtml = ep;
      if (itemOrder.length && designerPageHint === "starter-v2") {
        pages = paginateSemanticStarterLayout(itemOrder);
      } else if (itemOrder.length && designerPageHint === "starter-v1") {
        pages = paginateStarterLayout(itemOrder);
      } else {
        pages = itemOrder.length ? autoPaginateShared(itemOrder) : [[]];
      }
      const n = itemOrder.length;
      const layoutNote =
        designerPageHint === "starter-v2"
          ? " Starter layout v2: page 1 Host+Reader (Panelists if fewer than 7 names), then Contributors, ~3 short roles/page, large groups, thanks."
          : designerPageHint === "starter-v1"
            ? " Starter page layout (Host+Reader, ~3 roles/page, heavy lists then thanks)."
            : "";
      report(
        `${n} credit block(s) · ${pages.length} page(s) · long roles split into ≤${PEOPLE_MAX_PER_GROUP} names per block; drag each block separately.${layoutNote}`,
        "ok"
      );
      renderPageStrip();
      renderPlayoutEmpty();
      return true;
    } catch (e) {
      itemsById = new Map();
      episodeHtml = null;
      pages = [[]];
      report(e instanceof Error ? e.message : String(e), "error");
      renderPageStrip();
      renderPlayoutEmpty();
      return false;
    }
  }

  function applyJsonFromInput() {
    applyJsonFromText(els.jsonInput.value, setJsonStatus);
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
    applyJsonFromText(text, setJsonStatus);
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
        '<p class="slide-empty" style="font-size:13px;padding:8px 0;">Apply JSON to see page boxes.</p>';
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
    if (els.btnExportDesignJson) els.btnExportDesignJson.disabled = playing;
    if (els.toggleRemote) els.toggleRemote.disabled = playing;
    if (els.btnPublishCredits) els.btnPublishCredits.disabled = playing;
    if (els.btnMenuLinks) els.btnMenuLinks.disabled = playing;
    if (els.btnTogglePublishSecret) els.btnTogglePublishSecret.disabled = playing;
    if (els.btnReloadEditorConfig) els.btnReloadEditorConfig.disabled = playing;
    if (els.btnLoadJsonUrl) els.btnLoadJsonUrl.disabled = playing;
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

  /**
   * @param {(msg: string, kind?: string) => void} report
   */
  async function copyPlayerLink(viewParam, label, report) {
    const r = report || setJsonStatus;
    if (itemsById.size === 0 && !episodeHtml) {
      r("Apply JSON and arrange pages before copying a player link.", "error");
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
   * @param {(msg: string, kind?: string) => void} report
   */
  async function copyPlayerFileLink(viewParam, label, report) {
    const r = report || setJsonStatus;
    if (itemsById.size === 0 && !episodeHtml) {
      r("Apply JSON and arrange pages before copying a player link.", "error");
      return;
    }
    const ok = await copyTextToClipboard(playerUrlForJsonFile(viewParam));
    if (ok) {
      r(`Copied ${label} URL (${EXPORT_DESIGN_FILENAME} next to player.html).`, "ok");
    } else {
      r("Copy failed — try HTTPS/localhost or copy manually.", "error");
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
      setToolbarPublishStatus("Apply JSON and arrange pages before publishing.", "error");
      return;
    }
    const code = els.remoteEvent ? els.remoteEvent.value.trim() : "";
    const sec = els.remotePublishSecret ? els.remotePublishSecret.value.trim() : "";
    if (!validateEventSlug(code)) {
      setToolbarPublishStatus("Event code: 1–64 chars — letters, numbers, hyphens, underscores.", "error");
      return;
    }
    if (!editorPublishFunctionUrl) {
      await loadEditorConfig();
    }
    const fnRaw = editorPublishFunctionUrl;
    if (!fnRaw) {
      setToolbarPublishStatus("Missing publishFunctionUrl in editor-config.json.", "error");
      return;
    }
    if (!sec) {
      setToolbarPublishStatus("Enter publish secret (Cloud settings) — saved only in this browser.", "error");
      return;
    }

    const resolved = resolvePublishFunctionUrl(fnRaw);
    if (!resolved.url) {
      setToolbarPublishStatus(resolved.hint || "Invalid publishFunctionUrl in editor-config.json.", "error");
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
        headers,
        body: JSON.stringify({
          event_code: code,
          design: designStateForShare(),
        }),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      setToolbarPublishStatus(
        `Request failed (${detail}). Check Edge Function URL and deployment; see Network tab.`,
        "error"
      );
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
    const autoFixNote = resolved.hint ? `${resolved.hint} ` : "";
    setToolbarPublishStatus(
      `${autoFixNote}Published “${code}”. player-config.json must be on your site for ?event links.`,
      "ok"
    );
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
      report(`Copied ${label} player URL (?event=${code}).`, "ok");
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
      if (isHidden) {
        loadRemoteFields();
        void loadEditorConfig();
      }
    });
  }

  if (els.btnReloadEditorConfig) {
    els.btnReloadEditorConfig.addEventListener("click", () => {
      void loadEditorConfig();
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

  function closeLinksMenu() {
    if (!els.panelMenuLinks || !els.btnMenuLinks) return;
    els.panelMenuLinks.hidden = true;
    els.panelMenuLinks.classList.add("hidden");
    els.btnMenuLinks.setAttribute("aria-expanded", "false");
  }

  function openLinksMenu() {
    if (!els.panelMenuLinks || !els.btnMenuLinks) return;
    els.panelMenuLinks.hidden = false;
    els.panelMenuLinks.classList.remove("hidden");
    els.btnMenuLinks.setAttribute("aria-expanded", "true");
    setLinksMenuStatus("", "");
  }

  if (els.btnMenuLinks && els.panelMenuLinks) {
    els.btnMenuLinks.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !els.panelMenuLinks.hidden;
      if (open) closeLinksMenu();
      else openLinksMenu();
    });

    els.panelMenuLinks.addEventListener("click", (e) => {
      const item = e.target.closest("[data-links-action]");
      if (!item) return;
      const action = item.getAttribute("data-links-action");
      void (async () => {
        switch (action) {
          case "event-169":
            await copyPlayerEventUrl("16x9", "16:9", setLinksMenuStatus);
            break;
          case "event-916":
            await copyPlayerEventUrl("9x16", "9:16", setLinksMenuStatus);
            break;
          case "json-169":
            await copyPlayerFileLink("16x9", "16:9", setLinksMenuStatus);
            break;
          case "json-916":
            await copyPlayerFileLink("9x16", "9:16", setLinksMenuStatus);
            break;
          case "hash-169":
            await copyPlayerLink("16x9", "16:9", setLinksMenuStatus);
            break;
          case "hash-916":
            await copyPlayerLink("9x16", "9:16", setLinksMenuStatus);
            break;
          default:
            break;
        }
        closeLinksMenu();
      })();
    });
  }

  document.addEventListener("click", () => {
    closeLinksMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLinksMenu();
  });
  if (els.linksDropdown) {
    els.linksDropdown.addEventListener("click", (e) => e.stopPropagation());
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

  els.applyJson.addEventListener("click", applyJsonFromInput);

  els.btnPreview.addEventListener("click", previewFirstSlide);

  els.btnPlayBoth.addEventListener("click", () => {
    void runPlayoutBoth();
  });

  els.btnStop.addEventListener("click", stopPlayout);

  els.btnAddPage.addEventListener("click", addEmptyPage);

  if (els.btnExportDesignJson) {
    els.btnExportDesignJson.addEventListener("click", () => {
      void exportDesignJson();
    });
  }

  if (els.btnLoadJsonUrl) {
    els.btnLoadJsonUrl.addEventListener("click", () => {
      void loadCreditsJsonFromUrl();
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
    await loadEditorConfig();
    loadRemoteFields();
    syncStoredEventIntoQuickPick();
    if (els.jsonInput && !els.jsonInput.value.trim()) {
      els.jsonInput.value = DEFAULT_CREDITS_JSON;
      applyJsonFromText(DEFAULT_CREDITS_JSON, setJsonStatus);
    } else {
      renderPlayoutEmpty();
      renderPageStrip();
    }
  })();
})();
