// CC-53: twelve-lead ECG (V1–V6 first) from one cardiac vector.
// Every lead is the dot product of the heart vector with that electrode's
// axis, so V1–V6, II and the limb leads stay mutually consistent. The vector
// is built from the dipoles in ecg12-modifiers.js and placed on the clocks
// that sample() already returns (sample.timing / sample.conduction): P on the
// atrial clock, QRS from QRS onset over qrsDuration, ST/T up to QT. This file
// reads the engine and never changes it; the legacy lead II (sample.ecg) is
// untouched. A dipole-in-a-torso teaching model, not a diagnostic ECG.
import {
  normalDipoles,
  resolveModifiers,
  MODIFIERS,
} from "./ecg12-modifiers.js";

export const CHEST_LEADS = ["V1", "V2", "V3", "V4", "V5", "V6"];
export const LIMB_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF"];
const norm = (v) => {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};
/**
 * Electrode axes (x left, y inferior, z anterior) with two proximity gains:
 * one for ventricular sources (QRS, ST, T) and one for atrial sources (P, f
 * waves). V1 lies over the right atrium, so atrial activity is largest there.
 */
export const LEAD_AXES = Object.freeze(
  Object.fromEntries(
    Object.entries({
      I: [[1, 0, 0], 1, 1],
      II: [[0.5, 0.866, 0], 1, 1],
      III: [[-0.5, 0.866, 0], 1, 1],
      aVR: [[-0.866, -0.5, 0], 1, 1],
      aVL: [[0.866, -0.5, 0], 1, 1],
      aVF: [[0, 1, 0], 1, 1],
      V1: [[-0.45, 0.05, 0.89], 1, 1.6],
      V2: [[-0.05, 0.1, 0.99], 1.5, 1.2],
      V3: [[0.35, 0.15, 0.92], 1.6, 0.9],
      V4: [[0.62, 0.2, 0.76], 1.5, 0.75],
      V5: [[0.86, 0.2, 0.47], 1.25, 0.65],
      V6: [[0.98, 0.18, 0.08], 1, 0.6],
    }).map(([lead, [axis, gain, atrialGain]]) => [
      lead,
      Object.freeze({ axis: Object.freeze(norm(axis)), gain, atrialGain }),
    ]),
  ),
);
/** Engine reference durations the dipole windows are written against. */
export const P_WAVE_MS = 80;

const clone = (o) => JSON.parse(JSON.stringify(o));
const finish = (c) => ({ ...c, dir: norm(c.dir) });

/**
 * Build the frozen dipole spec of one scenario from its content/ecg12 entry.
 * Throws when a QRS window would outlast the engine's QRS duration, so a new
 * modifier cannot silently draw activity after the J point. CC-59: with the
 * premature-beat entry (content/ecg12/ectopic.json) the spec also carries
 * spec.ectopic, the QRS, ST and T of a premature ventricular beat; P stays the
 * scenario's, since the sinus node keeps firing.
 */
