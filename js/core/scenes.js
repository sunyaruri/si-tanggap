// @ts-check
// Adegan siap pakai untuk tangkapan layar: simulasi dijalankan sampai keadaan tertentu,
// supaya gambar di paper selalu bisa dibuat ulang dengan hasil yang sama.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const engine = ns.sim;

  /** Jalankan simulasi sampai kondisi terpenuhi atau skenario habis. */
  function runUntil(sim, done, auto) {
    const maxTicks = Math.round(
      (sim.cfg.scenario.days * 24) / sim.cfg.tickHours,
    );
    while (sim.tick < maxTicks && !done(sim)) {
      engine.step(sim);
      if (auto) engine.autoRespond(sim);
    }
    return done(sim);
  }

  function advance(sim, hours, auto) {
    const until = sim.t + hours;
    return runUntil(sim, (s) => s.t >= until, auto);
  }

  const reached = (status) => (sim) => sim.region.status === status;
  const recovered = (sim) => sim.marks.normalAgainAt !== null;

  // Contoh laporan hoaks warga (sintetis) supaya alur klarifikasi terlihat di tangkapan layar.
  const reportHoax = (sim) =>
    engine.addReport(sim, {
      type: "hoaks",
      text: "Pesan berantai: semua SPBU di Jember tutup sampai minggu depan",
    });

  const SCENES = [
    {
      id: "normal",
      label: "Normal – pemantauan rutin",
      play: (sim) => advance(sim, 20, false),
    },
    {
      id: "waspada",
      label: "WASPADA terpicu",
      play: (sim) =>
        runUntil(sim, reached("WASPADA"), false) && advance(sim, 1, false),
    },
    {
      id: "krisis",
      label: "KRISIS – menunggu keputusan",
      play: (sim) =>
        runUntil(sim, reached("KRISIS"), false) && advance(sim, 1.5, false),
    },
    {
      id: "blokir",
      label: "POS memblokir jeriken",
      // Keadaan sama dengan adegan krisis; tampilan POS membuka kendaraan berjeriken.
      play: (sim) =>
        runUntil(sim, reached("KRISIS"), false) && advance(sim, 1.5, false),
    },
    {
      id: "pengalihan",
      label: "Pengalihan menunggu Pertamina",
      // Pemda menyetujui satu jam setelah KRISIS; permintaan pengalihan belum dijawab Pertamina.
      play: (sim) =>
        runUntil(sim, reached("KRISIS"), false) &&
        advance(sim, 1, false) &&
        engine.approvePolicy(sim) &&
        advance(sim, 0.5, false),
    },
    {
      id: "respons",
      label: "Kebijakan & pengalihan berjalan",
      play: (sim) =>
        runUntil(sim, reached("KRISIS"), true) &&
        advance(sim, 1, true) &&
        reportHoax(sim) &&
        advance(sim, 29, true),
    },
    {
      id: "pulih",
      label: "Pulih – kembali NORMAL",
      play: (sim) => runUntil(sim, recovered, true) && advance(sim, 2, true),
    },
  ];

  /** Simulasi baru pada adegan tertentu, atau null bila id tidak dikenal. */
  function createScene(cfg, id) {
    const scene = SCENES.find((candidate) => candidate.id === id);
    if (!scene) return null;
    const sim = engine.createSim(cfg, { withSystem: true });
    scene.play(sim);
    sim.scene = id;
    return sim;
  }

  ns.scenes = {
    list: SCENES.map(({ id, label }) => ({ id, label })),
    createScene,
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
