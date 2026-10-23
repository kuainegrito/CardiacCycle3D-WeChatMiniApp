// Copied by tools/sync-from-web.mjs from js/ectopy-view.js; only this line is added (and any stylesheet import removed).
import { devicePixelRatio } from "./mp-dom.js";
// CC-58: the ectopic stimulus in the lab — the "Rhythm strip" tab of the
// Wiggers card and the numbers of the result line. The beat plan itself is
// the engine's (engine/ectopy.js, CC-57); this view only reads beats the lab
// has already sampled (each beat's 400-sample series, as the chest leads'
// paper mode does) and the plan's events, so it adds no model sampling while
// it draws. The compensatory pause spans three beats (75 bpm: 2.4–3.2 s), so
// the strip shows the last 4 s at 25 mm/s: lead II, aortic pressure and LV
// volume on one time axis, with the stimuli, each QRS's ventricular ERP, the
// RR intervals and the "pre RR + post RR = 2 × RR" bracket.

export const WINDOW_MS = 4000;
const C = {
  ecg: "#5ee0b5",
  ao: "#ff8a65",
  volume: "#e8b04d",
  ink: "#dbe6f5",
  text: "#8ea3c0",
  dim: "#64789a",
  warm: "#e8a33d",
  grid: "rgba(120, 168, 226, 0.14)",
  paper: "rgba(255, 122, 144, 0.06)",
  paperMajor: "rgba(255, 122, 144, 0.22)",
  erp: "rgba(195, 155, 255, 0.22)",
  pvc: "rgba(255, 122, 144, 0.10)",
  now: "rgba(233, 239, 250, 0.55)",
};
const FONT = '"Segoe UI","Microsoft YaHei",sans-serif';

function fit(canvas) {
  const r = canvas.getBoundingClientRect(),
    d = Math.min(devicePixelRatio || 1, 2),
    w = Math.max(1, r.width),
    h = Math.max(1, r.height);
  if (canvas.width !== Math.round(w * d) || canvas.height !== Math.round(h * d)) {
    canvas.width = Math.round(w * d);
    canvas.height = Math.round(h * d);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w, h };
}
function label(ctx, s, x, y, color, size = 9, align = "left", weight = "") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
}
// A lightning mark, filled (a premature beat) or outlined (refractory).
function bolt(ctx, x, y, s, filled) {
  ctx.beginPath();
  ctx.moveTo(x + 0.15 * s, y - s);
  ctx.lineTo(x - 0.45 * s, y + 0.1 * s);
  ctx.lineTo(x - 0.02 * s, y + 0.1 * s);
  ctx.lineTo(x - 0.2 * s, y + s);
  ctx.lineTo(x + 0.45 * s, y - 0.15 * s);
  ctx.lineTo(x + 0.03 * s, y - 0.15 * s);
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = C.warm;
    ctx.fill();
  } else {
    ctx.fillStyle = "#081222";
    ctx.fill();
    ctx.strokeStyle = C.warm;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
}

/**
 * The numbers of an accepted stimulus (model.ectopy.stimulate's result), for
 * the result line: R waves from the beats' own QRS onsets, so pre RR + post RR
 * is measured, not assumed. RR in ms, stroke volumes in mL.
 */
export function summarizeStimulus(model, result, hr, modifiers = {}) {
  const k = result.beat,
    at = (beat) => model.sample(0, hr, modifiers, beat),
    R = (beat) => {
      const s = at(beat);
      return s.absolute - s.t + s.timing.qrsStart;
    };
  // The R wave before the PVC: this beat's own, or (stimulus in the PR
  // interval, the PVC takes this beat's QRS) the one before.
  const before =
      result.blocks === "own"
        ? k > 0
          ? R(k - 1)
          : R(k) - model.cycleDuration(hr, k + 2)
        : R(k),
    premature = R(k + 1),
    after = R(k + 2),
    post = at(k + 2);
  return {
    tMs: result.tMs,
    preMs: premature - before,
    postMs: after - premature,
    sumMs: after - before,
    rrMs: model.cycleDuration(hr, k + 2),
    svMl: result.strokeVolumeMl,
    postSvMl: post.sv,
    ejected: result.ejected,
    onT: result.onT,
  };
}

