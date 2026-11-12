// Komunikasi risiko – halaman info BBM resmi dan kanal siaran untuk masyarakat (ponsel).
(function (ns) {
  "use strict";

  const { ui, sim: engine, ews, maps, config } = ns;
  const {
    esc,
    num,
    icon,
    shape,
    setHTML,
    refs,
    clock,
    dayName,
    when,
    toast,
    STATUS,
    STOCK,
  } = ui;
  const UPDATE_EVERY_HOURS = 2;
  const NEAREST_COUNT = 4;
  const EARTH_RADIUS_KM = 6371;
  const HEADLINES = {
    NORMAL: "Pasokan BBM normal",
    WASPADA: "Pasokan BBM perlu diwaspadai",
    KRISIS: "Pasokan BBM terganggu",
  };

  const STATUS_BAR = (
    ref,
    dark,
  ) => `<div class="phone-status${dark ? " is-dark" : ""}"><span data-ref="${ref}"></span><span>
      <svg width="58" height="14" viewBox="0 0 58 14" aria-hidden="true" fill="currentColor"><rect x="0" y="9" width="3" height="5" rx="1"/><rect x="5" y="6" width="3" height="8" rx="1"/><rect x="10" y="3" width="3" height="11" rx="1"/><rect x="15" y="0" width="3" height="14" rx="1"/><rect x="28" y="1.5" width="24" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="30.5" y="4" width="15" height="6" rx="1.5"/><rect x="53.5" y="5" width="2" height="4" rx="1"/></svg>
    </span></div>`;

  // Form laporan warga; dipakai halaman publik dan versi wireframe.
  const REPORT_DIALOG = `<dialog data-ref="dialog" aria-labelledby="report-title">
      <form data-ref="form" novalidate>
        <h2 id="report-title">Lapor penimbunan / hoaks</h2>
        <fieldset>
          <legend class="sr-only">Jenis laporan</legend>
          <label><input type="radio" name="type" value="penimbunan" checked> Penimbunan</label>
          <label><input type="radio" name="type" value="hoaks"> Hoaks</label>
        </fieldset>
        <label class="stack">Lokasi dan keterangan
          <textarea name="text" rows="3" maxlength="200" aria-describedby="report-error"></textarea>
        </label>
        <p class="field-error" id="report-error" data-ref="reportError" role="alert"></p>
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary">${icon("send", 16)}Kirim laporan</button>
          <button type="button" class="btn" data-action="close">Batal</button>
        </div>
      </form>
    </dialog>`;

  const TEMPLATE = `
    <div class="publik">
    <header class="app-head">
      <span class="app-icon">${icon("megaphone", 22)}</span>
      <div>
        <h1 class="app-title">Komunikasi Risiko Terintegrasi</h1>
        <p class="app-sub">Halaman info resmi dan kanal siaran untuk warga Kab. Jember, dari satu sumber data</p>
      </div>
    </header>
    <div class="phones">
      <div class="device-phone">
        <div class="phone-screen">
          ${STATUS_BAR("time1", true)}
          <div class="phone-hero">
            <h2>Info BBM Resmi</h2>
            <p>Pemkab Jember dan Pertamina</p>
          </div>
          <div class="phone-body">
            <div data-ref="statusCard"></div>
            <div class="map map-sm" data-ref="map"></div>
            <section class="phone-section">
              <h3>SPBU terdekat</h3>
              <div class="spbu-list" data-ref="nearest"></div>
            </section>
            <section class="phone-section">
              <h3>Kebijakan yang berlaku</h3>
              <div data-ref="policies"></div>
            </section>
            <section class="phone-section report-cta">
              <h3>Melihat penimbunan atau hoaks?</h3>
              <button type="button" class="btn btn-primary btn-block btn-phone" data-action="report">${icon("megaphone", 18)}Buat laporan</button>
            </section>
          </div>
        </div>
      </div>

      <div class="device-phone">
        <div class="phone-screen">
          ${STATUS_BAR("time2", false)}
          <div class="chat-head">
            ${icon("back", 20)}
            <span class="chat-avatar">${icon("megaphone", 18)}</span>
            <div><p class="chat-title">Info BBM Kab. Jember ${icon("shield", 15)}</p><p class="chat-sub">Kanal siaran resmi Pemkab dan Pertamina</p></div>
          </div>
          <div class="chat-body" data-ref="chat"></div>
          <p class="chat-foot">Hanya admin Pemkab &amp; Pertamina yang dapat mengirim pesan</p>
        </div>
      </div>

      <aside class="side-note">
        <article class="panel">
          <header class="panel-head"><h2>${icon("info", 17)}Satu pesan, satu sumber</h2></header>
          <div class="panel-body">
            <p>Status, stok SPBU, dan kebijakan diambil dari satu server SI-TANGGAP. Web, WhatsApp, dan media sosial menerima pesan yang sama.</p>
            <p class="note">Status baru tampil ke publik setelah info resmi terbit. Halaman diperbarui tiap ${UPDATE_EVERY_HOURS} jam.</p>
          </div>
        </article>
        <article class="panel">
          <header class="panel-head"><h2>${icon("inbox", 17)}Laporan warga</h2></header>
          <div class="panel-body" data-ref="reports"></div>
        </article>
        <p class="note">Lokasi pengguna contoh: ${esc(config.userLocation.name)}.</p>
      </aside>
    </div>
    </div>

    ${REPORT_DIALOG}`;

  function distanceKm(a, b) {
    const rad = (deg) => (deg * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
  }

  /** Waktu kiriman pasokan tambahan pertama, atau null bila belum ada. */
  function firstDiversionArrival(sim) {
    const diversion = sim.diversion;
    if (
      !diversion ||
      diversion.approvedAt === null ||
      diversion.plan.length === 0
    )
      return null;
    return (
      diversion.approvedAt +
      Math.min(...diversion.plan.map((item) => item.leadHours))
    );
  }

  /** Jam pembaruan terakhir halaman publik (data disegarkan tiap 2 jam). */
  const lastUpdate = (sim) =>
    Math.floor(sim.t / UPDATE_EVERY_HOURS) * UPDATE_EVERY_HOURS;

  // Publik hanya melihat status yang sudah diumumkan.
  const shownStatus = (sim) =>
    sim.infoPublished ? sim.region.status : "NORMAL";

  /** Kunci penyegaran: isi halaman publik hanya berubah tiap 2 jam atau saat keputusan baru terbit. */
  const refreshKey = (sim, shown) =>
    `${Math.floor(sim.t / UPDATE_EVERY_HOURS)}|${shown}|${sim.crisisMode.active}|${Boolean(sim.policy.KRISIS)}|${sim.diversion?.approvedAt ?? ""}`;

  function statusCardHTML(sim, shown) {
    const meta = STATUS[shown];
    const lines = [];
    const arrival = firstDiversionArrival(sim);
    if (arrival !== null) {
      lines.push(
        `Pasokan tambahan ${arrival > sim.t ? "tiba" : "berjalan sejak"} ${when(arrival)}.`,
      );
    } else if (shown !== "NORMAL") {
      lines.push("Pasokan tetap dikirim. Beli secukupnya.");
    }
    lines.push(`Diperbarui ${when(lastUpdate(sim))}.`);
    return `<div class="status-card tone-${meta.tone}"><span class="status-card-tag">${shape(meta.shape)}STATUS ${esc(shown)}</span>
      <strong>${HEADLINES[shown]}</strong>${lines.map((line) => `<p>${esc(line)}</p>`).join("")}
    </div>`;
  }

  /** SPBU terdekat dari lokasi pengguna: jarak, stok, jam truk tiba (bila kosong), dan waktu antre. */
  function nearest(sim, count = NEAREST_COUNT) {
    const queueMinutes = Math.max(
      5,
      Math.round(sim.region.queueMinutes / 5) * 5,
    );
    return sim.spbu
      .map((s) => ({ s, km: distanceKm(config.userLocation, s) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, count)
      .map(({ s, km }) => ({
        s,
        km,
        meta: STOCK[s.klass],
        empty: s.klass === "kosong",
        arrivalAt: Number.isFinite(s.etaHours) ? sim.t + s.etaHours : null,
        queueMinutes,
      }));
  }

  function nearestHTML(sim) {
    return nearest(sim)
      .map(({ s, km, meta, empty, arrivalAt, queueMinutes }) => {
        const arrival =
          arrivalAt !== null
            ? `truk tiba ${clock(arrivalAt)}`
            : "menunggu jadwal pasokan";
        const queue = `antre sekitar ${num(queueMinutes)} menit`;
        const detail = `${meta.short}, ${empty ? arrival : queue}`;
        return `<div class="spbu-row">${ui.marker(meta.tone, meta.shape)}<div><p class="spbu-name">SPBU ${esc(s.name)}</p><p class="spbu-detail">${esc(detail)}</p></div><span class="spbu-dist">${num(km, 1)} km</span></div>`;
      })
      .join("");
  }

  /** Kebijakan yang berlaku untuk publik, dari keputusan Pemda dan mode krisis POS. */
  function activePolicies(sim) {
    const lines = [];
    const policy = sim.policy.KRISIS;
    if (policy) {
      for (const item of ews.recommendations("KRISIS", sim.cfg)) {
        if (
          !item.auto &&
          item.id !== "pengalihan-suplai" &&
          policy.items.includes(item.id)
        )
          lines.push(item.label);
      }
    }
    if (sim.crisisMode.active) {
      const quota = sim.crisisMode.quota;
      lines.push(
        `Maks ${num(quota.motor)} L/motor, ${num(quota.mobil)} L/mobil per hari`,
        "Jeriken dan tangki modifikasi dilarang",
      );
    }
    return lines;
  }

  const noPolicyText = (shown) =>
    shown === "NORMAL"
      ? "Tidak ada pembatasan. Pembelian BBM seperti biasa."
      : "Belum ada pembatasan. Stok terus dipantau.";

  function policiesHTML(sim, shown) {
    const lines = activePolicies(sim);
    if (lines.length === 0) return `<p class="note">${noPolicyText(shown)}</p>`;
    return `<ul class="policy-list">${lines.map((line) => `<li>${icon("check", 16)}<span>${esc(line)}</span></li>`).join("")}</ul>`;
  }

  /** Pesan siaran yang sudah terbit, disusun dari kejadian di server. */
  function broadcasts(sim) {
    const messages = [];
    const infoAt = [...sim.log].reverse().find((row) => row.kind === "info")?.t;
    const status = sim.region.status;
    if (sim.infoPublished && infoAt !== undefined) {
      messages.push({
        t: infoAt,
        title: `Status ${status}: pasokan BBM terganggu`,
        lines: [
          "Jalur Gumitir terganggu, truk tangki terlambat.",
          "Cek stok SPBU terdekat di halaman Info BBM.",
          "Beli secukupnya, jangan menimbun.",
        ],
      });
    }
    const policy = sim.policy.KRISIS;
    if (policy) {
      messages.push({
        t: policy.at,
        title: "Kebijakan darurat berlaku",
        lines: activePolicies(sim),
      });
    }
    const arrival = firstDiversionArrival(sim);
    if (arrival !== null) {
      messages.push({
        t: sim.diversion.approvedAt,
        title: "Pasokan tambahan dikirim",
        lines: [
          `Dari ${sim.diversion.plan.map((item) => item.name).join(" dan ")}.`,
          `Truk pertama tiba ${when(arrival)}.`,
        ],
      });
    }
    if (status === "NORMAL" && sim.marks.normalAgainAt !== null) {
      messages.push({
        t: sim.marks.normalAgainAt,
        title: "Pasokan kembali normal",
        lines: [
          "Pembatasan pembelian dicabut.",
          "Terima kasih sudah membeli secukupnya.",
        ],
      });
    }
    // Alur sistem: isu atau hoaks dipantau lalu diklarifikasi dari satu sumber resmi.
    for (const report of sim.reports) {
      if (report.type !== "hoaks" || report.clarifiedAt === null) continue;
      messages.push({
        t: report.clarifiedAt,
        title: "Klarifikasi isu BBM",
        lines: [
          "Isu yang dilaporkan warga sudah dicek Pemkab dan Pertamina. Isu itu tidak benar.",
          "Info resmi hanya diumumkan di kanal ini.",
        ],
      });
    }
    return messages.sort((a, b) => a.t - b.t);
  }

  function chatHTML(sim) {
    const messages = broadcasts(sim);
    if (messages.length === 0) {
      return '<p class="chat-empty">Belum ada siaran. Pesan dikirim saat status WASPADA atau KRISIS diumumkan dan saat pasokan pulih.</p>';
    }
    let lastDay = null;
    return messages
      .map((message) => {
        const day = dayName(message.t);
        const chip =
          day !== lastDay ? `<span class="day-chip">${esc(day)}</span>` : "";
        lastDay = day;
        const list = message.lines.length
          ? `<ul>${message.lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`
          : "";
        return `${chip}<div class="bubble"><strong>${esc(message.title)}</strong>${list}<p class="bubble-time">${clock(message.t)}</p></div>`;
      })
      .join("");
  }

  const REPORT_LABEL = { hoaks: "Hoaks", penimbunan: "Penimbunan" };

  /** Waktu laporan masuk dan, untuk hoaks, status klarifikasinya. */
  function reportStatus(report) {
    if (report.type !== "hoaks") return ui.when(report.t);
    return report.clarifiedAt === null
      ? `${ui.when(report.t)} · sedang dicek`
      : `${ui.when(report.t)} · diklarifikasi ${ui.clock(report.clarifiedAt)}`;
  }

  function reportsHTML(sim) {
    if (sim.reports.length === 0)
      return '<p class="note">Belum ada laporan. Laporan warga diteruskan ke inbox Pemda dan Pertamina.</p>';
    return `<ul class="inbox">${sim.reports
      .slice(-3)
      .reverse()
      .map(
        (report) =>
          `<li class="inbox-item is-neutral"><span class="inbox-icon">${icon("megaphone", 16)}</span><div><p class="inbox-title">${esc(REPORT_LABEL[report.type] || report.type)}</p><p class="inbox-text">${esc(report.text)}</p><p class="inbox-time">${esc(reportStatus(report))}</p></div></li>`,
      )
      .join("")}</ul>`;
  }

  /** Peta kecil SPBU terdekat dengan penanda lokasi pengguna; layer null bila Leaflet tidak termuat. */
  function mountMap(el) {
    const user = config.userLocation;
    const map = maps.create(el, {
      center: [user.lat, user.lng],
      zoom: 12,
      controls: false,
    });
    const spbuLayer = map ? maps.spbuLayer(map, 17) : null;
    if (map) {
      L.marker([user.lat, user.lng], {
        icon: maps.divIcon("mk-you", "", 16),
        keyboard: false,
      })
        .bindTooltip("Lokasi Anda")
        .addTo(map);
    }
    return { map, spbuLayer };
  }

  /** Tombol data-action="report"/"close" dan kiriman form laporan (butuh ref dialog, form, reportError). */
  function bindReport(root, r, app) {
    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "report") {
        r.reportError.textContent = "";
        r.dialog.showModal();
      } else if (action === "close") {
        r.dialog.close();
      }
    });

    r.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(r.form);
      const sent = engine.addReport(app.sim, {
        type: String(data.get("type")),
        text: String(data.get("text") ?? ""),
      });
      if (!sent) {
        r.reportError.textContent =
          "Isi lokasi dan keterangan (1–200 karakter).";
        r.form.elements.text.focus();
        return;
      }
      r.form.reset();
      r.dialog.close();
      toast("Laporan terkirim ke Pemda dan Pertamina.");
      app.render();
    });
  }

  function mount(root, app) {
    root.innerHTML = TEMPLATE;
    const r = refs(root);
    const { map, spbuLayer } = mountMap(r.map);
    let shownKey = "";

    bindReport(root, r, app);

    function update(sim) {
      const time = clock(sim.t);
      ui.setText(r.time1, time);
      ui.setText(r.time2, time);
      setHTML(r.chat, chatHTML(sim));
      setHTML(r.reports, reportsHTML(sim));

      const shown = shownStatus(sim);
      const key = refreshKey(sim, shown);
      if (key === shownKey) return;
      shownKey = key;
      setHTML(r.statusCard, statusCardHTML(sim, shown));
      setHTML(r.nearest, nearestHTML(sim));
      setHTML(r.policies, policiesHTML(sim, shown));
      if (spbuLayer) spbuLayer(sim);
    }

    return {
      update,
      destroy() {
        if (map) map.remove();
      },
    };
  }

  ns.views = ns.views || {};
  ns.views.publik = {
    mount,
    // Bagian bersama untuk versi wireframe.
    parts: {
      UPDATE_EVERY_HOURS,
      REPORT_DIALOG,
      shownStatus,
      refreshKey,
      lastUpdate,
      firstDiversionArrival,
      nearest,
      activePolicies,
      noPolicyText,
      mountMap,
      bindReport,
    },
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
