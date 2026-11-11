"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../js/core/config.js");
require("../js/core/pos.js");
const { pos } = globalThis.SiTanggap;

const krisis = { active: true, quota: { motor: 5, mobil: 20, niaga: 60 } };
const normal = { active: false, quota: { motor: 5, mobil: 20, niaga: 60 } };
const motor = { type: "motor", jerrycan: false, modifiedTank: false };

test("mode krisis: motor yang belum mengisi boleh isi sampai 5 L", () => {
  assert.deepEqual(pos.checkTransaction(motor, 0, krisis), {
    allowed: true,
    maxLiters: 5,
    reason: "ok",
  });
});

test("mode krisis: sisa kuota berkurang sesuai pengisian hari ini", () => {
  assert.deepEqual(pos.checkTransaction(motor, 3, krisis), {
    allowed: true,
    maxLiters: 2,
    reason: "ok",
  });
});

test("mode krisis: kuota harian habis berarti transaksi ditolak", () => {
  assert.deepEqual(pos.checkTransaction(motor, 5, krisis), {
    allowed: false,
    maxLiters: 0,
    reason: "kuota-habis",
  });
});

test("mode krisis: jeriken diblokir walau kuota masih ada", () => {
  const vehicle = { type: "mobil", jerrycan: true, modifiedTank: false };
  assert.deepEqual(pos.checkTransaction(vehicle, 0, krisis), {
    allowed: false,
    maxLiters: 0,
    reason: "jeriken",
  });
});

test("mode krisis: tangki modifikasi diblokir", () => {
  const vehicle = { type: "mobil", jerrycan: false, modifiedTank: true };
  assert.deepEqual(pos.checkTransaction(vehicle, 0, krisis), {
    allowed: false,
    maxLiters: 0,
    reason: "tangki-modifikasi",
  });
});

test("mode normal: kunci anti-penimbunan tidak aktif", () => {
  const vehicle = { type: "mobil", jerrycan: true, modifiedTank: false };
  assert.deepEqual(pos.checkTransaction(vehicle, 50, normal), {
    allowed: true,
    maxLiters: Infinity,
    reason: "ok",
  });
});

test("kuota mengikuti parameter yang dikirim pusat", () => {
  const ketat = { active: true, quota: { motor: 3, mobil: 10, niaga: 40 } };
  assert.equal(pos.checkTransaction(motor, 0, ketat).maxLiters, 3);
});

test("jenis kendaraan tak dikenal ditolak, bukan diloloskan", () => {
  const vehicle = {
    type: "truk-gandeng",
    jerrycan: false,
    modifiedTank: false,
  };
  assert.deepEqual(pos.checkTransaction(vehicle, 0, krisis), {
    allowed: false,
    maxLiters: 0,
    reason: "jenis-tidak-dikenal",
  });
});

test("koreksi nopol manual dinormalkan ke format baku", () => {
  assert.equal(pos.parsePlate("p1234ab"), "P 1234 AB");
  assert.equal(pos.parsePlate("  ag 12  xyz "), "AG 12 XYZ");
});

test("nopol yang tidak valid ditolak", () => {
  assert.equal(pos.parsePlate("1234"), null);
  assert.equal(pos.parsePlate("P 12345 AB"), null);
  assert.equal(pos.parsePlate("<b>P 1 A</b>"), null);
});
