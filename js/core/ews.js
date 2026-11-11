// @ts-check
// Lapis 1 – Trigger Warning System: aturan status dari dokumen alur sistem.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  /** Urutan keparahan status, dipakai untuk membandingkan naik/turun. */
  const STATUS_RANK = { NORMAL: 0, WASPADA: 1, KRISIS: 2 };

  /** Waktu habis stok (jam) = stok ÷ laju jual. */
  function hoursOfStock(stockKL, salesRateKLh) {
    if (stockKL <= 0) return 0;
    return salesRateKLh > 0 ? stockKL / salesRateKLh : Infinity;
  }

  /** Rasio R = waktu habis stok ÷ ETA truk tangki. */
  function ratioR(hoursLeft, etaHours) {
    if (!Number.isFinite(etaHours))
      return Number.isFinite(hoursLeft) ? 0 : Infinity;
    return etaHours > 0 ? hoursLeft / etaHours : Infinity;
  }

  /** Kelas stok SPBU pada peta: aman (> 24 jam), waspada (6–24 jam), kritis (< 6 jam). */
  function stockClass(hoursLeft, thresholds = ns.config.ews) {
    if (hoursLeft > thresholds.stockSafeHours) return "aman";
    return hoursLeft < thresholds.stockCriticalHours ? "kritis" : "waspada";
  }

  /** Status wilayah menurut matriks keputusan. */
  function regionStatus(
    { r, criticalShare, consumptionRatio },
    thresholds = ns.config.ews,
  ) {
    if (
      r < thresholds.rKrisis ||
      criticalShare >= thresholds.criticalShareKrisis
    )
      return "KRISIS";
    if (
      r < thresholds.rNormal ||
      consumptionRatio > thresholds.consumptionWaspada
    )
      return "WASPADA";
    return "NORMAL";
  }

  function recommendations(status, cfg = ns.config) {
    return cfg.recommendations[status] || [];
  }

  function slaHours(status, cfg = ns.config) {
    return cfg.slaHours[status] ?? null;
  }

  function median(values) {
    if (values.length === 0) return Infinity;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  ns.ews = {
    STATUS_RANK,
    hoursOfStock,
    ratioR,
    stockClass,
    regionStatus,
    recommendations,
    slaHours,
    median,
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
