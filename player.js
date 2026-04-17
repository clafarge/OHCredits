(function () {
  "use strict";

  const OH = window.OHCreditsEngine;
  const el = document.getElementById("slide-content");
  const shell = document.getElementById("player-shell");
  const frame = document.getElementById("player-frame");

  function showError(msg) {
    const safe = OH ? OH.escapeHtml(msg) : String(msg).replace(/</g, "&lt;");
    if (el) el.innerHTML = `<p class="slide-empty">${safe}</p>`;
  }

  if (!OH || !el || !shell || !frame) {
    showError("Player failed to load.");
    return;
  }

  /**
   * Same-origin only: relative path or same-host URL (no .., no protocol-relative).
   * @param {string} param
   * @returns {string | null} absolute href to fetch
   */
  function safeResolveJsonUrl(param) {
    if (!param || typeof param !== "string") return null;
    const trimmed = param.trim();
    if (!trimmed || trimmed.includes("..") || trimmed.startsWith("//")) return null;
    let u;
    try {
      u = new URL(trimmed, window.location.href);
    } catch {
      return null;
    }
    if (u.origin !== window.location.origin) return null;
    return u.href;
  }

  function slidesFromState(state) {
    const itemsRaw = state.items;
    const items =
      itemsRaw instanceof Map
        ? itemsRaw
        : new Map(Object.entries(itemsRaw && typeof itemsRaw === "object" ? itemsRaw : {}));

    let pages = Array.isArray(state.pages) && state.pages.length ? state.pages : [[]];
    if (!pages.every((p) => Array.isArray(p))) pages = [[]];

    return OH.buildSlides({
      episodeHtml: state.episodeHtml != null ? state.episodeHtml : null,
      pages,
      items,
    });
  }

  /**
   * @returns {Promise<{ supabaseUrl: string, supabaseAnonKey: string } | null>}
   */
  async function loadBackendConfig() {
    const metaUrl = document
      .querySelector('meta[name="ohcredits-supabase-url"]')
      ?.getAttribute("content")
      ?.trim();
    const metaKey = document
      .querySelector('meta[name="ohcredits-supabase-anon-key"]')
      ?.getAttribute("content")
      ?.trim();
    if (metaUrl && metaKey) {
      return { supabaseUrl: metaUrl.replace(/\/$/, ""), supabaseAnonKey: metaKey };
    }
    try {
      const cfgUrl = new URL("player-config.json", window.location.href);
      const res = await fetch(cfgUrl.href, { cache: "no-store" });
      if (!res.ok) return null;
      const j = await res.json();
      const supabaseUrl =
        typeof j.supabaseUrl === "string" ? j.supabaseUrl.trim().replace(/\/$/, "") : "";
      const supabaseAnonKey =
        typeof j.supabaseAnonKey === "string" ? j.supabaseAnonKey.trim() : "";
      if (supabaseUrl && supabaseAnonKey) {
        return { supabaseUrl, supabaseAnonKey };
      }
    } catch {
      return null;
    }
    return null;
  }

  /**
   * @param {{ supabaseUrl: string, supabaseAnonKey: string }} backend
   * @param {string} eventCode
   * @returns {Promise<object | null>}
   */
  async function fetchDesignFromSupabase(backend, eventCode) {
    const filter = encodeURIComponent(eventCode);
    const url = `${backend.supabaseUrl}/rest/v1/credit_events?event_code=eq.${filter}&select=design`;
    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          apikey: backend.supabaseAnonKey,
          Authorization: `Bearer ${backend.supabaseAnonKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch {
      showError("Could not reach Supabase (network). Check player-config.json and CORS.");
      return null;
    }
    if (!res.ok) {
      showError(`Supabase error (${res.status}). Confirm the table and RLS policies are installed.`);
      return null;
    }
    let rows;
    try {
      rows = await res.json();
    } catch {
      showError("Invalid response from Supabase.");
      return null;
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      showError(`No saved design for event "${eventCode}". Publish from the editor first.`);
      return null;
    }
    const design = rows[0].design;
    if (!design || typeof design !== "object") {
      showError("Stored design is invalid.");
      return null;
    }
    return design;
  }

  const params = new URLSearchParams(window.location.search);
  const rawView = (params.get("view") || "").toLowerCase().replace(/_/g, "");
  const is916 =
    rawView === "9x16" ||
    rawView === "916" ||
    rawView === "vertical" ||
    rawView === "portrait";

  /**
   * Fixed “broadcast” canvas: avoids vw/rem caps that stay tiny on large displays.
   * - hd=1|1080|1080p → 1920×1080 (or 1080×1920 vertical)
   * - hd=1440|1440p|qhd or output=1440|qhd|2560 → 2560×1440 (or 1440×2560 vertical)
   * - hd=4k|2160|uhd or output=2160 or scale=2|200 → 3840×2160 (or 2160×3840)
   * scale: use 2 (or 200 meaning 200%) for 4K vs the 1080p baseline.
   * @returns {"1080" | "1440" | "4k" | null}
   */
  function parseBroadcastTier(p) {
    const h = (p.get("hd") || "").toLowerCase().trim();
    const o = (p.get("output") || "").toLowerCase().trim();
    const scaleStr = (p.get("scale") || "").trim();
    let scaleFactor = NaN;
    if (scaleStr) {
      const n = parseFloat(scaleStr);
      if (!Number.isNaN(n)) {
        scaleFactor = n > 10 ? n / 100 : n;
      }
    }
    const fourK =
      ["4k", "2160", "uhd", "3840"].includes(h) ||
      ["4k", "2160", "uhd", "3840"].includes(o) ||
      scaleFactor >= 1.9;
    if (fourK) return "4k";
    const qhd =
      ["1440", "1440p", "qhd"].includes(h) || ["1440", "qhd", "2560"].includes(o);
    if (qhd) return "1440";
    const tenEighty =
      h === "1" ||
      h === "true" ||
      h === "1080" ||
      h === "1080p" ||
      o === "1080";
    if (tenEighty) return "1080";
    return null;
  }

  const broadcastTier = parseBroadcastTier(params);

  shell.classList.remove("player-shell--169", "player-shell--916");
  frame.classList.remove("frame-16-9", "frame-9-16");
  if (is916) {
    shell.classList.add("player-shell--916");
    frame.classList.add("frame-9-16");
  } else {
    shell.classList.add("player-shell--169");
    frame.classList.add("frame-16-9");
  }

  if (broadcastTier === "1080") {
    document.body.classList.add("player-body--hd1080");
    if (is916) document.body.classList.add("player-body--hd1080-vertical");
    const mv = document.querySelector('meta[name="viewport"]');
    if (mv) {
      mv.setAttribute(
        "content",
        is916 ? "width=1080, height=1920, initial-scale=1" : "width=1920, initial-scale=1"
      );
    }
  } else if (broadcastTier === "1440") {
    document.body.classList.add("player-body--hd1440");
    if (is916) document.body.classList.add("player-body--hd1440-vertical");
    const mv = document.querySelector('meta[name="viewport"]');
    if (mv) {
      mv.setAttribute(
        "content",
        is916 ? "width=1440, height=2560, initial-scale=1" : "width=2560, initial-scale=1"
      );
    }
  } else if (broadcastTier === "4k") {
    document.body.classList.add("player-body--hd4k");
    if (is916) document.body.classList.add("player-body--hd4k-vertical");
    const mv = document.querySelector('meta[name="viewport"]');
    if (mv) {
      mv.setAttribute(
        "content",
        is916 ? "width=2160, height=3840, initial-scale=1" : "width=3840, initial-scale=1"
      );
    }
  }

  void (async function loadAndPlay() {
    const urlParam = params.get("url");
    const eventParam = (params.get("event") || params.get("e") || "").trim();

    /** @type {object | null} */
    let state = null;

    if (urlParam != null && String(urlParam).trim() !== "") {
      const href = safeResolveJsonUrl(String(urlParam));
      if (!href) {
        showError("Invalid JSON path — use a same-site relative URL (no ..). Example: ?url=ohcredits-design.json");
        return;
      }
      let res;
      try {
        res = await fetch(href, { cache: "no-store" });
      } catch {
        showError("Could not load the design JSON file (network error).");
        return;
      }
      if (!res.ok) {
        showError(`Design file not found (${res.status}). Commit the JSON next to player.html or fix ?url=.`);
        return;
      }
      try {
        state = await res.json();
      } catch {
        showError("Design file is not valid JSON.");
        return;
      }
    } else if (eventParam) {
      if (!/^[\w-]{1,64}$/.test(eventParam)) {
        showError("Invalid event code in URL (use letters, numbers, hyphens, underscores).");
        return;
      }
      const backend = await loadBackendConfig();
      if (!backend) {
        showError(
          "Event mode needs Supabase settings: add player-config.json next to player.html (see player-config.example.json) or &lt;meta name=\"ohcredits-supabase-url\"&gt; / &lt;meta name=\"ohcredits-supabase-anon-key\"&gt;."
        );
        return;
      }
      state = await fetchDesignFromSupabase(backend, eventParam);
      if (!state) return;
    } else {
      const hash = window.location.hash || "";
      const m = hash.match(/^#d=(.+)$/);
      if (!m) {
        showError(
          "Missing design: use ?event=officehours (cloud), ?url=file.json (same site), or #d=… from the editor."
        );
        return;
      }
      try {
        state = OH.decodeDesignState(m[1]);
      } catch {
        showError("This player link is damaged or truncated.");
        return;
      }
    }

    if (!state || typeof state !== "object") {
      showError("Invalid design data.");
      return;
    }

    let slides;
    try {
      slides = slidesFromState(state);
    } catch {
      showError("Invalid page layout in this design.");
      return;
    }

    if (slides.length === 0) {
      showError("No slides in this design.");
      return;
    }

    const ac = new AbortController();
    void OH.runPlayoutOnElement(el, slides, ac);
  })();
})();
