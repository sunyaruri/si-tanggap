// Lapis 2 – Layar operator POS SPBU (tablet). Kendaraan dibangkitkan secara sintetis;
// keputusan boleh isi / diblokir memakai aturan yang sama dengan core/pos.js.
(function (ns) {
  "use strict";

  const { ui, sim: engine, pos: lock, config } = ns;
  const { esc, num, icon, pill, setHTML, setText, refs, clock } = ui;
  const QUEUE_SIZE = 3;
  const JERRYCAN_SHARE = 0.07;
  const MODIFIED_TANK_SHARE = 0.04;
  const REPEAT_BUYER_SHARE = 0.3;
  const PLATE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

  const TYPES = [
    {
      type: "motor",
      label: "Sepeda motor",
      icon: "bike",
      fuel: "Pertalite",
      weight: 0.68,
      ask: [2, 5],
    },
    {
      type: "mobil",
      label: "Mobil pribadi",
      icon: "car",
      fuel: "Pertalite",
      weight: 0.26,
      ask: [15, 40],
    },
    {
      type: "niaga",
      label: "Kendaraan niaga",
      icon: "truck",
      fuel: "Solar",
      weight: 0.06,
      ask: [30, 60],
    },
  ];
  const TYPE_BY_ID = Object.fromEntries(TYPES.map((kind) => [kind.type, kind]));

  const REASONS = {
    jeriken: "Jeriken terdeteksi",
    "tangki-modifikasi": "Tangki modifikasi terdeteksi",
    "kuota-habis": "Kuota harian nopol ini habis",
    "jenis-tidak-dikenal": "Jenis kendaraan tidak dikenal",
  };

  // Keadaan meja POS bertahan saat pindah tampilan dan diulang bersama simulasi.
  const desk = {
    rnd: () => 0,
    ledger: new Map(),
    day: 1,
    current: null,
    queue: [],
    served: 0,
    rejected: 0,
    liters: 0,
  };

  function makeVehicle() {
    const rnd = desk.rnd;
    let roll = rnd();
    const kind =
      TYPES.find((candidate) => (roll -= candidate.weight) < 0) || TYPES[0];
    const letter = () =>
      PLATE_LETTERS[Math.floor(rnd() * PLATE_LETTERS.length)];
    const plate = `P ${1000 + Math.floor(rnd() * 9000)} ${letter()}${letter()}`;
    const jerrycan = rnd() < JERRYCAN_SHARE;
    const modifiedTank = !jerrycan && rnd() < MODIFIED_TANK_SHARE;
    const repeat = rnd() < REPEAT_BUYER_SHARE;
    const usedToday = repeat
      ? Math.round(rnd() * config.quota[kind.type] * 1.1)
      : 0;
    if (usedToday > 0) desk.ledger.set(plate, usedToday);
    return {
      plate,
      type: kind.type,
      jerrycan,
      modifiedTank,
      askLiters: Math.round(kind.ask[0] + rnd() * (kind.ask[1] - kind.ask[0])),
      confidence: 90 + Math.floor(rnd() * 10),
      lastFillHours: repeat
        ? 1 + Math.floor(rnd() * 9)
        : 18 + Math.floor(rnd() * 30),
      lastFillSpbu: ["Mangli", "Kaliwates", "Ajung", "Rambipuji 2"][
        Math.floor(rnd() * 4)
      ],
    };
  }

  /** @param {any} [sim] adegan "blokir" membuka kendaraan berjeriken untuk tangkapan layar. */
  function reset(sim) {
    desk.rnd = engine.random(config.seed + 7);
    desk.ledger = new Map();
    desk.day = 1;
    desk.served = 0;
    desk.rejected = 0;
    desk.liters = 0;
    desk.current = makeVehicle();
    desk.queue = Array.from({ length: QUEUE_SIZE }, makeVehicle);
    if (sim && sim.scene === "blokir")
      desk.current = { ...desk.current, jerrycan: true, modifiedTank: false };
  }

  function advance() {
    desk.current = desk.queue.shift();
    desk.queue.push(makeVehicle());
  }

  const used = (vehicle) => desk.ledger.get(vehicle.plate) || 0;
  const decide = (vehicle, sim) =>
    lock.checkTransaction(vehicle, used(vehicle), sim.crisisMode);
  const litersFor = (vehicle, decision) =>
    Math.min(vehicle.askLiters, decision.maxLiters);
  /** Angka di tombol dan antrean: batas kuota saat krisis, permintaan pengendara saat normal. */
  const shownLiters = (vehicle, decision) =>
    Number.isFinite(decision.maxLiters)
      ? decision.maxLiters
      : vehicle.askLiters;

  // ---------- Ilustrasi kamera ANPR (SVG 640×360) ----------
  // Warna kotak deteksi: tanda NORMAL dan KRISIS tema v2, versi KRISIS dicerahkan agar terbaca di latar gelap.
  const CAM_OK = "#25ae83";
  const CAM_ALERT = "#e4575d";
  const BODIES = {
    mobil: {
      plate: { x: 272, y: 214, w: 96, h: 28, fs: 15 },
      body: { x: 176, y: 92, w: 288, h: 196 },
      svg: `<ellipse cx="320" cy="300" rx="172" ry="14" fill="#000" opacity=".45"/>
        <rect x="196" y="268" width="46" height="36" rx="8" fill="#0b0f15"/><rect x="398" y="268" width="46" height="36" rx="8" fill="#0b0f15"/>
        <path d="M236 120 Q244 98 270 96 L370 96 Q396 98 404 120 L428 170 L212 170 Z" fill="#40516c"/>
        <path d="M249 125 Q255 108 273 107 L367 107 Q385 108 391 125 L407 162 L233 162 Z" fill="#8aa1bb" opacity=".35"/>
        <rect x="180" y="158" width="280" height="122" rx="26" fill="#62769a"/>
        <rect x="192" y="160" width="256" height="8" rx="4" fill="#64779a" opacity=".7"/>
        <rect x="194" y="182" width="60" height="22" rx="6" fill="#e04848"/><rect x="386" y="182" width="60" height="22" rx="6" fill="#e04848"/>
        <rect x="186" y="252" width="268" height="24" rx="10" fill="#3b4a61"/>`,
    },
    motor: {
      plate: { x: 288, y: 216, w: 64, h: 20, fs: 11 },
      body: { x: 244, y: 58, w: 152, h: 248 },
      svg: `<ellipse cx="320" cy="304" rx="72" ry="10" fill="#000" opacity=".45"/>
        <rect x="306" y="246" width="28" height="58" rx="12" fill="#0b0f15"/>
        <path d="M276 130 L246 186 L258 193 L290 141Z" fill="#4c6080"/><path d="M364 130 L394 186 L382 193 L350 141Z" fill="#4c6080"/>
        <rect x="234" y="182" width="32" height="9" rx="4" fill="#1d2633"/><rect x="374" y="182" width="32" height="9" rx="4" fill="#1d2633"/>
        <path d="M276 120 Q320 104 364 120 L374 198 Q320 208 266 198 Z" fill="#4c6080"/>
        <circle cx="320" cy="92" r="31" fill="#3d4a60"/><rect x="315" y="62" width="10" height="58" rx="5" fill="#3e4b5e"/>
        <path d="M268 198 Q320 184 372 198 L366 240 Q320 250 274 240 Z" fill="#62769a"/>
        <rect x="296" y="200" width="48" height="10" rx="5" fill="#e04848"/>`,
    },
    niaga: {
      plate: { x: 270, y: 250, w: 100, h: 26, fs: 15 },
      body: { x: 166, y: 52, w: 308, h: 258 },
      svg: `<ellipse cx="320" cy="306" rx="192" ry="14" fill="#000" opacity=".45"/>
        <rect x="178" y="272" width="56" height="34" rx="8" fill="#0b0f15"/><rect x="406" y="272" width="56" height="34" rx="8" fill="#0b0f15"/>
        <rect x="170" y="56" width="300" height="200" rx="10" fill="#6f82a0"/>
        <rect x="170" y="56" width="300" height="12" rx="6" fill="#8193b0"/>
        <path d="M320 70 V244" stroke="#46546a" stroke-width="3"/>
        <rect x="290" y="140" width="12" height="40" rx="4" fill="#3b4759"/><rect x="338" y="140" width="12" height="40" rx="4" fill="#3b4759"/>
        <rect x="176" y="250" width="288" height="28" rx="6" fill="#3b4a61"/>
        <rect x="186" y="230" width="42" height="16" rx="4" fill="#e04848"/><rect x="412" y="230" width="42" height="16" rx="4" fill="#e04848"/>`,
    },
  };

  /** Kotak deteksi bergaya kamera AI dengan label di atasnya. */
  function detection(box, color, label, below = false) {
    const { x, y, w, h } = box;
    const c = Math.min(16, w / 3, h / 3);
    const corners = [
      `M${x} ${y + c}V${y}H${x + c}`,
      `M${x + w - c} ${y}H${x + w}V${y + c}`,
      `M${x + w} ${y + h - c}V${y + h}H${x + w - c}`,
      `M${x + c} ${y + h}H${x}V${y + h - c}`,
    ].join("");
    const tagW = label.length * 6.9 + 14;
    const tagY = below || y - 22 < 4 ? y + h + 4 : y - 22;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" fill-opacity=".08" stroke="${color}" stroke-width="1.5" stroke-opacity=".7"/>
      <path d="${corners}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <rect x="${x}" y="${tagY}" width="${tagW}" height="19" rx="4" fill="${color}"/>
      <text x="${x + 7}" y="${tagY + 13.5}" font-size="11.5" font-weight="800" fill="#0b0f15">${esc(label)}</text>`;
  }

  function cameraSVG(vehicle, t) {
    const body = BODIES[vehicle.type];
    const p = body.plate;
    let overlays = detection(
      { x: p.x - 10, y: p.y - 10, w: p.w + 20, h: p.h + 20 },
      CAM_OK,
      `NOPOL ${vehicle.plate} · ${vehicle.confidence}%`,
      true,
    );
    let extra = "";
    if (vehicle.jerrycan) {
      const jx = vehicle.type === "motor" ? 432 : 486;
      extra = `<g transform="translate(${jx} 206)"><rect x="0" y="12" width="46" height="60" rx="7" fill="#2c8adc"/><rect x="8" y="0" width="22" height="16" rx="5" fill="none" stroke="#2c8adc" stroke-width="6"/><rect x="32" y="3" width="9" height="11" rx="2" fill="#0a5894"/><path d="M8 32 L38 54 M38 32 L8 54" stroke="#0c3f6a" stroke-width="3"/></g>`;
      overlays += detection(
        { x: jx - 8, y: 196, w: 62, h: 86 },
        CAM_ALERT,
        "JERIKEN · 94%",
      );
    }
    if (vehicle.modifiedTank) {
      const b = body.body;
      overlays += detection(
        { x: b.x, y: b.y + b.h * 0.45, w: b.w, h: b.h * 0.5 },
        CAM_ALERT,
        "TANGKI MODIFIKASI · 91%",
      );
    }
    return `<svg viewBox="0 0 640 360" role="img" aria-label="Ilustrasi kamera ANPR: kendaraan ${esc(vehicle.plate)}">
      <rect width="640" height="360" fill="#141c26"/>
      <path d="M0 360 L246 150 L394 150 L640 360Z" fill="#1a2333"/>
      <path d="M246 150 L60 360 M394 150 L580 360" stroke="#2b3647" stroke-width="3"/>
      <rect x="0" y="0" width="640" height="30" fill="#273244"/><rect x="0" y="30" width="640" height="4" fill="#cfdbec" opacity=".45"/>
      <rect x="36" y="34" width="20" height="270" fill="#1f2937"/><rect x="584" y="34" width="20" height="270" fill="#1f2937"/>
      ${body.svg}
      <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3" fill="#f5f7fa" stroke="#0b0f15" stroke-width="2"/>
      <text x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + p.fs * 0.36}" text-anchor="middle" font-size="${p.fs}" font-weight="800" fill="#0b0f15">${esc(vehicle.plate)}</text>
      ${extra}
      ${overlays}
      <rect x="10" y="40" width="226" height="24" rx="6" fill="#000" opacity=".55"/>
      <circle cx="24" cy="52" r="5" fill="${CAM_ALERT}"/>
      <text x="36" y="56.5" font-size="12" font-weight="800" fill="#e5edf7">CAM-03 · JALUR ANTRE POMPA 3</text>
      <rect x="548" y="40" width="82" height="24" rx="6" fill="#000" opacity=".55"/>
      <text x="589" y="56.5" text-anchor="middle" font-size="12.5" font-weight="800" fill="#e5edf7">${clock(t)}</text>
      <rect x="10" y="326" width="252" height="24" rx="6" fill="#000" opacity=".55"/>
      <text x="20" y="342.5" font-size="11.5" font-weight="700" fill="#cbd5e1">ANPR (YOLO + OCR) di edge server SPBU</text>
      <rect x="430" y="326" width="200" height="24" rx="6" fill="#000" opacity=".55"/>
      <text x="530" y="342.5" text-anchor="middle" font-size="11.5" font-weight="700" fill="#cbd5e1">Ilustrasi, bukan rekaman nyata</text>
    </svg>`;
  }

  // ---------- Template ----------
  const TEMPLATE = `
    <div class="device-tablet">
      <div class="device-screen">
        <header class="pos-bar">
          <span class="logo-mark">${ns.icons.logo(18)}</span>
          <p class="pos-title">SI-TANGGAP POS<small>SPBU ${esc(config.posStation.spbuName)}, pompa ${config.posStation.pump}</small></p>
          <div class="pos-bar-right">
            <span data-ref="mode"></span>
            <span class="pos-clock" data-ref="clock"></span>
          </div>
        </header>
        <div class="pos-body">
          <section class="stack">
            <div class="cam" data-ref="camera"></div>
            <div class="panel">
              <div class="panel-body" style="padding-top: 14px">
                <div class="plate-read" data-ref="vehicle"></div>
                <form class="correction" data-ref="correction" novalidate>
                  <label class="sr-only" for="plate-input">Koreksi nopol manual</label>
                  <span class="input-wrap"><span>${icon("scan", 16)}</span><input id="plate-input" type="text" name="plate" maxlength="12" placeholder="Koreksi nopol manual, mis. P 1234 AB" autocomplete="off" aria-describedby="plate-error"></span>
                  <button type="submit" class="btn">Cek ulang</button>
                </form>
                <p class="field-error" id="plate-error" data-ref="plateError" role="alert"></p>
              </div>
            </div>
          </section>
          <section class="stack" data-ref="decision"></section>
        </div>
        <div style="padding: 0 16px 16px">
          <div class="panel">
            <header class="panel-head">
              <h2>${icon("users", 17)}Antrean berikutnya</h2>
              <span class="hint">terbaca kamera jalur antre</span>
              <div class="panel-tools" data-ref="counters"></div>
            </header>
            <div class="panel-body"><div class="queue" data-ref="queue"></div></div>
          </div>
        </div>
      </div>
    </div>`;

  function vehicleHTML(vehicle) {
    const kind = TYPE_BY_ID[vehicle.type];
    return `<span class="plate-lg">${esc(vehicle.plate)}</span>
      <span class="plate-meta">
        <b>${esc(kind.label)}</b>
        <span>${esc(kind.fuel)}</span>
        <span class="chip">${icon("scan", 14)}Terbaca <b>${vehicle.confidence}%</b></span>
      </span>`;
  }

  function decisionHTML(vehicle, decision, sim) {
    const crisis = sim.crisisMode.active;
    const detected = vehicle.jerrycan
      ? "Jeriken"
      : vehicle.modifiedTank
        ? "Tangki modifikasi"
        : "Tidak ada";
    const facts = `<dl class="facts">
      <dt>Jeriken atau tangki modifikasi</dt><dd class="${detected === "Tidak ada" ? "" : "is-alert"}">${detected}</dd>
      <dt>Pengisian terakhir</dt><dd>${vehicle.lastFillHours} jam lalu di SPBU ${esc(vehicle.lastFillSpbu)}</dd>
      <dt>Permintaan pengendara</dt><dd>${num(vehicle.askLiters)} liter</dd>
    </dl>`;

    const quota = crisis ? sim.crisisMode.quota[vehicle.type] : null;
    const usedToday = used(vehicle);
    const quotaBox = crisis
      ? `<div class="quota">
          <span class="sla-label">Sisa kuota hari ini</span>
          <span class="quota-value">${num(Math.max(0, quota - usedToday), 1)} liter</span>
          <div class="meter"><span class="fill" style="width:${Math.max(0, ((quota - usedToday) / quota) * 100).toFixed(1)}%;background:var(--brand)"></span></div>
          <span class="note">Terpakai ${num(usedToday)} dari ${num(quota)} liter, dihitung di semua SPBU</span>
        </div>`
      : `<div class="quota"><span class="sla-label">Kuota per nopol</span><span class="quota-value">Tanpa batas</span><span class="note">Kuota berlaku otomatis saat status KRISIS.</span></div>`;

    if (!decision.allowed) {
      return `<div class="verdict is-blocked"><span class="verdict-icon">${icon("ban", 30)}</span><div><strong>DIBLOKIR</strong>${esc(REASONS[decision.reason])}</div></div>
        ${quotaBox}${facts}
        <button type="button" class="btn btn-primary btn-lg btn-block" data-action="reject">${icon("x", 20)}Catat penolakan</button>`;
    }
    const liters = shownLiters(vehicle, decision);
    return `<div class="verdict is-ok"><span class="verdict-icon">${icon("check", 30)}</span><div><strong>BOLEH ISI</strong>${crisis ? "Masih dalam kuota harian" : "Tanpa batas volume"}</div></div>
      ${quotaBox}${facts}
      <div class="btn-row" style="display:flex;gap:10px">
        <button type="button" class="btn btn-primary btn-lg" style="flex:2" data-action="fill">${icon("fuel", 20)}${crisis ? `Isi maks ${num(liters)} L` : `Isi ${num(liters)} L`}</button>
        <button type="button" class="btn btn-lg" style="flex:1" data-action="reject">Tolak</button>
      </div>`;
  }

  function queueHTML(sim) {
    return desk.queue
      .map((vehicle) => {
        const decision = decide(vehicle, sim);
        const kind = TYPE_BY_ID[vehicle.type];
        const liters = num(shownLiters(vehicle, decision));
        const text = !decision.allowed
          ? REASONS[decision.reason]
          : sim.crisisMode.active && used(vehicle) > 0
            ? `Sisa kuota ${liters} L`
            : `Boleh isi ${liters} L`;
        const mark = decision.allowed
          ? ui.marker("ok", "circle")
          : ui.marker("crit", "square");
        return `<div class="q-card${decision.allowed ? "" : " is-blocked"}"><span class="q-icon">${icon(kind.icon, 22)}</span><div class="q-body"><span class="plate-chip">${esc(vehicle.plate)}</span><span class="q-status">${mark}${esc(text)}</span></div></div>`;
      })
      .join("");
  }

  function mount(root, app) {
    if (!desk.current) reset();
    root.innerHTML = TEMPLATE;
    const r = refs(root);

    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      const decision = decide(desk.current, app.sim);
      if (action !== "reject" && !(action === "fill" && decision.allowed)) return;
      // Simpan keadaan meja supaya transaksi bisa dibatalkan beberapa detik.
      const vehicle = desk.current;
      const before = {
        current: vehicle,
        queue: [...desk.queue],
        served: desk.served,
        rejected: desk.rejected,
        liters: desk.liters,
        usedBefore: desk.ledger.get(vehicle.plate),
      };
      let text;
      if (action === "fill") {
        const liters = litersFor(vehicle, decision);
        desk.ledger.set(vehicle.plate, used(vehicle) + liters);
        desk.served += 1;
        desk.liters += liters;
        text = `${vehicle.plate} · diisi ${num(liters)} L`;
      } else {
        desk.rejected += 1;
        text = `${vehicle.plate} · ditolak`;
      }
      advance();
      r.plateError.textContent = "";
      app.render();
      ui.undoable({
        text,
        seconds: 5,
        onUndo() {
          Object.assign(desk, {
            current: before.current,
            queue: before.queue,
            served: before.served,
            rejected: before.rejected,
            liters: before.liters,
          });
          if (before.usedBefore === undefined) desk.ledger.delete(vehicle.plate);
          else desk.ledger.set(vehicle.plate, before.usedBefore);
          app.render();
        },
      });
    });

    r.correction.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = r.correction.elements.plate;
      const plate = lock.parsePlate(input.value);
      if (!plate) {
        r.plateError.textContent =
          "Format nopol tidak valid. Contoh yang benar: P 1234 AB.";
        input.focus();
        return;
      }
      r.plateError.textContent = "";
      desk.current = { ...desk.current, plate };
      input.value = "";
      app.render();
    });

    function update(sim) {
      const day = ui.dayNumber(sim.t);
      if (day !== desk.day) {
        desk.day = day;
        desk.ledger.clear(); // kuota per nopol berlaku per hari
      }
      setHTML(
        r.mode,
        sim.crisisMode.active
          ? pill("KRISIS", { label: "MODE KRISIS AKTIF", large: true })
          : pill("NORMAL", { label: "MODE NORMAL", large: true }),
      );
      setText(r.clock, clock(sim.t));
      setHTML(r.camera, cameraSVG(desk.current, sim.t));
      setHTML(r.vehicle, vehicleHTML(desk.current));
      setHTML(
        r.decision,
        decisionHTML(desk.current, decide(desk.current, sim), sim),
      );
      setHTML(r.queue, queueHTML(sim));
      setHTML(
        r.counters,
        `<span class="chip">Dilayani <b>${num(desk.served)}</b></span><span class="chip">Ditolak <b>${num(desk.rejected)}</b></span><span class="chip">Terjual <b>${num(desk.liters)}</b> L</span>`,
      );
    }

    return { update, destroy() {} };
  }

  ns.views = ns.views || {};
  ns.views.pos = { mount, reset };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
