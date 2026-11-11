"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../js/core/config.js");
require("../js/core/ews.js");
require("../js/core/sim.js");
require("../js/core/scenes.js");
const { scenes, sim, config } = globalThis.SiTanggap;

test("adegan normal: pemantauan rutin sebelum gangguan, truk sudah berjalan", () => {
  const state = scenes.createScene(config, "normal");
  assert.equal(state.region.status, "NORMAL");
  assert.equal(sim.isDisrupted(state), false);
  assert.ok(state.t > 0);
  assert.ok(state.trucks.length > 0);
});

test("adegan waspada: rekomendasi WASPADA menunggu persetujuan Pemda", () => {
  const state = scenes.createScene(config, "waspada");
  assert.equal(state.region.status, "WASPADA");
  assert.equal(sim.pendingPolicyStatus(state), "WASPADA");
});

test("adegan krisis: mode krisis POS aktif, kebijakan belum disetujui", () => {
  const state = scenes.createScene(config, "krisis");
  assert.equal(state.region.status, "KRISIS");
  assert.equal(state.crisisMode.active, true);
  assert.equal(sim.pendingPolicyStatus(state), "KRISIS");
  assert.equal(state.diversion, null);
});

test("adegan respons: kebijakan disetujui dan truk pengalihan sudah di jalan", () => {
  const state = scenes.createScene(config, "respons");
  assert.notEqual(state.policy.KRISIS, null);
  assert.notEqual(state.diversion.approvedAt, null);
  assert.deepEqual(
    state.sources.map((source) => source.id),
    ["tanjungwangi", "malang", "surabaya"],
  );
  assert.ok(
    state.trucks.some(
      (truck) => truck.route === "malang" || truck.route === "surabaya",
    ),
  );
});

test("adegan pulih: status kembali NORMAL dan mode krisis dicabut", () => {
  const state = scenes.createScene(config, "pulih");
  assert.equal(state.region.status, "NORMAL");
  assert.equal(state.crisisMode.active, false);
  assert.notEqual(state.marks.normalAgainAt, null);
});

test("adegan yang tidak dikenal tidak membuat simulasi", () => {
  assert.equal(scenes.createScene(config, "tidak-ada"), null);
});

test("daftar adegan berurutan dari normal sampai pulih", () => {
  assert.deepEqual(
    scenes.list.map((scene) => scene.id),
    ["normal", "waspada", "krisis", "respons", "pulih"],
  );
});
