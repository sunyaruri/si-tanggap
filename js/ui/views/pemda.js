// Lapis 3 – Aplikasi Pemda: ringkasan, peta SPBU, proyeksi stok, rekomendasi, penimbunan, dan log.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, sim: engine, ews, charts, maps, shell } = ns;
  const {
    esc,
    num,
    icon,
    shape,
    pill,
    setHTML,
    setText,
    refs,
    when,
    span,
    kpi,
    toast,
    STATUS,
    STOCK,
  } = ui;
  const PROJECTION_HOURS = 48;
  const R_DISPLAY_CAP = 10;
  const TREND_HOURS = 6;
  const SLA_LOW_SHARE = 0.75;
  const MAP_VIEW = { center: [-8.2, 113.62], zoom: 10 };
  const PER_PAGE = { spbu: 10, offenders: 10, log: 12 };
  const REASON_LABEL = {
    jeriken: "Jeriken",
    "tangki modif.": "Tangki modifikasi",
    "kuota habis": "Kuota habis",
  };
  const LOG_GROUP = {
    status: "status",
    sla: "kebijakan",
    policy: "kebijakan",
    pos: "kebijakan",
    info: "kebijakan",
    supply: "pasokan",
    report: "laporan",
    clarify: "laporan",
    defer: "kebijakan",
  };

  // ---------- Teks status (aturan: judul = pesan utama, isi ≤ 2 kalimat, tanpa rumus) ----------

  function bannerTitle(sim) {
    const region = sim.region;
    const th = sim.cfg.ews;
    if (region.status === "NORMAL") return "Pasokan BBM normal";
    if (sim.diversion && sim.diversion.approvedAt !== null)
      return "Pasokan tambahan sedang dikirim";
    if (region.r < th.rKrisis) return "Stok BBM akan habis sebelum truk tiba";
    if (region.criticalShare >= th.criticalShareKrisis)
      return "Banyak SPBU hampir kehabisan stok";
    if (region.r < th.rNormal) return "Stok BBM mulai menipis";
    if (region.consumptionRatio > th.consumptionWaspada)
      return "Pembelian BBM naik di atas normal";
    if (sim.policy.KRISIS || sim.policy.WASPADA)
      return "Kebijakan darurat sudah berlaku";
    return "Status turun setelah stabil 24 jam";
  }

  function bannerText(sim) {
    if (sim.region.status === "NORMAL")
      return "Semua indikator di bawah ambang. Stok, penjualan, dan armada dipantau tiap 15 menit.";
    const cause = engine.isDisrupted(sim)
      ? "Truk tangki terlambat karena jalur Gumitir terganggu."
      : "Konsumsi lebih cepat daripada pasokan yang datang.";
    const pending = engine.pendingPolicyStatus(sim);
    if (pending) return `${cause} Setujui rekomendasi sebelum batas waktu.`;
    return `${cause} Kebijakan darurat sudah berlaku; pantau sampai status kembali normal.`;
  }

  function bannerFacts(sim) {
    const region = sim.region;
    const facts = [];
    if (region.criticalCount > 0)
      facts.push({
        icon: "fuel",
        text: `${num(region.criticalCount)} SPBU stok < 6 jam`,
      });
    if (region.emptyCount > 0)
      facts.push({
        icon: "ban",
        text: `${num(region.emptyCount)} SPBU kosong`,
      });
    if (engine.isDisrupted(sim)) {
      const late =
        sim.cfg.supply.leadDisruptedHours - sim.cfg.supply.leadNormalHours;
      facts.push({ icon: "truck", text: `Truk telat ±${num(late)} jam` });
    }
    return facts;
  }

  function bannerDeadline(sim) {
    const info = ui.slaInfo(sim);
    if (info.state === "none") return undefined;
    if (info.state === "done")
      return {
        label: "Keputusan",
        value: "Tepat waktu",
        note: `disetujui ${span(info.took)} setelah status naik`,
      };
    if (info.state === "late")
      return {
        label: "Batas keputusan",
        value: "Terlewat",
        note: when(info.sla.deadlineAt),
      };
    return {
      label: "Sisa waktu keputusan",
      value: span(info.remaining),
      note: `batas ${when(info.sla.deadlineAt)}`,
    };
  }

  function bannerHTML(sim) {
    const status = sim.region.status;
    const pending = engine.pendingPolicyStatus(sim);
    const count = pending ? ews.recommendations(pending, sim.cfg).length : 0;
    const action = pending
      ? `<a class="btn" href="#pemda/rekomendasi">Tinjau rekomendasi <span class="badge">${num(count)}</span></a>`
      : "";
    const since =
      sim.sla && sim.sla.status === status
        ? `sejak ${when(sim.sla.startAt)}`
        : "";
    return ui.statusBanner({
      status,
      since,
      title: bannerTitle(sim),
      text: bannerText(sim),
      facts: status === "NORMAL" ? [] : bannerFacts(sim),
      deadline: bannerDeadline(sim),
      action,
    });
  }

  // ---------- Komponen bersama halaman ----------

  function offendersToday(sim) {
    return sim.speculators
      .filter((offender) => offender.countToday > 0)
      .sort((a, b) => b.countToday - a.countToday);
  }

  function countsHTML(sim, include = () => true) {
    const counts = { aman: 0, waspada: 0, kritis: 0, kosong: 0 };
    for (const s of sim.spbu.filter(include)) counts[s.klass] += 1;
    const items = Object.entries(counts).map(
      ([klass, count]) =>
        `<span class="chip">${ui.marker(STOCK[klass].tone, STOCK[klass].shape)}<b>${count}</b>${STOCK[klass].word}</span>`,
    );
    items.push(
      `<span class="chip">${icon("truck", 14)}<b>${sim.trucks.length}</b>truk</span>`,
    );
    return items.join("");
  }

  /** Peta SPBU + truk; dibangun saat halaman dibuka dan dibuang saat ditinggal. */
  function mountMap(el, opts = {}, include = undefined) {
    const map = maps.create(el, { ...MAP_VIEW, ...opts });
    const layers = map
      ? [maps.spbuLayer(map, 16, include), maps.truckLayer(map)]
      : [];
    return {
      map,
      update: (sim) => layers.forEach((layer) => layer(sim)),
      destroy: () => map && map.remove(),
    };
  }

  const legendItems = () => [
    ui.stockLegend(),
    ui.legendItem(ui.truckMark(), "Truk tangki"),
  ];
  const mapLegend = () => maps.legend(legendItems());

  const emptyHTML = (title, text) =>
    `<div class="empty"><span class="empty-icon">${icon("shield", 20)}</span><strong>${esc(title)}</strong><span class="note">${esc(text)}</span></div>`;

  // Saringan peta: kecamatan dari data SPBU; jenis BBM hanya penanda karena simulasi agregat.
  const FILTER_FIELDS = `<label class="field-inline">Kecamatan <select class="select" data-ref="kec"></select></label>
    <label class="field-inline" title="Simulasi menggabungkan semua jenis BBM; data per jenis tersedia dari POS di sistem nyata.">Jenis BBM <select class="select" disabled><option>Semua jenis (data agregat)</option></select></label>`;

  const kecFilter = (state) => (s) =>
    state.kec === "semua" || s.kecamatan === state.kec;

  /** Isi pilihan kecamatan; saat berganti, peta diarahkan ke SPBU kecamatan itu. */
  function bindKecamatan(select, map, state, app) {
    const kecamatan = [...new Set(app.sim.spbu.map((s) => s.kecamatan))].sort(
      (a, b) => a.localeCompare(b, "id"),
    );
    select.innerHTML = ["semua", ...kecamatan]
      .map(
        (name) =>
          `<option value="${esc(name)}">${name === "semua" ? "Semua kecamatan" : esc(name)}</option>`,
      )
      .join("");
    select.value = state.kec;
    select.addEventListener("change", () => {
      state.kec = select.value;
      state.page = 1;
      const spots = app.sim.spbu
        .filter(kecFilter(state))
        .map((s) => [s.lat, s.lng]);
      if (map.map && state.kec !== "semua" && spots.length)
        map.map.fitBounds(spots, { maxZoom: 13, padding: [60, 60] });
      else if (map.map) map.map.setView(MAP_VIEW.center, MAP_VIEW.zoom);
      app.render();
    });
  }

  /** Tombol saring dan halaman memakai satu pendengar per halaman. */
  function onControls(el, state, app) {
    el.addEventListener("click", (event) => {
      const target = event.target.closest("[data-filter], [data-action]");
      if (!target) return;
      if (target.dataset.filter) {
        state[target.dataset.filter] = target.dataset.value;
        state.page = 1;
      } else if (target.dataset.action === "page-prev") state.page -= 1;
      else if (target.dataset.action === "page-next") state.page += 1;
      else return;
      app.render();
    });
  }

  function hoursLabel(s) {
    if (s.klass === "kosong") return "habis";
    if (!Number.isFinite(s.hoursLeft) || s.hoursLeft > 48) return "> 2 hari";
    return `${num(s.hoursLeft)} jam`;
  }

  const pct = (ratio) => {
    const value = Math.round((ratio - 1) * 100);
    return value === 0
      ? "0%"
      : `${value > 0 ? "+" : "−"}${num(Math.abs(value))}%`;
  };

  /** Permintaan termasuk yang ditahan kuota; penjualan turun saat stok habis, jadi hanya jadi keterangan. */
  function demandKpi(r, sim) {
    const demand = engine.demandRatio(sim);
    setText(r.consumption, pct(demand));
    r.consumptionCard.dataset.tone =
      demand > sim.cfg.ews.consumptionWaspada ? "warn" : "";
    setText(
      r.consumptionSub,
      `penjualan 24 jam ${pct(sim.region.consumptionRatio)}`,
    );
  }

  function criticalTone(sim) {
    const region = sim.region;
    if (
      region.emptyCount > 0 ||
      region.criticalShare >= sim.cfg.ews.criticalShareKrisis
    )
      return "crit";
    return region.criticalCount > 0 ? "warn" : "";
  }

  const ratioValue = (r) =>
    r > R_DISPLAY_CAP ? `> ${R_DISPLAY_CAP}` : num(r, 2);

  function ratioKpi(r, sim) {
    const region = sim.region;
    const th = sim.cfg.ews;
    setText(r.ratio, ratioValue(region.r));
    r.ratioCard.dataset.tone =
      region.r < th.rKrisis ? "crit" : region.r < th.rNormal ? "warn" : "";
    setText(
      r.ratioSub,
      region.r < th.rKrisis
        ? "di bawah 1: stok habis lebih dulu"
        : region.r < th.rNormal
          ? "di bawah 1,5: mulai menipis"
          : "di atas 1,5: aman",
    );
  }

  /** Waktu antre bergantung jam; yang dirasakan warga adalah puncaknya dalam 24 jam. */
  function peakQueue(sim) {
    const recent = sim.series
      .filter((point) => point.t > sim.t - 24)
      .map((point) => point.queueMinutes);
    return Math.max(sim.region.queueMinutes, ...recent);
  }

  // ---------- Halaman: Ringkasan ----------

  function trendText(sim) {
    const region = sim.region;
    if (region.emptyCount > 0)
      return `<b>${num(region.emptyCount)} SPBU sudah kosong</b>`;
    const past = [...sim.series]
      .reverse()
      .find((point) => point.t <= sim.t - TREND_HOURS);
    if (!past) return "dipantau tiap 15 menit";
    const change = region.criticalCount - past.criticalCount;
    if (change > 0)
      return `<b>naik ${num(change)}</b> dalam ${TREND_HOURS} jam terakhir`;
    if (change < 0)
      return `turun ${num(-change)} dalam ${TREND_HOURS} jam terakhir`;
    return `tetap dalam ${TREND_HOURS} jam terakhir`;
  }

  function todoHTML(sim) {
    const pending = engine.pendingPolicyStatus(sim);
    const approved = sim.policy.KRISIS || sim.policy.WASPADA;
    const rec = pending
      ? {
          title: `Rekomendasi ${pending} menunggu persetujuan`,
          sub: sim.sla ? `batas ${when(sim.sla.deadlineAt)}` : "",
          count: ews.recommendations(pending, sim.cfg).length,
        }
      : approved
        ? { title: "Rekomendasi sudah disetujui", sub: when(approved.at) }
        : {
            title: "Belum ada rekomendasi",
            sub: "muncul otomatis saat ambang terlewati",
          };
    const offenders = offendersToday(sim).length;
    const diversion = sim.diversion;
    const supply = !diversion
      ? {
          title: "Pengalihan pasokan",
          sub: "diajukan setelah rekomendasi KRISIS disetujui",
        }
      : diversion.approvedAt === null
        ? {
            title: "Pengalihan pasokan diajukan",
            sub: "menunggu persetujuan Pertamina",
          }
        : {
            title: "Pengalihan pasokan berjalan",
            sub: `disetujui Pertamina ${when(diversion.approvedAt)}`,
          };
    const items = [
      { href: "#pemda/rekomendasi", iconName: "clipboard", ...rec },
      {
        href: "#pemda/penimbunan",
        iconName: "ban",
        title: "Kendaraan diduga menimbun",
        sub: offenders
          ? "teruskan ke Satpol PP"
          : "belum ada penolakan hari ini",
        count: offenders,
      },
      { href: "#pemda/log", iconName: "truck", ...supply },
      {
        href: "#publik",
        iconName: "megaphone",
        title: sim.infoPublished
          ? "Info resmi sudah terbit"
          : "Belum ada info resmi",
        sub: sim.infoPublished
          ? "web, WhatsApp, dan media sosial"
          : "terbit saat WASPADA disetujui atau saat KRISIS",
      },
    ];
    return items
      .map(
        (item) =>
          `<a class="todo" href="${item.href}">${icon(item.iconName, 20)}<span><b>${esc(item.title)}</b><small>${esc(item.sub)}</small></span>${item.count ? `<span class="count-box">${num(item.count)}</span>` : ""}</a>`,
      )
      .join("");
  }

  function ringkasanPage() {
    return {
      title: "Ringkasan",
      mount(el) {
        el.innerHTML = `
          <div data-ref="banner"></div>
          <section class="kpis" aria-label="Indikator utama">
            ${kpi({ ref: "critical", label: "SPBU stok < 6 jam", iconName: "fuel" })}
            ${kpi({ ref: "ratio", label: "Stok vs kedatangan truk", iconName: "gauge" })}
            ${kpi({ ref: "queue", label: "Antre terlama", iconName: "users", sub: "puncak 24 jam terakhir" })}
            ${kpi({ ref: "consumption", label: "Permintaan vs normal", iconName: "trending" })}
            ${kpi({ ref: "rejected", label: "Pengisian ditolak", iconName: "ban" })}
          </section>
          <div class="cols cols-2-1">
            <article class="panel">
              <header class="panel-head"><h2>${icon("pin", 18)}Status SPBU</h2><a class="link" href="#pemda/peta">Buka peta</a></header>
              <div class="panel-body">
                <div class="map-wrap"><div class="map map-md" data-ref="map"></div>${mapLegend()}</div>
                <div class="toolbar" data-ref="counts"></div>
              </div>
            </article>
            <article class="panel">
              <header class="panel-head"><h2>${icon("bell", 18)}Perlu tindakan</h2></header>
              <div class="panel-body"><div class="todo-list" data-ref="todo"></div></div>
            </article>
          </div>`;
        const r = refs(el);
        const map = mountMap(r.map, { zoom: 9.6 });

        function update(sim) {
          const region = sim.region;
          setHTML(r.banner, bannerHTML(sim));

          setHTML(
            r.critical,
            `${num(region.criticalCount)}<small>dari ${num(sim.spbu.length)}</small>`,
          );
          setHTML(r.criticalSub, trendText(sim));
          r.criticalCard.dataset.tone = criticalTone(sim);
          ratioKpi(r, sim);

          setText(r.queue, ui.wait(peakQueue(sim)));
          demandKpi(r, sim);

          setText(r.rejected, num(sim.totals.rejectedToday));
          setText(
            r.rejectedSub,
            sim.crisisMode.active
              ? "hari ini · jeriken & tangki modifikasi"
              : "kunci POS belum aktif",
          );

          setHTML(r.counts, countsHTML(sim));
          setHTML(r.todo, todoHTML(sim));
          map.update(sim);
        }
        return { update, destroy: map.destroy };
      },
    };
  }

  // ---------- Halaman: Peta SPBU ----------

  const SPBU_FILTER = {
    semua: () => true,
    kritis: (s) => s.klass === "kritis" || s.klass === "kosong",
    waspada: (s) => s.klass === "waspada",
    aman: (s) => s.klass === "aman",
  };

  function petaPage(state) {
    return {
      title: "Peta SPBU",
      mount(el, ctx) {
        el.innerHTML = `
          <div class="cols cols-map">
            <article class="panel">
              <header class="panel-head"><h2>${icon("map", 18)}Stok SPBU dan posisi truk tangki</h2><div class="panel-tools" data-ref="counts"></div></header>
              <div class="panel-body">
                <div class="toolbar">${FILTER_FIELDS}</div>
                <div class="map-wrap"><div class="map map-xl" data-ref="map"></div>${mapLegend()}</div>
              </div>
            </article>
            <article class="panel">
              <header class="panel-head"><h2>${icon("list", 18)}SPBU paling berisiko</h2><span class="hint">urut dari stok paling sedikit</span></header>
              <div class="panel-body">
                <div data-ref="filter"></div>
                <div class="risk-list" data-ref="list"></div>
                <div data-ref="pager"></div>
              </div>
            </article>
          </div>`;
        const r = refs(el);
        const inKec = kecFilter(state);
        const map = mountMap(r.map, {}, inKec);
        bindKecamatan(r.kec, map, state, ctx.app);
        onControls(el, state, ctx.app);
        // Klik baris: arahkan peta ke SPBU itu.
        r.list.addEventListener("click", (event) => {
          const row = event.target.closest("[data-spbu]");
          const s = row && ctx.app.sim.spbu[Number(row.dataset.spbu)];
          if (s && map.map) map.map.setView([s.lat, s.lng], 13);
        });

        function update(sim) {
          setHTML(r.counts, countsHTML(sim, inKec));
          const shown = sim.spbu.filter(inKec);
          const options = Object.keys(SPBU_FILTER).map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
            count: shown.filter(SPBU_FILTER[value]).length,
          }));
          setHTML(r.filter, ui.filterHTML("klass", options, state.klass));
          const list = shown
            .filter(SPBU_FILTER[state.klass])
            .sort((a, b) => a.hoursLeft - b.hoursLeft);
          const pageInfo = ui.paginate(list, state.page, PER_PAGE.spbu);
          state.page = pageInfo.page;
          setHTML(
            r.list,
            pageInfo.rows.length
              ? pageInfo.rows
                  .map(
                    (s) =>
                      `<button type="button" class="risk-row" data-spbu="${s.id}" title="Tampilkan di peta">${ui.marker(STOCK[s.klass].tone, STOCK[s.klass].shape)}<span><b>${esc(s.name)}</b><small>Kec. ${esc(s.kecamatan)}</small></span><span class="value">${esc(hoursLabel(s))}</span></button>`,
                  )
                  .join("")
              : '<p class="note">Tidak ada SPBU di kelompok ini.</p>',
          );
          setHTML(r.pager, ui.pagerHTML(pageInfo, "SPBU"));
          map.update(sim);
        }
        return { update, destroy: map.destroy };
      },
    };
  }

  // ---------- Halaman: Proyeksi stok ----------

  /** Tandai kapan stok menembus batas kritis dan kapan habis, supaya grafik menjawab "kapan". */
  function projectionMarks(outlook, divertedEtas, sim) {
    const marks = [];
    if (outlook.criticalIn)
      marks.push({
        x: outlook.criticalIn,
        label: `kritis ≈ ${when(sim.t + outlook.criticalIn)}`,
      });
    if (outlook.emptyIn !== null)
      marks.push({
        x: outlook.emptyIn,
        label: `habis ≈ ${when(sim.t + outlook.emptyIn)}`,
      });
    if (divertedEtas.length)
      marks.push({
        x: Math.min(...divertedEtas),
        label: "truk pengalihan tiba",
      });
    return marks;
  }

  /**
   * Grafik proyeksi stok 48 jam.
   * @param {{ height?: number, compact?: boolean }} [opts] compact = grafik kecil: hanya "habis" dan "ETA truk"
   */
  function drawProjection(el, sim, { height = 380, compact = false } = {}) {
    const outlook = engine.stockOutlook(sim, PROJECTION_HOURS);
    const points = outlook.points.map((point) => [point.h, point.stockKL]);
    const divertedEtas = sim.trucks
      .filter((truck) => truck.route === "malang" || truck.route === "surabaya")
      .map((truck) => truck.etaAt - sim.t);
    let marks = projectionMarks(outlook, divertedEtas, sim);
    if (compact) {
      // Grafik sempit: label berdempet, jadi cukup kapan habis dan kapan truk (pengalihan bila ada) tiba.
      const etas = divertedEtas.length
        ? divertedEtas
        : sim.trucks.map((truck) => truck.etaAt - sim.t).filter((h) => h > 0);
      marks = marks.filter((mark) => mark.label.startsWith("habis"));
      if (etas.length) marks.push({ x: Math.min(...etas), label: "ETA truk" });
    }
    charts.line(el, {
      series: [{ name: "Stok wilayah", color: ui.seriesColor(0), points }],
      xTicks: [0, 12, 24, 36, 48].map((h) => ({
        x: h,
        label: h === 0 ? "kini" : `+${h} jam`,
      })),
      xTitle: "Jam ke depan",
      xFormat: (h) => `+${h} jam`,
      yFormat: (value) => `${num(value)} KL`,
      levels: [{ y: outlook.critical, label: "batas kritis (6 jam konsumsi)" }],
      marks,
      area: true,
      height,
      ariaLabel: "Proyeksi stok BBM wilayah 48 jam ke depan",
    });
  }

  function proyeksiPage() {
    return {
      title: "Proyeksi stok",
      mount(el) {
        el.innerHTML = `
          <section class="kpis is-4" aria-label="Stok wilayah">
            ${kpi({ ref: "stock", label: "Stok seluruh SPBU", iconName: "database", sub: "total 58 SPBU" })}
            ${kpi({ ref: "cover", label: "Cukup untuk, tanpa truk baru", iconName: "clock", sub: "pada laju penjualan sekarang" })}
            ${kpi({ ref: "consumption", label: "Permintaan vs normal", iconName: "trending" })}
            ${kpi({ ref: "trucks", label: "Truk tangki di jalan", iconName: "truck", sub: "menuju SPBU Kab. Jember" })}
          </section>
          <article class="panel">
            <header class="panel-head"><h2>${icon("activity", 18)}Proyeksi stok wilayah 48 jam</h2><span class="hint">termasuk truk yang sedang di jalan</span></header>
            <div class="panel-body"><div data-ref="projection"></div></div>
          </article>`;
        const r = refs(el);

        function update(sim) {
          const region = sim.region;
          setHTML(r.stock, `${num(region.stockKL)}<small>KL</small>`);
          setText(r.cover, span(region.coverHours));
          r.coverCard.dataset.tone =
            region.coverHours < sim.cfg.ews.stockCriticalHours
              ? "crit"
              : region.coverHours < sim.cfg.ews.stockSafeHours
                ? "warn"
                : "";
          demandKpi(r, sim);
          setText(r.trucks, num(sim.trucks.length));
          drawProjection(r.projection, sim);
        }
        return { update };
      },
    };
  }

  // ---------- Halaman: Rekomendasi ----------

  function slaHTML(sim) {
    const info = ui.slaInfo(sim);
    if (info.state === "none") {
      return `<p class="sla-label">Tidak ada keputusan yang ditunggu</p>
        <p class="note">Hitung mundur dimulai otomatis saat status naik: WASPADA diputuskan dalam 6 jam, KRISIS dalam 24 jam.</p>`;
    }
    const label = `Status ${info.sla.status} · target ${num(info.total)} jam`;
    if (info.state === "done") {
      return `<p class="sla-label">${esc(label)}</p>
        <p class="sla-value">${icon("check", 26)}Tepat waktu</p>
        <div class="progress tone-ok"><span style="width:100%"></span></div>
        <p class="note">Disetujui ${esc(span(info.took))} setelah status ${esc(info.sla.status)} terpicu.</p>`;
    }
    if (info.state === "late") {
      return `<p class="sla-label">${esc(label)}</p>
        <p class="sla-value">Terlewat ${esc(span(-info.remaining))}</p>
        <div class="progress tone-crit"><span style="width:100%"></span></div>
        <p class="note">Batas ${esc(when(info.sla.deadlineAt))}.</p>`;
    }
    const tone = info.used > SLA_LOW_SHARE ? "crit" : "warn";
    return `<p class="sla-label">${esc(label)} · sisa waktu</p>
      <p class="sla-value">${esc(span(info.remaining))}</p>
      <div class="progress tone-${tone}"><span style="width:${(info.used * 100).toFixed(1)}%"></span></div>
      <p class="note">Putuskan sebelum ${esc(when(info.sla.deadlineAt))}.</p>`;
  }

  function recItemHTML(item, { checked, disabled, state }) {
    const tag = item.auto ? '<span class="tag">otomatis</span>' : "";
    const mark = state === "skipped" ? icon("minus", 14) : icon("check", 14);
    const input =
      state === "pending"
        ? `<input type="checkbox" data-item="${esc(item.id)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""}>`
        : "";
    const cls = [
      "rec",
      item.auto ? "is-auto" : "",
      state === "done" ? "is-done" : "",
      state === "skipped" ? "is-skipped" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const sub = state === "skipped" ? "tidak dijalankan" : `PJ: ${item.pj}`;
    return `<li><label class="${cls}">${input}<span class="box">${mark}</span><span class="rec-text"><span class="rec-title">${esc(item.label)}</span><span class="rec-pj">${esc(sub)}</span></span>${tag}</label></li>`;
  }

  /** Dasar keputusan di layar yang sama dengan tombol Setujui: angka yang memicu rekomendasi. */
  function basisHTML(sim) {
    const region = sim.region;
    const outlook = engine.stockOutlook(sim);
    const facts = [
      `Stok ÷ waktu tiba truk (R) ${num(Math.min(region.r, 99), 2)}`,
      `${num(region.criticalCount)} dari ${num(sim.spbu.length)} SPBU stok < 6 jam`,
    ];
    if (engine.isDisrupted(sim)) {
      const late =
        sim.cfg.supply.leadDisruptedHours - sim.cfg.supply.leadNormalHours;
      facts.push(`truk telat ±${num(late)} jam (jalur Gumitir)`);
    }
    if (outlook.emptyIn !== null)
      facts.push(`stok wilayah habis ≈ ${when(sim.t + outlook.emptyIn)}`);
    else if (outlook.criticalIn)
      facts.push(`stok kritis ≈ ${when(sim.t + outlook.criticalIn)}`);
    return `<div class="basis"><span class="basis-title">Dasar rekomendasi</span>${facts.map((text) => `<span class="chip">${esc(text)}</span>`).join("")}</div>`;
  }

  /** Catatan di kaki panel rekomendasi: apa yang terjadi bila disetujui sekarang. */
  function pendingNote(state, deferred) {
    if (state.approving)
      return "Terbit dalam beberapa detik. Bisa dibatalkan di bilah bawah.";
    if (state.editing) return "Hapus centang butir yang tidak akan dijalankan.";
    if (deferred)
      return `Ditunda ${when(deferred.t)}. Batas waktu tetap berjalan.`;
    if (state.unchecked.size)
      return `${num(state.unchecked.size)} butir tidak akan dijalankan.`;
    return "Semua butir akan dijalankan.";
  }

  // Versi ringkas menyembunyikan butir otomatis: tetap dijalankan mesin, tidak perlu diputuskan.
  const recItems = (status, sim, compact) =>
    ews
      .recommendations(status, sim.cfg)
      .filter((item) => !compact || !item.auto);

  /**
   * Tombol sesuai dokumen alur 4.2: Setujui, Ubah, dan Tunda.
   * @param {{ compact?: boolean }} [opts] compact = tanpa dasar rekomendasi dan butir otomatis
   */
  function recommendationsView(sim, state, { compact = false } = {}) {
    const pending = engine.pendingPolicyStatus(sim);
    if (pending) {
      const deferred =
        state.deferred && state.deferred.status === pending
          ? state.deferred
          : null;
      const items = recItems(pending, sim, compact)
        .map((item) =>
          recItemHTML(item, {
            checked: item.auto || !state.unchecked.has(item.id),
            disabled: item.auto || !state.editing,
            state: "pending",
          }),
        )
        .join("");
      const action =
        pending === "KRISIS" ? "Setujui &amp; terbitkan SE" : "Setujui";
      const chip = deferred
        ? `<span class="chip">${icon("pause2", 14)}ditunda ${esc(ui.clock(deferred.t))}</span>`
        : `<span class="chip">menunggu persetujuan</span>`;
      const edit = `<button type="button" class="btn" data-action="edit">${icon(state.editing ? "check" : "sliders", 16)}${state.editing ? "Selesai mengubah" : "Ubah"}</button>`;
      const defer = deferred
        ? ""
        : `<button type="button" class="btn" data-action="defer">${icon("pause2", 16)}Tunda</button>`;
      return {
        state: `${pill(pending)}${chip}`,
        body: `${compact ? "" : basisHTML(sim)}<ul class="rec-list">${items}</ul>`,
        foot: `<button type="button" class="btn btn-primary" data-action="approve"${state.approving ? " disabled" : ""}>${icon("check", 17)}${action}</button>${edit}${defer}<span class="note">${esc(pendingNote(state, deferred))}</span>`,
      };
    }

    const status = sim.policy.KRISIS
      ? "KRISIS"
      : sim.policy.WASPADA
        ? "WASPADA"
        : null;
    if (!status) {
      return {
        state: '<span class="chip">tidak ada tindakan</span>',
        body: emptyHTML(
          "Tidak ada rekomendasi saat ini",
          "Rekomendasi muncul otomatis saat status naik ke WASPADA atau KRISIS.",
        ),
        foot: '<a class="btn" href="#pemda/peta">Lihat peta SPBU</a>',
      };
    }
    const policy = sim.policy[status];
    const items = recItems(status, sim, compact)
      .map((item) =>
        recItemHTML(item, {
          state: policy.items.includes(item.id) ? "done" : "skipped",
        }),
      )
      .join("");
    return {
      state: `${pill(status)}<span class="chip">${icon("check", 14)}disetujui</span>`,
      body: `<ul class="rec-list">${items}</ul>`,
      foot: `<span class="note">Disetujui ${esc(when(policy.at))} dan tercatat untuk audit SLA.</span>`,
    };
  }

  /** Centang, Ubah, Tunda, dan Setujui (dengan jendela batal) untuk rekomendasi yang menunggu. */
  function bindRecActions(el, state, app) {
    el.addEventListener("change", (event) => {
      const id = event.target.dataset.item;
      if (!id) return;
      if (event.target.checked) state.unchecked.delete(id);
      else state.unchecked.add(id);
    });
    el.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      const pending = engine.pendingPolicyStatus(app.sim);
      if (!pending) return;
      if (action === "edit") {
        state.editing = !state.editing;
      } else if (action === "defer") {
        engine.logEvent(
          app.sim,
          "defer",
          `Rekomendasi ${pending} ditunda oleh Pemda`,
        );
        state.deferred = { status: pending, t: app.sim.t };
        state.editing = false;
        toast("Rekomendasi ditunda. Batas waktu SLA tetap berjalan.");
      } else if (action === "approve") {
        if (state.approving) return;
        const ids = ews
          .recommendations(pending, app.sim.cfg)
          .map((item) => item.id)
          .filter((id) => !state.unchecked.has(id));
        state.approving = true;
        state.editing = false;
        ui.undoable({
          text:
            pending === "KRISIS"
              ? `SE KRISIS terbit, ${ids.length} butir dijalankan`
              : `${ids.length} butir rekomendasi disetujui`,
          seconds: 8,
          onCommit() {
            state.approving = false;
            if (engine.approvePolicy(app.sim, ids))
              toast("Rekomendasi disetujui dan tercatat waktunya.");
            state.unchecked.clear();
            state.deferred = null;
            app.render();
          },
          onUndo() {
            state.approving = false;
            app.render();
          },
        });
      } else return;
      app.render();
    });
  }

  function thresholdsHTML(sim) {
    const th = sim.cfg.ews;
    return `<div class="thresholds">
      <div class="threshold">${pill("WASPADA")}<span>Rasio stok ÷ waktu tiba truk (R) &lt; ${num(th.rNormal, 1)}, atau penjualan naik &gt; ${num((th.consumptionWaspada - 1) * 100)}%. Putuskan dalam 6 jam.</span></div>
      <div class="threshold">${pill("KRISIS")}<span>R &lt; ${num(th.rKrisis)}, atau ≥ ${num(th.criticalShareKrisis * 100)}% SPBU berstok &lt; 6 jam. Putuskan dalam 24 jam.</span></div>
    </div><p class="note">Sumber: matriks keputusan, dokumen alur sistem bagian 4.1.</p>`;
  }

  function rekomendasiPage(state) {
    return {
      title: "Rekomendasi kebijakan",
      mount(el, ctx) {
        el.innerHTML = `
          <div class="cols cols-2-1">
            <article class="panel">
              <header class="panel-head">
                <h2>${icon("clipboard", 18)}Rekomendasi dari matriks keputusan</h2>
                <div class="panel-tools is-row" data-ref="recState"></div>
              </header>
              <div class="panel-body" data-ref="recommendations"></div>
              <footer class="panel-foot" data-ref="recFoot"></footer>
            </article>
            <div class="cols">
              <article class="panel">
                <header class="panel-head"><h2>${icon("clock", 18)}Batas waktu keputusan</h2></header>
                <div class="panel-body sla-box" data-ref="sla"></div>
              </article>
              <article class="panel">
                <header class="panel-head"><h2>${icon("info", 18)}Kapan rekomendasi muncul</h2></header>
                <div class="panel-body" data-ref="thresholds"></div>
              </article>
            </div>
          </div>`;
        const r = refs(el);
        const app = ctx.app;

        bindRecActions(el, state, app);

        function update(sim) {
          const rec = recommendationsView(sim, state);
          setHTML(r.recState, rec.state);
          setHTML(r.recommendations, rec.body);
          setHTML(r.recFoot, rec.foot);
          setHTML(r.sla, slaHTML(sim));
          setHTML(r.thresholds, thresholdsHTML(sim));
        }
        return { update };
      },
    };
  }

  // ---------- Halaman: Penimbunan ----------

  /** Kirim daftar penimbun dengan jendela batal; jejak "terkirim" disimpan di state. */
  function bindOffenderSend(el, state, app) {
    el.addEventListener("click", (event) => {
      if (!event.target.closest('[data-action="send-offenders"]')) return;
      if (state.sending) return;
      const count = offendersToday(app.sim).length;
      state.sending = true;
      app.render();
      ui.undoable({
        text: `Daftar ${count} kendaraan dikirim ke Satpol PP / Polres`,
        seconds: 6,
        onCommit() {
          state.sending = false;
          engine.logEvent(
            app.sim,
            "report",
            `Daftar ${count} kendaraan diduga menimbun dikirim ke Satpol PP / Polres`,
          );
          state.sent = { t: app.sim.t, count };
          toast("Daftar diteruskan ke Satpol PP / Polres.");
          app.render();
        },
        onUndo() {
          state.sending = false;
          app.render();
        },
      });
    });
  }

  /** Tombol kirim dan catatannya mengikuti state kirim; firstLabel = teks sebelum pernah terkirim. */
  function syncSend(r, all, state, firstLabel) {
    r.send.disabled = all.length === 0 || Boolean(state.sending);
    const fresh = state.sent ? all.length - state.sent.count : all.length;
    setHTML(
      r.send,
      `${icon("send", 16)}${state.sent ? `Kirim pembaruan${fresh > 0 ? ` (${num(fresh)} baru)` : ""}` : esc(firstLabel)}`,
    );
    setText(
      r.sendNote,
      state.sending
        ? "Mengirim… bisa dibatalkan di bilah bawah."
        : state.sent
          ? `Terkirim ${when(state.sent.t)} · ${num(state.sent.count)} kendaraan.`
          : "Daftar dikirim beserta SPBU dan alasan penolakan.",
    );
  }

  function reasonPill(offender) {
    const tone = offender.reason === "kuota habis" ? "warn" : "crit";
    return `<span class="pill tone-${tone}">${shape(tone === "crit" ? "square" : "triangle")}${esc(REASON_LABEL[offender.reason])}</span>`;
  }

  const NO_OFFENDERS = [
    "Belum ada penolakan hari ini",
    "Kunci anti-penimbunan di POS aktif otomatis saat status KRISIS.",
  ];

  function penimbunanPage(state) {
    return {
      title: "Penimbunan",
      mount(el, ctx) {
        el.innerHTML = `
          <article class="panel">
            <header class="panel-head"><h2>${icon("ban", 18)}Kendaraan diduga menimbun</h2><span class="hint">ditolak POS hari ini</span></header>
            <div class="panel-body">
              <div class="toolbar">
                <label class="search">${icon("search", 16)}<input type="search" placeholder="Cari nopol, mis. P 3xxx" aria-label="Cari nopol" data-ref="query"></label>
                <div data-ref="filter"></div>
              </div>
              <div data-ref="table"></div>
              <div data-ref="pager"></div>
            </div>
            <footer class="panel-foot">
              <button type="button" class="btn btn-primary" data-action="send-offenders" data-ref="send">${icon("send", 16)}Teruskan ke Satpol PP</button>
              <span class="note" data-ref="sendNote">Daftar dikirim beserta SPBU dan alasan penolakan.</span>
            </footer>
          </article>`;
        const r = refs(el);
        const app = ctx.app;
        r.query.value = state.query;
        onControls(el, state, app);
        r.query.addEventListener("input", () => {
          state.query = r.query.value;
          state.page = 1;
          app.render();
        });
        bindOffenderSend(el, state, app);

        function update(sim) {
          const all = offendersToday(sim);
          const options = [
            { value: "semua", label: "Semua", count: all.length },
            ...Object.entries(REASON_LABEL).map(([value, label]) => ({
              value,
              label,
              count: all.filter((offender) => offender.reason === value).length,
            })),
          ];
          setHTML(r.filter, ui.filterHTML("reason", options, state.reason));
          const query = state.query.trim().toUpperCase().replace(/\s+/g, " ");
          const list = all.filter(
            (offender) =>
              (state.reason === "semua" || offender.reason === state.reason) &&
              offender.plate.includes(query),
          );
          const pageInfo = ui.paginate(list, state.page, PER_PAGE.offenders);
          state.page = pageInfo.page;
          syncSend(r, all, state, "Teruskan ke Satpol PP");
          if (pageInfo.rows.length === 0) {
            setHTML(
              r.table,
              all.length
                ? emptyHTML(
                    "Tidak ada yang cocok",
                    "Ubah kata kunci atau saringan.",
                  )
                : emptyHTML(...NO_OFFENDERS),
            );
            setHTML(r.pager, "");
            return;
          }
          const rows = pageInfo.rows
            .map((offender) => {
              const spbu = sim.spbu[offender.spbuId];
              return `<tr>
                <td><span class="plate-chip">${esc(offender.plate)}</span></td>
                <td class="nowrap">${esc(spbu.name)}</td>
                <td class="muted">${esc(spbu.kecamatan)}</td>
                <td>${reasonPill(offender)}</td>
                <td class="num"><b>${num(offender.countToday)}×</b></td>
              </tr>`;
            })
            .join("");
          setHTML(
            r.table,
            `<div class="table-wrap"><table class="table"><thead><tr><th>Nopol</th><th>SPBU</th><th>Kecamatan</th><th>Alasan</th><th class="num">Ditolak</th></tr></thead><tbody>${rows}</tbody></table></div>`,
          );
          setHTML(r.pager, ui.pagerHTML(pageInfo, "kendaraan"));
        }
        return { update };
      },
    };
  }

  // ---------- Halaman: Log & SLA ----------

  /** Ikon dan nada tiap jenis kejadian di log. */
  function logStyle(row) {
    if (row.kind === "status") {
      const status = ["KRISIS", "WASPADA", "NORMAL"].find((word) =>
        row.text.includes(word),
      );
      if (status)
        return { tone: STATUS[status].tone, html: shape(STATUS[status].shape) };
      return { tone: "ok", html: icon("check", 14) };
    }
    const icons = {
      sla: "send",
      pos: "lock",
      info: "megaphone",
      policy: "check",
      supply: "truck",
      report: "inbox",
      clarify: "megaphone",
      defer: "pause2",
    };
    return {
      tone: row.kind === "policy" ? "ok" : "brand",
      html: icon(icons[row.kind] || "info", 14),
    };
  }

  const pendingRow = (text) =>
    `<li class="tl-item is-pending"><span class="tl-dot is-pending">${icon("clock", 14)}</span><div><p class="tl-text">${esc(text)}</p><p class="tl-time">menunggu</p></div></li>`;

  function logPage(state) {
    const LOG_FILTERS = [
      { value: "semua", label: "Semua" },
      { value: "status", label: "Status" },
      { value: "kebijakan", label: "Kebijakan" },
      { value: "pasokan", label: "Pasokan" },
      { value: "laporan", label: "Laporan" },
    ];
    return {
      title: "Log keputusan & SLA",
      mount(el, ctx) {
        el.innerHTML = `
          <article class="panel">
            <header class="panel-head"><h2>${icon("log", 18)}Jejak keputusan</h2><span class="hint">terbaru di atas · tercatat otomatis untuk audit</span></header>
            <div class="panel-body">
              <div class="toolbar" data-ref="filter"></div>
              <ol class="timeline" data-ref="log"></ol>
              <div data-ref="pager"></div>
            </div>
          </article>`;
        const r = refs(el);
        onControls(el, state, ctx.app);

        function update(sim) {
          const options = LOG_FILTERS.map((option) => ({
            ...option,
            count:
              option.value === "semua"
                ? sim.log.length
                : sim.log.filter((row) => LOG_GROUP[row.kind] === option.value)
                    .length,
          }));
          setHTML(r.filter, ui.filterHTML("group", options, state.group));
          const rows = sim.log
            .filter(
              (row) =>
                state.group === "semua" || LOG_GROUP[row.kind] === state.group,
            )
            .reverse();
          const pageInfo = ui.paginate(rows, state.page, PER_PAGE.log);
          state.page = pageInfo.page;
          const pending = [];
          if (pageInfo.page === 1 && state.group === "semua") {
            const status = engine.pendingPolicyStatus(sim);
            if (status)
              pending.push(
                pendingRow(`Persetujuan rekomendasi ${status} oleh Pemda`),
              );
            if (sim.diversion && sim.diversion.approvedAt === null)
              pending.push(
                pendingRow("Persetujuan pengalihan pasokan oleh Pertamina"),
              );
          }
          const items = pageInfo.rows.map((row) => {
            const style = logStyle(row);
            return `<li class="tl-item"><span class="tl-dot tone-${style.tone}">${style.html}</span><div><p class="tl-text">${esc(row.text)}</p><p class="tl-time">${esc(when(row.t))}</p></div></li>`;
          });
          const html = [...pending, ...items].join("");
          setHTML(
            r.log,
            html ||
              '<li class="note">Belum ada kejadian. Sistem memantau tiap 15 menit.</li>',
          );
          setHTML(
            r.pager,
            pageInfo.total ? ui.pagerHTML(pageInfo, "kejadian") : "",
          );
        }
        return { update };
      },
    };
  }

  // ---------- Aplikasi ----------

  function mount(host, app) {
    // Status bersama halaman; bertahan saat pindah halaman, hilang saat simulasi diulang.
    const state = {
      unchecked: new Set(),
      editing: false,
      deferred: null,
      spbu: { klass: "semua", kec: "semua", page: 1 },
      offenders: { query: "", reason: "semua", page: 1 },
      log: { group: "semua", page: 1 },
    };
    return shell.mount(host, app, {
      role: "pemda",
      org: "Pemkab Jember",
      user: { initials: "BP", name: "Bagian Perekonomian" },
      groups: [
        {
          label: "Pemantauan",
          items: [
            { id: "ringkasan", label: "Ringkasan", icon: "dashboard" },
            { id: "peta", label: "Peta SPBU", icon: "map" },
            { id: "proyeksi", label: "Proyeksi stok", icon: "chart" },
          ],
        },
        {
          label: "Tindakan",
          items: [
            { id: "rekomendasi", label: "Rekomendasi", icon: "clipboard" },
            { id: "penimbunan", label: "Penimbunan", icon: "ban" },
            { id: "log", label: "Log & SLA", icon: "log" },
          ],
        },
      ],
      pages: {
        ringkasan: ringkasanPage(),
        peta: petaPage(state.spbu),
        proyeksi: proyeksiPage(),
        rekomendasi: rekomendasiPage(state),
        penimbunan: penimbunanPage(state.offenders),
        log: logPage(state.log),
      },
      badges(sim) {
        const pending = engine.pendingPolicyStatus(sim);
        return {
          rekomendasi: pending
            ? ews.recommendations(pending, sim.cfg).length
            : 0,
          penimbunan: offendersToday(sim).length,
        };
      },
    });
  }

  ns.views = ns.views || {};
  // Bagian yang dipakai ulang tata letak wireframe (wf-pemda.js).
  ns.views.pemda = {
    mount,
    shell: true,
    parts: {
      MAP_VIEW,
      FILTER_FIELDS,
      legendItems,
      mountMap,
      kecFilter,
      bindKecamatan,
      emptyHTML,
      offendersToday,
      criticalTone,
      ratioValue,
      ratioKpi,
      demandKpi,
      drawProjection,
      recommendationsView,
      bindRecActions,
      bindOffenderSend,
      syncSend,
      reasonPill,
      NO_OFFENDERS,
    },
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
