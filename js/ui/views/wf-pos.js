// Wireframe POS SPBU (Gambar 4): satu layar tablet operator. Keadaan meja, aturan, dan aksi
// dipinjam dari views.pos.parts supaya transaksi di sini juga tampak di layar POS biasa.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, config, icons } = ns;
  const { esc, num, setHTML, refs, tonePill } = ui;
  const parts = ns.views.pos.parts;
  const { desk } = parts;
  const station = config.posStation;
  const DOT = " • ";

  const TEMPLATE = `
    <div class="device-tablet wfp">
      <div class="device-screen">
        <header class="pos-bar wfp-bar">
          <span class="logo-mark">${icons.logo(18)}</span>
          <h1 class="wfp-title"><span>SI-TANGGAP POS</span><span class="wf-sep" aria-hidden="true">|</span><span>SPBU ${esc(station.spbuName)} – Pompa ${station.pump}</span></h1>
          <div class="pos-bar-right" data-ref="mode"></div>
        </header>
        <div class="wfp-body">
          <section class="panel">
            <header class="panel-head"><h2>Kendaraan di nozzle</h2></header>
            <div class="panel-body wfp-col">
              <div class="cam" data-ref="camera"></div>
              <div data-ref="vehicle"></div>
              <div><button type="button" class="btn" data-action="toggle-correction" aria-expanded="false" aria-controls="plate-input">Koreksi nopol manual</button></div>
              <div>${parts.correctionHTML(true)}</div>
            </div>
          </section>
          <section class="panel">
            <header class="panel-head"><h2>Hasil pengecekan</h2></header>
            <div class="panel-body wfp-col" data-ref="decision"></div>
          </section>
          <section class="panel wfp-queue">
            <header class="panel-head"><h2>Antrean berikutnya (sudah diidentifikasi kamera jalur antre)</h2></header>
            <div class="panel-body"><div class="wfp-cards" data-ref="queue"></div></div>
          </section>
        </div>
      </div>
    </div>`;

  function vehicleHTML(vehicle) {
    const kind = parts.TYPE_BY_ID[vehicle.type];
    return `<p class="wfp-label">Nomor polisi terbaca</p>
      <p class="wfp-plate">${esc(vehicle.plate)}</p>
      <p class="wfp-meta">Jenis: ${esc(kind.label.toLowerCase())}${DOT}BBM: ${esc(kind.fuel)}${DOT}keyakinan baca: ${vehicle.confidence}%</p>`;
  }

  function decisionHTML(vehicle, sim) {
    const crisis = sim.crisisMode.active;
    const { decision, allowed, liters } = parts.queueStatus(vehicle, sim);
    const quota = parts.quotaInfo(vehicle, sim);
    const found = parts.detected(vehicle);
    const sub = !allowed
      ? parts.REASONS[decision.reason]
      : crisis
        ? "batas volume krisis"
        : "tanpa batas volume";
    const buttons = allowed
      ? `<button type="button" class="btn btn-primary btn-lg" data-action="fill">${crisis ? `Isi maks ${num(liters)} L` : `Isi ${num(liters)} L`}</button>
         <button type="button" class="btn btn-lg" data-action="reject">Tolak</button>`
      : `<button type="button" class="btn btn-primary btn-lg wfp-wide" data-action="reject">Catat penolakan</button>`;
    return `<div class="verdict ${allowed ? "is-ok" : "is-blocked"} wfp-verdict"><strong>${allowed ? "BOLEH ISI" : "DIBLOKIR"}</strong><span>${esc(sub)}</span></div>
      <div>
        <p class="wfp-label">Sisa kuota hari ini</p>
        <p class="wfp-big">${quota ? `${num(quota.left, 1)} liter` : "Tanpa batas"}</p>
      </div>
      <div class="wfp-facts">
        <p>Deteksi jeriken / tangki modifikasi: ${found ? tonePill("crit", "square", found.toLowerCase()) : "tidak ada"}</p>
        <p>Pengisian sebelumnya: ${vehicle.lastFillHours} jam lalu, SPBU ${esc(vehicle.lastFillSpbu)}</p>
      </div>
      <div class="wfp-actions">${buttons}</div>`;
  }

  function queueHTML(sim) {
    return desk.queue
      .map((vehicle) => {
        const status = parts.queueStatus(vehicle, sim);
        const text = !status.allowed
          ? `DIBLOKIR${DOT}${parts.REASONS[status.decision.reason].toLowerCase()}`
          : `boleh isi${DOT}${num(status.liters)} L${status.partial ? " (sisa kuota)" : ""}`;
        return `<div class="wfp-card"><p class="wfp-card-plate">${esc(vehicle.plate)}</p><p class="wfp-card-status">${parts.queueMark(status.allowed)}${esc(text)}</p></div>`;
      })
      .join("");
  }

  function mount(root, app) {
    parts.ensure();
    root.innerHTML = TEMPLATE;
    const r = refs(root);
    parts.bindDesk(root, r, app);

    // Form koreksi disembunyikan seperti wireframe; tombolnya membuka form yang sama dengan POS biasa.
    root.addEventListener("click", (event) => {
      const toggle = event.target.closest('[data-action="toggle-correction"]');
      if (!toggle) return;
      const open = r.correction.hidden;
      r.correction.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) r.correction.elements.plate.focus();
      else r.plateError.textContent = "";
    });

    function update(sim) {
      parts.syncDay(sim);
      setHTML(r.mode, parts.modeHTML(sim));
      setHTML(r.camera, parts.cameraSVG(desk.current, sim.t));
      setHTML(r.vehicle, vehicleHTML(desk.current));
      setHTML(r.decision, decisionHTML(desk.current, sim));
      setHTML(r.queue, queueHTML(sim));
    }

    return { update };
  }

  ns.wf.layouts.pos = { title: "SI-TANGGAP POS", mount };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
