// Copied by tools/sync-from-web.mjs from js/engine/charts.js; only this line is added.
import { document, devicePixelRatio } from "./mp-dom.js";
// Traces are drawn on the dark panels of the portal-matched theme.
const C = {
  teal: "#45c8f5",
  ao: "#ff8a65",
  lv: "#6ea8ff",
  la: "#c39bff",
  ecg: "#5ee0b5",
  volume: "#e8b04d",
  sound: "#b49cff",
  grid: "rgba(120, 168, 226, 0.14)",
  text: "#8ea3c0",
  ink: "#dbe6f5",
};
// Vertical layout of the Wiggers strips for a canvas h px tall. At 486 px and
// taller everything scales uniformly (the desktop layout). Shorter canvases
// (phones and short screens show the strips beside or under the moving heart)
// keep the title bands, valve bars and time axis at a readable fixed size and
// shrink only the plots and the spacing between them; at 486 px both rules
// give the same layout.
export function stripLayout(h) {
  const plots = [63, 112, 66, 35],
    lead = [5, 10, 12, 13];
  if (h >= 486) {
    const s = h / 486,
      ys = [27, 122, 268, 369];
    return {
      rows: ys.map((y, i) => ({ y: y * s, h: plots[i] * s })),
      by: 432 * s,
      bh: 8 * s,
      bs: 16 * s,
    };
  }
  // Title band above each row: 22 px at 486, down to 17 px below 300 px.
  const band = 17 + 5 * Math.min(1, Math.max(0, (h - 300) / 186));
  const k = Math.max(0.05, (h - (5 * band + 32)) / 344);
  let y = 0;
  const rows = plots.map((height, i) => {
    y += band + lead[i] * k;
    const row = { y, h: height * k };
    y += row.h;
    return row;
  });
  return { rows, by: y + 8 + 20 * k, bh: 8, bs: 16 };
}