export function buildEcg12Spec(scenario, entry = {}, baseline, ectopic = null) {
  const patch = scenario.patch ?? {};
  const s = normalDipoles();
  const modifiers = resolveModifiers(patch, entry.modifiers ?? []);
  for (const m of modifiers) MODIFIERS[m.id].apply(s, m, patch);
  const baseQrs =
    (patch.escapeQrsMs ??
      (baseline?.physiology?.qrsMs ?? 90) + (patch.branchDelayMs ?? 0)) +
    (patch.accessoryPathway ? (patch.accessoryAdvanceMs ?? 45) : 0);
  const qrs = Object.entries(s.qrs).map(([id, c]) => ({ id, ...finish(c) }));
  for (const c of qrs)
    if (c.from < 0 || c.to > baseQrs + 1e-9 || c.to <= c.from)
      throw new Error(
        `${scenario.id}: QRS dipole ${c.id} [${c.from}, ${c.to}] ms outside 0–${baseQrs} ms`,
      );
  const spec = {
    scenarioId: scenario.id,
    modifiers: modifiers.map(({ source, ...m }) => ({ ...m, source })),
    baseQrs,
    pScale: s.pScale,
    p: Object.entries(s.p).map(([id, c]) => ({ id, ...finish(c) })),
    qrs,
    t: Object.entries(s.t).map(([id, c]) => ({ id, ...finish(c) })),
    st: Object.entries(s.st).map(([id, c]) => ({ id, ...finish(c) })),
    fib: s.fib ? finish(s.fib) : null,
  };
  if (ectopic) spec.ectopic = ectopicSpec(scenario, ectopic);
  return deepFreeze(clone(spec));
}
function ectopicSpec(scenario, entry) {
  const s = normalDipoles(),
    modifiers = resolveModifiers({}, entry.modifiers ?? []);
  for (const m of modifiers) MODIFIERS[m.id].apply(s, m, {});
  const baseQrs = modifiers.find((m) => m.qrsMs)?.qrsMs ?? 140;
  const qrs = Object.entries(s.qrs).map(([id, c]) => ({ id, ...finish(c) }));
  for (const c of qrs)
    if (c.from < 0 || c.to > baseQrs + 1e-9 || c.to <= c.from)
      throw new Error(
        `${scenario.id}: premature-beat QRS dipole ${c.id} [${c.from}, ${c.to}] ms outside 0–${baseQrs} ms`,
      );
  return {
    baseQrs,
    modifiers: modifiers.map(({ source, ...m }) => m),
    qrs,
    t: Object.entries(s.t).map(([id, c]) => ({ id, ...finish(c) })),
    st: Object.entries(s.st).map(([id, c]) => ({ id, ...finish(c) })),
  };
}
function deepFreeze(o) {
  for (const v of Object.values(o))
    if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

/** Raised-cosine pulse on u ∈ (0,1), peak 1 at `peak`, exactly 0 outside. */
function pulse(u, peak, shape) {
  if (!(u > 0 && u < 1)) return 0;
  if (u < peak)
    return shape === "ramp"
      ? u / peak
      : Math.sin((Math.PI / 2) * (u / peak)) ** 2;
  return Math.cos((Math.PI / 2) * ((u - peak) / (1 - peak))) ** 2;
}
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const add = (out, dir, v) => {
  if (v) {
    out[0] += dir[0] * v;
    out[1] += dir[1] * v;
    out[2] += dir[2] * v;
  }
};

/**
 * The heart vector of one engine sample, split by wave so tests can check
 * that each one starts and stops on the engine's clocks.
 */
export function ecg12Components(sample, spec) {
  const c = sample.conduction,
    tm = sample.timing;
  const p = [0, 0, 0],
    qrs = [0, 0, 0],
    st = [0, 0, 0],
    t = [0, 0, 0],
    fib = [0, 0, 0];
  const x = c.ventricularTime; // ms since QRS onset, within this beat
  // CC-59: a premature ventricular beat (engine/ectopy.js) has its own waves.
  const v = c.ectopic && spec.ectopic ? spec.ectopic : spec;
  if (x < c.qrsDuration) {
    const xb = x / c.qrsScale; // back to the rate-independent QRS timeline
    for (const d of v.qrs)
      add(
        qrs,
        d.dir,
        d.amp * pulse((xb - d.from) / (d.to - d.from), d.peak, d.shape),
      );
  }
  if (x < c.qtMs) {
    const u = x / c.qtMs;
    for (const d of v.t)
      add(
        t,
        d.dir,
        d.amp * pulse((u - d.from) / (d.to - d.from), d.peak, d.shape),
      );
    for (const d of v.st) {
      const j = x - c.qrsDuration;
      if (j <= 0) continue;
      if (d.shape === "decay") {
        const len = d.durationMs * c.qrsScale;
        if (j < len) add(st, d.dir, d.amp * smooth(j / 3) * (1 - j / len));
      } else {
        const len = d.toQt * c.qtMs - c.qrsDuration;
        if (j < len)
          add(
            st,
            d.dir,
            d.amp * smooth(j / (0.2 * len)) * smooth((len - j) / (0.2 * len)),
          );
      }
    }
  }
  if (spec.p.length && !c.fibrillating) {
    const pMs = P_WAVE_MS * tm.atrialScale * spec.pScale,
      u = c.atrialTime / pMs;
    for (const d of spec.p)
      add(
        p,
        d.dir,
        d.amp * pulse((u - d.from) / (d.to - d.from), d.peak, d.shape),
      );
  }
  if (spec.fib) {
    const s = sample.absolute / 1000,
      f = spec.fib;
    add(
      fib,
      f.dir,
      f.amp *
        (0.62 *
          Math.sin(
            2 * Math.PI * 6.1 * s + 0.4 * Math.sin(2 * Math.PI * 0.7 * s),
          ) +
          0.42 * Math.sin(2 * Math.PI * 7.9 * s + 1.3) +
          0.3 * Math.sin(2 * Math.PI * 4.7 * s + 2.1)),
    );
  }
  return { p, qrs, st, t, fib };
}

/** The whole heart vector (for drawing the vector and its loops). */
export function heartVector(sample, spec) {
  const k = ecg12Components(sample, spec),
    v = [0, 0, 0];
  for (const part of Object.values(k)) {
    v[0] += part[0];
    v[1] += part[1];
    v[2] += part[2];
  }
  return v;
}
/** One source vector seen by one lead; `atrial` selects the atrial proximity gain. */
export const leadVoltage = (vector, lead, atrial = false) => {
  const { axis, gain, atrialGain } = LEAD_AXES[lead];
  return (
    (vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2]) *
    (atrial ? atrialGain : gain)
  );
};
/** A lead from wave components: ventricular (QRS, ST, T) plus atrial (P, f). */
export const leadFromComponents = (k, lead) =>
  leadVoltage(
    [
      k.qrs[0] + k.st[0] + k.t[0],
      k.qrs[1] + k.st[1] + k.t[1],
      k.qrs[2] + k.st[2] + k.t[2],
    ],
    lead,
  ) +
  leadVoltage(
    [k.p[0] + k.fib[0], k.p[1] + k.fib[1], k.p[2] + k.fib[2]],
    lead,
    true,
  );
