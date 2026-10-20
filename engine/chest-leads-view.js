// Copied by tools/sync-from-web.mjs from js/chest-leads-view.js; only this line is added (and any stylesheet import removed).
import { document, devicePixelRatio } from "./mp-dom.js";
// CC-54: the chest-lead (V1–V6) tab of the Wiggers card. Two canvases share
// the lab's clock: the strips (lead II reference + V1–V6) and a horizontal-
// plane chest diagram with the live heart vector and its QRS/T loops. The
// leads come from the beat series the lab already samples (ecg12.js reads
// each sample's clocks), so this view adds no model sampling of its own.
// "sync" draws one cardiac cycle with the phase bands, like the Wiggers
// strips; "paper" scrolls 2.4 s at 25 mm/s from the beats already played,
// so AF's irregular RR and complete block's dissociated P waves show.
import {
  ecg12Components,
  leadFromComponents,
  beatLeads,
  STRIP_LEADS,
  CHEST_LEADS,
  LEAD_AXES,
} from "./ecg12.js";

export { beatLeads, STRIP_LEADS };

const PAPER_MS = 2400;
const C = {
  ecg: "#5ee0b5",
  ref: "rgba(94, 224, 181, 0.45)",
  hl: "#e8a33d",
  ink: "#dbe6f5",
  text: "#8ea3c0",
  dim: "#64789a",
  grid: "rgba(120, 168, 226, 0.14)",
  line: "rgba(120, 168, 226, 0.32)",
  paper: "rgba(255, 122, 144, 0.06)",
  paperMajor: "rgba(255, 122, 144, 0.22)",
  pos: (a) => `rgba(94, 224, 181, ${a})`,
  neg: (a) => `rgba(255, 122, 144, ${a})`,
};
// Phase bands in the colours of the Wiggers strips (charts.js).
const PHASE_COLORS = [
  "rgba(94, 224, 181, 0.55)",
  "rgba(195, 155, 255, 0.5)",
  "rgba(110, 168, 255, 0.55)",
  "rgba(110, 168, 255, 0.4)",
  "rgba(244, 114, 182, 0.5)",
  "rgba(232, 176, 77, 0.55)",
  "rgba(148, 165, 191, 0.35)",
];

function fit(canvas) {
  const r = canvas.getBoundingClientRect(),
    d = Math.min(devicePixelRatio || 1, 2),
    w = Math.max(1, r.width),
    h = Math.max(1, r.height);
  if (
    canvas.width !== Math.round(w * d) ||
    canvas.height !== Math.round(h * d)
  ) {
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w, h };
}
const FONT = '"Segoe UI","Microsoft YaHei",sans-serif';
function label(ctx, s, x, y, color, size = 9, align = "left", weight = "") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}