export function fitCanvas(canvas) {
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
  return { ctx, w, h, d };
}
function text(ctx, s, x, y, color = C.text, size = 9, align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${size}px "Segoe UI","Microsoft YaHei",sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}
function path(ctx, points, color, width = 1.6) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}
function grid(ctx, x, y, w, h, min, max) {
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.6;
  for (let i = 0; i <= 4; i++) {
    const yy = y + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();
    if (i % 2 === 0)
      text(
        ctx,
        Math.round(max - ((max - min) * i) / 4),
        x - 5,
        yy + 3,
        C.text,
        8,
        "right",
      );
  }
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / 8, y);
    ctx.lineTo(x + (w * i) / 8, y + h);
    ctx.stroke();
  }
}
export class Charts {
  constructor(strips, pv, ap, i18n) {
    Object.assign(this, { strips, pv, ap, i18n });
    this.background = document.createElement("canvas");
    this.series = [];
  }
  setData(series, schedule, baseline, side = "left") {
    Object.assign(this, { series, schedule, baseline, side });
    this.build();
  }
  build() {
    if (!this.series.length) return;
    const { w, h, d } = fitCanvas(this.strips);
    this.background.width = this.strips.width;
    this.background.height = this.strips.height;
    const ctx = this.background.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Left label gutter: wider on narrow (phone) canvases so the strip
    // titles ("心电图 / 压力 / 心室容积 / 心音") are not squeezed against the
    // plot, and so there is a generous non-interactive margin to hold while
    // scrolling the page.
    const x = w < 500 ? Math.round(Math.min(64, Math.max(48, w * 0.16))) : 39,
      r = 17,
      pw = w - x - r,
      T = this.series[0].T;
    this.plot = { x, w: pw, T };
    const rows = [
      {
        key: "ecg",
        y: 27,
        h: 63,
        min: -0.5,
        max: 1.5,
        title: this.i18n.t("ecg") + " · II",
        unit: "mV",
      },
      {
        key: "pressure",
        y: 122,
        h: 112,
        min: 0,
        max:
          this.side === "left"
            ? Math.max(140, ...this.series.map((s) => s.pressures.lv)) * 1.04
            : 35,
        title: this.i18n.t("pressure"),
        unit: "mmHg",
      },
      {
        key: "volume",
        y: 268,
        h: 66,
        min: 30,
        max: Math.max(140, ...this.series.map((s) => s.edv)) * 1.02,
        title: this.i18n.t("volume"),
        unit: "mL",
      },
      {
        key: "sounds",
        y: 369,
        h: 35,
        min: -1,
        max: 1,
        title: this.i18n.t("heartSounds"),
        unit: "",
      },
    ];
    const layout = stripLayout(h);
    rows.forEach((row, i) => {
      row.y = layout.rows[i].y;
      row.h = layout.rows[i].h;
      text(ctx, row.title, 13, row.y - 12, C.ink, 10);
      text(ctx, row.unit, w - 17, row.y - 12, C.text, 8, "right");
      grid(ctx, x, row.y, pw, row.h, row.min, row.max);
      const yy = (v) =>
        row.y + row.h * (1 - (v - row.min) / (row.max - row.min));
      if (row.key === "pressure") {
        // CC-48 PFO: the right-to-left shunt window shaded under the traces.
        const pfo = !!this.series[0]?.interatrial;
        if (pfo) {
          ctx.fillStyle = "rgba(69, 200, 245, 0.14)";
          let from = null;
          this.series.forEach((s, i) => {
            const open = s.interatrial.open,
              last = i === this.series.length - 1;
            if (open && from === null) from = s.t;
            if (from !== null && (!open || last)) {
              const to = open ? T : s.t;
              ctx.fillRect(x + (from / T) * pw, row.y, ((to - from) / T) * pw, row.h);
              if (to - from > 0.12 * T)
                text(ctx, this.i18n.t("shuntRightToLeft"), x + (((from + to) / 2) / T) * pw, row.y + 10, C.teal, 8, "center");
              from = null;
            }
          });
        }
        const keys =
          this.side === "left" ? ["ao", "lv", "la"] : ["pa", "rv", "ra"];
        keys.forEach((key, i) => {
          path(
            ctx,
            this.series.map((s) => [x + (s.t / T) * pw, yy(s.pressures[key])]),
            [C.ao, C.lv, C.la][i],
          );
          text(
            ctx,
            key.toUpperCase(),
            x + 8 + i * 40,
            row.y + 10,
            [C.ao, C.lv, C.la][i],
            8,
          );
        });
        // CC-48 PFO: the other atrium dashed, so the RA-LA crossing that
        // opens the flap is visible on either side's strip.
        if (pfo) {
          const other = this.side === "left" ? "ra" : "la";
          ctx.setLineDash([4, 3]);
          path(
            ctx,
            this.series.map((s) => [x + (s.t / T) * pw, yy(s.pressures[other])]),
            C.teal,
            1.3,
          );
          ctx.setLineDash([]);
          text(ctx, other.toUpperCase() + " - -", x + 8 + 3 * 40, row.y + 10, C.teal, 8);
        }
        if (this.side === "left") {
          for (const [tag, ref] of [
            ["a", 55],
            ["c", 125],
            ["v", 450],
          ]) {
            const point = this.series.reduce(
              (best, s) =>
                Math.abs(s.referenceTime - ref) <
                Math.abs(best.referenceTime - ref)
                  ? s
                  : best,
              this.series[0],
            );
            text(
              ctx,
              tag,
              x + (point.t / T) * pw,
              yy(point.pressures.la) - 6,
              C.la,
              9,
            );
          }
        }
      } else if (row.key === "sounds") {
        for (const key of ["s1", "s2", "s3", "s4", "murmur"])
          path(
            ctx,
            this.series.map((s) => [
              x + (s.t / T) * pw,
              yy(s.sounds[key] * Math.sin(s.referenceTime * 0.8)),
            ]),
            C.sound,
            1.1,
          );
        ["s1", "s2"].forEach((key, i) => {
          const p = this.series.reduce((a, b) =>
            a.sounds[key] > b.sounds[key] ? a : b,
          );
          text(
            ctx,
            key.toUpperCase(),
            x + (p.t / T) * pw,
            row.y - 1,
            C.sound,
            8,
            "center",
          );
        });
      } else
        path(
          ctx,
          this.series.map((s) => [
            x + (s.t / T) * pw,
            yy(row.key === "ecg" ? s.ecg : s.volume.lv),
          ]),
          row.key === "ecg" ? C.ecg : C.volume,
          1.7,
        );
    });
    const { by, bh, bs } = layout;
    const names =
      this.side === "left" ? ["mitral", "aortic"] : ["tricuspid", "pulmonary"];
    names.forEach((key, j) => {
      const y = by + j * bs;
      ctx.fillStyle = "rgba(148, 165, 191, 0.14)";
      ctx.fillRect(x, y, pw, bh);
      ctx.fillStyle = j ? C.ao : C.teal;
      this.series.forEach((s) => {
        if (s.valves[key].open)
          ctx.fillRect(x + (s.t / T) * pw, y, pw / this.series.length + 1, bh);
      });
      ctx.fillStyle = "rgba(8, 18, 34, 0.92)";
      ctx.fillRect(x + 3, y - 1, Math.min(90, pw * 0.4), bh + 2);
      text(ctx, this.i18n.t(key), x + 6, y + bh - 1, C.text, 8);
    });
    for (let i = 0; i <= 4; i++)
      text(
        ctx,
        ((T * i) / 4000).toFixed(2),
        x + (pw * i) / 4,
        h - 8,
        C.text,
        8,
        "center",
      );
    text(ctx, "s", w - 10, h - 8, C.text, 8);
    for (const phase of this.schedule) {
      if (phase.duration < 1) continue;
      ctx.fillStyle = [
        "rgba(94, 224, 181, 0.55)",
        "rgba(195, 155, 255, 0.5)",
        "rgba(110, 168, 255, 0.55)",
        "rgba(110, 168, 255, 0.4)",
        "rgba(244, 114, 182, 0.5)",
        "rgba(232, 176, 77, 0.55)",
        "rgba(148, 165, 191, 0.35)",
        "rgba(148, 165, 191, 0.35)",
      ][phase.index];
      ctx.fillRect(x + (phase.start / T) * pw, 2, (phase.duration / T) * pw, 3);
    }
    this.renderAP();
  }
  update(sample, relations = true) {
    const { ctx, w, h } = fitCanvas(this.strips);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.background, 0, 0, w, h);
    const x = this.plot.x + (sample.t / sample.T) * this.plot.w;
    ctx.strokeStyle = "rgba(233, 239, 250, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 7);
    ctx.lineTo(x, h - 22);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#e9effa";
    ctx.beginPath();
    ctx.moveTo(x - 3, 5);
    ctx.lineTo(x + 3, 5);
    ctx.lineTo(x, 10);
    ctx.fill();
    this.renderPV(sample, relations);
    if (!this.ap.closest("[hidden]")) this.renderAP(sample);
  }
  renderPV(sample, relations) {
    const { ctx, w, h } = fitCanvas(this.pv);
    ctx.clearRect(0, 0, w, h);
    if (!this.series.length) return;
    const x = 31,
      y = 10,
      pw = w - 44,
      ph = h - 36,
      maxV = Math.max(160, ...this.series.map((s) => s.volume.lv)) * 1.1,
      maxP = Math.max(140, ...this.series.map((s) => s.pressures.lv)) * 1.12;
    const X = (v) => x + (v / maxV) * pw,
      Y = (p) => y + ph - (p / maxP) * ph;
    grid(ctx, x, y, pw, ph, 0, maxP);
    for (let i = 0; i <= 3; i++)
      text(
        ctx,
        Math.round((maxV * i) / 3),
        x + (pw * i) / 3,
        h - 12,
        C.text,
        8,
        "center",
      );
    text(ctx, "mL", w - 1, h - 12, C.text, 8, "right");
    if (relations) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, pw, ph);
      ctx.clip();
      ctx.setLineDash([3, 3]);
      path(
        ctx,
        [
          [X(10), Y(0)],
          [X(110), Y(sample.pv?.espvrSlope * 100 || 220)],
        ],
        "#ff9e80",
        1,
      );
      path(
        ctx,
        Array.from({ length: 70 }, (_, i) => {
          const v = (i * maxV) / 70;
          return [X(v), Y(Math.max(0, 2 * (Math.exp(0.025 * (v - 45)) - 1)))];
        }),
        "#8fd3b0",
        1,
      );
      ctx.restore();
      text(ctx, "ESPVR", x + 4, y + 10, "#ffb199", 7);
      text(ctx, "EDPVR", x + pw - 4, y + ph - 9, "#9ad9b9", 7, "right");
    }
    const points = this.series.map((s) => [X(s.volume.lv), Y(s.pressures.lv)]);
    path(ctx, [...points, points[0]], C.teal, 2);
    ctx.fillStyle = "rgba(69, 200, 245, 0.12)";
    ctx.fill();
    for (const [ref, label, dx, dy] of [
      [100, "MC", 6, 11],
      [150, "AO", 6, -2],
      [450, "AC", -7, -5],
      [510, "MO", -7, 11],
    ]) {
      const s = this.series.reduce((a, b) =>
        Math.abs(a.referenceTime - ref) < Math.abs(b.referenceTime - ref)
          ? a
          : b,
      );
      ctx.fillStyle = "#081222";
      ctx.strokeStyle = C.teal;
      ctx.beginPath();
      ctx.arc(X(s.volume.lv), Y(s.pressures.lv), 2.8, 0, 7);
      ctx.fill();
      ctx.stroke();
      text(
        ctx,
        label,
        X(s.volume.lv) + dx,
        Y(s.pressures.lv) + dy,
        C.text,
        7,
        dx < 0 ? "right" : "left",
      );
    }
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(X(sample.volume.lv), Y(sample.pressures.lv), 4, 0, 7);
    ctx.fill();
    ctx.strokeStyle = C.teal;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  renderAP(sample) {
    if (!this.series.length || this.ap.closest("[hidden]")) return;
    const { ctx, w, h } = fitCanvas(this.ap);
    ctx.clearRect(0, 0, w, h);
    const names = ["sa", "atrial", "av", "purkinje", "ventricular"],
      left = Math.min(190, w * 0.29),
      pw = w - left - 22,
      rh = (h - 22) / 5,
      T = this.series[0].T;
    names.forEach((key, i) => {
      const top = i * rh + 14,
        ph = rh - 30;
      const yy = (v) => top + ph * (1 - (v + 100) / 140);
      text(ctx, this.i18n.t(key), 14, top + 14, C.ink, 11);
      text(
        ctx,
        this.i18n.language === "zh" ? "−100 至 +40 mV" : "−100 to +40 mV",
        14,
        top + 31,
        C.text,
        8,
      );
      grid(ctx, left, top, pw, ph, -100, 40);
      path(
        ctx,
        this.series.map((s) => [left + (s.t / T) * pw, yy(s.ap[key])]),
        [C.teal, C.ao, C.la, C.volume, C.ecg][i],
        1.6,
      );
      if (
        key === "ventricular" &&
        document.getElementById("repolarization")?.checked
      )
        this.renderRepolarization(ctx, left, top, pw, ph, T, yy);
      if (key === "ventricular" && document.getElementById("erp").checked) {
        ctx.fillStyle = "rgba(232, 176, 77, 0.5)";
        this.series.forEach((s) => {
          if (s.erp)
            ctx.fillRect(
              left + (s.t / T) * pw,
              top + ph + 5,
              pw / this.series.length + 1,
              4,
            );
        });
        text(ctx, "ERP", left - 8, top + ph + 10, C.text, 8, "right");
      }
      if (sample) {
        const sx = left + (sample.t / T) * pw;
        ctx.strokeStyle = "rgba(233, 239, 250, 0.4)";
        ctx.beginPath();
        ctx.moveTo(sx, top);
        ctx.lineTo(sx, top + ph);
        ctx.stroke();
        ctx.fillStyle = C.ink;
        ctx.beginPath();
        ctx.arc(sx, yy(sample.ap[key]), 3, 0, 7);
        ctx.fill();
      }
    });
    text(ctx, (T / 1000).toFixed(3) + " s", w - 23, h - 2, C.text, 8, "right");
  }
  // "Why is the T wave upright?": the ventricular trace is read as the
  // endocardial cell and an epicardial one is drawn beside it with the same
  // timing rule as the 3D conduction layer (repolarizationAt): activation
  // 35 ms later, action potential 65 ms shorter, so it recovers 30 ms first.
  // The shaded strip is that transmural recovery gap, the T wave's window.
  renderRepolarization(ctx, left, top, pw, ph, T, yy) {
    const s = this.series,
      v = s.map((x) => x.ap.ventricular);
    const up = v.findIndex((y, i) => i > 0 && v[i - 1] < -40 && y >= -40);
    if (up < 0) return;
    const tUp = s[up].t;
    const down = v.findIndex((y, i) => i > up && s[i].t > tUp + 50 && y < -70);
    if (down < 0) return;
    const D = s[down].t - tUp,
      rest = v[Math.max(0, up - 1)];
    const at = (t) => {
      const j = s.findIndex((x) => x.t >= t);
      if (j <= 0) return v[Math.max(0, j)];
      const k = (t - s[j - 1].t) / Math.max(1e-6, s[j].t - s[j - 1].t);
      return v[j - 1] + (v[j] - v[j - 1]) * k;
    };
    const epi = (t) => {
      const tau = t - tUp - 35;
      return tau < 0 || tau > D - 65 ? rest : at(tUp + (tau * D) / (D - 65));
    };
    const X = (t) => left + (t / T) * pw,
      zh = this.i18n.language === "zh",
      pink = "#ff7eb6";
    ctx.fillStyle = "rgba(255, 126, 182, 0.16)";
    ctx.fillRect(X(tUp + D - 30), top, X(tUp + D) - X(tUp + D - 30), ph);
    text(ctx, zh ? "T 波窗口" : "T-wave window", X(tUp + D) + 4, top + 10, pink, 9);
    ctx.setLineDash([4, 3]);
    path(ctx, s.map((x) => [X(x.t), yy(epi(x.t))]), pink, 1.4);
    ctx.setLineDash([]);
    text(ctx, zh ? "实线 心内膜 · 虚线 心外膜" : "solid endo · dashed epi",
      left + pw, top + ph + 12, C.ink, 8.5, "right");
    text(
      ctx,
      zh
        ? "心外膜先复极 → 复极由外向内，T 波直立"
        : "Epicardium recovers first → T wave upright",
      left + pw,
      top + ph + 22,
      pink,
      8.5,
      "right",
    );
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
  // True when the pointer is over the plot area itself; the left label
  // gutter stays non-interactive so resting a finger on the strip titles
  // (or starting a page scroll there) never seeks or pauses playback.
  inPlot(clientX) {
    const r = this.strips.getBoundingClientRect();
    return clientX - r.left >= this.plot.x;
  }
}
