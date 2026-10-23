// CC-50: blood filling the heart, as the owner's reference animation shows it
// ("the filling start point should start from the vena cava for the RA, and
// pulmonary veins for the LA; make animations that are more realistic").
// Shared by the 2D heart (js/heart2d.js) and the realistic heart's filling
// view (js/atlas-inflow-layer.js); runtime only, outside the audited engine.
//
// Each stream runs from an inlet into a chamber, driven by the model's own
// volumetric flows (engine/atlas-valve-flow.js, the same flows as the 3D
// flow views): the venae cavae into the RA and the pulmonary veins into the LA
// (filling the atria while the AV valves are shut, flowing straight through in
// early diastole, briefly reversing during the atrial kick), then the
// tricuspid and mitral valves into the ventricles (E wave, diastasis, A wave).
// The IVC carries about two thirds of the caval return, the SVC one third;
// the right and left pulmonary veins half each.
//
// Particles advance by the volume that has crossed, a pure function of the
// time in the beat: they stand still when nothing flows, speed up with the
// flow, back up when it reverses, and a whole beat moves them exactly one
// beat's worth (an integer number of spacings), so they join up from beat to
// beat, also when beats differ (AF). Teaching kinematics, not CFD.
import { volumeFlows, volumeFlowIntegrals } from "./atlas-valve-flow.js";

export const INFLOW_VERSION = 1;
export const INFLOW_STREAMS = Object.freeze([
  { id: "svc", side: "right", source: "venaeCavae", share: 1 / 3, stage: "atrium" },
  { id: "ivc", side: "right", source: "venaeCavae", share: 2 / 3, stage: "atrium" },
  { id: "pvRight", side: "left", source: "pulmonaryVeins", share: 0.5, stage: "atrium" },
  { id: "pvLeft", side: "left", source: "pulmonaryVeins", share: 0.5, stage: "atrium" },
  { id: "tricuspid", side: "right", source: "tricuspid", share: 1, stage: "ventricle" },
  { id: "mitral", side: "left", source: "mitral", share: 1, stage: "ventricle" },
]);
// Flow (mL/ms, per stream) drawn at full strength. The model's venous return
// is mostly diastolic (conduit flow up to ~0.25 per stream) with a smaller,
// steady systolic reservoir inflow (~0.02-0.05); the lower atrial reference
// keeps that systolic filling visible. The E wave peaks near 0.55.
export const INFLOW_REFERENCE = Object.freeze({ atrium: 0.12, ventricle: 0.45 });
const STEPS = 60;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Scenarios whose beats differ keep one integral table per beat; the others
// reuse beat 0's. CC-61 R2: so does a model with ectopic stimuli (premature
// and post-pause beats differ in length and filling).
const varies = (model) =>
  !!(model.patch?.rrSequence || model.patch?.completeBlock || model.patch?.pfo || model.ectopy?.active);
const caches = new WeakMap();

function integrals(model, hr, modifiers, beatIndex, atrialSettings) {
  let cache = caches.get(model);
  if (!cache) caches.set(model, (cache = new Map()));
  const key = `${hr}|${modifiers.preload ?? 1}|${modifiers.afterload ?? 1}|${modifiers.contractility ?? 1}|${varies(model) ? beatIndex : 0}|${model.ectopy?.version ?? 0}`;
  let table = cache.get(key);
  if (!table) {
    if (cache.size > 8) cache.clear();
    table = volumeFlowIntegrals(model, hr, modifiers, varies(model) ? beatIndex : 0, atrialSettings, STEPS);
    cache.set(key, table);
  }
  return table;
}

// Cumulative volume (mL) through one source at time t of the beat.
function cumulativeAt(series, t) {
  const x = clamp(t / series.T, 0, 1) * STEPS,
    i = Math.min(STEPS - 1, Math.floor(x));
  return series.values[i] + (series.values[i + 1] - series.values[i]) * (x - i);
}