export class RhythmStrip {
  constructor({ canvas, i18n, erpMs }) {
    Object.assign(this, { canvas, i18n, erpMs });
    this.beats = new Map(); // beatIndex → recorded beat
    this.refractory = []; // [{beat, t}] stimuli that found the ventricles refractory
  }
  reset() {
    this.beats.clear();
    this.refractory = [];
  }
  /**
   * Record the beat the lab is playing: series as from model.series() (beat
   * 0's when every beat is the same — the lab's sameBeat — recorded under
   * the real beat index).
   */
  setBeat({ model, series, beatIndex, hr, modifiers, T = series?.[0]?.T }) {
    if (!series?.length) return;
    const stamp = `${hr}|${modifiers?.preload}|${modifiers?.afterload}|${modifiers?.contractility}`;
    if (model !== this.model || stamp !== this.stamp) this.reset();
    Object.assign(this, { model, stamp, beatIndex });
    const old = this.beats.get(beatIndex);
    if (old?.series === series && old.T === T) return;
    // T: the beat's own length (model.cycleDuration). A beat cut by a
    // stimulus keeps its samples' template T, so as not to rewrite them.
    const first = series[0],
      rateScale = first.timing.rateScale;
    this.beats.set(beatIndex, {
      series,
      T,
      qrs: first.timing.qrsStart,
      erp: this.erpMs * rateScale,
      kind: first.ectopy?.kind ?? "sinus",
      ejected: first.ectopy?.ejected,
      rows: series.map((s) => ({ t: s.t, ecg: s.ecg, ao: s.pressures.ao, lv: s.volume.lv })),
    });
    for (const k of [...this.beats.keys()]) if (k < beatIndex - 12 || k > beatIndex) this.beats.delete(k);
  }
  addRefractory(beat, t) {
    this.refractory.push({ beat, t });
    if (this.refractory.length > 12) this.refractory.shift();
  }
  geometry(w, h) {
    const compact = w < 520,
      x = compact ? 40 : 58,
      top = 22,
      bottom = 18,
      gap = compact ? 28 : 32, // room for the RR bracket and its label under the ECG
      plotH = h - top - bottom - gap,
      ecgH = plotH * 0.44,
      aoH = plotH * 0.28,
      lvH = plotH - ecgH - aoH;
    return {
      compact,
      x,
      pw: w - x - 8,
      top,
      bottom,
      ecg: { y0: top, h: ecgH },
      bracket: top + ecgH + 8,
      ao: { y0: top + ecgH + gap, h: aoH },
      lv: { y0: top + ecgH + gap + aoH, h: lvH },
    };
  }
  /** Beats in the window, oldest first: [beatIndex, beat, start ms relative to now]. */
  window(t) {
    const out = [];
    let k = this.beatIndex,
      start = -t,
      beat = this.beats.get(k);
    while (beat && start + beat.T > -WINDOW_MS && out.length < 12) {
      out.push([k, beat, start]);
      k -= 1;
      beat = this.beats.get(k);
      if (beat) start -= beat.T;
    }
    return out.reverse();
  }
  /** R waves in the window (ms relative to now), oldest first. */
  rWaves(beats) {
    // (A beat cut in its PR interval never reaches its own QRS.)
    return beats
      .filter(([, beat]) => beat.qrs < beat.T)
      .map(([k, beat, s]) => ({ k, beat, x: s + beat.qrs }))
      .filter((r) => r.x <= 0);
  }
  /** Each premature beat whose pause has ended: R before, R after, sinus RR. */
  pauses(t) {
    const Rs = this.rWaves(this.window(t)),
      out = [];
    for (let i = 1; i < Rs.length - 1; i++)
      if (Rs[i].beat.kind === "pvc") out.push({ from: Rs[i - 1].x, to: Rs[i + 1].x, rrMs: Rs[i + 1].beat.T });
    return out;
  }
  update(sample) {
    if (this.canvas.closest("[hidden]") || !this.beats.size) return;
    const { ctx, w, h } = fit(this.canvas),
      g = (this.g = this.geometry(w, h)),
      t = sample.t,
      X = (ms) => g.x + g.pw + (ms / WINDOW_MS) * g.pw,
      inside = (ms) => ms <= 0 && ms >= -WINDOW_MS,
      beats = this.window(t);
    ctx.clearRect(0, 0, w, h);
    // ECG paper behind the ECG row: 40 ms / 0.1 mV small, 200 ms / 0.5 mV large.
    const mvpx = g.ecg.h * 0.3,
      ecgMid = g.ecg.y0 + g.ecg.h * 0.62;
    ctx.lineWidth = 1;
    for (let ms = -Math.floor(WINDOW_MS / 40) * 40; ms <= 0; ms += 40) {
      const x = X(ms - (t % 40));
      ctx.strokeStyle = Math.round((ms - (t % 40) + t) / 40) % 5 === 0 ? C.paperMajor : C.paper;
      ctx.beginPath();
      ctx.moveTo(x, g.ecg.y0);
      ctx.lineTo(x, g.ecg.y0 + g.ecg.h);
      ctx.stroke();
    }
    for (let mv = -1; mv <= 2; mv += 0.5) {
      const y = ecgMid - mv * mvpx;
      if (y < g.ecg.y0 || y > g.ecg.y0 + g.ecg.h) continue;
      ctx.strokeStyle = mv % 1 === 0 ? C.paperMajor : C.paper;
      ctx.beginPath();
      ctx.moveTo(g.x, y);
      ctx.lineTo(g.x + g.pw, y);
      ctx.stroke();
    }
    for (const row of [g.ao, g.lv]) {
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(g.x, row.y0);
      ctx.lineTo(g.x + g.pw, row.y0);
      ctx.stroke();
    }
    // The premature beats' span, and each QRS's ventricular ERP under the ECG.
    for (const [, beat, s] of beats) {
      if (beat.kind === "pvc") {
        const x0 = Math.max(g.x, X(s)),
          x1 = Math.min(g.x + g.pw, X(Math.min(0, s + beat.T)));
        if (x1 > x0) {
          ctx.fillStyle = C.pvc;
          ctx.fillRect(x0, g.ecg.y0, x1 - x0, g.lv.y0 + g.lv.h - g.ecg.y0);
        }
      }
      // (A beat cut in its PR interval never reaches its own QRS.)
      if (beat.qrs >= beat.T) continue;
      const r = s + beat.qrs,
        x0 = Math.max(g.x, X(r)),
        x1 = Math.min(g.x + g.pw, X(Math.min(0, r + beat.erp)));
      if (r <= 0 && x1 > x0) {
        ctx.fillStyle = C.erp;
        ctx.fillRect(x0, g.ecg.y0 + g.ecg.h - 6, x1 - x0, 5);
      }
    }
    // Traces.
    const trace = (row, key, lo, hi, color) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(g.x, row.y0, g.pw, row.h);
      ctx.clip();
      ctx.beginPath();
      let first = true;
      for (const [, beat, s] of beats)
        for (const p of beat.rows) {
          const ms = s + p.t;
          if (!inside(ms)) continue;
          const y = row.y0 + row.h - ((p[key] - lo) / (hi - lo)) * row.h;
          first ? ctx.moveTo(X(ms), y) : ctx.lineTo(X(ms), y);
          first = false;
        }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    };
    trace({ y0: g.ecg.y0, h: g.ecg.h }, "ecg", -(g.ecg.h - (ecgMid - g.ecg.y0)) / mvpx, (ecgMid - g.ecg.y0) / mvpx, C.ecg);
    trace(g.ao, "ao", 40, 135, C.ao);
    trace(g.lv, "lv", 30, 145, C.volume);
    // Row labels and scales.
    const small = g.compact ? 9 : 10;
    label(ctx, this.i18n.t("rhythmLeadII"), 4, g.ecg.y0 + 9, C.ink, small, "left", "500");
    label(ctx, this.i18n.t("rhythmAorta"), 4, g.ao.y0 + 9, C.ao, small, "left", "500");
    label(ctx, "mmHg", 4, g.ao.y0 + 21, C.dim, 8);
    label(ctx, this.i18n.t("rhythmVolume"), 4, g.lv.y0 + 9, C.volume, small, "left", "500");
    label(ctx, "mL", 4, g.lv.y0 + 21, C.dim, 8);
    // R waves and the RR between neighbours; the pause bracket; "no pulse".
    const Rs = this.rWaves(beats);
    ctx.textBaseline = "middle";
    for (let i = 1; i < Rs.length; i++) {
      const a = Rs[i - 1].x,
        b = Rs[i].x;
      if (b < -WINDOW_MS) continue;
      const mid = Math.max(-WINDOW_MS + 120, (a + b) / 2);
      label(ctx, ((b - a) / 1000).toFixed(2), X(mid), g.ecg.y0 + 7, C.text, g.compact ? 8.5 : 9.5, "center");
    }
    for (const r of Rs) {
      if (!inside(r.x)) continue;
      ctx.strokeStyle = "rgba(219, 230, 245, 0.35)";
      ctx.beginPath();
      ctx.moveTo(X(r.x), g.ecg.y0 + 13);
      ctx.lineTo(X(r.x), g.ecg.y0 + 17);
      ctx.stroke();
    }
    for (const { from: a, to: b, rrMs: rr } of this.pauses(t)) {
      const y = g.bracket;
      ctx.strokeStyle = C.warm;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(Math.max(a, -WINDOW_MS)), y - 4);
      ctx.lineTo(X(Math.max(a, -WINDOW_MS)), y);
      ctx.lineTo(X(b), y);
      ctx.lineTo(X(b), y - 4);
      ctx.stroke();
      label(
        ctx,
        `${((b - a) / 1000).toFixed(2)} s = 2 × ${(rr / 1000).toFixed(2)} s · ${this.i18n.t("rhythmCompensation")}`,
        X(Math.max((a + b) / 2, -WINDOW_MS + 600)),
        y + 10,
        C.warm,
        g.compact ? 8.5 : 9.5,
        "center",
        "600",
      );
    }
    for (const [, beat, s] of beats) {
      if (beat.kind !== "pvc" || beat.ejected) continue;
      const ms = Math.min(-60, s + beat.qrs + 150);
      if (inside(ms) && ms > -WINDOW_MS + 40)
        label(ctx, this.i18n.t("rhythmNoPulse"), X(ms), g.ao.y0 + g.ao.h * 0.28, C.ao, g.compact ? 8.5 : 9.5, "center", "600");
    }
    // Stimuli: filled for a premature beat, outlined when refractory.
    const start = new Map(beats.map(([k, , s]) => [k, s]));
    for (const e of this.model?.ectopy?.events ?? []) {
      const s = start.get(e.beat);
      if (s !== undefined && inside(s + e.cutMs)) bolt(ctx, X(s + e.cutMs), g.ecg.y0 + 24, 7.5, true);
    }
    for (const e of this.refractory) {
      const s = start.get(e.beat);
      if (s !== undefined && inside(s + e.t)) bolt(ctx, X(s + e.t), g.ecg.y0 + 24, 7.5, false);
    }
    label(ctx, this.i18n.t("rhythmScale"), g.x + g.pw, h - g.bottom / 2, C.text, 8, "right");
    label(ctx, "−4 s", g.x, h - g.bottom / 2, C.text, 8);
    ctx.strokeStyle = C.now;
    ctx.beginPath();
    ctx.moveTo(g.x + g.pw, g.top - 4);
    ctx.lineTo(g.x + g.pw, h - g.bottom);
    ctx.stroke();
  }
}