/** Voltages (mV) of the requested leads at one engine sample. */
export function leadVoltages(sample, spec, leads = CHEST_LEADS) {
  const k = ecg12Components(sample, spec);
  return Object.fromEntries(leads.map((l) => [l, leadFromComponents(k, l)]));
}

/**
 * One beat of leads on the same sampling as model.series(): count samples
 * over the beat's RR. Each row carries the engine sample time, its clocks and
 * the vector, so a chart can share the Wiggers cursor.
 */
export function ecg12Series(
  model,
  spec,
  {
    hr = model.scenario.hr ?? 75,
    modifiers = {},
    beatIndex = 0,
    count = 400,
    leads = CHEST_LEADS,
  } = {},
) {
  const T = model.cycleDuration(hr, beatIndex);
  return Array.from({ length: count }, (_, i) => {
    const s = model.sample((T * i) / count, hr, modifiers, beatIndex),
      k = ecg12Components(s, spec);
    const vector = Object.values(k).reduce(
      (a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]],
      [0, 0, 0],
    );
    return {
      t: s.t,
      T,
      vector,
      leads: Object.fromEntries(
        leads.map((l) => [l, leadFromComponents(k, l)]),
      ),
      conduction: s.conduction,
    };
  });
}

/** Strip leads of the lab: lead II for reference, then V1–V6. */
export const STRIP_LEADS = ["II", ...CHEST_LEADS];
/** Lead voltages and vectors of one beat's series (the lab's 400 samples). */
export function beatLeads(series, spec) {
  return series.map((s) => {
    const k = ecg12Components(s, spec);
    return {
      t: s.t,
      vector: [0, 1, 2].map(
        (i) => k.p[i] + k.qrs[i] + k.st[i] + k.t[i] + k.fib[i],
      ),
      leads: Object.fromEntries(
        STRIP_LEADS.map((l) => [l, leadFromComponents(k, l)]),
      ),
      ventricularTime: s.conduction.ventricularTime,
      qrsDuration: s.conduction.qrsDuration,
      qtMs: s.conduction.qtMs,
    };
  });
}
