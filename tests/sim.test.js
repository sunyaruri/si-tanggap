"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../js/core/config.js");
require("../js/core/ews.js");
require("../js/core/sim.js");
const { sim, config } = globalThis.SiTanggap;

function calmConfig() {
  const cfg = structuredClone(config);
  cfg.scenario.disruptionStartHour = Infinity;
  return cfg;
}

function stepUntil(state, predicate, maxHours = 240) {
  const maxTicks = maxHours / state.cfg.tickHours;
  for (let i = 0; i < maxTicks && !predicate(state); i++) sim.step(state);
  assert.ok(predicate(state), "kondisi tidak tercapai dalam batas waktu");
}

const totalStock = (state) => state.spbu.reduce((sum, s) => sum + s.stockKL, 0);

test("proyeksi stok turun sesuai laju konsumsi sampai habis", () => {
  const points = sim.projectStock(
    { stockKL: 100, demandKLh: 10, arrivals: [], inflows: [] },
    12,
  );
  assert.equal(points[5].stockKL, 50);
  assert.equal(points[10].stockKL, 0);
  assert.equal(points[12].stockKL, 0);
});

test("proyeksi stok menghitung truk di jalan dan pasokan baru setelah waktu tempuh", () => {
  const input = {
    stockKL: 100,
    demandKLh: 10,
    arrivals: [{ inHours: 2.5, volumeKL: 16 }],
    inflows: [{ afterHours: 4, rateKLh: 10 }],
  };
  const stocks = sim.projectStock(input, 6).map((point) => point.stockKL);
  assert.deepEqual(stocks, [100, 90, 80, 86, 76, 76, 76]);
});

test("posisi truk diinterpolasi sepanjang lintasan dan tidak melewati ujungnya", () => {
  const path = [
    [0, 0],
    [0, 10],
    [10, 10],
  ];
  assert.deepEqual(sim.pointAlong(path, 0), [0, 0]);
  assert.deepEqual(sim.pointAlong(path, 0.5), [0, 10]);
  assert.deepEqual(sim.pointAlong(path, 0.75), [5, 10]);
  assert.deepEqual(sim.pointAlong(path, 1.4), [10, 10]);
});

test("pengalihan suplai diambil dari terminal ber-ETA terpendek lebih dulu", () => {
  const terminals = [
    { id: "jauh", name: "Jauh", spareKLday: 300, leadHours: 9, costPct: 8 },
    { id: "dekat", name: "Dekat", spareKLday: 180, leadHours: 6, costPct: 5 },
    { id: "utama", name: "Utama", primary: true },
  ];
  const pairs = (deficit) =>
    sim
      .planDiversion(deficit, terminals)
      .map((item) => [item.terminalId, item.kLday]);
  assert.deepEqual(pairs(100), [["dekat", 100]]);
  assert.deepEqual(pairs(200), [
    ["dekat", 180],
    ["jauh", 20],
  ]);
  assert.deepEqual(pairs(1000), [
    ["dekat", 180],
    ["jauh", 300],
  ]);
  assert.deepEqual(pairs(0), []);
});

test("tanpa gangguan pasokan, status tetap NORMAL dan tidak ada SPBU kosong", () => {
  const metrics = sim.metrics(
    sim.runScenario(calmConfig(), { withSystem: true }),
  );
  assert.equal(metrics.waspadaAt, null);
  assert.equal(metrics.krisisAt, null);
  assert.equal(metrics.spbuEverEmpty, 0);
});

test("simulasi deterministik: dua kali jalan memberi hasil yang sama", () => {
  const first = sim.metrics(sim.runScenario(config, { withSystem: true }));
  const second = sim.metrics(sim.runScenario(config, { withSystem: true }));
  assert.deepEqual(first, second);
});

test("stok SPBU tidak pernah negatif atau melebihi kapasitas", () => {
  const state = sim.createSim(config, { withSystem: false });
  const ticks = (config.scenario.days * 24) / config.tickHours;
  for (let i = 0; i < ticks; i++) {
    sim.step(state);
    for (const s of state.spbu) {
      assert.ok(
        s.stockKL >= 0,
        `stok negatif di ${s.name} pada jam ${state.t}`,
      );
      assert.ok(
        s.stockKL <= s.capacityKL + 1e-9,
        `stok melebihi kapasitas di ${s.name} pada jam ${state.t}`,
      );
    }
  }
});

test("neraca volume tertutup: stok awal + kiriman − penjualan = stok akhir", () => {
  const state = sim.runScenario(config, { withSystem: true });
  const expected =
    state.initialStockKL + state.totals.deliveredKL - state.totals.soldKL;
  assert.ok(Math.abs(expected - totalStock(state)) < 1e-6);
});

