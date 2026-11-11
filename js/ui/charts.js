// Grafik SVG kecil: garis (satu sumbu, kisi tipis, tooltip, tabel data pendamping),
// sparkline untuk ubin KPI, dan lajur status untuk halaman hasil.
(function (ns) {
  "use strict";

  const { esc, setHTML } = ns.ui;
  const MARGIN = { top: 18, right: 16, bottom: 28, left: 56 };
  const END_LABEL_CHAR_PX = 7;
  const MIN_LABEL_GAP_PX = 14;
  const TABLE_ROWS = 12;
  const AREA_OPACITY = 0.1;

  /** Skala sumbu Y dengan angka bulat dan paling banyak lima garis kisi. */
  function scaleY(maxValue) {
    const top = maxValue > 0 ? maxValue : 1;
    const raw = top / 4;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const unit = raw / pow;
    const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * pow;
    return { max: Math.ceil(top / step - 1e-9) * step, step };
  }

  function nearest(points, x) {
    let best = points[0];
    for (const point of points) {
      if (Math.abs(point[0] - x) < Math.abs(best[0] - x)) best = point;
    }
    return best;
  }

  const swatch = (color) =>
    `<span class="legend-line" style="border-color:${color}"></span>`;

  function scaffold(el) {
    el.classList.add("chart");
    el.innerHTML =
      '<div data-part="legend" class="chart-legend"></div><div data-part="body"></div>' +
      '<div data-part="cross" class="chart-cross" hidden></div><div data-part="tip" class="chart-tip" hidden></div>' +
      '<details class="chart-data"><summary>Lihat data tabel</summary><div class="table-wrap" data-part="table"></div></details>';
    const parts = {};
    for (const part of el.querySelectorAll("[data-part]"))
      parts[part.dataset.part] = part;

    el.addEventListener("mousemove", (event) => showTip(el, event));
    el.addEventListener("mouseleave", () => {
      parts.cross.hidden = true;
      parts.tip.hidden = true;
    });
    el.__parts = parts;
    return parts;
  }

  function showTip(el, event) {
    const state = el.__state;
    const parts = el.__parts;
    if (!state) return;
    const bodyRect = parts.body.getBoundingClientRect();
    const offsetX = event.clientX - bodyRect.left;
    if (
      offsetX < state.left ||
      offsetX > state.left + state.plotW ||
      event.clientY > bodyRect.bottom
    ) {
      parts.cross.hidden = true;
      parts.tip.hidden = true;
      return;
    }
    const xValue =
      state.x0 + ((offsetX - state.left) / state.plotW) * (state.x1 - state.x0);
    const anchor = nearest(state.opts.series[0].points, xValue);
    const rows = state.opts.series
      .map((series) => {
        const point = nearest(series.points, anchor[0]);
        return `<span class="legend-item"><span>${swatch(series.color)} ${esc(series.name)}</span><b>${esc(state.opts.yFormat(point[1]))}</b></span>`;
      })
      .join("");
    parts.tip.innerHTML = `<strong>${esc(state.opts.xFormat(anchor[0]))}</strong>${rows}`;

    const elRect = el.getBoundingClientRect();
    const crossX = bodyRect.left - elRect.left + state.px(anchor[0]);
    parts.cross.hidden = false;
    parts.cross.style.left = `${crossX}px`;
    parts.cross.style.top = `${bodyRect.top - elRect.top + state.top}px`;
    parts.cross.style.height = `${state.plotH}px`;
    parts.tip.hidden = false;
    const tipLeft =
      crossX + 12 + parts.tip.offsetWidth > elRect.width
        ? crossX - 12 - parts.tip.offsetWidth
        : crossX + 12;
    parts.tip.style.left = `${Math.max(0, tipLeft)}px`;
    parts.tip.style.top = `${bodyRect.top - elRect.top + state.top}px`;
  }

  function tableHTML(opts) {
    const base = opts.series[0].points;
    const stride = Math.max(1, Math.ceil(base.length / TABLE_ROWS));
    const head = opts.series
      .map((series) => `<th class="num">${esc(series.name)}</th>`)
      .join("");
    const rows = base
      .filter((_, index) => index % stride === 0 || index === base.length - 1)
      .map((point) => {
        const cells = opts.series
          .map(
            (series) =>
              `<td class="num">${esc(opts.yFormat(nearest(series.points, point[0])[1]))}</td>`,
          )
          .join("");
        return `<tr><td>${esc(opts.xFormat(point[0]))}</td>${cells}</tr>`;
      })
      .join("");
    return `<table class="table"><thead><tr><th>${esc(opts.xTitle)}</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  const HATCH =
    '<defs><pattern id="hatch-crit" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#f8fafd"/><line x1="0" y1="0" x2="0" y2="8" stroke="#dae0e7" stroke-width="3"/></pattern></defs>';

  /**
   * Grafik garis.
   * @param {HTMLElement} el
   * @param {{
   *   series: {name: string, color: string, points: number[][]}[],
   *   xTicks: {x: number, label: string}[], xTitle: string,
   *   xFormat: (x: number) => string, yFormat: (y: number) => string,
   *   marks?: {x: number, label: string}[], levels?: {y: number, label: string}[],
   *   band?: {from: number, to: number, label: string},
   *   height?: number, endLabels?: boolean, area?: boolean, ariaLabel: string
   * }} opts
   */
  function line(el, opts) {
    const parts = el.__parts || scaffold(el);
    const series = opts.series.filter((item) => item.points.length > 0);
    if (series.length === 0) {
      setHTML(parts.body, '<p class="note">Belum ada data.</p>');
      return;
    }
    opts = { ...opts, series };

    const width = Math.max(300, el.clientWidth);
    const height = opts.height || 230;
    const longestName = Math.max(...series.map((item) => item.name.length));
    const right = opts.endLabels
      ? MARGIN.right + longestName * END_LABEL_CHAR_PX
      : MARGIN.right;
    const left = MARGIN.left;
    const top = MARGIN.top;
    const plotW = width - left - right;
    const plotH = height - top - MARGIN.bottom;

    const xs = series.flatMap((item) => item.points.map((point) => point[0]));
    const ys = series.flatMap((item) => item.points.map((point) => point[1]));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const levels = opts.levels || [];
    const { max: yMax, step } = scaleY(
      Math.max(...ys, ...levels.map((level) => level.y)),
    );
    const px = (x) => left + ((x - x0) / (x1 - x0 || 1)) * plotW;
    const py = (y) => top + plotH - (y / yMax) * plotH;

    let svg = HATCH;
    if (opts.band) {
      const bx0 = px(Math.max(opts.band.from, x0));
      const bx1 = px(Math.min(opts.band.to, x1));
      svg += `<rect class="band" x="${bx0}" y="${top}" width="${Math.max(0, bx1 - bx0)}" height="${plotH}" rx="4"/>`;
      svg += `<text class="label-text" x="${bx0 + 6}" y="${top + 14}">${esc(opts.band.label)}</text>`;
    }
    for (let value = 0; value <= yMax + step / 2; value += step) {
      const y = py(value);
      svg += `<line class="${value === 0 ? "axis-line" : "grid-line"}" x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}"/>`;
      svg += `<text class="axis-text" x="${left - 8}" y="${y + 4}" text-anchor="end">${esc(opts.yFormat(value))}</text>`;
    }
    for (const tick of opts.xTicks) {
      if (tick.x < x0 || tick.x > x1) continue;
      svg += `<text class="axis-text" x="${px(tick.x)}" y="${height - 8}" text-anchor="middle">${esc(tick.label)}</text>`;
    }
    for (const level of levels) {
      const y = py(level.y);
      svg += `<line class="ref-line" x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}"/>`;
      svg += `<text class="label-text" x="${left + plotW - 4}" y="${y - 6}" text-anchor="end">${esc(level.label)}</text>`;
    }
    for (const mark of opts.marks || []) {
      if (mark.x < x0 || mark.x > x1) continue;
      const x = px(mark.x);
      const anchor = x > left + plotW * 0.7 ? "end" : "start";
      svg += `<line class="ref-line" x1="${x}" x2="${x}" y1="${top}" y2="${top + plotH}"/>`;
      svg += `<text class="label-text" x="${anchor === "end" ? x - 5 : x + 5}" y="${top + 28}" text-anchor="${anchor}">${esc(mark.label)}</text>`;
    }

    const ends = series.map((item) => item.points[item.points.length - 1]);
    const endYs = ends.map((point) => py(point[1])).sort((a, b) => a - b);
    const labelsFit = endYs.every(
      (y, index) => index === 0 || y - endYs[index - 1] >= MIN_LABEL_GAP_PX,
    );
    series.forEach((item, index) => {
      const path = item.points
        .map(
          (point, i) =>
            `${i ? "L" : "M"}${px(point[0]).toFixed(1)} ${py(point[1]).toFixed(1)}`,
        )
        .join("");
      if (opts.area && index === 0) {
        const baseY = py(0).toFixed(1);
        const first = px(item.points[0][0]).toFixed(1);
        const last = px(ends[index][0]).toFixed(1);
        svg += `<path d="${path}L${last} ${baseY}L${first} ${baseY}Z" fill="${item.color}" opacity="${AREA_OPACITY}"/>`;
      }
      const end = ends[index];
      svg += `<path class="series" stroke="${item.color}" d="${path}"/>`;
      svg += `<circle class="end-dot" r="4.5" fill="${item.color}" cx="${px(end[0])}" cy="${py(end[1])}"/>`;
      if (opts.endLabels && labelsFit) {
        svg += `<text class="label-text" x="${px(end[0]) + 10}" y="${py(end[1]) + 4}">${esc(item.name)}</text>`;
      }
    });

    setHTML(
      parts.body,
      `<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="${esc(opts.ariaLabel)}">${svg}</svg>`,
    );
    setHTML(
      parts.legend,
      series.length > 1
        ? series
            .map(
              (item) =>
                `<span class="legend-item">${swatch(item.color)}${esc(item.name)}</span>`,
            )
            .join("")
        : "",
    );
    setHTML(parts.table, tableHTML(opts));
    el.__state = { opts, px, x0, x1, left, top, plotW, plotH };
  }

  /** Sparkline sebagai string SVG yang melebar mengikuti wadahnya. */
  function sparkline(values, { color, min, max }) {
    if (values.length < 2) return "";
    const W = 100;
    const H = 30;
    const lo = min ?? Math.min(...values);
    const hi = Math.max(max ?? Math.max(...values), lo + 1e-9);
    const y = (v) =>
      H - 2 - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (H - 5);
    const d = values
      .map(
        (v, i) =>
          `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(2)} ${y(v).toFixed(2)}`,
      )
      .join("");
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}L${W} ${H}L0 ${H}Z" fill="${color}" opacity="${AREA_OPACITY}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  // Warna lajur status: tiga tingkat terang yang berbeda (muda, sedang, gelap) supaya tetap
  // terbedakan saat paper dicetak hitam-putih; KRISIS merah solid seperti banner. Kontras teks ≥ 4,5:1.
  const LANE_FILL = {
    NORMAL: "#cdeee2",
    WASPADA: "#e49921",
    KRISIS: "#b71824",
  };
  const LANE_INK = { NORMAL: "#1a6d52", WASPADA: "#2a1a05", KRISIS: "#ffffff" };
  const LANE_LABEL_MIN_PX = 64;
  const MARK_MIN_GAP_PX = 120;
  const MARK_CHAR_PX = 6.8; // perkiraan lebar satu karakter label penanda (11,5px tebal)

  /** Gabungkan penanda yang terlalu dekat agar labelnya tidak bertumpuk. */
  function placeMarks(marks, px, anchorEndAfter) {
    // Rentang horizontal label: rata kiri dari titiknya, atau rata kanan bila titik dekat ujung grafik.
    const extent = (mark) => {
      const x = px(mark.x);
      const w = mark.label.length * MARK_CHAR_PX + 7;
      return x > anchorEndAfter ? [x - w, x] : [x, x + w];
    };
    const placed = [];
    for (const mark of [...marks].sort((a, b) => a.x - b.x)) {
      const last = placed[placed.length - 1];
      // Kejadian yang hampir bersamaan digabung menjadi satu label berurutan.
      if (last && px(mark.x) - px(last.x) < MARK_MIN_GAP_PX) {
        last.label += ` → ${mark.label}`;
        continue;
      }
      const lastAbove = placed.filter((item) => !item.below).pop();
      const below = Boolean(lastAbove) && extent(mark)[0] < extent(lastAbove)[1] + 12;
      placed.push({ ...mark, below });
    }
    return placed;
  }

  /**
   * Lajur status per jam untuk beberapa skenario.
   * @param {HTMLElement} el
   * @param {{lanes: {name: string, sub: string, points: [number, string][], marks: {x: number, label: string}[]}[],
   *   x0: number, x1: number, xTicks: {x: number, label: string}[], band?: {from: number, to: number, label: string},
   *   spans?: {from: number, to: number, label: string}[],
   *   statusWord: Record<string, string>, ariaLabel: string}} opts
   */
  function statusLanes(el, opts) {
    el.classList.add("chart");
    const width = Math.max(520, el.clientWidth);
    const labelW = 190;
    const right = 16;
    const laneH = 34;
    const markH = 24;
    const laneGap = 28;
    const spanRow = opts.spans && opts.spans.length ? 26 : 0;
    const top = 26 + spanRow;
    const plotW = width - labelW - right;
    const px = (x) => labelW + ((x - opts.x0) / (opts.x1 - opts.x0)) * plotW;
    const laneBlock = markH + laneH + laneGap;
    const anchorEndAfter = labelW + plotW * 0.72;
    const height = top + opts.lanes.length * laneBlock + 14;

    let svg = HATCH;
    // Rentang penting (mis. jendela peringatan): kurung di baris atas + sorotan tipis di semua lajur.
    for (const span of opts.spans || []) {
      const sx0 = px(span.from);
      const sx1 = px(span.to);
      svg += `<rect x="${sx0}" y="${top - 6}" width="${sx1 - sx0}" height="${height - top - 14}" fill="#006cb8" opacity="0.08"/>`;
      svg += `<path d="M${sx0} 22v-6h${sx1 - sx0}v6" fill="none" stroke="#006cb8" stroke-width="1.5"/>`;
      svg += `<text class="span-label" x="${(sx0 + sx1) / 2}" y="11" text-anchor="middle">${esc(span.label)}</text>`;
    }
    if (opts.band) {
      const bx0 = px(opts.band.from);
      const bx1 = px(opts.band.to);
      svg += `<rect class="band" x="${bx0}" y="${top - 6}" width="${bx1 - bx0}" height="${height - top - 14}" rx="6"/>`;
      svg += `<text class="label-text" x="${bx0 + 8}" y="${top - 10}">${esc(opts.band.label)}</text>`;
    }
    for (const tick of opts.xTicks) {
      const x = px(tick.x);
      svg += `<line class="grid-line" x1="${x}" x2="${x}" y1="${top - 6}" y2="${height - 18}"/>`;
      svg += `<text class="axis-text" x="${x}" y="${height - 2}" text-anchor="middle">${esc(tick.label)}</text>`;
    }

    opts.lanes.forEach((lane, index) => {
      const y = top + index * laneBlock + markH;
      svg += `<text class="lane-label" x="0" y="${y + 15}">${esc(lane.name)}</text>`;
      svg += `<text class="lane-sub" x="0" y="${y + 31}">${esc(lane.sub)}</text>`;

      // Gabungkan jam berurutan dengan status sama menjadi satu blok.
      const segments = [];
      for (const [t, status] of lane.points) {
        const last = segments[segments.length - 1];
        if (last && last.status === status) last.to = t;
        else segments.push({ status, from: t, to: t });
      }
      segments.forEach((segment, i) => {
        const end = i + 1 < segments.length ? segments[i + 1].from : opts.x1;
        const sx = px(segment.from);
        const sw = Math.max(1, px(end) - sx - 2);
        svg += `<rect x="${sx}" y="${y}" width="${sw}" height="${laneH}" rx="5" fill="${LANE_FILL[segment.status]}"/>`;
        if (sw >= LANE_LABEL_MIN_PX) {
          svg += `<text class="seg-label" x="${sx + 8}" y="${y + 21}" fill="${LANE_INK[segment.status]}">${esc(opts.statusWord[segment.status])}</text>`;
        }
      });

      for (const mark of placeMarks(lane.marks, px, anchorEndAfter)) {
        const x = px(mark.x);
        const anchor = x > anchorEndAfter ? "end" : "start";
        const dotY = mark.below ? y + laneH + 6 : y - 6;
        const textY = mark.below ? y + laneH + 18 : y - 3;
        svg += `<line x1="${x}" x2="${x}" y1="${Math.min(dotY, y)}" y2="${Math.max(dotY, y + laneH)}" stroke="#172029" stroke-width="1.5"/>`;
        svg += `<circle cx="${x}" cy="${dotY}" r="3.5" fill="#172029"/>`;
        svg += `<text class="mark-label" x="${anchor === "end" ? x - 7 : x + 7}" y="${textY}" text-anchor="${anchor}">${esc(mark.label)}</text>`;
      }
    });

    setHTML(
      el,
      `<svg viewBox="0 0 ${width} ${height}" height="${height}" role="img" aria-label="${esc(opts.ariaLabel)}">${svg}</svg>`,
    );
  }

  ns.charts = { line, sparkline, statusLanes, scaleY, LANE_FILL };
})((globalThis.SiTanggap = globalThis.SiTanggap || {}));
