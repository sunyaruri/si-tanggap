// Hasil simulasi: skenario yang sama dijalankan tanpa sistem dan dengan SI-TANGGAP, lalu dibandingkan.
(function (ns) {
  "use strict";

  const { ui, sim: engine, charts, config } = ns;
  const { esc, num, icon, shape, refs, stamp, span, wait, clock, STATUS } = ui;
  const SYSTEM_NAME = "Dengan SI-TANGGAP";
  const BASELINE_NAME = "Tanpa sistem";
  const STATUS_WORD = {
    NORMAL: "NORMAL",
    WASPADA: "WASPADA",
    KRISIS: "KRISIS",
  };

  const TEMPLATE = `
    <div class="hasil">
    <header class="app-head">
      <span class="app-icon">${icon("chart", 22)}</span>
      <div>
        <h1 class="app-title">Hasil Simulasi Skenario</h1>
        <p class="app-sub" data-ref="subtitle"></p>
      </div>
      <div class="app-meta"><span class="pill tone-warn">${shape("triangle")}Keluaran model, bukan data lapangan</span></div>
    </header>

    <article class="panel" style="margin-bottom: var(--gap)">
      <header class="panel-head">
        <h2>${icon("activity", 17)}Linimasa status wilayah per jam</h2>
        <span class="hint" data-ref="leadHint"></span>
        <div class="panel-tools">
          ${Object.keys(STATUS_WORD)
            .map(
              (status) =>
                `<span class="legend-item lane-key is-${status.toLowerCase()}"><span class="mk">${shape(STATUS[status].shape)}</span>${status}</span>`,
            )
            .join("")}
        </div>
      </header>
      <div class="panel-body"><div data-ref="lanes"></div></div>
    </article>

    <section class="compare" data-ref="compare"></section>

    <section class="grid-12">
      <article class="panel span-6">
        <header class="panel-head"><h2>${icon("database", 17)}Total stok BBM seluruh SPBU</h2><span class="hint">KL, sampel per jam</span></header>
        <div class="panel-body"><div data-ref="stock"></div></div>
      </article>
      <article class="panel span-6">
        <header class="panel-head"><h2>${icon("fuel", 17)}Jumlah SPBU kosong</h2><span class="hint">sampel per jam</span></header>
        <div class="panel-body"><div data-ref="empty"></div></div>
      </article>
    </section>

    <section class="grid-12">
      <article class="panel span-6">
        <header class="panel-head"><h2>${icon("file", 17)}Perbandingan indikator</h2><span class="hint">baris <b>masukan</b> ditetapkan skenario, bukan dihasilkan model</span></header>
        <div class="panel-body"><div class="table-wrap" data-ref="metrics"></div></div>
      </article>
      <article class="panel span-6">
        <header class="panel-head"><h2>${icon("sliders", 17)}Asumsi model &amp; skenario</h2></header>
        <div class="panel-body"><div class="table-wrap" data-ref="assumptions"></div></div>
      </article>
    </section>
    </div>`;

  let cache = null;

  /** Kedua skenario deterministik, jadi cukup dihitung sekali. */
  function results() {
    if (!cache) {
      const base = engine.runScenario(config, { withSystem: false });
      const system = engine.runScenario(config, { withSystem: true });
      cache = {
        base,
        system,
        mBase: engine.metrics(base),
        mSystem: engine.metrics(system),
      };
    }
    return cache;
  }

  const at = (t) => (t === null ? "tidak terjadi" : stamp(t));
  const duration = (hours) => (hours === null ? "–" : span(hours));
  const kl = (value) => `${num(value)} KL`;

  function compareTiles({ system, mBase, mSystem }) {
    const total = system.spbu.length;
    const tiles = [
      {
        label: "SPBU yang sempat kosong",
        base: mBase.spbuEverEmpty,
        sys: mSystem.spbuEverEmpty,
        fmt: (v) => `${num(v)} dari ${total}`,
      },
      {
        label: "Total jam SPBU kosong",
        base: mBase.stockoutHours,
        sys: mSystem.stockoutHours,
        fmt: (v) => `${num(v)} jam`,
      },
      {
        label: "Permintaan tak terlayani",
        base: mBase.unservedKL,
        sys: mSystem.unservedKL,
        fmt: kl,
      },
      {
        label: "Puncak waktu antre (estimasi)",
        base: mBase.peakQueueMinutes,
        sys: mSystem.peakQueueMinutes,
        fmt: wait,
      },
    ];
    const blue = ui.seriesColor(0);
    const gray = ui.seriesColor(1);
    return tiles
      .map((tile) => {
        const top = Math.max(tile.base, tile.sys) || 1;
        const delta =
          tile.base > 0 ? ((tile.sys - tile.base) / tile.base) * 100 : 0;
        return `<article class="cmp">
          <div class="cmp-head"><p class="cmp-label">${esc(tile.label)}</p><span class="cmp-delta">${delta <= 0 ? "−" : "+"}${num(Math.abs(delta), Math.abs(delta) >= 99.5 && tile.sys !== 0 ? 1 : 0)}%</span></div>
          <div class="cmp-row"><span class="cmp-name"><i style="background:${blue}"></i>${SYSTEM_NAME}</span><b>${esc(tile.fmt(tile.sys))}</b></div>
          <div class="cmp-bar"><span style="width:${((tile.sys / top) * 100).toFixed(1)}%;background:${blue}"></span></div>
          <div class="cmp-row is-base"><span class="cmp-name"><i style="background:${gray}"></i>${BASELINE_NAME}</span><b>${esc(tile.fmt(tile.base))}</b></div>
          <div class="cmp-bar"><span style="width:${((tile.base / top) * 100).toFixed(1)}%;background:${gray}"></span></div>
        </article>`;
      })
      .join("");
  }

  function metricRows({ system, mBase, mSystem }) {
    const total = system.spbu.length;
    const cap = config.model.queueCapMinutes;
    const queue = (minutes) =>
      `${wait(minutes)}${minutes >= cap ? ", batas model" : ""}`;
    const lead =
      mBase.firstEmptyAt !== null && mSystem.waspadaAt !== null
        ? mBase.firstEmptyAt - mSystem.waspadaAt
        : null;
    return [
      ["Peringatan WASPADA", "hasil", "tidak ada", at(mSystem.waspadaAt)],
      [
        "Peringatan sebelum SPBU pertama kosong",
        "hasil",
        "tidak ada",
        lead === null ? "–" : span(lead),
      ],
      [
        "Kondisi KRISIS tercapai",
        "hasil",
        `${at(mBase.krisisAt)}, tanpa peringatan`,
        `${at(mSystem.krisisAt)}, terpicu otomatis`,
      ],
      [
        "Kebijakan darurat terbit setelah KRISIS",
        "masukan",
        duration(mBase.policyResponseHours),
        duration(mSystem.policyResponseHours),
      ],
      [
        "SPBU yang sempat kosong",
        "hasil",
        `${mBase.spbuEverEmpty} dari ${total}`,
        `${mSystem.spbuEverEmpty} dari ${total}`,
      ],
      [
        "Total jam SPBU kosong",
        "hasil",
        num(mBase.stockoutHours),
        num(mSystem.stockoutHours),
      ],
      [
        "Permintaan tak terlayani",
        "hasil",
        kl(mBase.unservedKL),
        kl(mSystem.unservedKL),
      ],
      [
        "Volume jatuh ke spekulan",
        "hasil",
        kl(mBase.hoardedKL),
        kl(mSystem.hoardedKL),
      ],
      [
        "Volume tertahan kuota & kunci POS",
        "hasil",
        kl(mBase.blockedKL),
        kl(mSystem.blockedKL),
      ],
      [
        "Percobaan penimbunan ditolak",
        "hasil",
        num(mBase.rejectedTx),
        num(mSystem.rejectedTx),
      ],
      [
        "Puncak waktu antre (estimasi)",
        "hasil",
        queue(mBase.peakQueueMinutes),
        queue(mSystem.peakQueueMinutes),
      ],
      [
        "Cakupan stok terendah wilayah",
        "hasil",
        `${num(mBase.minCoverHours, 1)} jam`,
        `${num(mSystem.minCoverHours, 1)} jam`,
      ],
      [
        "Lama status di luar NORMAL",
        "hasil",
        duration(mBase.nonNormalHours),
        duration(mSystem.nonNormalHours),
      ],
      [
        "Kembali NORMAL",
        "hasil",
        at(mBase.normalAgainAt),
        at(mSystem.normalAgainAt),
      ],
    ];
  }

  function assumptionRows(total) {
    const { model, scenario, supply, ews: th, quota } = config;
    const pct = (value) => `${num(value * 100)}%`;
    const spare = config.terminals
      .filter((terminal) => terminal.spareKLday > 0)
      .map(
        (terminal) =>
          `${terminal.name.replace("TBBM ", "")} ${num(terminal.spareKLday)} KL/hari (${num(terminal.leadHours)} jam)`,
      )
      .join(", ");
    return [
      ["Jumlah SPBU", `${total} (lokasi ilustratif)`, "Contoh wireframe"],
      [
        "Lama simulasi / gangguan jalur",
        `${scenario.days} hari / ${span(scenario.disruptionEndHour - scenario.disruptionStartHour)}`,
        "Skenario uji",
      ],
      [
        "Pasokan utama saat gangguan",
        `${pct(scenario.supplyFactorDisrupted)} dari normal`,
        "Asumsi",
      ],
      [
        "Waktu tempuh truk: normal / gangguan",
        `${num(supply.leadNormalHours, 1)} / ${num(supply.leadDisruptedHours, 1)} jam`,
        "Asumsi",
      ],
      [
        "Pasokan susulan setelah jalur pulih",
        `+${pct(supply.catchUpFactor - 1)} sampai stok pulih`,
        "Asumsi",
      ],
      ["Kenaikan konsumsi saat panik", pct(model.panicIncrease), "Abstrak"],
      [
        "Pembelian spekulan saat panik",
        `${pct(model.hoardShare)} konsumsi normal`,
        "Asumsi",
      ],
      ["Info resmi meredam lonjakan panik", pct(model.riskCommCut), "Asumsi"],
      [
        "Kuota per nopol menahan lonjakan tersisa",
        pct(model.quotaPanicCut),
        "Asumsi",
      ],
      [
        "Jeriken / tangki modifikasi terblokir",
        pct(model.lockEffectiveness),
        "Asumsi",
      ],
      ["Penurunan konsumsi karena WFH", pct(model.wfhDemandCut), "Asumsi"],
      [
        "Kuota krisis per nopol per hari",
        `motor ${quota.motor} L, mobil ${quota.mobil} L`,
        "Wireframe",
      ],
      [
        "Ambang WASPADA",
        `R < ${num(th.rNormal, 1)} atau konsumsi > +${pct(th.consumptionWaspada - 1)}`,
        "Alur sistem",
      ],
      [
        "Ambang KRISIS",
        `R < ${num(th.rKrisis)} atau ≥ ${pct(th.criticalShareKrisis)} SPBU kritis`,
        "Alur sistem",
      ],
      ["R wilayah", "median R seluruh SPBU", "Asumsi"],
      ["Status turun setelah stabil", span(th.recoveryHoldHours), "Asumsi"],
      [
        "Kebijakan terbit: tanpa / dengan sistem",
        `${span(scenario.baselinePolicyDelayHours)} / ${span(scenario.policyDelayHours)}`,
        "Abstrak / skenario",
      ],
      ["Pengalihan suplai tersedia", spare, "Wireframe"],
    ];
  }

  function tableHTML(head, rows, strongColumn = -1) {
    const cells = (row) =>
      row
        .map(
          (cell, index) =>
            `<td${index === strongColumn ? ' class="is-strong"' : ""}>${esc(cell)}</td>`,
        )
        .join("");
    return `<table class="table"><thead><tr>${head.map((title) => `<th>${esc(title)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((row) => `<tr>${cells(row)}</tr>`)
      .join("")}</tbody></table>`;
  }

  function mount(root) {
    root.innerHTML = TEMPLATE;
    const r = refs(root);
    const data = results();
    const { scenario } = config;
    const { mBase, mSystem } = data;
    const end = scenario.days * 24;

    r.subtitle.textContent = `Gangguan jalur Gumitir ${span(scenario.disruptionEndHour - scenario.disruptionStartHour)} pada ${data.system.spbu.length} SPBU selama ${scenario.days} hari, dijalankan dua kali: tanpa sistem dan dengan SI-TANGGAP.`;
    const lead = mBase.firstEmptyAt - mSystem.waspadaAt;
    r.leadHint.textContent = `Peringatan muncul ${span(lead)} sebelum SPBU pertama kosong`;
    r.compare.innerHTML = compareTiles(data);
    r.metrics.innerHTML = tableHTML(
      ["Indikator", "Jenis", BASELINE_NAME, SYSTEM_NAME],
      metricRows(data),
      3,
    );
    r.assumptions.innerHTML = tableHTML(
      ["Parameter", "Nilai", "Sumber"],
      assumptionRows(data.system.spbu.length),
    );

    const xTicks = [];
    for (let day = 0; day < scenario.days; day += 1)
      xTicks.push({ x: day * 24, label: `H${day + 1}` });
    const band = {
      from: scenario.disruptionStartHour,
      to: scenario.disruptionEndHour,
      label: "Gangguan jalur Gumitir",
    };
    const lanes = [
      {
        name: SYSTEM_NAME,
        sub: "status terpantau tiap 15 menit",
        points: data.system.series.map((point) => [point.t, point.status]),
        marks: [
          {
            x: mSystem.waspadaAt,
            label: `WASPADA ${clock(mSystem.waspadaAt)}`,
          },
          { x: mSystem.krisisAt, label: `KRISIS ${clock(mSystem.krisisAt)}` },
          {
            x: mSystem.policyIssuedAt,
            label: `kebijakan +${span(mSystem.policyResponseHours)}`,
          },
          { x: mSystem.normalAgainAt, label: "NORMAL kembali" },
        ],
      },
      {
        name: BASELINE_NAME,
        sub: "status tidak terpantau",
        points: data.base.series.map((point) => [point.t, point.status]),
        marks: [
          {
            x: mBase.firstEmptyAt,
            label: `SPBU pertama kosong ${clock(mBase.firstEmptyAt)}`,
          },
          {
            x: mBase.policyIssuedAt,
            label: `kebijakan +${span(mBase.policyResponseHours)}`,
          },
          { x: mBase.normalAgainAt, label: "NORMAL kembali" },
        ],
      },
    ].map((lane) => ({
      ...lane,
      marks: lane.marks.filter((mark) => mark.x !== null),
    }));

    const seriesOf = (pick) => [
      {
        name: SYSTEM_NAME,
        color: ui.seriesColor(0),
        points: data.system.series.map((point) => [point.t, pick(point)]),
      },
      {
        name: BASELINE_NAME,
        color: ui.seriesColor(1),
        points: data.base.series.map((point) => [point.t, pick(point)]),
      },
    ];
    const dayTicks = xTicks
      .filter((_, index) => index % 2 === 0)
      .map((tick) => ({ ...tick, label: `Hari ${tick.x / 24 + 1}` }));

    function update() {
      charts.statusLanes(r.lanes, {
        lanes,
        x0: 0,
        x1: end,
        xTicks,
        band,
        statusWord: STATUS_WORD,
        ariaLabel:
          "Linimasa status wilayah per jam, dengan dan tanpa SI-TANGGAP",
      });
      const shared = {
        xTicks: dayTicks,
        band,
        xTitle: "Waktu",
        xFormat: stamp,
        height: 250,
      };
      charts.line(r.stock, {
        ...shared,
        series: seriesOf((point) => point.stockKL),
        yFormat: (value) => `${num(value)} KL`,
        ariaLabel: "Total stok BBM seluruh SPBU, dengan dan tanpa SI-TANGGAP",
      });
      charts.line(r.empty, {
        ...shared,
        series: seriesOf((point) => point.emptyCount),
        yFormat: (value) => `${num(value)} SPBU`,
        ariaLabel: "Jumlah SPBU kosong, dengan dan tanpa SI-TANGGAP",
      });
    }

    return { update, destroy() {} };
  }

  ns.views = ns.views || {};
  ns.views.hasil = { mount };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