export class ChestLeadsView {
  constructor({ strips, diagram, readout, findings, i18n }) {
    Object.assign(this, { strips, diagram, readout, findings, i18n });
    this.mode = "sync";
    this.highlight = new Set();
    this.beats = new Map(); // beatIndex → { T, rows }, for the paper window
    this.background = document.createElement("canvas");
  }
  /** entry: content/ecg12/<id>.json; spec: buildEcg12Spec(...) */
  setScenario(spec, entry) {
    this.spec = spec;
    this.entry = entry;
    this.beats.clear();
    this.highlight.clear();
    this.renderFindings();
  }
  /**
   * The lab's current beat: series as from model.series(); schedule from
   * model.phaseSchedule(); beatKey identifies the beat (0 for identical beats).
   */
  setData({ series, schedule, beatIndex, sameBeat = false, hr, modifiers }) {
    if (!this.spec || !series?.length) return;
    const stamp = `${hr}|${modifiers?.preload}|${modifiers?.afterload}|${modifiers?.contractility}`;
    if (stamp !== this.stamp) this.beats.clear();
    this.stamp = stamp;
    const beatKey = sameBeat ? 0 : beatIndex;
    Object.assign(this, { schedule, beatIndex, beatKey, hr, sameBeat });
    const T = series[0].T;
    let beat = this.beats.get(beatKey);
    if (!beat || beat.series !== series) {
      beat = { T, series, schedule, rows: beatLeads(series, this.spec) };
      this.beats.set(beatKey, beat);
      if (this.beats.size > 12)
        this.beats.delete(this.beats.keys().next().value);
    }
    this.current = beat;
    this.renderFindings(); // language may have changed
    // QRS and T loops for the chest diagram.
    this.qrsLoop = beat.rows
      .filter((r) => r.ventricularTime < r.qrsDuration)
      .sort((a, b) => a.ventricularTime - b.ventricularTime);
    this.tLoop = beat.rows
      .filter(
        (r) => r.ventricularTime >= r.qrsDuration && r.ventricularTime < r.qtMs,
      )
      .sort((a, b) => a.ventricularTime - b.ventricularTime);
    this.build();
  }
  geometry(w, h) {
    const compact = w < 520,
      top = compact ? 16 : 22,
      bottom = compact ? 16 : 18,
      x = compact ? 34 : 46,
      right = 8,
      rh = (h - top - bottom) / STRIP_LEADS.length;
    return { compact, top, bottom, x, pw: w - x - right, rh, mvpx: rh * 0.5 };
  }
  rowY(g, i) {
    return g.top + g.rh * (i + 0.5);
  }
  /** Static layer of the cycle-synced mode: phase bands, grid, traces. */
  build() {
    if (!this.current || this.strips.closest("[hidden]")) return;
    const { ctx, w, h } = fit(this.strips);
    this.background.width = this.strips.width;
    this.background.height = this.strips.height;
    const b = this.background.getContext("2d"),
      d = this.strips.width / w;
    b.setTransform(d, 0, 0, d, 0, 0);
    b.clearRect(0, 0, w, h);
    const g = (this.g = this.geometry(w, h)),
      T = this.current.T;
    this.plot = { x: g.x, w: g.pw, T };
    for (const p of this.schedule ?? []) {
      if (p.duration < 1) continue;
      const x0 = g.x + (p.start / T) * g.pw,
        pw = (p.duration / T) * g.pw;
      b.fillStyle = PHASE_COLORS[p.index] ?? PHASE_COLORS[6];
      b.fillRect(x0, 3, pw, g.compact ? 4 : 5);
      if (!g.compact && pw > 56)
        label(b, this.i18n.local(p.name), x0 + 3, 14, C.text, 8.5);
    }
    this.drawRows(b, g, w, h, (lead) =>
      this.current.rows.map((r) => [g.x + (r.t / T) * g.pw, r.leads[lead]]),
    );
    for (let i = 0; i <= 4; i++)
      label(
        b,
        ((T * i) / 4000).toFixed(2),
        g.x + (g.pw * i) / 4,
        h - g.bottom / 2,
        C.text,
        8,
        i === 0 ? "left" : i === 4 ? "right" : "center",
      );
    if (!g.compact)
      label(b, "s", w - 2, h - g.bottom / 2 - 10, C.text, 8, "right");
    ctx.clearRect(0, 0, w, h);
  }
  drawRows(ctx, g, w, h, points) {
    STRIP_LEADS.forEach((lead, i) => {
      const y = this.rowY(g, i),
        ref = lead === "II",
        hl = this.highlight.has(lead);
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.pw, y);
      ctx.stroke();
      label(
        ctx,
        ref ? this.i18n.t(g.compact ? "chestRefShort" : "chestRef") : lead,
        4,
        y,
        hl ? C.hl : ref ? C.dim : C.ink,
        g.compact ? 10 : 11,
        "left",
        hl ? "600" : "500",
      );
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, y - g.rh, g.pw, g.rh * 2);
      ctx.clip();
      ctx.beginPath();
      points(lead).forEach(([x, v], k) =>
        k ? ctx.lineTo(x, y - v * g.mvpx) : ctx.moveTo(x, y - v * g.mvpx),
      );
      ctx.strokeStyle = hl ? C.hl : ref ? C.ref : C.ecg;
      ctx.lineWidth = hl ? 2 : ref ? 1 : 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    });
    // 1 mV calibration pulse beside V1.
    if (!g.compact) {
      const x = g.x - 8,
        y = this.rowY(g, 1);
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x - 5, y - g.mvpx);
      ctx.lineTo(x, y - g.mvpx);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  update(sample) {
    if (!this.current || this.strips.closest("[hidden]")) return;
    this.sample = sample;
    const { ctx, w, h } = fit(this.strips);
    const g = this.g ?? this.geometry(w, h);
    ctx.clearRect(0, 0, w, h);
    if (this.mode === "sync") {
      ctx.drawImage(this.background, 0, 0, w, h);
      const x = g.x + (sample.t / this.current.T) * g.pw;
      ctx.strokeStyle = "rgba(233, 239, 250, 0.55)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, g.top - 4);
      ctx.lineTo(x, h - g.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      const row = this.rowAt(sample.t);
      STRIP_LEADS.forEach((lead, i) => {
        ctx.fillStyle = C.hl;
        ctx.beginPath();
        ctx.arc(x, this.rowY(g, i) - row.leads[lead] * g.mvpx, 2.4, 0, 7);
        ctx.fill();
      });
    } else this.drawPaper(ctx, g, w, h, sample.t);
    this.drawDiagram(sample);
    this.renderReadout(sample);
  }
  rowAt(t) {
    const rows = this.current.rows,
      i = Math.min(
        rows.length - 1,
        Math.max(0, Math.round((t / this.current.T) * rows.length)),
      );
    return rows[i % rows.length];
  }
  drawPaper(ctx, g, w, h, t) {
    const X = (ms) => g.x + g.pw + (ms / PAPER_MS) * g.pw; // ms ≤ 0 relative to now
    // Beats in the window, newest first: [beat, its start relative to now].
    const window = [];
    let k = this.beatIndex,
      start = -t,
      beat = this.current;
    while (beat && start + beat.T > -PAPER_MS && window.length < 12) {
      window.push([beat, start]);
      k -= 1;
      beat = this.sameBeat ? this.current : k >= 0 ? this.beats.get(k) : null;
      if (beat) start -= beat.T;
    }
    // Millimetre paper: 40 ms / 0.1 mV small boxes, 200 ms / 0.5 mV large.
    ctx.lineWidth = 1;
    for (let ms = -Math.floor(PAPER_MS / 40) * 40; ms <= 0; ms += 40) {
      const x = X(ms - (t % 40));
      ctx.strokeStyle =
        Math.round((ms - (t % 40) + t) / 40) % 5 === 0 ? C.paperMajor : C.paper;
      ctx.beginPath();
      ctx.moveTo(x, g.top - 4);
      ctx.lineTo(x, h - g.bottom);
      ctx.stroke();
    }
    for (const [beat, s] of window) {
      for (const p of beat.schedule ?? []) {
        if (p.duration < 1) continue;
        const x0 = Math.max(g.x, X(s + p.start)),
          x1 = Math.min(g.x + g.pw, X(s + p.end));
        if (x1 > x0) {
          ctx.fillStyle = PHASE_COLORS[p.index] ?? PHASE_COLORS[6];
          ctx.fillRect(x0, 3, x1 - x0, 4);
        }
      }
    }
    this.drawRows(ctx, g, w, h, (lead) => {
      const pts = [];
      for (const [beat, s] of [...window].reverse())
        for (const r of beat.rows) {
          const ms = s + r.t;
          if (ms > 0 || ms < -PAPER_MS) continue;
          pts.push([X(ms), r.leads[lead]]);
        }
      return pts;
    });
    label(
      ctx,
      this.i18n.t(g.compact ? "chestPaperScaleShort" : "chestPaperScale"),
      g.x + g.pw,
      h - g.bottom / 2,
      C.text,
      8,
      "right",
    );
    label(ctx, "−2.4 s", g.x, h - g.bottom / 2, C.text, 8);
    ctx.strokeStyle = "rgba(233, 239, 250, 0.55)";
    ctx.beginPath();
    ctx.moveTo(g.x + g.pw, g.top - 4);
    ctx.lineTo(g.x + g.pw, h - g.bottom);
    ctx.stroke();
  }
  drawDiagram(sample) {
    const { ctx, w, h } = fit(this.diagram);
    ctx.clearRect(0, 0, w, h);
    const compact = w < 160,
      cx = w / 2,
      cy = h * 0.55,
      rx = Math.min(w * 0.44, h * 0.68),
      ry = rx * 0.66;
    ctx.fillStyle = "rgba(120, 168, 226, 0.06)";
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 7);
    ctx.fill();
    ctx.stroke();
    // Spine (posterior) and sternum (anterior).
    ctx.fillStyle = "rgba(120, 168, 226, 0.18)";
    ctx.beginPath();
    ctx.arc(cx, cy + ry * 0.72, ry * 0.13, 0, 7);
    ctx.fill();
    ctx.fillRect(cx - 3, cy - ry * 0.98, 6, ry * 0.16);
    const hx = cx + rx * 0.1,
      hy = cy - ry * 0.08;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-0.55);
    ctx.fillStyle = "rgba(255, 122, 144, 0.16)";
    ctx.strokeStyle = "rgba(255, 122, 144, 0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.3, ry * 0.36, 0, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Viewed from the feet, anterior up: patient's left on the viewer's right.
    const k = ry * 0.36,
      P = (v) => [hx + v[0] * k, hy - v[2] * k];
    const loop = (rows, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      rows.forEach((r, i) => {
        const [x, y] = P(r.vector);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    loop(this.qrsLoop ?? [], "rgba(69, 200, 245, 0.55)");
    loop(this.tLoop ?? [], "rgba(232, 176, 77, 0.5)");
    const parts = ecg12Components(sample, this.spec),
      H = [0, 1, 2].map(
        (i) =>
          parts.p[i] + parts.qrs[i] + parts.st[i] + parts.t[i] + parts.fib[i],
      ),
      r = compact ? 7 : 9;
    ctx.font = `600 ${compact ? 7 : 8.5}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const lead of CHEST_LEADS) {
      const a = LEAD_AXES[lead].axis,
        m = Math.hypot(a[0], a[2]);
      const ex = cx + (rx * 0.93 * a[0]) / m,
        ey = cy - (ry * 0.93 * a[2]) / m;
      const v = leadFromComponents(parts, lead),
        s = Math.min(1, Math.abs(v) / 1.2);
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = "rgba(120, 168, 226, 0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = v >= 0 ? C.pos(0.15 + 0.75 * s) : C.neg(0.15 + 0.75 * s);
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, 7);
      ctx.fill();
      ctx.lineWidth = this.highlight.has(lead) ? 2 : 1;
      ctx.strokeStyle = this.highlight.has(lead) ? C.hl : C.line;
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.fillText(lead, ex, ey + 0.5);
    }
    const clampV = (x) => Math.max(-2.2, Math.min(2.2, x));
    const [ax, ay] = P([clampV(H[0]), 0, clampV(H[2])]),
      len = Math.hypot(ax - hx, ay - hy),
      ang = Math.atan2(ay - hy, ax - hx);
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    if (len > 5) {
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 7 * Math.cos(ang - 0.45), ay - 7 * Math.sin(ang - 0.45));
      ctx.lineTo(ax - 7 * Math.cos(ang + 0.45), ay - 7 * Math.sin(ang + 0.45));
      ctx.fill();
    }
    label(
      ctx,
      this.i18n.t("chestAnterior"),
      cx,
      Math.max(7, cy - ry - 7),
      C.dim,
      compact ? 8 : 9,
      "center",
    );
    label(
      ctx,
      this.i18n.t("chestLeft"),
      cx + rx * 0.92,
      cy + ry * 0.9,
      C.dim,
      compact ? 8 : 9,
      "right",
    );
    label(
      ctx,
      this.i18n.t("chestRight"),
      cx - rx * 0.92,
      cy + ry * 0.9,
      C.dim,
      compact ? 8 : 9,
      "left",
    );
  }
  /** [label, value] rows of the current beat's intervals. */
  readoutRows(sample) {
    const c = sample.conduction,
      pr = c.dissociated
        ? this.i18n.t("chestDissociated")
        : c.fibrillating
          ? this.i18n.t("chestNoP")
          : `${Math.round(c.prMs)} ms`;
    return [
      [this.i18n.t("heartRate"), `${Math.round(60000 / c.periodMs)} /min`],
      ["PR", pr],
      ["QRS", `${Math.round(c.qrsDuration)} ms`],
      ["QT", `${Math.round(c.qtMs)} ms`],
    ];
  }
  /** The scenario's findings with their lead tags and highlight state. */
  findingItems() {
    return (this.entry?.findings ?? []).map((f, index) => ({
      index,
      id: f.id,
      tag:
        f.leads.length === 6 && f.leads.every((l) => CHEST_LEADS.includes(l))
          ? "V1–V6"
          : f.leads.join(" "),
      text: this.i18n.local(f.text),
      on:
        f.leads.length === this.highlight.size &&
        f.leads.every((l) => this.highlight.has(l)),
    }));
  }
  // The readout and findings elements are optional: the WeChat mini program
  // renders readoutRows() and findingItems() in its own WXML.
  renderReadout(sample) {
    if (!this.readout) return;
    const html = this.readoutRows(sample)
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("");
    if (html !== this.readoutHtml)
      this.readout.innerHTML = this.readoutHtml = html;
  }
  renderFindings() {
    if (!this.entry || !this.findings) return;
    const esc = (s) =>
      String(s).replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      );
    this.findings.innerHTML = this.findingItems()
      .map(
        (f) =>
          `<button type="button" class="chest-finding" data-finding="${f.index}" aria-pressed="${f.on}"><span class="chest-finding-leads">${esc(f.tag)}</span><span>${esc(f.text)}</span></button>`,
      )
      .join("");
  }
  /** Highlight a finding's leads (toggle); returns the leads now lit. */
  toggleFinding(index) {
    const leads = this.entry?.findings[index]?.leads ?? [];
    const same =
      leads.length === this.highlight.size &&
      leads.every((l) => this.highlight.has(l));
    this.highlight = new Set(same ? [] : leads);
    this.refreshHighlight();
    return [...this.highlight];
  }
  toggleLead(lead) {
    this.highlight = new Set(
      this.highlight.size === 1 && this.highlight.has(lead) ? [] : [lead],
    );
    this.refreshHighlight();
    return [...this.highlight];
  }
  refreshHighlight() {
    this.renderFindings();
    this.build();
    if (this.sample) this.update(this.sample);
  }
  setMode(mode) {
    this.mode = mode === "paper" ? "paper" : "sync";
    this.build();
    if (this.sample) this.update(this.sample);
  }
  /** Strip row under a client y (lead name), or null on the reference row. */
  leadAt(clientY) {
    const r = this.strips.getBoundingClientRect(),
      g = this.geometry(r.width, r.height);
    const i = Math.floor((clientY - r.top - g.top) / g.rh);
    return i >= 1 && i < STRIP_LEADS.length ? STRIP_LEADS[i] : null;
  }
  timeAt(clientX) {
    const r = this.strips.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        this.plot.T - 0.01,
        ((clientX - r.left - this.plot.x) / this.plot.w) * this.plot.T,
      ),
    );
  }
  inPlot(clientX) {
    return (
      !!this.plot &&
      clientX - this.strips.getBoundingClientRect().left >= this.plot.x
    );
  }
  /** Values of the strip leads at the current instant (values dialog, CSV). */
  valuesAt(sample) {
    const k = ecg12Components(sample, this.spec);
    return Object.fromEntries(
      CHEST_LEADS.map((l) => [l, leadFromComponents(k, l)]),
    );
  }
}
