// @ts-check
// Lapis 2 – Automated Anti-Hoarding Lock: keputusan transaksi di POS SPBU.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const PLATE = /^([A-Z]{1,2})\s*(\d{1,4})\s*([A-Z]{1,3})$/;

  /** Menormalkan nomor polisi hasil ketik manual. Mengembalikan null bila formatnya tidak valid. */
  function parsePlate(text) {
    const match = PLATE.exec(String(text).trim().toUpperCase());
    return match ? `${match[1]} ${match[2]} ${match[3]}` : null;
  }

  /**
   * @param {{type: string, jerrycan: boolean, modifiedTank: boolean}} vehicle
   * @param {number} litersUsedToday liter yang sudah diisi nopol ini hari ini
   * @param {{active: boolean, quota: Record<string, number>}} mode mode krisis dan kuota dari pusat
   */
  function checkTransaction(vehicle, litersUsedToday, mode) {
    if (!mode.active)
      return { allowed: true, maxLiters: Infinity, reason: "ok" };
    const blocked = (reason) => ({ allowed: false, maxLiters: 0, reason });

    if (vehicle.jerrycan) return blocked("jeriken");
    if (vehicle.modifiedTank) return blocked("tangki-modifikasi");

    const cap = Object.hasOwn(mode.quota, vehicle.type)
      ? mode.quota[vehicle.type]
      : undefined;
    if (typeof cap !== "number") return blocked("jenis-tidak-dikenal");

    const remaining = cap - litersUsedToday;
    return remaining > 0
      ? { allowed: true, maxLiters: remaining, reason: "ok" }
      : blocked("kuota-habis");
  }

  ns.pos = { parsePlate, checkTransaction };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
