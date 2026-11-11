"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../js/core/config.js");
require("../js/core/ews.js");
const { ews } = globalThis.SiTanggap;

test("waktu habis stok = stok dibagi laju jual", () => {
  assert.equal(ews.hoursOfStock(12, 2), 6);
});

test("tangki kosong berarti 0 jam, walau laju jual juga 0", () => {
  assert.equal(ews.hoursOfStock(0, 0), 0);
});

test("laju jual 0 dengan stok tersisa berarti stok tidak akan habis", () => {
  assert.equal(ews.hoursOfStock(12, 0), Infinity);
});

test("rasio R = waktu habis stok dibagi ETA truk tangki", () => {
  assert.equal(ews.ratioR(6, 4), 1.5);
});

test("tanpa pasokan (ETA tak terhingga) R bernilai 0", () => {
  assert.equal(ews.ratioR(6, Infinity), 0);
});

test("kelas stok SPBU mengikuti legenda peta: aman > 24 jam, kritis < 6 jam", () => {
  const cases = [
    [24.1, "aman"],
    [24, "waspada"],
    [6, "waspada"],
    [5.9, "kritis"],
    [0, "kritis"],
  ];
  for (const [hours, want] of cases) {
    assert.equal(ews.stockClass(hours), want, `${hours} jam`);
  }
});

test("status wilayah mengikuti matriks keputusan", () => {
  const cases = [
    [{ r: 1.5, criticalShare: 0, consumptionRatio: 1 }, "NORMAL"],
    [{ r: 1.49, criticalShare: 0, consumptionRatio: 1 }, "WASPADA"],
    [{ r: 1, criticalShare: 0, consumptionRatio: 1 }, "WASPADA"],
    [{ r: 0.99, criticalShare: 0, consumptionRatio: 1 }, "KRISIS"],
    [{ r: 2, criticalShare: 0.3, consumptionRatio: 1 }, "KRISIS"],
    [{ r: 2, criticalShare: 0.29, consumptionRatio: 1 }, "NORMAL"],
    [{ r: 2, criticalShare: 0, consumptionRatio: 1.21 }, "WASPADA"],
    [{ r: 2, criticalShare: 0, consumptionRatio: 1.2 }, "NORMAL"],
  ];
  for (const [input, want] of cases) {
    assert.equal(ews.regionStatus(input), want, JSON.stringify(input));
  }
});

test("rekomendasi KRISIS memuat pengalihan suplai, NORMAL tidak memuat apa pun", () => {
  const krisis = ews.recommendations("KRISIS").map((item) => item.id);
  assert.ok(krisis.includes("pengalihan-suplai"));
  assert.ok(krisis.includes("wfh"));
  assert.deepEqual(ews.recommendations("NORMAL"), []);
});

test("rekomendasi WASPADA memuat info resmi ke publik", () => {
  const waspada = ews.recommendations("WASPADA").map((item) => item.id);
  assert.ok(waspada.includes("info-resmi"));
  assert.ok(!waspada.includes("wfh"));
});

test("batas waktu SLA: WASPADA 6 jam, KRISIS 24 jam, NORMAL tanpa batas", () => {
  assert.equal(ews.slaHours("WASPADA"), 6);
  assert.equal(ews.slaHours("KRISIS"), 24);
  assert.equal(ews.slaHours("NORMAL"), null);
});

test("median dipakai sebagai R wilayah", () => {
  assert.equal(ews.median([3, 1, 2]), 2);
  assert.equal(ews.median([4, 1, 3, 2]), 2.5);
  assert.equal(ews.median([]), Infinity);
});
