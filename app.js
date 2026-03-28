(function () {
  "use strict";

  const DISPLAY_MS = 5000;
  const FADE_MS = 500;

  const els = {
    toggleJson: document.getElementById("btn-toggle-json"),
    jsonPanel: document.getElementById("json-panel"),
    jsonInput: document.getElementById("json-input"),
    jsonStatus: document.getElementById("json-status"),
    applyJson: document.getElementById("btn-apply-json"),
    aspect: document.getElementById("aspect-ratio"),
    frame: document.getElementById("frame"),
    slideContent: document.getElementById("slide-content"),
    btnPreview: document.getElementById("btn-preview"),
    btnPlay: document.getElementById("btn-play"),
    btnStop: document.getElementById("btn-stop"),
  };

  /** @type {{ type: 'episode'|'credit', html: string }[]} */
  let slides = [];
  let playAbort = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setJsonStatus(message, kind) {
    els.jsonStatus.textContent = message || "";
    els.jsonStatus.classList.remove("error", "ok");
    if (kind) els.jsonStatus.classList.add(kind);
  }

  function parseCreditsPayload(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("Root must be an object");

    const episode = data.episode && typeof data.episode === "object" ? data.episode : null;
    const credits = Array.isArray(data.credits) ? data.credits : null;
    if (!credits) throw new Error('Missing "credits" array');

    const out = [];

    const title = episode && typeof episode.title === "string" ? episode.title.trim() : "";
    const date = episode && typeof episode.date === "string" ? episode.date.trim() : "";
    if (title || date) {
      let html = "";
      if (title) html += `<h1 class="slide-episode-title">${escapeHtml(title)}</h1>`;
      if (date) html += `<p class="slide-episode-date">${escapeHtml(date)}</p>`;
      out.push({ type: "episode", html });
    }

    for (let i = 0; i < credits.length; i++) {
      const row = credits[i];
      if (!row || typeof row !== "object") continue;
      const role = typeof row.role === "string" ? row.role.trim() : "";
      let people = row.people;
      if (!Array.isArray(people)) people = [];
      const names = people
        .map((p) => (typeof p === "string" ? p.trim() : String(p)))
        .filter(Boolean);

      const roleHtml = escapeHtml(role || "—");
      const list =
        names.length === 0
          ? `<p class="slide-empty">No names listed</p>`
          : `<ul class="slide-people">${names.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`;

      out.push({
        type: "credit",
        html: `<h2 class="slide-role">${roleHtml}</h2>${list}`,
      });
    }

    if (out.length === 0) throw new Error("No slides produced from JSON");
    return out;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSlideIndex(index) {
    if (index < 0 || index >= slides.length) {
      els.slideContent.innerHTML = `<p class="slide-empty">No data — paste JSON and Apply.</p>`;
      return;
    }
    els.slideContent.innerHTML = slides[index].html;
  }

  function applyJsonFromInput() {
    const text = els.jsonInput.value.trim();
    if (!text) {
      setJsonStatus("Paste JSON first.", "error");
      return;
    }
    try {
      slides = parseCreditsPayload(text);
      setJsonStatus(`${slides.length} slide(s) loaded.`, "ok");
      renderSlideIndex(0);
    } catch (e) {
      slides = [];
      setJsonStatus(e instanceof Error ? e.message : String(e), "error");
      els.slideContent.innerHTML = `<p class="slide-empty">Invalid JSON</p>`;
    }
  }

  async function runPlayout() {
    if (slides.length === 0) {
      setJsonStatus("Load JSON before play.", "error");
      return;
    }

    const ac = new AbortController();
    playAbort = ac;
    els.btnPlay.disabled = true;
    els.btnStop.disabled = false;
    els.btnPreview.disabled = true;
    els.toggleJson.disabled = true;

    const el = els.slideContent;
    el.style.transition = `opacity ${FADE_MS}ms ease`;
    let lastShownIndex = -1;

    try {
      for (let i = 0; i < slides.length; i++) {
        if (ac.signal.aborted) break;

        els.slideContent.innerHTML = slides[i].html;
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
      els.btnPlay.disabled = false;
      els.btnStop.disabled = true;
      els.btnPreview.disabled = false;
      els.toggleJson.disabled = false;
      playAbort = null;
      if (slides.length && lastShownIndex >= 0) {
        renderSlideIndex(lastShownIndex);
      }
    }
  }

  function stopPlayout() {
    if (playAbort) playAbort.abort();
  }

  els.toggleJson.addEventListener("click", () => {
    const isHidden = els.jsonPanel.hidden;
    els.jsonPanel.hidden = !isHidden;
    els.jsonPanel.classList.toggle("hidden", !isHidden);
    els.toggleJson.setAttribute("aria-expanded", String(isHidden));
  });

  els.applyJson.addEventListener("click", applyJsonFromInput);

  els.aspect.addEventListener("change", () => {
    const v = els.aspect.value;
    els.frame.classList.remove("frame-16-9", "frame-9-16");
    els.frame.classList.add(v === "9-16" ? "frame-9-16" : "frame-16-9");
    els.frame.dataset.ratio = v === "9-16" ? "9-16" : "16-9";
  });

  els.btnPreview.addEventListener("click", () => {
    stopPlayout();
    if (slides.length === 0) {
      applyJsonFromInput();
      if (slides.length === 0) return;
    }
    els.slideContent.classList.remove("is-hidden");
    renderSlideIndex(0);
  });

  els.btnPlay.addEventListener("click", () => {
    void runPlayout();
  });

  els.btnStop.addEventListener("click", stopPlayout);

  renderSlideIndex(-1);
})();