test("peringatan WASPADA muncul sebelum SPBU pertama kosong pada skenario tanpa sistem", () => {
  const baseline = sim.metrics(sim.runScenario(config, { withSystem: false }));
  const system = sim.metrics(sim.runScenario(config, { withSystem: true }));
  assert.notEqual(baseline.firstEmptyAt, null);
  assert.notEqual(system.waspadaAt, null);
  assert.ok(
    system.waspadaAt >= config.scenario.disruptionStartHour,
    "tidak boleh ada alarm sebelum gangguan",
  );
  assert.ok(system.waspadaAt < baseline.firstEmptyAt);
});

test("mode krisis POS aktif otomatis saat status KRISIS", () => {
  const state = sim.createSim(config, { withSystem: true });
  assert.equal(state.crisisMode.active, false);
  stepUntil(state, (s) => s.region.status === "KRISIS");
  assert.equal(state.crisisMode.active, true);
});

test("tanpa sistem, mode krisis POS tidak pernah aktif", () => {
  const metrics = sim.metrics(sim.runScenario(config, { withSystem: false }));
  assert.notEqual(metrics.krisisAt, null);
  assert.equal(metrics.crisisModeEverActive, false);
  assert.equal(metrics.blockedKL, 0);
});

test("waktu respons kebijakan: 3 jam dengan sistem, 120 jam tanpa sistem", () => {
  const system = sim.metrics(sim.runScenario(config, { withSystem: true }));
  const baseline = sim.metrics(sim.runScenario(config, { withSystem: false }));
  assert.equal(system.policyResponseHours, 3);
  assert.equal(baseline.policyResponseHours, 120);
});

test("dengan sistem, jam SPBU kosong lebih sedikit daripada tanpa sistem", () => {
  const system = sim.metrics(sim.runScenario(config, { withSystem: true }));
  const baseline = sim.metrics(sim.runScenario(config, { withSystem: false }));
  assert.ok(baseline.stockoutHours > 0);
  assert.ok(system.stockoutHours < baseline.stockoutHours);
});

test("status kembali NORMAL dan mode krisis dicabut setelah gangguan selesai", () => {
  const state = sim.runScenario(config, { withSystem: true });
  assert.equal(state.region.status, "NORMAL");
  assert.equal(state.crisisMode.active, false);
  assert.equal(state.sources.length, 1);
});

test("persetujuan kebijakan menutup SLA dan membuat permintaan pengalihan suplai", () => {
  const state = sim.createSim(config, { withSystem: true });
  stepUntil(state, (s) => s.region.status === "KRISIS");
  assert.equal(state.sla.doneAt, null);

  assert.equal(sim.approvePolicy(state), true);
  assert.equal(state.sla.doneAt, state.t);
  assert.equal(state.wfhActive, true);
  assert.equal(state.diversion.requestedAt, state.t);
  const requested = state.diversion.plan.reduce(
    (sum, item) => sum + item.kLday,
    0,
  );
  assert.ok(requested > 0 && requested <= 480);

  assert.equal(
    sim.approvePolicy(state),
    false,
    "tidak boleh disetujui dua kali",
  );
});

test("kebijakan yang tidak dicentang tidak dijalankan", () => {
  const state = sim.createSim(config, { withSystem: true });
  stepUntil(state, (s) => s.region.status === "KRISIS");
  sim.approvePolicy(state, ["jalur-prioritas"]);
  assert.equal(state.wfhActive, false);
  assert.equal(state.diversion, null);
});

test("persetujuan Pertamina mengaktifkan sumber pasokan tambahan", () => {
  const state = sim.createSim(config, { withSystem: true });
  stepUntil(state, (s) => s.region.status === "KRISIS");
  assert.equal(sim.approveDiversion(state), false, "belum ada permintaan");
  sim.approvePolicy(state);
  assert.equal(sim.approveDiversion(state), true);
  assert.deepEqual(
    state.sources.map((source) => source.id),
    ["tanjungwangi", "malang", "surabaya"],
  );
  assert.equal(
    sim.approveDiversion(state),
    false,
    "tidak boleh disetujui dua kali",
  );
});

test("laporan warga divalidasi: jenis harus dikenal, isi 1–200 karakter", () => {
  const state = sim.createSim(config, { withSystem: true });
  assert.equal(
    sim.addReport(state, {
      type: "penimbunan",
      text: "  Jeriken di SPBU Mangli  ",
    }),
    true,
  );
  assert.equal(state.reports[0].text, "Jeriken di SPBU Mangli");
  assert.equal(
    sim.addReport(state, { type: "penimbunan", text: "   " }),
    false,
  );
  assert.equal(sim.addReport(state, { type: "lainnya", text: "isi" }), false);
  assert.equal(
    sim.addReport(state, { type: "hoaks", text: "x".repeat(201) }),
    false,
  );
  assert.equal(state.reports.length, 1);
});