// The streams at one instant: flow (mL/ms, this stream's share), strength
// (0..1 against INFLOW_REFERENCE) and progress (beat fraction of the volume
// that has crossed: 0 at the start of the beat, 1 at its end).
export function inflowState({ model, sample, t, hr, beatIndex = 0, modifiers = {}, atrialSettings }) {
  if (!atrialSettings) return null;
  const flows = volumeFlows(model, t, hr, beatIndex, modifiers, atrialSettings, sample);
  const table = integrals(model, hr, modifiers, beatIndex, atrialSettings);
  return Object.fromEntries(
    INFLOW_STREAMS.map((s) => {
      const flow = (flows[s.source] ?? 0) * s.share,
        series = table[s.source],
        total = series.total;
      return [
        s.id,
        {
          ...s,
          flow,
          strength: clamp(flow / INFLOW_REFERENCE[s.stage], 0, 1),
          progress: Math.abs(total) > 1e-6 ? cumulativeAt(series, t) / total : 0,
        },
      ];
    }),
  );
}

// Positions (fractions 0..1 along a stream's route) of its n particles: the
// particles are evenly spaced and a beat moves them `spacings` spacings, so
// the pattern at the end of a beat is the one at its start.
export function particleFractions(stream, n, spacings = n) {
  const out = new Array(n);
  for (let k = 0; k < n; k++) {
    const u = (k + spacings * stream.progress) / n;
    out[k] = u - Math.floor(u);
  }
  return out;
}

// CC-50 (owner, 2026-10-11, on the 2D heart): "as in the reference animation,
// filling is shown by the colour deepening: it starts at the venae cavae and
// the pulmonary veins, grows as circles that merge and spread, and then
// reaches the ventricles." Per chamber, how far the deeper colour has spread
// (coverage 0..1, as a fraction of the chamber's filling volume) and how deep
// it is (intensity 0..1):
//   - an atrium is reset when its AV valve closes; venous blood then spreads
//     from the inlets (coverage = venous volume since closure / the volume
//     until the valve opens); once the valve opens it is full and lightens as
//     the atrium empties (intensity = the blood still held / that held at
//     opening, conduit inflow included);
//   - a ventricle is reset when its AV valve opens; blood spreads from the
//     valve with the volume that has crossed it (E wave, diastasis, A wave,
//     into the next beat), and lightens with the volume ejected after the
//     valve closes.
// Valve times are the model's phase boundaries (closure: isovolumetric
// contraction; opening: rapid filling), shared by both sides.
const SIDES = Object.freeze({
  right: { atrium: "RA", ventricle: "RV", veins: "venaeCavae", valve: "tricuspid", outflow: "pulmonary" },
  left: { atrium: "LA", ventricle: "LV", veins: "pulmonaryVeins", valve: "mitral", outflow: "aortic" },
});

export function fillState({ model, t, hr, beatIndex = 0, modifiers = {}, atrialSettings }) {
  if (!atrialSettings) return null;
  const table = integrals(model, hr, modifiers, beatIndex, atrialSettings),
    schedule = model.phaseSchedule(hr, beatIndex),
    T = model.cycleDuration(hr, beatIndex),
    close = schedule[1].start,
    open = schedule[5].start,
    time = clamp(t, 0, T),
    wrap = time < close; // the end of the last diastole, before closure
  const cum = (id, at, wrapped = false) =>
    cumulativeAt(table[id], at) + (wrapped ? table[id].total : 0);
  const ratio = (a, b) => (Math.abs(b) > 1e-6 ? clamp(a / b, 0, 1) : 0);
  const out = {};
  for (const side of Object.values(SIDES)) {
    const V0 = cum(side.veins, close),
      Vopen = cum(side.veins, open),
      A0 = cum(side.valve, open);
    // Atrium.
    if (!wrap && time < open) out[side.atrium] = { coverage: ratio(cum(side.veins, time) - V0, Vopen - V0), intensity: 1 };
    else {
      const held = cum(side.veins, time, wrap) - V0 - (cum(side.valve, time, wrap) - A0);
      out[side.atrium] = { coverage: 1, intensity: ratio(held, Vopen - V0) };
    }
    // Ventricle.
    if (wrap || time >= open) {
      const filled = cum(side.valve, time, wrap) - A0,
        total = cum(side.valve, close, true) - A0;
      out[side.ventricle] = { coverage: ratio(filled, total), intensity: 1 };
    } else {
      const O0 = cum(side.outflow, close),
        ejected = cum(side.outflow, time) - O0;
      out[side.ventricle] = { coverage: 1, intensity: 1 - ratio(ejected, cum(side.outflow, open) - O0) };
    }
  }
  return out;
}
