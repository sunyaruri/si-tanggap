// Versi satu layar: tata letak persis wireframe dokumen alur sistem (Gambar 3–6).
// Tata letak tiap peran didaftarkan berkas wf-*.js ke ns.wf.layouts; data dan aksi tetap dari simulasi yang sama.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, icons } = ns;
  const { esc, refs } = ui;
  const PAGES = [
    { id: "pemda", label: "Pemda" },
    { id: "pertamina", label: "Pertamina" },
    { id: "pos", label: "POS SPBU" },
    { id: "publik", label: "Info publik" },
  ];

  /**
   * Bilah judul layar seperti wireframe: "SI-TANGGAP | <judul>" dan alat di kanan.
   * @param {{ title: string, tools?: string }} opts tools = HTML (sudah di-escape pemanggil)
   */
  function head({ title, tools = "" }) {
    return `<header class="wf-head">
      <span class="wf-logo">${icons.logo(18)}</span>
      <h1 class="wf-title"><b>SI-TANGGAP</b><span class="wf-sep" aria-hidden="true">|</span>${esc(title)}</h1>
      <div class="wf-tools">${tools}</div>
    </header>`;
  }

  function mount(host, app) {
    host.innerHTML = `
      <div class="wf">
        <nav class="wf-switch" aria-label="Versi wireframe">
          <span class="wf-switch-label">Versi wireframe</span>
          ${PAGES.map((page) => `<a href="#wireframe/${page.id}" data-page="${page.id}">${esc(page.label)}</a>`).join("")}
        </nav>
        <div class="wf-page" data-ref="page"></div>
      </div>`;
    const r = refs(host);
    const links = [...host.querySelectorAll(".wf-switch a")];
    let current = null;
    let currentId = "";

    function go(id) {
      const layouts = ns.wf.layouts;
      const next = Object.hasOwn(layouts, id) ? id : PAGES[0].id;
      if (next === currentId && current) return;
      if (current && current.destroy) current.destroy();
      const pageHost = document.createElement("div");
      pageHost.className = `wf-${next}`;
      r.page.replaceChildren(pageHost);
      currentId = next;
      current = layouts[next].mount(pageHost, app);
      document.title = `${layouts[next].title} · SI-TANGGAP`;
      for (const link of links) {
        if (link.dataset.page === next)
          link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      window.scrollTo(0, 0);
      current.update(app.sim);
    }

    return {
      go,
      update: (sim) => current && current.update(sim),
      destroy() {
        if (current && current.destroy) current.destroy();
      },
    };
  }

  ns.wf = { ...(ns.wf || {}), head, layouts: (ns.wf && ns.wf.layouts) || {} };
  ns.views = ns.views || {};
  ns.views.wireframe = { mount, shell: true };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
