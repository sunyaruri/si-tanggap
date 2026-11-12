// Wireframe info publik (Gambar 5): satu ponsel. Data, peta, dan form laporan
// dipinjam dari views.publik.parts supaya isinya sama dengan halaman publik biasa.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui } = ns;
  const { esc, setHTML, refs, clock, when, span, shape, marker, STATUS } = ui;
  const parts = ns.views.publik.parts;
  const NEAREST_COUNT = 3;
  const DOT = " • ";
  const TITLE = "Info BBM Resmi – Kab. Jember";

  const TEMPLATE = `
    <div class="publik wfq">
      <div class="device-phone">
        <div class="phone-screen">
          <header class="wfq-head"><h1>${esc(TITLE)}</h1></header>
          <div class="phone-body wfq-body">
            <div data-ref="status"></div>
            <div class="map map-sm" data-ref="map"></div>
            <section class="phone-section">
              <h3>SPBU terdekat</h3>
              <div class="wfq-cards" data-ref="nearest"></div>
            </section>
            <section class="phone-section">
              <h3>Kebijakan yang berlaku</h3>
              <div data-ref="policies"></div>
            </section>
            <button type="button" class="btn btn-primary btn-block btn-phone" data-action="report">Lapor penimbunan / hoaks</button>
          </div>
        </div>
      </div>
      ${parts.REPORT_DIALOG}
    </div>`;

  /** Baris estimasi pulih: jam truk pasokan tambahan pertama, karena simulasi tidak memodelkan jam pulih. */
  function recoveryLine(sim) {
    const arrival = parts.firstDiversionArrival(sim);
    if (arrival === null) return "Estimasi pulih: menunggu jadwal pasokan";
    return arrival > sim.t
      ? `Estimasi pulih: ${when(arrival)}`
      : `Pasokan tambahan berjalan sejak ${when(arrival)}`;
  }

  function statusHTML(sim, shown) {
    const meta = STATUS[shown];
    const lines = shown === "NORMAL" ? [] : [recoveryLine(sim)];
    lines.push(
      `Pembaruan: ${clock(parts.lastUpdate(sim))} (tiap ${parts.UPDATE_EVERY_HOURS} jam)`,
    );
    return `<div class="status-card tone-${meta.tone} wfq-status">
      <strong>${shape(meta.shape)}STATUS: ${esc(meta.title.toUpperCase())}</strong>
      ${lines.map((line) => `<p>${esc(line)}</p>`).join("")}
    </div>`;
  }

  function nearestHTML(sim) {
    return parts
      .nearest(sim, NEAREST_COUNT)
      .map(({ s, km, meta, empty, arrivalAt, queueMinutes }) => {
        const extra = !empty
          ? `antre ±${span(queueMinutes / 60)}`
          : arrivalAt !== null
            ? `tiba ${clock(arrivalAt)}`
            : "menunggu jadwal pasokan";
        return `<div class="wfq-card"><p class="wfq-card-name">${esc(s.name)} – ${ui.num(km, 1)} km</p><p class="wfq-card-status">${marker(meta.tone, meta.shape)}${esc(meta.short.toLowerCase())}${DOT}${esc(extra)}</p></div>`;
      })
      .join("");
  }

  function policiesHTML(sim, shown) {
    const lines = parts.activePolicies(sim);
    if (lines.length === 0)
      return `<p class="note">${esc(parts.noPolicyText(shown))}</p>`;
    return `<ul class="wfq-bullets">${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
  }

  function mount(root, app) {
    root.innerHTML = TEMPLATE;
    const r = refs(root);
    const { map, spbuLayer } = parts.mountMap(r.map);
    parts.bindReport(root, r, app);
    let shownKey = "";

    function update(sim) {
      const shown = parts.shownStatus(sim);
      const key = parts.refreshKey(sim, shown);
      if (key === shownKey) return;
      shownKey = key;
      setHTML(r.status, statusHTML(sim, shown));
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

  ns.wf.layouts.publik = { title: TITLE, mount };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
