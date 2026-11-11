// Pengendali aplikasi: jam simulasi, perpindahan tampilan, dock kontrol, adegan, dan mode tangkapan layar.
(function (ns) {
  "use strict";

  const { sim: engine, scenes, config, ui, views, icons } = ns;
  const TICK_MS = 120;
  const RESIZE_DEBOUNCE_MS = 150;
  const DEFAULT_VIEW = "pemda";
  const SCRUB_LABEL_DAYS = [1, 4, 7, 10, 14];

  const byId = (id) => document.getElementById(id);
  const root = byId("view");
  const control = {
    play: byId("sim-play"),
    reset: byId("sim-reset"),
    speed: byId("sim-speed"),
    auto: byId("sim-auto"),
    scene: byId("sim-scene"),
    time: byId("sim-time"),
    day: byId("sim-day"),
    status: byId("sim-status"),
    fill: byId("scrub-fill"),
    head: byId("scrub-head"),
    shotOn: byId("shot-on"),
    shotOff: byId("shot-off"),
  };

  const app = {
    sim: null,
    playing: false,
    pausedOnCrisis: false,
    speed: 4,
    view: null,
    viewName: "",
    render,
  };
  const scenarioEnd = config.scenario.days * 24;
  const pct = (hours) =>
    `${((Math.min(hours, scenarioEnd) / scenarioEnd) * 100).toFixed(2)}%`;

  function render() {
    const sim = app.sim;
    ui.setText(control.time, ui.clock(sim.t));
    ui.setText(
      control.day,
      `${ui.dayName(sim.t)} · Hari ${ui.dayNumber(sim.t)}`,
    );
    ui.setHTML(control.status, ui.pill(sim.region.status));
    ui.setHTML(control.play, icons.svg(app.playing ? "pause" : "play", 20));
    control.play.setAttribute(
      "aria-label",
      app.playing ? "Jeda simulasi" : "Jalankan simulasi",
    );
    control.fill.style.width = pct(sim.t);
    control.head.style.left = pct(sim.t);
    app.view.update(sim);
  }

  /** Hash "#pemda/peta" → { role: "pemda", page: "peta" }. */
  function route() {
    const [role = "", page = ""] = location.hash.slice(1).split("/");
    return { role: Object.hasOwn(views, role) ? role : DEFAULT_VIEW, page };
  }

  function show({ role, page }) {
    // Peran yang sama cukup ganti sub-halaman, supaya peta dan isian tidak dibangun ulang.
    if (app.view && app.viewName === role && app.view.go) {
      app.view.go(page);
      return;
    }
    if (app.view) app.view.destroy();
    // Wadah baru tiap kali pindah tampilan, supaya pendengar event tampilan lama ikut terbuang.
    const host = document.createElement("div");
    root.replaceChildren(host);
    root.classList.toggle("is-app", Boolean(views[role].shell));
    app.viewName = role;
    app.view = views[role].mount(host, app);
    window.scrollTo(0, 0);
    for (const link of document.querySelectorAll(".role-tabs a")) {
      if (link.getAttribute("href") === `#${role}`)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    if (app.view.go) app.view.go(page);
    render();
  }

  function start(sim) {
    app.sim = sim;
    app.playing = false;
    app.pausedOnCrisis = sim.region.status === "KRISIS";
    views.pos.reset();
    // Simulasi baru: bangun ulang tampilan aktif supaya tidak memegang data simulasi lama.
    if (app.view) app.view.destroy();
    app.view = null;
    show(route());
  }

  function reset() {
    control.scene.value = "";
    start(engine.createSim(config, { withSystem: true }));
  }

  function loadScene(id) {
    const sim = scenes.createScene(config, id);
    if (!sim) return false;
    control.scene.value = id;
    start(sim);
    return true;
  }

  /** Mengembalikan true bila simulasi harus berhenti setelah langkah ini. */
  function shouldStop() {
    if (app.sim.t >= scenarioEnd) {
      ui.toast(
        `Skenario ${config.scenario.days} hari selesai. Tekan ulang untuk memulai lagi.`,
      );
      return true;
    }
    if (
      !control.auto.checked &&
      !app.pausedOnCrisis &&
      app.sim.region.status === "KRISIS"
    ) {
      app.pausedOnCrisis = true;
      ui.toast(
        "Status KRISIS terpicu. Simulasi dijeda sampai Pemda menyetujui rekomendasi.",
      );
      return true;
    }
    return false;
  }

  function tick() {
    if (!app.playing) return;
    for (let i = 0; i < app.speed; i++) {
      engine.step(app.sim);
      if (control.auto.checked) engine.autoRespond(app.sim);
      if (shouldStop()) {
        app.playing = false;
        break;
      }
    }
    render();
  }

  function setShot(on) {
    // Tanpa toast: pesan apa pun akan ikut terekam di tangkapan layar. Petunjuk Esc ada di title tombol.
    document.body.classList.toggle("is-shot", on);
    // Peta menyesuaikan ukuran setelah bilah atas hilang/muncul.
    window.dispatchEvent(new Event("resize"));
  }

  // ---------- Isi awal kontrol ----------
  control.scene.innerHTML =
    '<option value="">Mulai dari awal (hari 1)</option>' +
    scenes.list
      .map(
        (scene) =>
          `<option value="${scene.id}">${ui.esc(scene.label)}</option>`,
      )
      .join("");
  control.reset.innerHTML = icons.svg("reset", 17);
  document.querySelector("[data-logo]").innerHTML = icons.logo(20);
  for (const el of document.querySelectorAll("[data-icon]")) {
    el.insertAdjacentHTML("afterbegin", icons.svg(el.dataset.icon, 16));
  }

  const band = byId("scrub-band");
  band.style.left = pct(config.scenario.disruptionStartHour);
  band.style.width = `${(((config.scenario.disruptionEndHour - config.scenario.disruptionStartHour) / scenarioEnd) * 100).toFixed(2)}%`;
  byId("scrub-labels").innerHTML = SCRUB_LABEL_DAYS.map(
    (day, index) =>
      `<span style="left:${index === SCRUB_LABEL_DAYS.length - 1 ? "100%" : pct((day - 1) * 24)}">Hari ${day}</span>`,
  ).join("");

  // ---------- Event ----------
  control.play.addEventListener("click", () => {
    if (!app.playing && app.sim.t >= scenarioEnd) {
      ui.toast("Skenario sudah selesai. Tekan ulang untuk memulai lagi.");
      return;
    }
    app.playing = !app.playing;
    render();
  });
  control.reset.addEventListener("click", reset);
  control.scene.addEventListener("change", () =>
    control.scene.value ? loadScene(control.scene.value) : reset(),
  );
  control.speed.addEventListener("click", (event) => {
    const button = event.target.closest("[data-speed]");
    if (!button) return;
    app.speed = Number(button.dataset.speed);
    for (const other of control.speed.querySelectorAll("[data-speed]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
  control.shotOn.addEventListener("click", () => setShot(true));
  control.shotOff.addEventListener("click", () => setShot(false));
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      document.body.classList.contains("is-shot") &&
      !document.querySelector("dialog[open]")
    ) {
      setShot(false);
    }
  });
  window.addEventListener("hashchange", () => show(route()));

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, RESIZE_DEBOUNCE_MS);
  });

  // ---------- Mulai ----------
  // Tautan langsung untuk tangkapan layar, mis. index.html?adegan=krisis&shot=1#pemda
  const params = new URLSearchParams(location.search);
  ns.app = app;
  if (!loadScene(params.get("adegan") || "")) reset();
  if (params.get("shot") === "1") setShot(true);
  setInterval(tick, TICK_MS);
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
