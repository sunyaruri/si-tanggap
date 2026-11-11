// Kerangka aplikasi peran (Pemda, Pertamina): sidebar biru tua, bilah atas, dan sub-halaman.
// Tiap halaman punya mount/update/destroy sendiri; status bersama peran disimpan oleh pemanggil.
(function (/** @type {Record<string, any>} */ ns) {
  "use strict";

  const { ui, icons } = ns;
  const { esc, icon, setHTML, setText, pill, when } = ui;

  /**
   * @param {HTMLElement} host
   * @param {any} app
   * @param {{ role: string, org: string, user: { initials: string, name: string },
   *   groups: { label: string, items: { id: string, label: string, icon: string }[] }[],
   *   pages: Record<string, { title: string, mount: (el: HTMLElement, ctx: any) => { update: (sim: any) => void, destroy?: () => void } }>,
   *   badges?: (sim: any) => Record<string, number>, context?: string }} spec
   */
  function mount(host, app, spec) {
    const first = spec.groups[0].items[0].id;
    const nav = spec.groups
      .map(
        (group) =>
          `<p class="side-group">${esc(group.label)}</p>` +
          group.items
            .map(
              (item) =>
                `<a class="side-link" href="#${spec.role}/${item.id}" data-page="${item.id}">${icon(item.icon, 18)}<span>${esc(item.label)}</span><em data-badge="${item.id}" hidden></em></a>`,
            )
            .join(""),
      )
      .join("");

    host.innerHTML = `
      <div class="shell">
        <aside class="side">
          <a class="side-brand" href="#${spec.role}/${first}">
            <span class="side-logo">${icons.logo(20)}</span>
            <span><b>SI-TANGGAP</b><small>${esc(spec.org)}</small></span>
          </a>
          <nav class="side-nav" aria-label="Menu ${esc(spec.org)}">${nav}</nav>
          <div class="side-user"><span class="side-avatar">${esc(spec.user.initials)}</span><span>${esc(spec.user.name)}</span></div>
        </aside>
        <div class="shell-main">
          <header class="topbar">
            <h1 class="topbar-title" data-shell="title"></h1>
            <span class="topbar-context" data-shell="context"></span>
            <span class="topbar-tools">
              <span data-shell="status"></span>
              <span class="topbar-clock">${icon("clock", 16)}<span data-shell="clock"></span></span>
            </span>
          </header>
          <div class="page" data-shell="page"></div>
        </div>
      </div>`;

    const el = {};
    for (const node of host.querySelectorAll("[data-shell]"))
      el[node.dataset.shell] = node;
    const links = [...host.querySelectorAll(".side-link")];
    const badges = [...host.querySelectorAll("[data-badge]")];

    let current = null;
    let currentId = "";

    function go(id) {
      const next = Object.hasOwn(spec.pages, id) ? id : first;
      if (next === currentId && current) return;
      if (current && current.destroy) current.destroy();
      const pageHost = document.createElement("div");
      pageHost.className = `page-${next}`;
      el.page.replaceChildren(pageHost);
      currentId = next;
      current = spec.pages[next].mount(pageHost, { app, go: goTo });
      setText(el.title, spec.pages[next].title);
      document.title = `${spec.pages[next].title} · SI-TANGGAP`;
      for (const link of links) {
        if (link.dataset.page === next)
          link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      window.scrollTo(0, 0);
      update(app.sim);
    }

    /** Pindah halaman lewat hash, supaya tombol kembali browser ikut bekerja. */
    function goTo(id) {
      location.hash = `${spec.role}/${id}`;
    }

    function update(sim) {
      setText(
        el.context,
        `${spec.context || "Kab. Jember"} · data per ${when(sim.t)}`,
      );
      setHTML(el.status, pill(sim.region.status));
      setText(el.clock, `${ui.dayName(sim.t)} ${ui.clock(sim.t)}`);
      const counts = spec.badges ? spec.badges(sim) : {};
      for (const badge of badges) {
        const count = counts[badge.dataset.badge] || 0;
        badge.hidden = count === 0;
        setText(badge, String(count));
      }
      if (current) current.update(sim);
    }

    return {
      go,
      update,
      destroy() {
        if (current && current.destroy) current.destroy();
      },
    };
  }

  ns.shell = { mount };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