test("parameter kuota krisis divalidasi sebelum diterapkan ke POS", () => {
  const state = sim.createSim(config, { withSystem: true });
  assert.equal(
    sim.setCrisisQuota(state, { motor: 3, mobil: 15, niaga: 40 }),
    true,
  );
  assert.deepEqual(state.crisisMode.quota, { motor: 3, mobil: 15, niaga: 40 });
  assert.equal(
    sim.setCrisisQuota(state, { motor: -1, mobil: 15, niaga: 40 }),
    false,
  );
  assert.equal(
    sim.setCrisisQuota(state, { motor: 3, mobil: Number.NaN, niaga: 40 }),
    false,
  );
  assert.equal(sim.setCrisisQuota(state, { motor: 3, mobil: 15 }), false);
  assert.deepEqual(state.crisisMode.quota, { motor: 3, mobil: 15, niaga: 40 });
});

test("transaksi ditolak hanya menghitung percobaan penimbunan yang diblokir", () => {
  const metrics = sim.metrics(sim.runScenario(config, { withSystem: true }));
  assert.ok(metrics.rejectedTx > 0);
  const rejectedKL = (metrics.rejectedTx * config.model.avgHoardLiters) / 1000;
  assert.ok(rejectedKL <= metrics.blockedKL, `${rejectedKL} KL ditolak > ${metrics.blockedKL} KL tertahan`);
});

test("dengan sistem, status KRISIS terpicu sekali saja (tidak naik-turun mengikuti siklus harian)", () => {
  const state = sim.runScenario(config, { withSystem: true });
  const krisis = state.transitions.filter((transition) => transition.status === "KRISIS");
  assert.equal(krisis.length, 1);
});

test("tanpa sistem pun stok wilayah pulih di atas 24 jam setelah jalur kembali normal", () => {
  const state = sim.runScenario(config, { withSystem: false });
  assert.ok(state.region.coverHours > 24, `cakupan akhir ${state.region.coverHours} jam`);
});

test("status NORMAL baru kembali setelah 24 jam penuh sejak jalur pulih", () => {
  const metrics = sim.metrics(sim.runScenario(config, { withSystem: true }));
  const sinceReopened = metrics.normalAgainAt - config.scenario.disruptionEndHour;
  assert.ok(sinceReopened >= config.ews.recoveryHoldHours, `baru ${sinceReopened} jam`);
});

test("kepatuhan SLA: dengan sistem semua keputusan tepat waktu, tanpa sistem SLA KRISIS terlewat", () => {
  const withSystem = sim.runScenario(config, { withSystem: true });
  const fast = sim.slaCompliance(withSystem);
  assert.ok(fast.total >= 2, "WASPADA dan KRISIS sama-sama tercatat");
  assert.equal(fast.onTime, fast.total);
  assert.equal(fast.pending, 0);

  const baseline = sim.runScenario(config, { withSystem: false });
  const slow = sim.slaCompliance(baseline);
  assert.ok(slow.total >= 1);
  assert.ok(slow.onTime < slow.total, "kebijakan 120 jam melewati batas 24 jam");
});

test("laporan hoaks diklarifikasi di kanal resmi setelah jeda verifikasi, laporan penimbunan tidak", () => {
  const state = sim.createSim(calmConfig(), { withSystem: true });
  assert.ok(sim.addReport(state, { type: "hoaks", text: "SPBU Kaliwates tutup permanen" }));
  assert.ok(sim.addReport(state, { type: "penimbunan", text: "Jeriken di SPBU Ajung" }));
  const [hoax, hoarding] = state.reports;
  assert.equal(hoax.clarifiedAt, null);
  stepUntil(state, (s) => s.t >= s.cfg.scenario.hoaxClarifyHours, 24);
  sim.step(state);
  assert.ok(hoax.clarifiedAt !== null && hoax.clarifiedAt >= hoax.t + state.cfg.scenario.hoaxClarifyHours);
  assert.equal(hoarding.clarifiedAt, null);
  assert.equal(state.log.filter((row) => row.kind === "clarify").length, 1);
});

test("rasio permintaan: 1 saat normal, naik saat panik termasuk yang ditahan kuota", () => {
  const state = sim.createSim(calmConfig(), { withSystem: true });
  assert.equal(sim.demandRatio(state), 1);
  state.panic = 1;
  const panicked = sim.demandRatio(state);
  assert.ok(panicked > 1.2, `permintaan panik ${panicked}`);
  state.crisisMode.active = true;
  assert.equal(sim.demandRatio(state), panicked, "kuota menahan penjualan, bukan permintaan");
});

test("prospek stok: tanpa gangguan tidak habis; saat KRISIS ada waktu kritis lalu habis", () => {
  const calm = sim.createSim(calmConfig(), { withSystem: true });
  assert.equal(sim.stockOutlook(calm).emptyIn, null);

  const state = sim.createSim(config, { withSystem: false });
  stepUntil(state, (s) => s.region.status === "KRISIS");
  const outlook = sim.stockOutlook(state);
  assert.ok(outlook.criticalIn !== null, "stok menembus batas kritis");
  assert.ok(outlook.emptyIn === null || outlook.emptyIn >= outlook.criticalIn);
  assert.ok(outlook.critical > 0);
});
