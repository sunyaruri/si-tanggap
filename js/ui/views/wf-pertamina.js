// Wireframe pusat kendali Pertamina (Gambar 6): satu layar, data dan aksi dari bagian halaman Pertamina.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, sim: engine, wf } = ns;
  const {
    esc,
    num,
    icon,
    shape,
    setHTML,
    setText,
    refs,
    when,
    span,
    kpi,
    toast,
  } = ui;
  const parts = ns.views.pertamina.parts;
  const TITLE = "Pusat Kendali Distribusi – Pertamina Patra Niaga";
  const MAX_INBOX = 4;
  const CHART_HEIGHT = 120;
  // Ubah/Tolak belum ada di mesin simulasi: keputusan hanya dicatat ke log, permintaan Pemda tetap terbuka.
  const DECISIONS = {
    ubah: {
      undo: "Permintaan ubah rencana dikirim ke tim optimasi",
      log: "Pertamina meminta rencana pengalihan disusun ulang",
      toast: "Permintaan ubah rencana dicatat.",
      label: "Diminta diubah",
    },
    tolak: {
      undo: "Rekomendasi pengalihan ditolak",
      log: "Pertamina menolak rekomendasi pengalihan suplai",
      toast: "Penolakan rekomendasi dicatat.",
      label: "Ditolak",
    },
  };

  const select = (label, title) =>
    `<select class="select" disabled title="${esc(title)}" aria-label="${esc(label)}"><option>${esc(label)}</option></select>`;

  const row = (label, value) =>
    `<span class="wfpt-label">${esc(label)}</span><span class="locked">${value}</span>`;

  const quotaRow = (key, label) =>
    `<label class="wfpt-label" for="wfpt-quota-${key}">${esc(label)}</label><span class="input-wrap"><span>maks</span><input id="wfpt-quota-${key}" name="${key}" type="number" min="1" max="200" step="1" inputmode="numeric"><span>L / hari</span></span>`;

  function slaKpi(r, sim) {
    const sla = engine.slaCompliance(sim);
    const running = sla.pending ? `, ${num(sla.pending)} berjalan` : "";
    if (sla.total === 0) {
      setText(r.sla, "–");
      setText(
        r.slaSub,
        sla.pending
          ? `${num(sla.pending)} SLA masih berjalan`
          : "belum ada SLA jatuh tempo",
      );
      r.slaCard.dataset.tone = "";
      return;
    }
    setText(r.sla, `${num((sla.onTime / sla.total) * 100)}%`);
    setText(
      r.slaSub,
      `${num(sla.onTime)} dari ${num(sla.total)} tepat waktu${running}`,
    );
    r.slaCard.dataset.tone = sla.onTime < sla.total ? "warn" : "";
  }

  function inboxHTML(items) {
    if (items.length === 0)
      return '<li class="note">Kotak masuk kosong. Permintaan Pemda dan anomali muncul di sini.</li>';
    const shown = items
      .slice(0, MAX_INBOX)
      .map(
        (item) =>
          `<li class="inbox-item ${item.tone}"><div><p class="inbox-title">${esc(item.title)}${item.t === null ? "" : ` • ${esc(when(item.t))}`}</p><p class="inbox-text">${esc(item.text)}</p></div></li>`,
      )
      .join("");
    const rest = items.length - MAX_INBOX;
    return rest > 0
      ? `${shown}<li class="note">${num(rest)} pesan lain di <a class="link" href="#pertamina/inbox">Kotak masuk</a></li>`
      : shown;
  }

  function mount(el, app) {
    el.classList.add("app-pertamina");
    el.innerHTML = `
      ${wf.head({
        title: TITLE,
        tools:
          select(
            "Regional: Jatim-Bali-Nusra",
            "Prototipe hanya menyimulasikan satu regional (Kab. Jember).",
          ) +
          select(
            "BBM: semua",
            "Prototipe memodelkan stok BBM sebagai satu stok gabungan.",
          ),
      })}
      <section class="kpis" aria-label="Ringkasan regional">
        ${kpi({ ref: "krisis", label: "Wilayah berstatus KRISIS", iconName: "alert", sub: "dari 1 wilayah dipantau" })}
        ${kpi({ ref: "waspada", label: "Wilayah WASPADA", iconName: "bell", sub: "dari 1 wilayah dipantau" })}
        ${kpi({ ref: "trucks", label: "Truk tangki dalam perjalanan", iconName: "truck", sub: "menuju SPBU Kab. Jember" })}
        ${kpi({ ref: "request", label: "Permintaan Pemda menunggu", iconName: "landmark" })}
        ${kpi({ ref: "sla", label: "Kepatuhan SLA (30 hari)", iconName: "clock" })}
      </section>
      <div class="wfpt-row wfpt-mid">
        ${parts.panel({
          iconName: "map",
          title: "Peta wilayah, terminal BBM &amp; armada",
          body: `<div class="map-wrap"><div class="map" data-ref="map"></div></div>
            <div class="wfpt-legend">${[
              ui.legendItem(ui.marker("ok", "circle"), "wilayah normal"),
              ui.legendItem(ui.marker("warn", "triangle"), "waspada"),
              ui.legendItem(ui.marker("crit", "square"), "krisis"),
              ui.legendItem(ui.marker("terminal", "diamond"), "TBBM/terminal"),
              ui.legendItem(
                `${ui.truckMark()}<span class="mk mk-ship">${icon("ship", 11)}</span>`,
                "truk/kapal tanker",
              ),
            ].join("")}</div>`,
        })}
        ${parts.panel({
          iconName: "warehouse",
          title: "Stok terminal BBM (TBBM) &amp; ketahanan stok",
          body: `<div class="table-wrap" data-ref="terminals"></div>
            <p class="wfpt-caption">Grafik ketahanan stok 7 hari ke depan per terminal</p>
            <div data-ref="projection"></div>`,
        })}
      </div>
      <div class="wfpt-row wfpt-bottom">
        <div class="wfpt-cell" data-ref="divPanel">${parts.panel({
          iconName: "route",
          title: "Rekomendasi pengalihan suplai (optimasi)",
          body: `<p class="wfpt-need" data-ref="divNeed"></p>
            <div class="wfpt-plan" data-ref="divPlan"></div>
            <p class="note" data-ref="divFleet"></p>
            <div class="wfpt-actions" data-ref="divActions"></div>
            <p class="note" data-ref="divNote"></p>`,
        })}</div>
        ${parts.panel({
          iconName: "sliders",
          title: "Parameter mode krisis POS",
          body: `<form class="wfpt-params" data-ref="params" novalidate>
            <div class="wfpt-grid">
              ${row("Wilayah", `${icon("pin", 15)}Kab. Jember`)}
              ${quotaRow("motor", "Motor")}
              ${quotaRow("mobil", "Mobil pribadi")}
              <span class="wfpt-label">Kendaraan niaga</span><span class="locked">sesuai kuota QR<small class="note" data-ref="niaga"></small></span>
              ${row("Jeriken / tangki modif.", `${icon("lock", 15)}DIBLOKIR`)}
              ${row("Berlaku", "s.d. status NORMAL")}
            </div>
            <p class="field-error" data-ref="paramsError" role="alert"></p>
            <button type="submit" class="btn btn-primary">${icon("send", 16)}Terapkan ke semua POS wilayah</button>
          </form>`,
        })}
        <div class="wfpt-cell" data-ref="inboxPanel">${parts.panel({
          iconName: "inbox",
          title: "Inbox Pemda &amp; audit anomali",
          body: `<ul class="inbox wfpt-inbox" data-ref="inbox"></ul>
            <button type="button" class="btn btn-block" data-action="forward" data-ref="forward">${icon("send", 16)}Teruskan ke tim audit / Satgas</button>
            <p class="note" data-ref="forwardNote"></p>`,
        })}</div>
      </div>`;
    const r = refs(el);
    const map = parts.regionMap(r.map);
    const approving = parts.bindDiversionApproval(r.divPanel, app);
    parts.bindQuotaForm(r.params, app, r.paramsError);
    const forward = parts.bindForward(r.inboxPanel, app, r.forward);
    // Keputusan Ubah/Tolak milik tampilan ini, terikat ke permintaan Pemda yang sedang terbuka.
    const state = { deciding: null, decision: null };

    r.divPanel.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!Object.hasOwn(DECISIONS, action)) return;
      const diversion = app.sim.diversion;
      if (
        !diversion ||
        diversion.approvedAt !== null ||
        state.deciding ||
        approving()
      )
        return;
      const text = DECISIONS[action];
      state.deciding = action;
      app.render();
      ui.undoable({
        text: text.undo,
        seconds: 6,
        onCommit() {
          state.deciding = null;
          engine.logEvent(app.sim, "supply", text.log);
          state.decision = {
            kind: action,
            t: app.sim.t,
            requestedAt: diversion.requestedAt,
          };
          toast(text.toast);
          app.render();
        },
        onUndo() {
          state.deciding = null;
          app.render();
        },
      });
    });

    function actionsHTML(enabled, decided) {
      const off = (on) => (on ? "" : " disabled");
      return `<button type="button" class="btn btn-primary" data-action="approve-diversion"${off(enabled)}>${icon("check", 16)}Setujui &amp; kirim perintah</button>
        <button type="button" class="btn" data-action="ubah"${off(enabled && decided !== "ubah")}>Ubah</button>
        <button type="button" class="btn" data-action="tolak"${off(enabled && decided !== "tolak")}>Tolak</button>`;
    }

    function updateDiversion(sim) {
      const diversion = sim.diversion;
      if (
        state.decision &&
        (!diversion || state.decision.requestedAt !== diversion.requestedAt)
      )
        state.decision = null;
      if (!diversion) {
        setText(
          r.divNeed,
          "Wilayah tujuan: Kab. Jember • belum ada permintaan Pemda",
        );
        setHTML(
          r.divPlan,
          '<div class="empty"><strong>Belum ada rekomendasi</strong><span class="note">Rencana disusun otomatis saat Pemda meminta pengalihan pada status KRISIS.</span></div>',
        );
        setText(r.divFleet, "");
        setHTML(r.divActions, actionsHTML(false, null));
        setText(r.divNote, "");
        return;
      }
      setText(
        r.divNeed,
        `Wilayah tujuan: Kab. Jember • kebutuhan tambahan ${num(diversion.deficitKLday)} KL/hari`,
      );
      setHTML(
        r.divPlan,
        diversion.plan.length === 0
          ? '<p class="note">Pasokan utama masih cukup. Tidak ada volume yang perlu dialihkan.</p>'
          : diversion.plan
              .map(
                (item) => `<div class="route-card">
                  <div class="route-line">${esc(item.name)}${icon("arrow", 15)}Jember</div>
                  <p class="wfpt-route-meta">Volume ${num(item.kLday)} KL/hari • ETA ${num(item.leadHours)} jam via jalur alternatif • biaya +${num(item.costPct)}%</p>
                </div>`,
              )
              .join(""),
      );
      setText(
        r.divFleet,
        `Armada tambahan: ${num(diversion.trucks)} truk tangki dari Fuel Terminal terdekat`,
      );
      if (diversion.approvedAt !== null) {
        setHTML(
          r.divActions,
          `<span class="pill tone-ok">${shape("circle")}Disetujui ${esc(when(diversion.approvedAt))}</span>`,
        );
        setText(r.divNote, "Perintah kirim sudah diteruskan ke terminal.");
        return;
      }
      const busy = approving() || state.deciding !== null;
      const decided = state.decision ? state.decision.kind : null;
      setHTML(
        r.divActions,
        actionsHTML(!busy && diversion.plan.length > 0, decided),
      );
      setText(
        r.divNote,
        busy
          ? "Dikirim dalam beberapa detik. Bisa dibatalkan di bilah bawah."
          : state.decision
            ? `${DECISIONS[decided].label} ${when(state.decision.t)}. Permintaan Pemda tetap menunggu keputusan.`
            : `Diminta Pemda ${when(diversion.requestedAt)} · menunggu ${span(sim.t - diversion.requestedAt)}`,
      );
    }

    return {
      update(sim) {
        parts.updateRegionKpis(r, sim);
        slaKpi(r, sim);
        map.update(sim);
        setHTML(r.terminals, parts.terminalTableHTML(sim));
        parts.drawTerminalProjection(r.projection, sim, CHART_HEIGHT);
        updateDiversion(sim);
        setText(r.niaga, `${num(sim.crisisMode.quota.niaga)} L / hari`);
        const items = parts.inboxItems(sim);
        setHTML(r.inbox, inboxHTML(items));
        r.forward.disabled = items.length === 0 || forward.forwarding();
        setText(r.forwardNote, forward.note());
      },
      destroy: map.destroy,
    };
  }

  ns.wf.layouts.pertamina = { title: TITLE, mount };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
