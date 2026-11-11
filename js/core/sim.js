// @ts-check
// Mesin simulasi: stok SPBU, armada, status wilayah, dan respons kebijakan.
// Model agregat per SPBU dengan langkah 15 menit. Semua angka berasal dari config.js.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ews } = ns;
  const RANK = ews.STATUS_RANK;
  const REPORT_TYPES = ["penimbunan", "hoaks"];
  const OFFENDER_REASONS = ["jeriken", "tangki modif.", "kuota habis"];
  const CALM_LEVELS = ["NORMAL", "WASPADA"]; // urut dari yang paling tenang
  const MAX_LOG = 200;
  const MAX_REPORT_CHARS = 200;
  const MAX_QUOTA_LITERS = 200;

  const sum = (items, pick) =>
    items.reduce((total, item) => total + pick(item), 0);

  /** PRNG kecil berbenih agar simulasi selalu memberi hasil yang sama. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildSpbu(cfg, rnd) {
    const profile = cfg.spbuProfile;
    const list = [];
    for (const kec of cfg.kecamatan) {
      for (let i = 0; i < kec.count; i++) {
        const dailyKL =
          profile.dailyMinKL +
          rnd() * profile.dailySpreadKL +
          (kec.urban ? profile.urbanExtraKL : 0);
        const capacityKL = dailyKL * profile.capacityDays;
        list.push({
          id: list.length,
          name: (kec.names && kec.names[i]) || `${kec.name} ${i + 1}`,
          kecamatan: kec.name,
          lat: kec.lat + (rnd() - 0.5) * profile.jitterDeg,
          lng: kec.lng + (rnd() - 0.5) * profile.jitterDeg,
          baseRateKLh: dailyKL / 24,
          capacityKL,
          stockKL:
            capacityKL *
            (profile.initialFillMin + rnd() * profile.initialFillSpread),
          incomingKL: 0,
          window: [],
          windowSum: 0,
          waitRank: 0,
          hoursLeft: 0,
          etaHours: 0,
          r: Infinity,
          klass: "aman",
          rejectedToday: 0,
        });
      }
    }
    return list;
  }

  function buildSpeculators(cfg, spbu, rnd) {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const letter = () => letters[Math.floor(rnd() * letters.length)];
    return Array.from({ length: cfg.model.speculatorPool }, () => ({
      plate: `P ${1 + Math.floor(rnd() * 9)}xxx ${letter()}${letter()}`,
      spbuId: Math.floor(rnd() * spbu.length),
      reason: OFFENDER_REASONS[Math.floor(rnd() * OFFENDER_REASONS.length)],
      countToday: 0,
    }));
  }

  function createSim(cfg, { withSystem }) {
    const rnd = mulberry32(cfg.seed);
    const spbu = buildSpbu(cfg, rnd);
    const windowSize = Math.round(24 / cfg.tickHours);
    for (const s of spbu) {
      s.window = new Array(windowSize).fill(s.baseRateKLh * cfg.tickHours);
      s.windowSum = s.baseRateKLh * 24;
    }
    const dailyDemandKL = sum(spbu, (s) => s.baseRateKLh * 24);
    const diurnalMean = sum(cfg.diurnal, (v) => v) / cfg.diurnal.length;
    const primary = cfg.terminals.find((terminal) => terminal.primary);
    const primaryRate = (dailyDemandKL / 24) * cfg.supply.headroom;

    const sim = {
      cfg,
      withSystem,
      t: 0,
      tick: 0,
      windowIndex: 0,
      spbu,
      trucks: [],
      nextTruckId: 1,
      dailyDemandKL,
      capacityKL: sum(spbu, (s) => s.capacityKL),
      initialStockKL: sum(spbu, (s) => s.stockKL),
      diurnal: cfg.diurnal.map((v) => v / diurnalMean),
      sources: [
        {
          id: primary.id,
          name: primary.name,
          primary: true,
          active: true,
          rateKLh: primaryRate,
          leadHours: cfg.supply.leadNormalHours,
          bucketKL: primaryRate * cfg.supply.bucketCapHours,
        },
      ],
      terminals: cfg.terminals.map((terminal) => ({
        id: terminal.id,
        name: terminal.name,
        stockKL: terminal.stockKL,
        days: terminal.stockKL / terminal.outKLday,
        netKLday: 0,
        divertKLday: 0,
      })),
      region: {
        status: "NORMAL",
        r: Infinity,
        criticalShare: 0,
        criticalCount: 0,
        emptyCount: 0,
        consumptionRatio: 1,
        coverHours: 0,
        stockKL: 0,
        queueMinutes: 0,
        calmSince: { NORMAL: null, WASPADA: null },
      },
      panic: 0,
      crisisMode: { active: false, since: null, quota: { ...cfg.quota } },
      policy: { WASPADA: null, KRISIS: null },
      infoPublished: false,
      wfhActive: false,
      diversion: null,
      sla: null,
      log: [],
      reports: [],
      slaHistory: [],
      speculators: buildSpeculators(cfg, spbu, mulberry32(cfg.seed + 1)),
      offenderRnd: mulberry32(cfg.seed + 2),
      attemptAcc: 0,
      series: [],
      transitions: [],
      everEmpty: new Set(),
      crisisModeEverActive: false,
      marks: {
        waspadaAt: null,
        krisisAt: null,
        firstEmptyAt: null,
        policyIssuedAt: null,
        normalAgainAt: null,
      },
      totals: {
        soldKL: 0,
        deliveredKL: 0,
        unservedKL: 0,
        hoardedKL: 0,
        blockedKL: 0,
        rejectedTx: 0,
        rejectedToday: 0,
        stockoutHours: 0,
        nonNormalHours: 0,
        peakQueueMinutes: 0,
        minCoverHours: Infinity,
      },
    };
    evaluate(sim);
    return sim;
  }

  function addLog(sim, kind, text) {
    sim.log.push({ t: sim.t, kind, text });
    if (sim.log.length > MAX_LOG) sim.log.shift();
  }

  function isDisrupted(sim) {
    const { disruptionStartHour, disruptionEndHour } = sim.cfg.scenario;
    return sim.t >= disruptionStartHour && sim.t < disruptionEndHour;
  }

  /** Laju jual untuk EWS: rata-rata 24 jam terakhir, tidak lebih rendah dari rata-rata historis. */
  function salesRate(s) {
    return Math.max(s.windowSum / 24, s.baseRateKLh);
  }

  /** Faktor permintaan terhadap konsumsi normal, dipisah antara yang terlayani dan yang ditahan sistem. */
  function demandFactors(sim) {
    const model = sim.cfg.model;
    const surge =
      model.panicIncrease *
      sim.panic *
      (sim.infoPublished ? 1 - model.riskCommCut : 1);
    const quotaCut = sim.crisisMode.active ? model.quotaPanicCut : 0;
    const hoard = model.hoardShare * sim.panic;
    const lock = sim.crisisMode.active ? model.lockEffectiveness : 0;
    return {
      normal: 1 - (sim.wfhActive ? model.wfhDemandCut : 0),
      panicServed: surge * (1 - quotaCut),
      panicBlocked: surge * quotaCut,
      hoardServed: hoard * (1 - lock),
      hoardBlocked: hoard * lock,
    };
  }

  const servedFactor = (f) => f.normal + f.panicServed + f.hoardServed;

  function updateSources(sim) {
    const { supply, scenario } = sim.cfg;
    const disrupted = isDisrupted(sim);
    for (const source of sim.sources) {
      if (source.primary) {
        const normalRate = (sim.dailyDemandKL / 24) * supply.headroom;
        const depleted =
          sim.region.stockKL < sim.initialStockKL * supply.catchUpBelowShare;
        const recovering = depleted ? supply.catchUpFactor : 1;
        source.rateKLh =
          normalRate *
          (disrupted ? scenario.supplyFactorDisrupted : recovering);
        source.leadHours = disrupted
          ? supply.leadDisruptedHours
          : supply.leadNormalHours;
      }
      const cap = source.rateKLh * supply.bucketCapHours;
      if (source.bucketKL < cap) {
        source.bucketKL = Math.min(
          cap,
          source.bucketKL + source.rateKLh * sim.cfg.tickHours,
        );
      }
    }
  }

  function deliver(sim) {
    sim.trucks = sim.trucks.filter((truck) => {
      if (truck.etaAt > sim.t) return true;
      const s = sim.spbu[truck.to];
      s.stockKL += truck.volumeKL;
      s.incomingKL -= truck.volumeKL;
      sim.totals.deliveredKL += truck.volumeKL;
      return false;
    });
  }

  function recordOffenders(sim, attempts) {
    sim.attemptAcc += attempts;
    while (sim.attemptAcc >= 1) {
      sim.attemptAcc -= 1;
      sim.speculators[
        Math.floor(sim.offenderRnd() * sim.speculators.length)
      ].countToday += 1;
    }
  }

  function resetDailyCounters(sim) {
    sim.totals.rejectedToday = 0;
    for (const s of sim.spbu) s.rejectedToday = 0;
    for (const speculator of sim.speculators) speculator.countToday = 0;
  }

  function sell(sim) {
    const { model, tickHours: dt } = sim.cfg;
    const f = demandFactors(sim);
    const served = servedFactor(f);
    const hourOfDay = Math.floor(sim.t % 24);
    if (sim.t > 0 && sim.t % 24 === 0) resetDailyCounters(sim);

    let wantRate = 0;
    let openBaseRate = 0;
    let hoardAttempts = 0;
    for (const s of sim.spbu) {
      const base = s.baseRateKLh * sim.diurnal[hourOfDay] * dt;
      const want = base * served;
      const sold = Math.min(s.stockKL, want);
      s.stockKL -= sold;

      s.windowSum += sold - s.window[sim.windowIndex];
      s.window[sim.windowIndex] = sold;

      const blockedKL = base * (f.hoardBlocked + f.panicBlocked);
      // Ditolak = percobaan jeriken/tangki modifikasi. Lonjakan panik yang tertahan kuota
      // hanya memotong volume (pengisian sebagian), jadi tidak dihitung sebagai penolakan.
      const rejected = (base * f.hoardBlocked * 1000) / model.avgHoardLiters;
      s.rejectedToday += rejected;
      hoardAttempts += rejected;

      const totals = sim.totals;
      totals.soldKL += sold;
      totals.unservedKL += want - sold;
      totals.hoardedKL += want > 0 ? base * f.hoardServed * (sold / want) : 0;
      totals.blockedKL += blockedKL;
      totals.rejectedTx += rejected;
      totals.rejectedToday += rejected;

      if (s.stockKL <= 0) {
        totals.stockoutHours += dt;
        sim.everEmpty.add(s.id);
        if (sim.marks.firstEmptyAt === null) sim.marks.firstEmptyAt = sim.t;
      } else {
        openBaseRate += s.baseRateKLh;
      }
      wantRate += want / dt;
    }
    sim.windowIndex = (sim.windowIndex + 1) % sim.spbu[0].window.length;
    recordOffenders(sim, hoardAttempts);

    const rho =
      openBaseRate > 0
        ? wantRate / (openBaseRate * model.serviceHeadroom)
        : Infinity;
    sim.region.queueMinutes = queueMinutes(rho, model);
  }

  /** Estimasi waktu antre dari utilisasi layanan (pendekatan antrean satu pelayan), dibatasi 3,5 jam. */
  function queueMinutes(rho, model) {
    if (rho >= 1) return model.queueCapMinutes;
    return Math.min(
      model.queueCapMinutes,
      (model.serviceMinutes * rho) / (1 - rho),
    );
  }

  function truckRoute(sim, source) {
    if (!source.primary) return source.id;
    return isDisrupted(sim) ? "alternatif" : "gumitir";
  }

  function dispatch(sim) {
    const { truckKL, reorderHours } = sim.cfg.supply;
    const waiting = [];
    for (const s of sim.spbu) {
      s.waitRank = 0;
      const committed = s.stockKL + s.incomingKL;
      s.projHours = committed / salesRate(s);
      if (committed <= s.capacityKL - truckKL && s.projHours < reorderHours)
        waiting.push(s);
    }
    waiting.sort((a, b) => a.projHours - b.projHours || a.id - b.id);

    let rank = 0;
    for (const s of waiting) {
      const source = sim.sources
        .filter(
          (candidate) => candidate.active && candidate.bucketKL >= truckKL,
        )
        .sort((a, b) => a.leadHours - b.leadHours)[0];
      if (!source) {
        rank += 1;
        s.waitRank = rank;
        continue;
      }
      source.bucketKL -= truckKL;
      s.incomingKL += truckKL;
      sim.trucks.push({
        id: sim.nextTruckId++,
        from: source.id,
        to: s.id,
        route: truckRoute(sim, source),
        volumeKL: truckKL,
        departAt: sim.t,
        etaAt: sim.t + source.leadHours,
      });
    }
  }

  /** Hitung ulang indikator EWS tiap SPBU dan wilayah, lalu perbarui status. */
  function evaluate(sim) {
    const { cfg } = sim;
    const truckKL = cfg.supply.truckKL;
    const active = sim.sources.filter((source) => source.active);
    const supplyRate = sum(active, (source) => source.rateKLh);
    const buckets = sum(active, (source) => source.bucketKL);
    const minLead = Math.min(...active.map((source) => source.leadHours));

    const nextEta = new Map();
    for (const truck of sim.trucks) {
      nextEta.set(
        truck.to,
        Math.min(nextEta.get(truck.to) ?? Infinity, truck.etaAt),
      );
    }

    let stock = 0;
    let rate = 0;
    let sold24 = 0;
    let critical = 0;
    let empty = 0;
    const ratios = [];
    for (const s of sim.spbu) {
      const perHour = salesRate(s);
      s.hoursLeft = ews.hoursOfStock(s.stockKL, perHour);
      if (nextEta.has(s.id)) {
        s.etaHours = Math.max(nextEta.get(s.id) - sim.t, 0);
      } else if (s.waitRank > 0) {
        const allocationWait =
          supplyRate > 0
            ? Math.max(0, (s.waitRank * truckKL - buckets) / supplyRate)
            : Infinity;
        s.etaHours = minLead + allocationWait;
      } else {
        s.etaHours = minLead;
      }
      s.r = ews.ratioR(s.hoursLeft, s.etaHours);
      s.klass =
        s.stockKL <= 0 ? "kosong" : ews.stockClass(s.hoursLeft, cfg.ews);

      ratios.push(s.r);
      stock += s.stockKL;
      rate += perHour;
      sold24 += s.windowSum;
      if (s.klass === "kosong") empty += 1;
      if (s.klass === "kosong" || s.klass === "kritis") critical += 1;
    }

    const region = sim.region;
    region.r = ews.median(ratios);
    region.criticalCount = critical;
    region.emptyCount = empty;
    region.criticalShare = critical / sim.spbu.length;
    region.consumptionRatio = sold24 / sim.dailyDemandKL;
    region.stockKL = stock;
    region.coverHours = stock / rate;
    updateStatus(sim, ews.regionStatus(region, cfg.ews));
  }

  /** Naik status seketika; turun status hanya setelah kondisi membaik selama masa tahan. */
  function updateStatus(sim, raw) {
    const region = sim.region;
    const current = region.status;
    // Selama jalur utama masih terganggu, wilayah yang sedang dalam episode krisis tidak kembali NORMAL
    // ("stok pulih DAN ETA aman", dokumen alur sistem bagian 2).
    const floor =
      current !== "NORMAL" && isDisrupted(sim) ? "WASPADA" : "NORMAL";
    const target = RANK[raw] >= RANK[floor] ? raw : floor;

    // calmSince[level]: sejak kapan kondisi terus-menerus tidak lebih buruk dari level itu.
    for (const level of CALM_LEVELS) {
      if (RANK[target] > RANK[level]) region.calmSince[level] = null;
      else if (region.calmSince[level] === null)
        region.calmSince[level] = sim.t;
    }

    if (RANK[target] > RANK[current]) {
      setStatus(sim, target);
      return;
    }
    const hold = sim.cfg.ews.recoveryHoldHours;
    const calmEnough = CALM_LEVELS.find(
      (level) =>
        RANK[level] < RANK[current] &&
        region.calmSince[level] !== null &&
        sim.t - region.calmSince[level] >= hold,
    );
    if (calmEnough) setStatus(sim, calmEnough);
  }

  function publishInfo(sim) {
    if (sim.infoPublished) return;
    sim.infoPublished = true;
    addLog(
      sim,
      "info",
      "Info resmi #1 terbit ke publik (web, WhatsApp, media sosial)",
    );
  }

  function setStatus(sim, next) {
    const previous = sim.region.status;
    sim.region.status = next;
    sim.transitions.push({ t: sim.t, status: next });
    addLog(sim, "status", `Status ${next} terpicu otomatis`);

    if (RANK[next] > RANK[previous]) {
      if (sim.marks.waspadaAt === null) sim.marks.waspadaAt = sim.t;
      if (next === "KRISIS" && sim.marks.krisisAt === null)
        sim.marks.krisisAt = sim.t;
      closeSla(sim);
      sim.sla = {
        status: next,
        startAt: sim.t,
        deadlineAt: sim.t + ews.slaHours(next, sim.cfg),
        doneAt: sim.policy[next] ? sim.t : null,
      };
      if (!sim.withSystem) return;
      addLog(sim, "sla", "Rekomendasi dikirim ke Pemda dan Pertamina");
      if (next === "KRISIS") {
        sim.crisisMode.active = true;
        sim.crisisMode.since = sim.t;
        sim.crisisModeEverActive = true;
        addLog(sim, "pos", "Mode krisis dikirim ke POS semua SPBU wilayah");
        publishInfo(sim);
      }
      return;
    }

    if (next === "NORMAL") {
      sim.marks.normalAgainAt = sim.t;
      sim.crisisMode.active = false;
      sim.crisisMode.since = null;
      sim.policy = { WASPADA: null, KRISIS: null };
      sim.infoPublished = false;
      sim.wfhActive = false;
      sim.diversion = null;
      closeSla(sim);
      sim.sla = null;
      sim.sources = sim.sources.filter((source) => source.primary);
      for (const terminal of sim.terminals) terminal.divertKLday = 0;
      addLog(sim, "status", "Mode krisis dicabut, laporan krisis disimpan");
    }
  }

  function updatePanic(sim) {
    const { model, tickHours: dt } = sim.cfg;
    const region = sim.region;
    const triggered =
      region.status === "KRISIS" ||
      region.criticalShare >= model.panicTriggerShare;
    sim.panic = triggered
      ? Math.min(1, sim.panic + dt / model.panicRiseHours)
      : Math.max(0, sim.panic - dt / model.panicFallHours);
  }

  function updateTerminals(sim) {
    const { scenario, tickHours: dt } = sim.cfg;
    const disrupted = isDisrupted(sim);
    sim.terminals.forEach((terminal, index) => {
      const base = sim.cfg.terminals[index];
      let inflow = base.inKLday;
      if (base.primary && disrupted) inflow *= scenario.tankerInflowFactor;
      else if (terminal.stockKL < base.stockKL)
        inflow *= scenario.tankerCatchUpFactor;
      terminal.netKLday = inflow - base.outKLday - terminal.divertKLday;
      terminal.stockKL = Math.max(
        0,
        terminal.stockKL + (terminal.netKLday * dt) / 24,
      );
      terminal.days = terminal.stockKL / base.outKLday;
    });
  }

  /** Status dengan SLA yang masih menunggu persetujuan, atau null. */
  function pendingPolicyStatus(sim) {
    return sim.sla && sim.sla.doneAt === null ? sim.sla.status : null;
  }

  /** Bagi kekurangan pasokan ke terminal lain, mulai dari yang ETA-nya terpendek. */
  function planDiversion(deficitKLday, terminals) {
    const plan = [];
    let remaining = deficitKLday;
    const candidates = terminals
      .filter((terminal) => terminal.spareKLday > 0)
      .sort((a, b) => a.leadHours - b.leadHours);
    for (const terminal of candidates) {
      if (remaining <= 0) break;
      const kLday = Math.min(terminal.spareKLday, remaining);
      plan.push({
        terminalId: terminal.id,
        name: terminal.name,
        kLday,
        leadHours: terminal.leadHours,
        costPct: terminal.costPct,
      });
      remaining -= kLday;
    }
    return plan;
  }

  function requestDiversion(sim) {
    const { supply } = sim.cfg;
    const demandKLday = sim.dailyDemandKL * servedFactor(demandFactors(sim));
    const primary = sim.sources.find((source) => source.primary);
    const deficitKLday =
      Math.ceil(Math.max(0, demandKLday - primary.rateKLh * 24) / 10) * 10;
    const plan = planDiversion(deficitKLday, sim.cfg.terminals);
    // Armada untuk menjaga aliran: volume harian ÷ muatan truk × waktu pulang-pergi.
    const trucks = sum(plan, (item) =>
      Math.ceil(((item.kLday / supply.truckKL) * item.leadHours * 2) / 24),
    );
    sim.diversion = {
      requestedAt: sim.t,
      approvedAt: null,
      deficitKLday,
      plan,
      trucks,
    };
    addLog(
      sim,
      "supply",
      `Permintaan pengalihan suplai ${deficitKLday} KL/hari dikirim ke Pertamina`,
    );
  }

  /**
   * Pemda menyetujui rekomendasi untuk status yang SLA-nya masih berjalan.
   * @param {string[]} [itemIds] butir yang dicentang; kosong berarti semua butir.
   */
  function approvePolicy(sim, itemIds) {
    const status = pendingPolicyStatus(sim);
    if (!status) return false;

    const items = ews
      .recommendations(status, sim.cfg)
      .filter((item) =>
        item.auto ? sim.withSystem : !itemIds || itemIds.includes(item.id),
      )
      .map((item) => item.id);
    sim.policy[status] = { at: sim.t, items };
    sim.sla.doneAt = sim.t;
    if (status === "KRISIS" && sim.marks.policyIssuedAt === null)
      sim.marks.policyIssuedAt = sim.t;
    addLog(
      sim,
      "policy",
      status === "KRISIS"
        ? "Rekomendasi disetujui, SE terbit"
        : "Rekomendasi WASPADA disetujui",
    );

    if (items.includes("info-resmi")) publishInfo(sim);
    if (items.includes("wfh")) sim.wfhActive = true;
    if (items.includes("pengalihan-suplai") && !sim.diversion)
      requestDiversion(sim);
    return true;
  }

  /** Pertamina menyetujui pengalihan suplai dan mengirim perintah dispatch. */
  function approveDiversion(sim) {
    const diversion = sim.diversion;
    if (!diversion || diversion.approvedAt !== null) return false;
    diversion.approvedAt = sim.t;
    for (const item of diversion.plan) {
      sim.sources.push({
        id: item.terminalId,
        name: item.name,
        primary: false,
        active: true,
        rateKLh: item.kLday / 24,
        leadHours: item.leadHours,
        bucketKL: 0,
      });
      sim.terminals.find(
        (terminal) => terminal.id === item.terminalId,
      ).divertKLday = item.kLday;
    }
    addLog(
      sim,
      "supply",
      "Pertamina menyetujui pengalihan suplai, perintah dispatch dikirim",
    );
    return true;
  }

  /** Respons otomatis sesuai jeda skenario; dipakai uji banding dan mode "respons otomatis". */
  function autoRespond(sim) {
    const { scenario } = sim.cfg;
    const pending = pendingPolicyStatus(sim);
    if (pending) {
      const delay =
        pending === "KRISIS"
          ? scenario.policyDelayHours
          : scenario.waspadaDelayHours;
      if (sim.t - sim.sla.startAt >= delay) approvePolicy(sim);
    }
    const diversion = sim.diversion;
    if (
      diversion &&
      diversion.approvedAt === null &&
      sim.t - diversion.requestedAt >= scenario.dispatchDelayHours
    ) {
      approveDiversion(sim);
    }
  }

  /** Tanpa sistem: kebijakan dan pengalihan baru muncul setelah jeda reaktif (5 hari). */
  function baselineResponse(sim) {
    const krisisAt = sim.marks.krisisAt;
    if (krisisAt === null || pendingPolicyStatus(sim) !== "KRISIS") return;
    if (sim.t - krisisAt < sim.cfg.scenario.baselinePolicyDelayHours) return;
    approvePolicy(sim);
    approveDiversion(sim);
  }

  function record(sim) {
    const region = sim.region;
    sim.series.push({
      t: sim.t,
      stockKL: region.stockKL,
      coverHours: region.coverHours,
      emptyCount: region.emptyCount,
      criticalCount: region.criticalCount,
      r: region.r,
      status: region.status,
      queueMinutes: region.queueMinutes,
      inTransit: sim.trucks.length,
      consumptionRatio: region.consumptionRatio,
      rejectedToday: sim.totals.rejectedToday,
    });
  }

  function step(sim) {
    const dt = sim.cfg.tickHours;
    updateSources(sim);
    deliver(sim);
    sell(sim);
    dispatch(sim);
    evaluate(sim);
    updatePanic(sim);
    updateTerminals(sim);
    if (sim.withSystem) clarifyHoaxes(sim);
    if (!sim.withSystem) baselineResponse(sim);

    const totals = sim.totals;
    if (sim.region.status !== "NORMAL") totals.nonNormalHours += dt;
    totals.peakQueueMinutes = Math.max(
      totals.peakQueueMinutes,
      sim.region.queueMinutes,
    );
    totals.minCoverHours = Math.min(
      totals.minCoverHours,
      sim.region.coverHours,
    );
    if (sim.tick % Math.round(1 / dt) === 0) record(sim);

    sim.tick += 1;
    sim.t = sim.tick * dt;
  }

  function runScenario(cfg, { withSystem }) {
    const sim = createSim(cfg, { withSystem });
    const ticks = Math.round((cfg.scenario.days * 24) / cfg.tickHours);
    for (let i = 0; i < ticks; i++) {
      step(sim);
      if (withSystem) autoRespond(sim);
    }
    return sim;
  }

  function metrics(sim) {
    const { marks, totals } = sim;
    const responded = marks.policyIssuedAt !== null && marks.krisisAt !== null;
    return {
      waspadaAt: marks.waspadaAt,
      krisisAt: marks.krisisAt,
      firstEmptyAt: marks.firstEmptyAt,
      policyIssuedAt: marks.policyIssuedAt,
      normalAgainAt: marks.normalAgainAt,
      policyResponseHours: responded
        ? marks.policyIssuedAt - marks.krisisAt
        : null,
      spbuEverEmpty: sim.everEmpty.size,
      stockoutHours: totals.stockoutHours,
      nonNormalHours: totals.nonNormalHours,
      unservedKL: totals.unservedKL,
      hoardedKL: totals.hoardedKL,
      blockedKL: totals.blockedKL,
      rejectedTx: Math.round(totals.rejectedTx),
      peakQueueMinutes: totals.peakQueueMinutes,
      minCoverHours: totals.minCoverHours,
      soldKL: totals.soldKL,
      deliveredKL: totals.deliveredKL,
      crisisModeEverActive: sim.crisisModeEverActive,
    };
  }

  /**
   * Proyeksi stok per jam.
   * @param {{stockKL: number, demandKLh: number, arrivals: {inHours: number, volumeKL: number}[],
   *          inflows: {afterHours: number, rateKLh: number}[], capKL?: number}} input
   */
  function projectStock(input, hours) {
    const cap = input.capKL ?? Infinity;
    const points = [{ h: 0, stockKL: input.stockKL }];
    let stock = input.stockKL;
    for (let h = 1; h <= hours; h++) {
      const arriving = sum(
        input.arrivals.filter(
          (arrival) => arrival.inHours > h - 1 && arrival.inHours <= h,
        ),
        (arrival) => arrival.volumeKL,
      );
      const inflow = sum(
        input.inflows.filter((source) => h - 1 >= source.afterHours),
        (source) => source.rateKLh,
      );
      stock = Math.min(
        cap,
        Math.max(0, stock - input.demandKLh + arriving + inflow),
      );
      points.push({ h, stockKL: stock });
    }
    return points;
  }

  /** Masukan proyeksi wilayah dari keadaan simulasi saat ini. */
  function projectionInput(sim) {
    const demandKLh =
      (sim.dailyDemandKL / 24) * servedFactor(demandFactors(sim));
    return {
      stockKL: sim.region.stockKL,
      demandKLh,
      capKL: sim.capacityKL,
      arrivals: sim.trucks.map((truck) => ({
        inHours: truck.etaAt - sim.t,
        volumeKL: truck.volumeKL,
      })),
      inflows: sim.sources
        .filter((source) => source.active)
        .map((source) => ({
          afterHours: source.leadHours,
          rateKLh: source.rateKLh,
        })),
    };
  }

  /** Titik pada lintasan (deretan [lat, lng]) untuk pecahan jarak 0–1. */
  function pointAlong(path, fraction) {
    const clamped = Math.min(1, Math.max(0, fraction));
    const lengths = [];
    for (let i = 1; i < path.length; i++) {
      lengths.push(
        Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]),
      );
    }
    let remaining = clamped * sum(lengths, (length) => length);
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i] && lengths[i] > 0) {
        const ratio = remaining / lengths[i];
        return [
          path[i][0] + (path[i + 1][0] - path[i][0]) * ratio,
          path[i][1] + (path[i + 1][1] - path[i][1]) * ratio,
        ];
      }
      remaining -= lengths[i];
    }
    return [...path[path.length - 1]];
  }

  function truckPosition(sim, truck) {
    const target = sim.spbu[truck.to];
    const path = [
      ...sim.cfg.routes[truck.route],
      sim.cfg.hub,
      [target.lat, target.lng],
    ];
    return pointAlong(
      path,
      (sim.t - truck.departAt) / (truck.etaAt - truck.departAt),
    );
  }

  /** SLA yang selesai atau digantikan disimpan untuk menghitung kepatuhan. */
  function closeSla(sim) {
    if (sim.sla) sim.slaHistory.push({ ...sim.sla, closedAt: sim.t });
  }

  /**
   * Kepatuhan SLA selama simulasi. Dihitung: SLA yang sudah diputuskan, atau yang lewat batas
   * tanpa keputusan. SLA yang digantikan status lebih tinggi sebelum jatuh tempo tidak dihitung.
   */
  function slaCompliance(sim) {
    const all = sim.sla
      ? [...sim.slaHistory, { ...sim.sla, closedAt: null }]
      : sim.slaHistory;
    const result = { onTime: 0, total: 0, pending: 0 };
    for (const sla of all) {
      if (sla.doneAt !== null) {
        result.total += 1;
        if (sla.doneAt <= sla.deadlineAt) result.onTime += 1;
      } else if ((sla.closedAt ?? sim.t) > sla.deadlineAt) result.total += 1;
      else if (sla.closedAt === null) result.pending += 1;
    }
    return result;
  }

  /** Laporan hoaks yang sudah melewati jeda verifikasi dijawab klarifikasi di kanal resmi. */
  function clarifyHoaxes(sim) {
    for (const report of sim.reports) {
      if (report.type !== "hoaks" || report.clarifiedAt !== null) continue;
      if (sim.t - report.t < sim.cfg.scenario.hoaxClarifyHours) continue;
      report.clarifiedAt = sim.t;
      addLog(sim, "clarify", "Klarifikasi hoaks terbit di kanal resmi");
    }
  }

  /** Laporan warga (penimbunan/hoaks). Mengembalikan false bila masukan tidak valid. */
  function addReport(sim, { type, text }) {
    const clean = String(text ?? "").trim();
    if (
      !REPORT_TYPES.includes(type) ||
      clean.length === 0 ||
      clean.length > MAX_REPORT_CHARS
    )
      return false;
    sim.reports.push({ t: sim.t, type, text: clean, clarifiedAt: null });
    addLog(sim, "report", `Laporan warga masuk: ${type}`);
    return true;
  }

  /** Parameter kuota mode krisis dari pusat kendali. Mengembalikan false bila tidak valid. */
  function setCrisisQuota(sim, quota) {
    const next = {};
    for (const key of Object.keys(sim.cfg.quota)) {
      const liters = quota ? quota[key] : undefined;
      if (!Number.isInteger(liters) || liters < 1 || liters > MAX_QUOTA_LITERS)
        return false;
      next[key] = liters;
    }
    sim.crisisMode.quota = next;
    addLog(sim, "pos", "Parameter mode krisis diterapkan ke semua POS wilayah");
    return true;
  }

  ns.sim = {
    createSim,
    step,
    runScenario,
    autoRespond,
    approvePolicy,
    approveDiversion,
    pendingPolicyStatus,
    planDiversion,
    metrics,
    projectStock,
    projectionInput,
    pointAlong,
    truckPosition,
    isDisrupted,
    addReport,
    slaCompliance,
    setCrisisQuota,
    logEvent: addLog,
    random: mulberry32,
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
