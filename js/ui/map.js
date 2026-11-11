// Peta Leaflet: lapisan SPBU, truk tangki, terminal, dan jalur pasokan.
// Tanpa internet ubin peta tidak termuat; penanda dan label kecamatan tetap tampil.
(function (ns) {
  "use strict";

  const { esc, num, clock, shape, STOCK, icon } = ns.ui;
  const engine = ns.sim;
  const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const LABEL_MIN_ZOOM = 10;
  const ROUTE_COLOR = "#7b8aa0";
  const BLOCKED_COLOR = "#dc2626";

  /** Label nama kecamatan, dipakai bila ubin peta tidak bisa dimuat. */
  function addPlaceLabels(map) {
    for (const place of ns.config.kecamatan) {
      L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: "place-label",
          html: esc(place.name),
          iconSize: [0, 0],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: -500,
      }).addTo(map);
    }
  }

  /** @returns {any} peta Leaflet, atau null bila pustakanya tidak termuat */
  function create(el, { center, zoom, controls = true }) {
    if (typeof L === "undefined") {
      el.innerHTML =
        '<p class="map-missing">Peta tidak dapat dimuat: berkas vendor/leaflet tidak ditemukan.</p>';
      return null;
    }
    const map = L.map(el, {
      center,
      zoom,
      scrollWheelZoom: false,
      zoomControl: false,
    });
    if (controls) L.control.zoom({ position: "topright" }).addTo(map);
    map.attributionControl.setPrefix(
      '<a href="https://leafletjs.com">Leaflet</a>',
    );
    const tiles = L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxZoom: 15,
    }).addTo(map);
    tiles.once("tileerror", () => {
      map.removeLayer(tiles);
      if (zoom >= LABEL_MIN_ZOOM) addPlaceLabels(map);
    });
    // Ukuran wadah bisa berubah setelah isi panel lain dirender; Leaflet perlu diberi tahu.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);
    map.on("unload", () => observer.disconnect());
    return map;
  }

  function divIcon(className, html, size) {
    return L.divIcon({
      className: `mk ${className}`,
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  /** Samakan penanda dengan data: tambah yang baru, perbarui yang ada, buang yang sudah tidak ada. */
  function sync(group, cache, items, { key, build, update }) {
    const seen = new Set();
    for (const item of items) {
      const id = key(item);
      seen.add(id);
      let marker = cache.get(id);
      if (!marker) {
        marker = build(item).addTo(group);
        cache.set(id, marker);
      }
      update(marker, item);
    }
    for (const [id, marker] of cache) {
      if (seen.has(id)) continue;
      group.removeLayer(marker);
      cache.delete(id);
    }
  }

  function spbuTip(s) {
    const cover =
      s.klass === "kosong" ? "Stok habis" : `Cukup ${num(s.hoursLeft, 1)} jam`;
    const r = Number.isFinite(s.r) ? num(Math.min(s.r, 99), 2) : "∞";
    return `<b>SPBU ${esc(s.name)}</b><br>${esc(cover)} · ${num(s.stockKL)} KL<br>R = ${r} · status ${esc(STOCK[s.klass].word)}`;
  }

  /**
   * Lapisan SPBU berbentuk dan berwarna menurut kelas stok. Mengembalikan fungsi pembaruan.
   * @param {(s: any) => boolean} [include] saringan SPBU yang ditampilkan, mis. per kecamatan
   */
  function spbuLayer(map, size = 16, include = () => true) {
    const group = L.layerGroup().addTo(map);
    const cache = new Map();
    return (sim) =>
      sync(group, cache, sim.spbu.filter(include), {
        key: (s) => s.id,
        build: (s) =>
          L.marker([s.lat, s.lng], {
            icon: divIcon("", "", size),
            keyboard: false,
          }).bindTooltip(""),
        update(marker, s) {
          if (marker.__klass !== s.klass) {
            marker.__klass = s.klass;
            const meta = STOCK[s.klass];
            marker.setIcon(divIcon(`mk-${meta.tone}`, shape(meta.shape), size));
            marker.setZIndexOffset(s.klass === "aman" ? 0 : 200);
          }
          marker.setTooltipContent(spbuTip(s));
        },
      });
  }

  function truckLayer(map) {
    const group = L.layerGroup().addTo(map);
    const cache = new Map();
    return (sim) =>
      sync(group, cache, sim.trucks, {
        key: (truck) => truck.id,
        build: (truck) =>
          L.marker(engine.truckPosition(sim, truck), {
            icon: divIcon("mk-truck", icon("truck", 12), 22),
            keyboard: false,
            zIndexOffset: 500,
          }).bindTooltip(
            `<b>Truk tangki ${num(truck.volumeKL)} KL</b><br>→ SPBU ${esc(sim.spbu[truck.to].name)} · tiba ${clock(truck.etaAt)}`,
          ),
        update: (marker, truck) =>
          marker.setLatLng(engine.truckPosition(sim, truck)),
      });
  }

  function terminalLayer(map, cfg) {
    for (const terminal of cfg.terminals) {
      L.marker([terminal.lat, terminal.lng], {
        icon: divIcon("mk-terminal", shape("diamond"), 22),
        keyboard: false,
        zIndexOffset: 300,
      })
        .bindTooltip(esc(terminal.name), {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: "tip-label",
        })
        .addTo(map);
    }
  }

  /**
   * Kapal tanker yang memasok TBBM utama. Model tidak melacak kapal satu per satu; penanda ini
   * menunjukkan pasokan kapal yang turun ke cfg.scenario.tankerInflowFactor saat jalur terganggu.
   */
  function tankerLayer(map, cfg) {
    const primary = cfg.terminals.find((terminal) => terminal.primary);
    // Di laut timur terminal, di luar label TBBM yang menempel di atas penanda terminal.
    const marker = L.marker([primary.lat + 0.08, primary.lng + 0.55], {
      icon: divIcon("mk-ship", icon("ship", 13), 24),
      keyboard: false,
      zIndexOffset: 400,
    })
      .bindTooltip("")
      .addTo(map);
    return (sim) => {
      const late = engine.isDisrupted(sim);
      marker.setTooltipContent(
        `<b>Kapal tanker → ${esc(primary.name)}</b><br>${
          late
            ? `Pasokan kapal tinggal ${num(cfg.scenario.tankerInflowFactor * 100)}% dari normal`
            : "Bongkar muat sesuai jadwal"
        }`,
      );
      marker.getElement()?.classList.toggle("is-late", late);
    };
  }

  /** Jalur pasokan; jalur Gumitir digambar putus-putus merah dengan label saat terganggu. */
  function routeLayer(map, cfg) {
    const lines = {};
    for (const [name, path] of Object.entries(cfg.routes)) {
      lines[name] = L.polyline([...path, cfg.hub], {
        color: ROUTE_COLOR,
        weight: 3,
        opacity: 0.6,
      }).addTo(map);
    }
    const gumitir = cfg.routes.gumitir;
    const tag = L.marker(gumitir[Math.floor(gumitir.length / 2)], {
      icon: L.divIcon({
        className: "map-tag",
        html: "Jalur Gumitir terganggu",
        iconSize: [0, 0],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 800,
    });
    return (sim) => {
      const disrupted = engine.isDisrupted(sim);
      lines.gumitir.setStyle(
        disrupted
          ? {
              color: BLOCKED_COLOR,
              dashArray: "8 7",
              opacity: 0.95,
              weight: 3.5,
            }
          : { color: ROUTE_COLOR, dashArray: null, opacity: 0.6, weight: 3 },
      );
      if (disrupted && !map.hasLayer(tag)) tag.addTo(map);
      if (!disrupted && map.hasLayer(tag)) map.removeLayer(tag);
    };
  }

  /** Legenda melayang di pojok kiri bawah peta. */
  const legend = (items) => `<div class="map-legend">${items.join("")}</div>`;

  ns.maps = {
    create,
    divIcon,
    sync,
    spbuLayer,
    truckLayer,
    terminalLayer,
    tankerLayer,
    routeLayer,
    legend,
  };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
