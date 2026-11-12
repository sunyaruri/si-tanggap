// Pusat kendali distribusi Pertamina regional: aplikasi bermenu di atas kerangka shell.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, sim: engine, charts, maps, config } = ns;
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
    clock,
    dayName,
    span,
    kpi,
    toast,
    paginate,
    pagerHTML,
    filterHTML,
    STATUS,
  } = ui;
  const PROJECTION_DAYS = 7;
  const BAR_MAX_DAYS = 8;
  const MAX_REPORTS = 3;
  const MAX_ANOMALIES = 2;
  const ANOMALY_MIN_COUNT = 4;
  const SOON_HOURS = 6;
  const MAP_TRUCKS = 6;
  const ARMADA_PAGE_SIZE = 10;
  const TERMINAL_WORD = {
    NORMAL: "aman",
    WASPADA: "waspada",
    KRISIS: "KRISIS",
  };
  const QUOTA_LABELS = {
    motor: "Sepeda motor",
    mobil: "Mobil pribadi",
    niaga: "Kendaraan niaga",
  };
  const TERMINAL_SHORT = Object.fromEntries(
    config.terminals.map((terminal) => [
      terminal.id,
      terminal.name.replace("TBBM ", ""),
    ]),
  );
  const ROUTE_LABEL = {
    gumitir: "Gumitir",
    alternatif: "Alternatif",
    malang: "Lintas Malang",
    surabaya: "Lintas Surabaya",
  };
  const TONE_COLOR = {
    ok: "var(--ok)",
    warn: "var(--warn)",
    crit: "var(--crit)",
  };

  const quotaField = (key) =>
    `<label class="field" for="quota-${key}">${QUOTA_LABELS[key]}<span class="input-wrap"><input id="quota-${key}" name="${key}" type="number" min="1" max="200" step="1" inputmode="numeric"><span>L / hari</span></span></label>`;

  /** Kartu panel; `title` adalah HTML statis dari template ini, bukan data. */
  const panel = ({ iconName, title, hint = "", link, body, foot = "" }) =>
    `<article class="panel">
      <header class="panel-head"><h2>${icon(iconName, 17)}${title}</h2>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}${link ? `<a class="link" href="#pertamina/${link.page}">${esc(link.label)} →</a>` : ""}</header>
      <div class="panel-body">${body}</div>
      ${foot ? `<footer class="panel-foot">${foot}</footer>` : ""}
    </article>`;

  function terminalStatus(days) {
    const th = config.terminalDays;
    if (days < th.crisis) return "KRISIS";
    return days < th.low ? "WASPADA" : "NORMAL";
  }

  const waitingDiversion = (sim) =>
    Boolean(sim.diversion && sim.diversion.approvedAt === null);

  /** Sisa waktu tiba truk; "sekarang" bila sudah di tujuan pada jam ini. */
  const arrivesIn = (sim, truck) =>
    truck.etaAt - sim.t < 1 / 60 ? "sekarang" : span(truck.etaAt - sim.t);

  const divertedTrucks = (sim) =>
    sim.trucks.filter(
      (truck) => truck.route === "malang" || truck.route === "surabaya",
    );

  /** Bilah ketahanan stok tiap terminal; `compact` tanpa catatan neraca. */
  function terminalsHTML(sim, { compact = false } = {}) {
    const th = config.terminalDays;
    const disrupted = engine.isDisrupted(sim);
    return sim.terminals
      .map((terminal, index) => {
        const base = config.terminals[index];
        const status = terminalStatus(terminal.days);
        const width =
          (Math.min(terminal.days, BAR_MAX_DAYS) / BAR_MAX_DAYS) * 100;
        const notes = [];
        if (base.primary && disrupted)
          notes.push(
            `<span class="pill tone-crit">${icon("route", 13)}Jalur Gumitir terganggu</span>`,
          );
        if (terminal.divertKLday > 0)
          notes.push(
            `<span class="chip">${icon("truck", 13)}Dialihkan ${num(terminal.divertKLday)} KL/hari ke Jember</span>`,
          );
        const net = terminal.netKLday;
        notes.push(
          `<span class="chip">Neraca ${net >= 0 ? "+" : "−"}${num(Math.abs(net))} KL/hari</span>`,
        );
        return `<div class="term">
          <div class="term-top">
            <span class="term-name">${icon("warehouse", 16)}${esc(terminal.name)}</span>
            ${pill(status, { label: TERMINAL_WORD[status] })}
            <span class="term-days">${num(terminal.days, 1)} <small>hari</small></span>
          </div>
          <div class="meter" title="Ketahanan stok (hari); garis = ambang ${num(th.crisis, 1)} dan ${num(th.low)} hari">
            <span class="fill" style="width:${width.toFixed(1)}%;background:${TONE_COLOR[STATUS[status].tone]}"></span>
            <span class="tick" style="left:${((th.crisis / BAR_MAX_DAYS) * 100).toFixed(1)}%"></span>
            <span class="tick" style="left:${((th.low / BAR_MAX_DAYS) * 100).toFixed(1)}%"></span>
          </div>
          ${compact ? "" : `<div class="term-meta">${notes.join("")}</div>`}
        </div>`;
      })
      .join("");
  }

  /** Kata stok terminal dari ketahanan (hari), memakai ambang config.terminalDays. */
  function stockWord(days) {
    const th = config.terminalDays;
    if (days < th.low) return "rendah";
    return days < th.high ? "sedang" : "tinggi";
  }

  /** Tabel ringkas stok terminal: Terminal / Stok / Hari cukup / Jalur / Status. */
  function terminalTableHTML(sim) {
    const disrupted = engine.isDisrupted(sim);
    const rows = sim.terminals
      .map((terminal, index) => {
        const status = terminalStatus(terminal.days);
        const blocked = config.terminals[index].primary && disrupted;
        return `<tr>
          <td class="is-strong">${esc(terminal.name)}</td>
          <td>${stockWord(terminal.days)}</td>
          <td class="num">${num(terminal.days, 1)} hari</td>
          <td>${blocked ? `<span class="pill tone-crit">${shape("square")}Gumitir terganggu</span>` : "normal"}</td>
          <td>${pill(status, { label: TERMINAL_WORD[status] })}</td>
        </tr>`;
      })
      .join("");
    return `<table class="table"><thead><tr><th>Terminal</th><th>Stok</th><th class="num">Hari cukup</th><th>Jalur</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function drawTerminalProjection(el, sim, height) {
    const series = sim.terminals.map((terminal, index) => {
      const outKLday = config.terminals[index].outKLday;
      const points = [];
      for (let day = 0; day <= PROJECTION_DAYS; day++) {
        points.push([
          day,
          Math.max(0, terminal.stockKL + terminal.netKLday * day) / outKLday,
        ]);
      }
      return {
        name: TERMINAL_SHORT[terminal.id],
        color: ui.seriesColor(index),
        points,
      };
    });
    charts.line(el, {
      series,
      xTicks: Array.from({ length: PROJECTION_DAYS + 1 }, (_, day) => ({
        x: day,
        label: day === 0 ? "kini" : `H+${day}`,
      })),
      xTitle: "Hari ke depan",
      xFormat: (day) => (day === 0 ? "Kini" : `H+${day}`),
      yFormat: (value) => `${num(value, 1)} hari`,
      levels: [{ y: config.terminalDays.crisis, label: "ambang krisis" }],
      height,
      endLabels: true,
      ariaLabel: "Proyeksi ketahanan stok tiap terminal 7 hari ke depan",
    });
  }

  /** Banner ringkasan: teks polos, penyebab lalu langkah berikutnya. */
  function bannerHTML(sim) {
    const region = sim.region;
    if (region.status === "NORMAL") return "";
    const disrupted = engine.isDisrupted(sim);
    const criticalFact = {
      icon: "fuel",
      text: `${num(region.criticalCount)} SPBU stok di bawah 6 jam`,
    };
    if (region.status === "WASPADA") {
      return ui.statusBanner({
        status: "WASPADA",
        since:
          sim.marks.waspadaAt === null
            ? ""
            : `sejak ${when(sim.marks.waspadaAt)}`,
        title: "Kab. Jember waspada pasokan",
        text: disrupted
          ? "Jalur Gumitir terganggu sehingga truk butuh waktu lebih lama. Pastikan jadwal kirim dari Tanjungwangi tetap jalan."
          : "Stok SPBU turun lebih cepat dari biasanya. Pastikan jadwal kirim dari Tanjungwangi tetap jalan.",
        facts: [criticalFact],
      });
    }
    const since = `sejak ${when(sim.marks.krisisAt ?? sim.t)}`;
    const diversion = sim.diversion;
    if (diversion && diversion.approvedAt === null) {
      return ui.statusBanner({
        status: "KRISIS",
        since,
        title: "Pemda Jember meminta pengalihan pasokan",
        text: "Pasokan dari Tanjungwangi tertahan karena jalur Gumitir terganggu. Setujui pengalihan agar truk tambahan berangkat.",
        facts: [
          {
            icon: "fuel",
            text: `Butuh ${num(diversion.deficitKLday)} KL per hari`,
          },
          { icon: "truck", text: `${num(diversion.trucks)} truk tambahan` },
        ],
        action: `<a class="btn" href="#pertamina/pengalihan">Tinjau pengalihan</a>`,
      });
    }
    if (diversion) {
      const upcoming = divertedTrucks(sim)
        .map((truck) => truck.etaAt)
        .filter((eta) => eta > sim.t);
      const next = upcoming.length ? Math.min(...upcoming) : null;
      return ui.statusBanner({
        status: "KRISIS",
        since,
        title: "Pengalihan pasokan sedang berjalan",
        text: "Truk tambahan dari terminal cadangan sedang menuju Jember. Pantau kedatangannya di halaman armada.",
        facts: [
          {
            icon: "truck",
            text: `${num(divertedTrucks(sim).length)} truk pengalihan di jalan`,
          },
        ],
        deadline:
          next === null
            ? undefined
            : {
                label: "Truk tambahan berikutnya tiba",
                value: clock(next),
                note: dayName(next),
              },
        action: `<a class="btn" href="#pertamina/armada">Lihat armada</a>`,
      });
    }
    return ui.statusBanner({
      status: "KRISIS",
      since,
      title: "Kab. Jember krisis pasokan",
      text: disrupted
        ? "Jalur Gumitir terganggu sehingga truk dari Tanjungwangi terlambat. Siapkan terminal cadangan sambil menunggu permintaan Pemda."
        : "Stok SPBU diperkirakan habis sebelum truk tiba. Siapkan terminal cadangan sambil menunggu permintaan Pemda.",
      facts: [criticalFact],
      action: `<a class="btn" href="#pertamina/terminal">Lihat terminal</a>`,
    });
  }

  function inboxItems(sim) {
    const items = [];
    const diversion = sim.diversion;
    if (diversion) {
      const waiting = diversion.approvedAt === null;
      items.push({
        kind: "request",
        unread: waiting,
        icon: "landmark",
        tone: waiting ? "" : "is-neutral",
        title: "Pemda Kab. Jember meminta pengalihan pasokan",
        text: `${num(diversion.deficitKLday)} KL per hari, ${waiting ? "menunggu persetujuan" : "sudah disetujui"}`,
        t: diversion.requestedAt,
      });
    }
    const anomalies = sim.speculators
      .filter((offender) => offender.countToday >= ANOMALY_MIN_COUNT)
      .sort((a, b) => b.countToday - a.countToday)
      .slice(0, MAX_ANOMALIES);
    for (const offender of anomalies) {
      items.push({
        kind: "anomaly",
        unread: true,
        icon: "alert",
        tone: "tone-crit",
        title: `Anomali: ${offender.plate} ditolak ${num(offender.countToday)}× hari ini`,
        text: `SPBU ${sim.spbu[offender.spbuId].name}, alasan ${offender.reason}`,
        t: null,
      });
    }
    for (const report of sim.reports.slice(-MAX_REPORTS).reverse()) {
      items.push({
        kind: "report",
        unread: true,
        icon: "megaphone",
        tone: "is-neutral",
        title: `Laporan warga: ${report.type}`,
        text: report.text,
        t: report.t,
      });
    }
    return items;
  }

  function inboxHTML(items) {
    if (items.length === 0) {
      return `<li class="empty"><span class="empty-icon">${icon("inbox", 20)}</span><strong>Kotak masuk kosong</strong><span class="note">Permintaan Pemda, anomali transaksi, dan laporan warga akan muncul di sini.</span></li>`;
    }
    return items
      .map(
        (
          item,
        ) => `<li class="inbox-item ${item.tone}"><span class="inbox-icon">${icon(item.icon, 17)}</span><div>
          <p class="inbox-title">${esc(item.title)}</p>
          <p class="inbox-text">${esc(item.text)}</p>
          ${item.t === null ? "" : `<p class="inbox-time">${esc(when(item.t))}</p>`}
        </div></li>`,
      )
      .join("");
  }

  /** Penanda status kecil (bentuk + warna) di depan angka. */
  const statusMark = (status) =>
    `<span class="st st-${STATUS[status].tone}">${shape(STATUS[status].shape)}</span>`;

  // ---------- Bagian bersama (dipakai halaman ini dan versi wireframe) ----------

  /** KPI wilayah dan permintaan; `r` dari refs() atas markup kpi() ber-ref krisis/waspada/trucks/request. */
  function updateRegionKpis(r, sim) {
    // Prototipe memantau satu wilayah (Kab. Jember); platform nyata menjumlahkan semua kabupaten.
    const status = sim.region.status;
    setText(r.krisis, status === "KRISIS" ? "1" : "0");
    r.krisisCard.dataset.tone = status === "KRISIS" ? "crit" : "";
    setText(r.waspada, status === "WASPADA" ? "1" : "0");
    r.waspadaCard.dataset.tone = status === "WASPADA" ? "warn" : "";
    setText(r.trucks, num(sim.trucks.length));

    const waiting = waitingDiversion(sim);
    setText(r.request, waiting ? "1" : "0");
    setText(
      r.requestSub,
      waiting
        ? "menunggu persetujuan"
        : sim.diversion
          ? "sudah disetujui"
          : "tidak ada yang menunggu",
    );
    r.requestCard.dataset.tone = waiting ? "warn" : "";
  }

  /** Peta regional: jalur, truk, kapal tanker, terminal, dan penanda status Kab. Jember. */
  function regionMap(el) {
    const map = maps.create(el, { center: [-7.85, 113.5], zoom: 8 });
    const layers = [];
    let regionMarker = null;
    if (map) {
      layers.push(
        maps.routeLayer(map, config),
        maps.truckLayer(map),
        maps.tankerLayer(map, config),
      );
      maps.terminalLayer(map, config);
      regionMarker = L.marker(config.hub, {
        icon: maps.divIcon("", "", 26),
        keyboard: false,
        zIndexOffset: 900,
      })
        .bindTooltip("Kab. Jember", {
          permanent: true,
          direction: "bottom",
          offset: [0, 12],
          className: "tip-label",
        })
        .addTo(map);
    }
    return {
      update(sim) {
        const status = sim.region.status;
        if (regionMarker && regionMarker.__status !== status) {
          regionMarker.__status = status;
          regionMarker.setIcon(
            maps.divIcon(
              `mk-${STATUS[status].tone}`,
              shape(STATUS[status].shape),
              26,
            ),
          );
        }
        for (const layer of layers) layer(sim);
      },
      destroy() {
        if (map) map.remove();
      },
    };
  }

  /**
   * Tombol [data-action="approve-diversion"] di dalam `el`: setujui pengalihan dengan jendela Batalkan.
   * @returns {() => boolean} apakah persetujuan sedang menunggu jendela Batalkan
   */
  function bindDiversionApproval(el, app) {
    let approving = false;
    el.addEventListener("click", (event) => {
      if (
        event.target.closest("[data-action]")?.dataset.action !==
        "approve-diversion"
      )
        return;
      if (approving) return;
      approving = true;
      app.render();
      ui.undoable({
        text: "Pengalihan disetujui, perintah kirim ke terminal",
        seconds: 8,
        onCommit() {
          approving = false;
          if (engine.approveDiversion(app.sim))
            toast(
              "Pengalihan disetujui. Perintah kirim diteruskan ke terminal.",
            );
          app.render();
        },
        onUndo() {
          approving = false;
          app.render();
        },
      });
    });
    return () => approving;
  }

  /**
   * Form kuota krisis: isi dari simulasi, validasi, lalu terapkan setelah jendela Batalkan.
   * Kunci kuota tanpa input di form (mis. niaga di wireframe) memakai nilai yang berlaku.
   */
  function bindQuotaForm(form, app, errorEl) {
    const keys = Object.keys(config.quota);
    const fields = form.elements;
    const fill = () => {
      for (const key of keys)
        if (fields[key]) fields[key].value = app.sim.crisisMode.quota[key];
    };
    fill();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const quota = {};
      for (const key of keys)
        quota[key] = fields[key]
          ? Number(fields[key].value)
          : app.sim.crisisMode.quota[key];
      // Validasi saja di sini; kuota baru diterapkan setelah jendela Batalkan habis.
      const valid = Object.values(quota).every(
        (liters) => Number.isInteger(liters) && liters >= 1 && liters <= 200,
      );
      if (!valid) {
        errorEl.textContent = "Isi tiap kuota dengan angka bulat 1–200.";
        return;
      }
      errorEl.textContent = "";
      ui.undoable({
        text: `Kuota ${quota.motor}/${quota.mobil}/${quota.niaga} L diterapkan ke semua POS`,
        seconds: 6,
        onCommit() {
          engine.setCrisisQuota(app.sim, quota);
          toast("Kuota krisis diterapkan ke semua POS wilayah.");
          app.render();
        },
        onUndo: fill,
      });
    });
  }

  /**
   * Tombol [data-action="forward"] di dalam `el`: teruskan temuan ke tim audit / Satgas dengan jendela Batalkan.
   * @returns {{ forwarding: () => boolean, note: () => string }}
   */
  function bindForward(el, app, button) {
    let forwarding = false;
    let forwardedAt = null;
    el.addEventListener("click", (event) => {
      if (event.target.closest("[data-action]")?.dataset.action !== "forward")
        return;
      if (forwarding) return;
      forwarding = true;
      button.disabled = true;
      ui.undoable({
        text: "Temuan diteruskan ke tim audit / Satgas",
        seconds: 6,
        onCommit() {
          forwarding = false;
          engine.logEvent(
            app.sim,
            "report",
            "Temuan diteruskan ke tim audit / Satgas",
          );
          forwardedAt = app.sim.t;
          toast("Temuan diteruskan ke tim audit dan Satgas.");
          app.render();
        },
        onUndo() {
          forwarding = false;
          button.disabled = false;
        },
      });
    });
    return {
      forwarding: () => forwarding,
      note: () =>
        forwarding
          ? "Mengirim… bisa dibatalkan di bilah bawah."
          : forwardedAt !== null
            ? `Terakhir diteruskan ${when(forwardedAt)}.`
            : "Tim audit dan Satgas BBM menerima salinannya.",
    };
  }

  // ---------- Halaman ----------

  function ringkasanPage(el) {
    el.innerHTML = `
      <div data-ref="banner"></div>
      <section class="kpis" aria-label="Ringkasan regional">
        ${kpi({ ref: "krisis", label: "Wilayah KRISIS", iconName: "alert", sub: "dari 1 wilayah dipantau" })}
        ${kpi({ ref: "waspada", label: "Wilayah WASPADA", iconName: "bell", sub: "dari 1 wilayah dipantau" })}
        ${kpi({ ref: "trucks", label: "Truk tangki di jalan", iconName: "truck", sub: "menuju SPBU Kab. Jember" })}
        ${kpi({ ref: "request", label: "Permintaan Pemda menunggu", iconName: "landmark" })}
        ${kpi({ ref: "sla", label: "Respons ke permintaan Pemda", iconName: "clock" })}
      </section>
      <div class="cols cols-2-1">
        ${panel({ iconName: "warehouse", title: "Stok terminal", hint: "ketahanan dalam hari", link: { page: "terminal", label: "Detail" }, body: '<div class="terms" data-ref="terminals"></div>' })}
        ${panel({ iconName: "bell", title: "Perlu tindakan", body: '<div class="todo-list" data-ref="todo"></div>' })}
      </div>`;
    const r = refs(el);

    function todoHTML(sim) {
      const waiting = waitingDiversion(sim);
      const soon = sim.trucks.filter(
        (truck) => truck.etaAt - sim.t <= SOON_HOURS,
      ).length;
      const rows = [
        {
          page: "pengalihan",
          icon: "route",
          title: "Pengalihan pasokan",
          note: waiting
            ? "menunggu persetujuan Anda"
            : sim.diversion
              ? "sudah disetujui"
              : "belum ada permintaan Pemda",
          count: num(waiting ? 1 : 0),
        },
        {
          page: "inbox",
          icon: "inbox",
          title: "Kotak masuk",
          note: "permintaan, anomali, dan laporan warga",
          count: num(inboxItems(sim).filter((item) => item.unread).length),
        },
        {
          page: "kuota",
          icon: "sliders",
          title: "Kuota krisis POS",
          note: sim.crisisMode.active
            ? `aktif sejak ${when(sim.crisisMode.since)}`
            : "belum aktif",
          count: sim.crisisMode.active ? "aktif" : "–",
        },
        {
          page: "armada",
          icon: "truck",
          title: "Truk tiba dalam 6 jam",
          note: "menuju SPBU Kab. Jember",
          count: num(soon),
        },
      ];
      return rows
        .map(
          (row) =>
            `<a class="todo" href="#pertamina/${row.page}">${icon(row.icon, 20)}<span><b>${esc(row.title)}</b><small>${esc(row.note)}</small></span>${String(row.count) === "0" ? "" : `<span class="count-box">${esc(row.count)}</span>`}</a>`,
        )
        .join("");
    }

    return {
      update(sim) {
        const banner = bannerHTML(sim);
        r.banner.hidden = banner === "";
        setHTML(r.banner, banner);

        updateRegionKpis(r, sim);

        // SLA milik Pertamina: waktu dari permintaan pengalihan Pemda sampai disetujui (target bersama < 24 jam).
        const diversion = sim.diversion;
        const target = sim.cfg.slaHours.KRISIS;
        if (!diversion) {
          setText(r.sla, "–");
          setText(r.slaSub, "belum ada permintaan Pemda");
          r.slaCard.dataset.tone = "";
        } else if (diversion.approvedAt === null) {
          setText(r.sla, span(sim.t - diversion.requestedAt));
          setText(r.slaSub, `menunggu sejak ${when(diversion.requestedAt)}`);
          r.slaCard.dataset.tone = "warn";
        } else {
          const took = diversion.approvedAt - diversion.requestedAt;
          setText(r.sla, span(took));
          setText(
            r.slaSub,
            took <= target
              ? `tepat SLA, target < ${num(target)} jam`
              : `melewati target ${num(target)} jam`,
          );
          r.slaCard.dataset.tone = took <= target ? "" : "crit";
        }

        setHTML(r.terminals, terminalsHTML(sim, { compact: true }));
        setHTML(r.todo, todoHTML(sim));
      },
    };
  }

  function petaPage(el, { app }) {
    el.innerHTML = `
      <div class="cols cols-map">
        <article class="panel">
          <header class="panel-head">
            <h2>${icon("map", 17)}Peta terminal &amp; armada</h2>
            <div class="panel-tools" data-ref="region"></div>
          </header>
          <div class="panel-body">
            <div class="map-wrap">
              <div class="map map-xl" data-ref="map"></div>
              ${maps.legend([
                ui.legendItem(ui.marker("ok", "circle"), "Wilayah normal"),
                ui.legendItem(ui.marker("warn", "triangle"), "Waspada"),
                ui.legendItem(ui.marker("crit", "square"), "Krisis"),
                ui.legendItem(
                  ui.marker("terminal", "diamond"),
                  "TBBM / terminal",
                ),
                ui.legendItem(ui.truckMark(), "Truk tangki"),
                ui.legendItem(
                  `<span class="mk mk-ship">${icon("ship", 11)}</span>`,
                  "Kapal tanker",
                ),
                '<span class="legend-item"><span class="legend-line is-dashed" style="border-color:var(--crit)"></span>Jalur terganggu</span>',
              ])}
            </div>
          </div>
        </article>
        <div class="side-stack">
          ${panel({ iconName: "warehouse", title: "Terminal", body: '<div class="risk-list" data-ref="terminals"></div>' })}
          ${panel({ iconName: "truck", title: "Truk menuju Jember", hint: "tiba paling awal", body: '<div class="risk-list" data-ref="trucks"></div>', foot: '<a class="link" href="#pertamina/armada">Lihat semua armada →</a>' })}
        </div>
      </div>`;
    const r = refs(el);

    const map = regionMap(r.map);

    function terminalRows(sim) {
      return sim.terminals
        .map((terminal) => {
          const status = terminalStatus(terminal.days);
          const net = terminal.netKLday;
          return `<div class="risk-row">${icon("warehouse", 18)}<span><b>${esc(terminal.name)}</b><small>neraca ${net >= 0 ? "+" : "−"}${num(Math.abs(net))} KL per hari</small></span><span class="value">${statusMark(status)}${num(terminal.days, 1)} hari</span></div>`;
        })
        .join("");
    }

    function truckRows(sim) {
      const list = [...sim.trucks].sort((a, b) => a.etaAt - b.etaAt);
      if (list.length === 0)
        return '<p class="note">Tidak ada truk di jalan saat ini.</p>';
      const rows = list
        .slice(0, MAP_TRUCKS)
        .map(
          (truck) =>
            `<div class="risk-row">${icon("truck", 18)}<span><b>Dari ${esc(TERMINAL_SHORT[truck.from] || truck.from)}</b><small>ke ${esc(sim.spbu[truck.to].name)}, tiba ${esc(when(truck.etaAt))}</small></span><span class="value">${esc(arrivesIn(sim, truck))}</span></div>`,
        )
        .join("");
      const rest = list.length - MAP_TRUCKS;
      return rest > 0
        ? `${rows}<p class="note">${num(rest)} truk lain di jalan.</p>`
        : rows;
    }

    return {
      update(sim) {
        const status = sim.region.status;
        setHTML(
          r.region,
          `<span class="chip">Kab. Jember</span>${pill(status)}`,
        );
        setHTML(r.terminals, terminalRows(sim));
        setHTML(r.trucks, truckRows(sim));
        map.update(sim);
      },
      destroy: map.destroy,
    };
  }

  function terminalPage(el) {
    el.innerHTML = `
      <div class="cols cols-1-1">
        ${panel({ iconName: "warehouse", title: "Ketahanan stok terminal", hint: "garis = ambang 1,5 dan 2 hari", body: '<div class="terms" data-ref="terminals"></div>' })}
        ${panel({ iconName: "chart", title: "Proyeksi 7 hari ke depan", hint: "ketahanan stok dalam hari", body: '<div data-ref="projection"></div>' })}
      </div>
      ${panel({ iconName: "database", title: "Neraca terminal", hint: "per hari, termasuk volume yang dialihkan", body: '<div class="table-wrap" data-ref="table"></div>' })}`;
    const r = refs(el);

    function tableHTML(sim) {
      const rows = sim.terminals
        .map((terminal) => {
          const status = terminalStatus(terminal.days);
          const net = terminal.netKLday;
          return `<tr>
            <td class="is-strong">${esc(terminal.name)}</td>
            <td>${pill(status, { label: TERMINAL_WORD[status] })}</td>
            <td class="num">${num(terminal.stockKL)} KL</td>
            <td class="num">${num(terminal.days, 1)} hari</td>
            <td class="num">${net >= 0 ? "+" : "−"}${num(Math.abs(net))} KL</td>
            <td class="num">${terminal.divertKLday > 0 ? `${num(terminal.divertKLday)} KL` : "–"}</td>
          </tr>`;
        })
        .join("");
      return `<table class="table"><thead><tr><th>Terminal</th><th>Status</th><th class="num">Stok</th><th class="num">Ketahanan</th><th class="num">Neraca</th><th class="num">Dialihkan ke Jember</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    return {
      update(sim) {
        setHTML(r.terminals, terminalsHTML(sim));
        drawTerminalProjection(r.projection, sim, 250);
        setHTML(r.table, tableHTML(sim));
      },
    };
  }

  function armadaPage(el, { app }, state) {
    el.innerHTML = panel({
      iconName: "truck",
      title: "Truk tangki di jalan",
      hint: "diurutkan dari yang tiba paling awal",
      body: `<div class="toolbar" data-ref="toolbar"></div><div class="table-wrap" data-ref="table"></div><div data-ref="pager"></div>`,
    });
    const r = refs(el);

    el.addEventListener("click", (event) => {
      const filter = event.target.closest("[data-filter]");
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (filter) {
        state.armadaFilter = filter.dataset.value;
        state.armadaPage = 1;
      } else if (action === "page-prev") state.armadaPage -= 1;
      else if (action === "page-next") state.armadaPage += 1;
      else return;
      app.render();
    });

    return {
      update(sim) {
        const all = [...sim.trucks].sort((a, b) => a.etaAt - b.etaAt);
        const options = [
          { value: "semua", label: "Semua", count: all.length },
          ...config.terminals.map((terminal) => ({
            value: terminal.id,
            label: TERMINAL_SHORT[terminal.id],
            count: all.filter((truck) => truck.from === terminal.id).length,
          })),
        ];
        setHTML(
          r.toolbar,
          `<span class="note">Asal terminal</span>${filterHTML("asal", options, state.armadaFilter)}`,
        );
        const list =
          state.armadaFilter === "semua"
            ? all
            : all.filter((truck) => truck.from === state.armadaFilter);
        const pageData = paginate(list, state.armadaPage, ARMADA_PAGE_SIZE);
        state.armadaPage = pageData.page;
        if (list.length === 0) {
          setHTML(
            r.table,
            '<p class="note">Tidak ada truk dari terminal ini yang sedang di jalan.</p>',
          );
          setHTML(r.pager, "");
          return;
        }
        const rows = pageData.rows
          .map(
            (truck) => `<tr>
              <td class="is-strong">T-${String(truck.id).padStart(3, "0")}</td>
              <td>${esc(TERMINAL_SHORT[truck.from] || truck.from)}</td>
              <td>${esc(sim.spbu[truck.to].name)}</td>
              <td class="muted">${esc(ROUTE_LABEL[truck.route] || truck.route)}</td>
              <td class="num">${num(truck.volumeKL)} KL</td>
              <td class="nowrap">${esc(when(truck.etaAt))}</td>
              <td class="num">${esc(arrivesIn(sim, truck))}</td>
            </tr>`,
          )
          .join("");
        setHTML(
          r.table,
          `<table class="table"><thead><tr><th>Truk</th><th>Asal</th><th>Tujuan</th><th>Jalur</th><th class="num">Muatan</th><th>Tiba</th><th class="num">Sisa waktu</th></tr></thead><tbody>${rows}</tbody></table>`,
        );
        setHTML(r.pager, pagerHTML(pageData, "truk"));
      },
    };
  }

  /** Stok terminal donor sekarang → sesudah pengalihan, dalam hari ketahanan. */
  function donorChip(sim, item) {
    const index = config.terminals.findIndex(
      (terminal) => terminal.id === item.terminalId,
    );
    const terminal = sim.terminals[index];
    const base = config.terminals[index];
    if (!terminal || !base) return "";
    const after = terminal.stockKL / (base.outKLday + item.kLday);
    return `<span class="chip">stok ${esc(TERMINAL_SHORT[item.terminalId] || item.name)} <b>${num(terminal.days, 1)} → ${num(after, 1)} hari</b></span>`;
  }

  /** Perlombaan yang diputuskan dispatcher: truk pengalihan pertama vs stok SPBU Jember habis. */
  function raceHTML(sim, diversion) {
    const fastest = Math.min(...diversion.plan.map((item) => item.leadHours));
    const outlook = engine.stockOutlook(sim);
    const arrive =
      diversion.approvedAt === null
        ? sim.t + fastest
        : diversion.approvedAt + fastest;
    const empty = outlook.emptyIn === null ? null : sim.t + outlook.emptyIn;
    const lines = [`Truk pengalihan pertama tiba ≈ ${when(arrive)}`];
    lines.push(
      empty === null
        ? "Stok SPBU Jember tidak habis dalam 48 jam"
        : `Stok SPBU Jember habis ≈ ${when(empty)}`,
    );
    return `<div class="basis"><span class="basis-title">Bila disetujui sekarang</span>${lines.map((text) => `<span class="chip">${esc(text)}</span>`).join("")}</div>`;
  }

  function pengalihanPage(el, { app }) {
    const spare = config.terminals.filter((terminal) => !terminal.primary);
    el.innerHTML = `
      <div class="cols cols-2-1">
        ${panel({ iconName: "route", title: "Rencana pengalihan pasokan", hint: "terminal dengan waktu tiba tercepat didahulukan", body: '<div class="route-plan" data-ref="plan"></div>', foot: '<div class="foot-row" data-ref="foot"></div>' })}
        ${panel({
          iconName: "warehouse",
          title: "Terminal cadangan",
          body: `<div class="risk-list">${spare
            .map(
              (terminal) =>
                `<div class="risk-row">${icon("warehouse", 18)}<span><b>${esc(terminal.name)}</b><small>cadangan ${num(terminal.spareKLday)} KL per hari</small></span><span class="value">tiba ±${num(terminal.leadHours)} jam</span></div>`,
            )
            .join(
              "",
            )}</div><p class="note">Pengalihan menambah biaya angkut, jadi hanya dipakai saat Pemda mengajukannya pada status KRISIS.</p>`,
        })}
      </div>`;
    const r = refs(el);
    const approving = bindDiversionApproval(el, app);

    function view(sim) {
      const diversion = sim.diversion;
      if (!diversion) {
        return {
          body: `<div class="empty"><span class="empty-icon">${icon("route", 20)}</span><strong>Belum ada permintaan pengalihan</strong><span class="note">Rencana disusun otomatis saat Pemda meminta pengalihan pada status KRISIS.</span></div>`,
          foot: '<span class="note">Pemasok cadangan: TBBM Malang dan TBBM Surabaya Group.</span>',
        };
      }
      if (diversion.plan.length === 0) {
        return {
          body: '<div class="empty"><strong>Pasokan utama masih cukup</strong><span class="note">Tidak ada volume yang perlu dialihkan.</span></div>',
          foot: "",
        };
      }
      const cards = diversion.plan
        .map(
          (item) => `<div class="route-card">
            <div class="route-line">${icon("warehouse", 16)}${esc(item.name)}${icon("arrow", 16)}Kab. Jember</div>
            <div class="route-chips">
              ${donorChip(sim, item)}
              <span class="chip"><b>${num(item.kLday)}</b>KL per hari</span>
              <span class="chip">${icon("clock", 13)}tiba<b>±${num(item.leadHours)} jam</b></span>
              <span class="chip">biaya <b>+${num(item.costPct)}%</b></span>
            </div>
          </div>`,
        )
        .join("");
      const body = `<div class="plan-need"><b>Jember butuh tambahan ${num(diversion.deficitKLday)} KL per hari</b><span class="note">Perlu ${num(diversion.trucks)} truk tangki tambahan.</span></div>${raceHTML(sim, diversion)}${cards}`;
      const foot =
        diversion.approvedAt === null
          ? `<button type="button" class="btn btn-primary" data-action="approve-diversion"${approving() ? " disabled" : ""}>${icon("check", 17)}Setujui pengalihan</button><span class="note">${approving() ? "Dikirim dalam beberapa detik. Bisa dibatalkan di bilah bawah." : `Diminta Pemda ${esc(when(diversion.requestedAt))} · menunggu ${esc(span(sim.t - diversion.requestedAt))}`}</span>`
          : `<span class="pill tone-ok">${shape("circle")}Disetujui ${esc(when(diversion.approvedAt))}</span><span class="note">Diminta ${esc(when(diversion.requestedAt))}, disetujui ${esc(span(diversion.approvedAt - diversion.requestedAt))} kemudian. Perintah kirim sudah diteruskan.</span>`;
      return { body, foot };
    }

    return {
      update(sim) {
        const content = view(sim);
        setHTML(r.plan, content.body);
        setHTML(r.foot, content.foot);
      },
    };
  }

  function kuotaPage(el, { app }) {
    el.innerHTML = `
      <div class="cols cols-2-1">
        ${panel({
          iconName: "sliders",
          title: "Kuota per nomor polisi",
          hint: "berlaku di semua POS SPBU Kab. Jember",
          body: `<form class="quota-form" data-ref="params" novalidate>
            <div class="quota-fields">${Object.keys(config.quota).map(quotaField).join("")}</div>
            <div class="locked-row">
              <span class="locked">${icon("pin", 15)}Kab. Jember</span>
              <span class="locked">${icon("lock", 15)}Jeriken &amp; tangki modif. diblokir</span>
              <span class="locked">Berlaku sampai status NORMAL</span>
            </div>
            <p class="field-error" data-ref="paramsError" role="alert"></p>
            <p class="note" data-ref="modeNote"></p>
            <button type="submit" class="btn btn-primary">${icon("send", 16)}Terapkan ke semua POS</button>
          </form>`,
        })}
        ${panel({
          iconName: "info",
          title: "Cara kerja kuota krisis",
          body: `<ul class="plain-list">
            <li>Aktif otomatis di semua POS SPBU saat status KRISIS.</li>
            <li>Dihitung per nomor polisi per hari, di semua SPBU.</li>
            <li>Jeriken dan tangki modifikasi selalu ditolak.</li>
            <li>Berhenti saat status wilayah kembali NORMAL.</li>
          </ul>`,
        })}
      </div>`;
    const r = refs(el);
    bindQuotaForm(r.params, app, r.paramsError);

    return {
      update(sim) {
        setText(
          r.modeNote,
          sim.crisisMode.active
            ? `Mode krisis aktif sejak ${when(sim.crisisMode.since)}.`
            : "Mode krisis belum aktif. Kuota ini dipakai saat status KRISIS terpicu.",
        );
      },
    };
  }

  function inboxPage(el, { app }) {
    el.innerHTML = `
      <div class="cols cols-2-1">
        ${panel({ iconName: "inbox", title: "Kotak masuk", hint: "permintaan, anomali, dan laporan warga", body: '<ul class="inbox" data-ref="inbox"></ul>', foot: `<button type="button" class="btn" data-action="forward" data-ref="forward">${icon("send", 16)}Teruskan ke Satgas</button><span class="note" data-ref="forwardNote"></span>` })}
        ${panel({ iconName: "list", title: "Jenis pesan", body: '<div class="risk-list" data-ref="kinds"></div>' })}
      </div>`;
    const r = refs(el);
    const forward = bindForward(el, app, r.forward);

    const KINDS = [
      {
        kind: "request",
        icon: "landmark",
        title: "Permintaan Pemda",
        note: "pengalihan pasokan",
      },
      {
        kind: "anomaly",
        icon: "alert",
        title: "Anomali transaksi",
        note: `nopol ditolak ${ANOMALY_MIN_COUNT}× atau lebih hari ini`,
      },
      {
        kind: "report",
        icon: "megaphone",
        title: "Laporan warga",
        note: "dari halaman info publik",
      },
    ];

    return {
      update(sim) {
        const items = inboxItems(sim);
        setHTML(r.inbox, inboxHTML(items));
        r.forward.disabled = items.length === 0 || forward.forwarding();
        setText(r.forwardNote, forward.note());
        setHTML(
          r.kinds,
          KINDS.map(
            (kind) =>
              `<div class="risk-row">${icon(kind.icon, 18)}<span><b>${esc(kind.title)}</b><small>${esc(kind.note)}</small></span><span class="value">${num(items.filter((item) => item.kind === kind.kind).length)}</span></div>`,
          ).join(""),
        );
      },
    };
  }

  function mount(host, app) {
    host.classList.add("app-pertamina");
    // Status per peran (saringan, nomor halaman) bertahan saat berpindah sub-halaman.
    const state = { armadaFilter: "semua", armadaPage: 1 };
    const withState = (page) => (el, ctx) => page(el, ctx, state);
    return ns.shell.mount(host, app, {
      role: "pertamina",
      org: "Pertamina Patra Niaga",
      context: "Regional Jatim-Bali-Nusra",
      user: { initials: "DR", name: "Dispatcher Regional" },
      groups: [
        {
          label: "Pemantauan",
          items: [
            { id: "ringkasan", label: "Ringkasan", icon: "dashboard" },
            { id: "peta", label: "Peta distribusi", icon: "map" },
            { id: "terminal", label: "Stok terminal", icon: "warehouse" },
            { id: "armada", label: "Armada truk", icon: "truck" },
          ],
        },
        {
          label: "Tindakan",
          items: [
            { id: "pengalihan", label: "Pengalihan", icon: "route" },
            { id: "kuota", label: "Kuota krisis POS", icon: "sliders" },
            { id: "inbox", label: "Kotak masuk", icon: "inbox" },
          ],
        },
      ],
      pages: {
        ringkasan: { title: "Ringkasan", mount: ringkasanPage },
        peta: { title: "Peta distribusi", mount: petaPage },
        terminal: { title: "Stok terminal", mount: terminalPage },
        armada: { title: "Armada truk", mount: withState(armadaPage) },
        pengalihan: { title: "Pengalihan pasokan", mount: pengalihanPage },
        kuota: { title: "Kuota krisis POS", mount: kuotaPage },
        inbox: { title: "Kotak masuk", mount: inboxPage },
      },
      badges: (sim) => ({
        pengalihan: waitingDiversion(sim) ? 1 : 0,
        inbox: inboxItems(sim).filter((item) => item.unread).length,
      }),
    });
  }

  ns.views = ns.views || {};
  ns.views.pertamina = {
    mount,
    shell: true,
    parts: {
      panel,
      terminalStatus,
      waitingDiversion,
      inboxItems,
      updateRegionKpis,
      regionMap,
      terminalTableHTML,
      drawTerminalProjection,
      bindDiversionApproval,
      bindQuotaForm,
      bindForward,
    },
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
