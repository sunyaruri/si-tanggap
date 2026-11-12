// Wireframe Gambar 3: dashboard Pemda satu layar; logika dan aksi memakai bagian bersama pemda.js.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, ews, wf } = ns;
  const { esc, num, icon, pill, setHTML, setText, refs, when, clock, kpi } = ui;
  const parts = ns.views.pemda.parts;
  const TITLE = "Dashboard Pemangku Kebijakan – Kabupaten Jember";
  const TOP_OFFENDERS = 4;
  const STEPS = {
    KRISIS: [
      "Status KRISIS terpicu otomatis",
      "Rekomendasi dikirim ke Pemda",
      "Info resmi #1 terbit ke publik",
      "Rekomendasi disetujui",
      "SE terbit & POS mode krisis",
    ],
    WASPADA: [
      "Status WASPADA terpicu otomatis",
      "Rekomendasi dikirim ke Pemda",
      "Info resmi #1 terbit ke publik",
      "Rekomendasi disetujui",
      "Instansi siaga & suplai cadangan",
    ],
  };

  function slaBox(sim) {
    const info = ui.slaInfo(sim);
    if (info.state === "pending")
      return `<span class="pill pill-lg wf-sla">Sisa SLA: ${esc(ui.countdown(info.remaining))}</span>`;
    if (info.state === "late")
      return `<span class="pill pill-lg tone-crit">SLA: terlewat</span>`;
    if (info.state === "done")
      return info.took <= info.total
        ? `<span class="pill pill-lg tone-ok">SLA: tepat waktu</span>`
        : `<span class="pill pill-lg tone-warn">SLA: terlambat</span>`;
    return `<span class="pill pill-lg wf-sla">Sisa SLA: –</span>`;
  }

  function basisText(sim) {
    const region = sim.region;
    const since =
      sim.sla && sim.sla.status === region.status
        ? ` sejak ${when(sim.sla.startAt)}`
        : "";
    return `Dasar: status ${region.status}${since} • R = ${parts.ratioValue(region.r)} • ${num(region.criticalCount)} SPBU kritis`;
  }

  /** Waktu tiap langkah eskalasi yang sedang berjalan; null = belum terjadi. */
  function stepTimes(sim) {
    const sla = sim.sla;
    if (!sla) return [null, null, null, null, null];
    const policy = sim.policy[sla.status];
    const sent = sim.log.findLast(
      (row) => row.kind === "sla" && row.t >= sla.startAt,
    );
    // Info resmi bisa terbit sebelum eskalasi ini (saat WASPADA disetujui), jadi tidak dibatasi startAt.
    const info = sim.infoPublished
      ? sim.log.findLast((row) => row.kind === "info")
      : null;
    const last =
      sla.status === "KRISIS"
        ? policy && sim.crisisMode.since !== null
          ? Math.max(policy.at, sim.crisisMode.since)
          : null
        : policy && policy.at;
    return [
      sla.startAt,
      sent ? sent.t : null,
      info ? info.t : null,
      policy ? policy.at : null,
      last ?? null,
    ];
  }

  function stepsHTML(sim) {
    const texts = STEPS[sim.sla ? sim.sla.status : "KRISIS"];
    return stepTimes(sim)
      .map((t, index) => {
        const done = t !== null;
        const dot = done
          ? `<span class="tl-dot tone-ok">${icon("check", 14)}</span>`
          : '<span class="tl-dot is-pending"></span>';
        const time = done
          ? `<time class="tl-time" title="${esc(when(t))}">${esc(clock(t))}</time>`
          : '<span class="tl-time">–</span>';
        return `<li class="tl-item${done ? "" : " is-pending"}">${dot}<div class="wf-step">${time}<span class="tl-text">${esc(texts[index])}</span></div></li>`;
      })
      .join("");
  }

  function offendersHTML(sim, all) {
    if (all.length === 0) return parts.emptyHTML(...parts.NO_OFFENDERS);
    const rows = all
      .slice(0, TOP_OFFENDERS)
      .map(
        (offender) => `<tr>
          <td><span class="plate-chip">${esc(offender.plate)}</span></td>
          <td class="nowrap">${esc(sim.spbu[offender.spbuId].name)}</td>
          <td class="num"><b>${num(offender.countToday)}×</b></td>
          <td>${parts.reasonPill(offender)}</td>
        </tr>`,
      )
      .join("");
    return `<div class="table-wrap"><table class="table"><thead><tr><th>Nopol</th><th>SPBU</th><th class="num">Ditolak</th><th>Alasan</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function mount(el, app) {
    // Status layar ini saja; hilang saat pindah layar wireframe.
    const state = {
      rec: { unchecked: new Set(), editing: false, deferred: null },
      offenders: { sending: false, sent: null },
      map: { kec: "semua" },
    };
    el.innerHTML = `
      ${wf.head({ title: TITLE, tools: '<span data-ref="status"></span><span data-ref="sla"></span>' })}
      <section class="kpis" aria-label="Indikator utama">
        ${kpi({ ref: "critical", label: "SPBU kritis (stok < 6 jam)", iconName: "fuel" })}
        ${kpi({ ref: "ratio", label: "Rasio R wilayah", iconName: "gauge" })}
        ${kpi({ ref: "queue", label: "Rata-rata waktu antre", iconName: "users" })}
        ${kpi({ ref: "consumption", label: "Konsumsi vs normal", iconName: "trending" })}
        ${kpi({ ref: "rejected", label: "Transaksi ditolak hari ini", iconName: "ban" })}
      </section>
      <div class="wf-row wf-row-mid">
        <article class="panel">
          <header class="panel-head"><h2>${icon("map", 18)}Peta stok SPBU &amp; posisi truk tangki</h2></header>
          <div class="panel-body">
            <div class="map-wrap"><div class="map" data-ref="map"></div></div>
            <div class="wf-legend">${parts.legendItems().join("")}<span class="wf-filters">${parts.FILTER_FIELDS}</span></div>
          </div>
        </article>
        <article class="panel" data-ref="recPanel">
          <header class="panel-head"><h2>${icon("clipboard", 18)}Rekomendasi kebijakan (matriks keputusan)</h2></header>
          <div class="panel-body" data-ref="recBody"></div>
          <p class="note wf-basis" data-ref="basis"></p>
          <footer class="panel-foot" data-ref="recFoot"></footer>
        </article>
      </div>
      <div class="wf-row wf-row-bottom">
        <article class="panel">
          <header class="panel-head"><h2>${icon("activity", 18)}Proyeksi stok vs kedatangan armada (48 jam)</h2></header>
          <div class="panel-body"><div data-ref="projection"></div></div>
        </article>
        <article class="panel" data-ref="offPanel">
          <header class="panel-head"><h2>${icon("ban", 18)}Pelanggaran anti-hoarding (spekulan)</h2><span class="hint" data-ref="offHint"></span></header>
          <div class="panel-body" data-ref="offenders"></div>
          <footer class="panel-foot">
            <button type="button" class="btn" data-action="send-offenders" data-ref="send"></button>
            <span class="note" data-ref="sendNote"></span>
          </footer>
        </article>
        <article class="panel">
          <header class="panel-head"><h2>${icon("log", 18)}Log keputusan &amp; SLA</h2></header>
          <div class="panel-body"><ol class="timeline wf-steps" data-ref="steps"></ol></div>
          <p class="note wf-target" data-ref="target"></p>
        </article>
      </div>`;
    const r = refs(el);
    const map = parts.mountMap(
      r.map,
      { zoom: 9.6 },
      parts.kecFilter(state.map),
    );
    parts.bindKecamatan(r.kec, map, state.map, app);
    parts.bindRecActions(r.recPanel, state.rec, app);
    parts.bindOffenderSend(r.offPanel, state.offenders, app);

    function update(sim) {
      const region = sim.region;
      setHTML(
        r.status,
        pill(region.status, {
          label: `STATUS WILAYAH: ${region.status}`,
          large: true,
        }),
      );
      setHTML(r.sla, slaBox(sim));

      setText(
        r.critical,
        `${num(region.criticalCount)} / ${num(sim.spbu.length)}`,
      );
      r.criticalCard.dataset.tone = parts.criticalTone(sim);
      parts.ratioKpi(r, sim);
      setText(r.queue, ui.wait(region.queueMinutes));
      parts.demandKpi(r, sim);
      setText(r.rejected, num(sim.totals.rejectedToday));

      map.update(sim);
      const rec = parts.recommendationsView(sim, state.rec, { compact: true });
      setHTML(r.recBody, rec.body);
      setHTML(r.recFoot, rec.foot);
      setText(r.basis, basisText(sim));

      parts.drawProjection(r.projection, sim, { height: 230, compact: true });

      const all = parts.offendersToday(sim);
      setText(
        r.offHint,
        all.length > TOP_OFFENDERS
          ? `${TOP_OFFENDERS} teratas dari ${num(all.length)}`
          : "",
      );
      setHTML(r.offenders, offendersHTML(sim, all));
      parts.syncSend(r, all, state.offenders, "Kirim ke Satpol PP / Polres");

      setHTML(r.steps, stepsHTML(sim));
      const hours = sim.sla
        ? sim.sla.deadlineAt - sim.sla.startAt
        : ews.slaHours("KRISIS", sim.cfg);
      setText(r.target, `Target: semua langkah selesai < ${num(hours)} jam`);
    }
    return { update, destroy: map.destroy };
  }

  wf.layouts.pemda = { title: TITLE, mount };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
