// Pembantu tampilan: escape HTML, format angka dan waktu, dan komponen kecil yang dipakai semua layar.
(function (ns) {
  "use strict";

  const ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const lastHTML = new WeakMap();
  const formatters = new Map();
  const pad = (value) => String(value).padStart(2, "0");

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
  }

  /** Menulis ke DOM hanya bila isinya berubah, supaya fokus dan hover tidak hilang tiap detik. */
  function setHTML(el, html) {
    if (lastHTML.get(el) === html) return;
    el.innerHTML = html;
    lastHTML.set(el, html);
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function refs(root) {
    const found = {};
    for (const el of root.querySelectorAll("[data-ref]"))
      found[el.dataset.ref] = el;
    return found;
  }

  function num(value, digits = 0) {
    if (!Number.isFinite(value)) return "∞";
    if (!formatters.has(digits)) {
      formatters.set(
        digits,
        new Intl.NumberFormat("id-ID", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        }),
      );
    }
    return formatters.get(digits).format(value);
  }

  /** Jam simulasi → "14.30". */
  function clock(t) {
    const minutes = Math.round((((t % 24) + 24) % 24) * 60) % 1440;
    return `${pad(Math.floor(minutes / 60))}.${pad(minutes % 60)}`;
  }

  const dayNumber = (t) => Math.floor(t / 24) + 1;
  const dayName = (t) =>
    ns.config.dayNames[Math.floor(t / 24) % ns.config.dayNames.length];
  const stamp = (t) => `Hari ${dayNumber(t)} · ${clock(t)}`;
  const when = (t) => `${dayName(t)}, ${clock(t)}`;

  /** Sisa waktu → "17 : 42 : 10". */
  function countdown(hours) {
    const seconds = Math.max(0, Math.round(hours * 3600));
    return `${pad(Math.floor(seconds / 3600))} : ${pad(Math.floor((seconds % 3600) / 60))} : ${pad(seconds % 60)}`;
  }

  /** Durasi → "3 jam 15 mnt" atau "5 hari 4 jam". */
  function span(hours) {
    const minutes = Math.round(hours * 60);
    if (minutes < 60) return `${minutes} mnt`;
    if (minutes >= 48 * 60) {
      const days = Math.floor(minutes / 1440);
      const rest = Math.round((minutes % 1440) / 60);
      return rest ? `${days} hari ${rest} jam` : `${days} hari`;
    }
    const rest = minutes % 60;
    return rest
      ? `${Math.floor(minutes / 60)} jam ${rest} mnt`
      : `${minutes / 60} jam`;
  }

  /** Waktu antre → "12 mnt" atau "2,1 jam". */
  function wait(minutes) {
    return minutes < 60 ? `${num(minutes)} mnt` : `${num(minutes / 60, 1)} jam`;
  }

  const icon = (name, size) => ns.icons.svg(name, size);

  // Bentuk status: dipakai bersama warna supaya status terbaca tanpa bergantung pada warna.
  const SHAPES = {
    circle: '<circle cx="8" cy="8" r="6.5"/>',
    triangle: '<path d="M8 1.2 15.2 14.2H.8z"/>',
    square: '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2"/>',
    cross:
      '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2"/><path class="x" d="M5.3 5.3l5.4 5.4M10.7 5.3l-5.4 5.4"/>',
    diamond: '<path d="M8 .8 15.2 8 8 15.2.8 8z"/>',
  };
  const shape = (name) =>
    `<svg class="shape" viewBox="0 0 16 16" aria-hidden="true">${SHAPES[name]}</svg>`;

  const STATUS = {
    NORMAL: { tone: "ok", shape: "circle", title: "Pasokan normal" },
    WASPADA: { tone: "warn", shape: "triangle", title: "Waspada pasokan" },
    KRISIS: { tone: "crit", shape: "square", title: "Krisis pasokan" },
  };

  const STOCK = {
    aman: {
      tone: "ok",
      shape: "circle",
      word: "aman",
      legend: "Stok aman (> 24 jam)",
      short: "Stok ada",
    },
    waspada: {
      tone: "warn",
      shape: "triangle",
      word: "waspada",
      legend: "Waspada (6–24 jam)",
      short: "Stok ada",
    },
    kritis: {
      tone: "crit",
      shape: "square",
      word: "kritis",
      legend: "Kritis (< 6 jam)",
      short: "Stok menipis",
    },
    kosong: {
      tone: "empty",
      shape: "cross",
      word: "kosong",
      legend: "Kosong",
      short: "Stok habis",
    },
  };

  /** Pil status dengan bentuk + teks. */
  function pill(status, { label = status, large = false } = {}) {
    const meta = STATUS[status];
    return tonePill(meta.tone, meta.shape, label, large);
  }

  function tonePill(tone, shapeName, label, large = false) {
    return `<span class="pill tone-${tone}${large ? " pill-lg" : ""}">${shape(shapeName)}${esc(label)}</span>`;
  }

  /** Penanda peta kecil, dipakai juga di legenda dan daftar. */
  const marker = (tone, shapeName) =>
    `<span class="mk mk-${tone}">${shape(shapeName)}</span>`;

  function legendItem(markHtml, label) {
    return `<span class="legend-item">${markHtml}${esc(label)}</span>`;
  }

  const stockLegend = () =>
    Object.values(STOCK)
      .map((meta) => legendItem(marker(meta.tone, meta.shape), meta.legend))
      .join("");

  const truckMark = () =>
    `<span class="mk mk-truck">${icon("truck", 11)}</span>`;

  /** Ubin KPI: label + ikon, angka besar, keterangan, dan sparkline 48 jam. */
  function kpi({ ref, label, iconName, sub = "" }) {
    return `<article class="kpi" data-ref="${ref}Card">
      <div class="kpi-top"><span class="kpi-icon">${icon(iconName, 17)}</span>${esc(label)}</div>
      <div class="kpi-value" data-ref="${ref}">–</div>
      <div class="kpi-sub" data-ref="${ref}Sub">${esc(sub)}</div>
      <div class="kpi-spark" data-ref="${ref}Spark"></div>
    </article>`;
  }

  const BANNER_CLASS = {
    NORMAL: "is-ok",
    WASPADA: "is-warn",
    KRISIS: "is-crit",
  };

  /**
   * Banner status wilayah. KRISIS = blok merah solid (satu-satunya bidang berwarna kuat),
   * WASPADA = kartu putih bergaris tanda, NORMAL = kartu tenang.
   * Teks: judul membawa pesan utama, isi ≤ 2 kalimat (penyebab lalu langkah berikutnya).
   * @param {{ status: string, since?: string, title: string, text?: string,
   *   facts?: { icon: string, text: string }[],
   *   deadline?: { label: string, value: string, note?: string }, action?: string }} opts
   */
  function statusBanner({
    status,
    since,
    title,
    text,
    facts = [],
    deadline,
    action,
  }) {
    const meta = STATUS[status];
    // "sejak …" jadi fakta pertama; status menempel di baris judul, bukan label di atasnya.
    const allFacts = since ? [{ icon: "clock", text: since }, ...facts] : facts;
    const factsHTML = allFacts.length
      ? `<div class="status-facts">${allFacts.map((fact) => `<span>${icon(fact.icon, 15)}${esc(fact.text)}</span>`).join("")}</div>`
      : "";
    const deadlineHTML = deadline
      ? `<div class="status-deadline"><small>${esc(deadline.label)}</small><strong>${esc(deadline.value)}</strong>${deadline.note ? `<em>${esc(deadline.note)}</em>` : ""}</div>`
      : "";
    return `<section class="status-banner ${BANNER_CLASS[status]}" aria-label="Status wilayah">
      <div class="status-lead">
        <div class="status-title"><span class="status-tag">${shape(meta.shape)}${esc(status)}</span><h2>${esc(title)}</h2></div>
        ${text ? `<p>${esc(text)}</p>` : ""}
        ${factsHTML}
      </div>
      ${deadlineHTML}
      ${action || ""}
    </section>`;
  }

  /** Potong daftar per halaman; halaman di luar batas dijepit ke halaman terakhir. */
  function paginate(list, page, size) {
    const pages = Math.max(1, Math.ceil(list.length / size));
    const current = Math.min(Math.max(1, page), pages);
    const start = (current - 1) * size;
    return {
      rows: list.slice(start, start + size),
      page: current,
      pages,
      from: list.length ? start + 1 : 0,
      to: Math.min(start + size, list.length),
      total: list.length,
    };
  }

  /** Navigasi halaman tabel; tombol memakai data-action="page-prev" / "page-next". */
  function pagerHTML({ page, pages, from, to, total }, unit = "baris") {
    return `<div class="pager"><span>${num(from)}–${num(to)} dari ${num(total)} ${esc(unit)}</span><span class="spacer"></span>
      <button type="button" data-action="page-prev" aria-label="Halaman sebelumnya"${page <= 1 ? " disabled" : ""}>${icon("back", 15)}</button>
      <span>${num(page)} / ${num(pages)}</span>
      <button type="button" data-action="page-next" aria-label="Halaman berikutnya"${page >= pages ? " disabled" : ""}>${icon("chevron", 15)}</button></div>`;
  }

  /**
   * Tombol saring bersegmen; tiap tombol membawa data-filter dan data-value.
   * @param {string} name @param {{ value: string, label: string, count?: number }[]} options @param {string} active
   */
  function filterHTML(name, options, active) {
    return `<div class="filter" role="group" aria-label="Saring">${options
      .map(
        (option) =>
          `<button type="button" data-filter="${esc(name)}" data-value="${esc(option.value)}" aria-pressed="${option.value === active}">${esc(option.label)}${option.count === undefined ? "" : `<b>${num(option.count)}</b>`}</button>`,
      )
      .join("")}</div>`;
  }

  /** Keadaan SLA yang sedang berjalan, untuk kepala dashboard. */
  function slaInfo(sim) {
    const sla = sim.sla;
    if (!sla) return { state: "none" };
    const total = sla.deadlineAt - sla.startAt;
    if (sla.doneAt !== null)
      return { state: "done", sla, took: sla.doneAt - sla.startAt, total };
    const remaining = sla.deadlineAt - sim.t;
    return {
      state: remaining >= 0 ? "pending" : "late",
      sla,
      remaining,
      total,
      used: Math.min(1, (sim.t - sla.startAt) / total),
    };
  }

  const seriesColors = [];
  /** Warna seri grafik ke-n, dibaca dari token CSS --series-n supaya sumbernya satu. */
  function seriesColor(index) {
    if (!seriesColors[index]) {
      const style = getComputedStyle(document.documentElement);
      seriesColors[index] = style
        .getPropertyValue(`--series-${index + 1}`)
        .trim();
    }
    return seriesColors[index];
  }

  // Jendela "Batalkan": aksi penting ditunda beberapa detik (onCommit) atau dijalankan lalu bisa
  // dipulihkan (onUndo). Hanya satu yang berjalan; aksi baru menuntaskan yang sebelumnya dulu.
  let pendingUndo = null;

  function undoBar() {
    let bar = document.getElementById("undo");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "undo";
    bar.className = "undo-bar";
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.addEventListener("click", (event) => {
      if (!event.target.closest("[data-undo]") || !pendingUndo) return;
      const state = pendingUndo;
      pendingUndo = null;
      clearInterval(state.timer);
      bar.classList.remove("is-visible");
      state.onUndo();
      toast("Dibatalkan.");
    });
    document.body.append(bar);
    return bar;
  }

  function settleUndo() {
    if (!pendingUndo) return;
    const state = pendingUndo;
    pendingUndo = null;
    clearInterval(state.timer);
    document.getElementById("undo")?.classList.remove("is-visible");
    state.onCommit();
  }

  /** @param {{ text: string, seconds?: number, onCommit?: () => void, onUndo?: () => void }} opts */
  function undoable({
    text,
    seconds = 8,
    onCommit = () => {},
    onUndo = () => {},
  }) {
    settleUndo();
    const bar = undoBar();
    const state = { left: seconds, onCommit, onUndo, timer: 0 };
    bar.innerHTML = `<span>${esc(text)}</span><span class="undo-left">${seconds} dtk</span><button type="button" class="btn" data-undo>Batalkan</button>`;
    bar.classList.add("is-visible");
    state.timer = setInterval(() => {
      state.left -= 1;
      if (state.left <= 0) settleUndo();
      else setText(bar.querySelector(".undo-left"), `${state.left} dtk`);
    }, 1000);
    pendingUndo = state;
  }

  const undoPending = () => pendingUndo !== null;

  let toastTimer = 0;
  function toast(text) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3200);
  }

  ns.ui = {
    STATUS,
    STOCK,
    esc,
    setHTML,
    setText,
    refs,
    num,
    clock,
    dayNumber,
    dayName,
    stamp,
    when,
    countdown,
    span,
    wait,
    icon,
    shape,
    pill,
    tonePill,
    marker,
    legendItem,
    stockLegend,
    truckMark,
    kpi,
    statusBanner,
    paginate,
    pagerHTML,
    filterHTML,
    slaInfo,
    seriesColor,
    undoable,
    undoPending,
    settleUndo,
    toast,
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
