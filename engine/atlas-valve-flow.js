// CC-27: volumetric blood flow (mL/ms) for the realistic heart's flow views,
// from the teaching model's own volume curves: the ventricular curve both 3D
// ventricles are held at (CC-06) and the CC-06 atrial target curves. Blood
// therefore moves exactly when the rendered chambers change volume:
//   - a filling ventricle (dV/dt > 0) takes blood through its open AV valve,
//     and through a regurgitant semilunar valve if there is one;
//   - an emptying ventricle sends blood through its open semilunar valve and
//     back through a regurgitant AV valve (MR); a ventricle feeding both splits
//     its loss in the ratio of the model's two signed valve flows;
//   - venous inflow keeps each atrium on its curve: dV_atrium/dt + AV flow, so
//     the veins fill the atria while the AV valves are closed (reservoir),
//     flow straight through in early diastole (conduit) and briefly reverse
//     during the atrial kick.
// The schematic's own valve `flow` is a gradient-based teaching value that
// stays near 1.4 through diastasis; it only decides
// which valves are open and how a loss is split. Teaching kinematics, not CFD.
import { atrialVolumeTargets } from "./atrial-targets.js";

export const FLOW_VALVES = Object.freeze([
  "mitral",
  "tricuspid",
  "aortic",
  "pulmonary",
]);
export const FLOW_SOURCES = Object.freeze([
  ...FLOW_VALVES,
  "pulmonaryVeins",
  "venaeCavae",
]);
// Resolve slow flow without confusing it with an exactly closed valve.
export const FLOW_EPSILON = 1e-4; // mL/ms
const SIDES = [
  {
    inflow: "mitral",
    outflow: "aortic",
    ventricle: "lv",
    atrium: "LA",
    veins: "pulmonaryVeins",
  },
  {
    inflow: "tricuspid",
    outflow: "pulmonary",
    ventricle: "rv",
    atrium: "RA",
    veins: "venaeCavae",
  },
];
const HALF_STEP_MS = 2;

// Ventricular filling rate dV/dt at t (mL/ms); CC-19's jet rule.
export function fillingRates(model, t, hr, beatIndex = 0, modifiers = {}) {
  const T = model.cycleDuration(hr, beatIndex),
    a = Math.max(0, t - HALF_STEP_MS),
    b = Math.min(T - 0.001, t + HALF_STEP_MS);
  const va = model.sample(a, hr, modifiers, beatIndex).volume,
    vb = model.sample(b, hr, modifiers, beatIndex).volume;
  return { lv: (vb.lv - va.lv) / (b - a), rv: (vb.rv - va.rv) / (b - a) };
}

// Signed flows at t (mL/ms) through the four valves and, with atrialSettings
// (content/atlas-atrial-volume.json), from the veins into each atrium.
export function volumeFlows(
  model,
  t,
  hr,
  beatIndex = 0,
  modifiers = {},
  atrialSettings = null,
  sample = model.sample(t, hr, modifiers, beatIndex),
) {
  // One pair of samples serves the ventricular and the atrial differences.
  const T = model.cycleDuration(hr, beatIndex),
    a = Math.max(0, t - HALF_STEP_MS),
    b = Math.min(T - 0.001, t + HALF_STEP_MS),
    sa = model.sample(a, hr, modifiers, beatIndex),
    sb = model.sample(b, hr, modifiers, beatIndex);
  const rates = {
    lv: (sb.volume.lv - sa.volume.lv) / (b - a),
    rv: (sb.volume.rv - sa.volume.rv) / (b - a),
  };
  let atrialRates = null;
  if (atrialSettings) {
    const at = (s, time) =>
      atrialVolumeTargets(
        model,
        s,
        time,
        hr,
        modifiers,
        beatIndex,
        atrialSettings,
      );
    const [va, vb] = [at(sa, a), at(sb, b)];
    atrialRates = {
      LA: (vb.LA - va.LA) / (b - a),
      RA: (vb.RA - va.RA) / (b - a),
    };
  }
  const out = splitVolumeChange(model, rates, sample.valves);
  if (atrialRates)
    for (const side of SIDES)
      out[side.veins] = atrialRates[side.atrium] + out[side.inflow];
  return out;
}

// Split each ventricle's volume change (any unit: mL/ms or mL) between its two
// valves. Filling comes through the open AV valve (and a leaking semilunar
// valve); emptying leaves through the open semilunar valve and, in MR, back
// through the AV valve: the scenario's regurgitant fraction of it while the
// semilunar valve is open, all of it while that valve is shut (MR has no true
// isovolumetric contraction). Other leaks split by the model's valve flows.
export function splitVolumeChange(model, change, valves = {}) {
  const out = {};
  for (const side of SIDES) {
    const r = change[side.ventricle],
      flow = (id) => Number(valves[side[id]]?.flow ?? 0);
    const avForward = Math.max(0, flow("inflow")),
      avBack = Math.max(0, -flow("inflow")),
      slForward = Math.max(0, flow("outflow")),
      slBack = Math.max(0, -flow("outflow"));
    let qIn = 0,
      qOut = 0;
    if (r > 0) {
      const total = avForward + slBack;
      if (total > 0 && !slBack) qIn = r;
      else if (total > 0) {
        qIn = (r * avForward) / total;
        qOut = (-r * slBack) / total;
      }
    } else if (r < 0) {
      const fraction =
        model.patch?.regurgitation === side.inflow
          ? (model.patch.regurgitantFraction ?? 0.3)
          : avBack / Math.max(1e-12, slForward + avBack);
      const back = !avBack ? 0 : slForward ? fraction : 1;
      if (avBack || slForward) {
        qIn = r * back;
        qOut = -r * (1 - back);
      }
    }
    out[side.inflow] = qIn;
    out[side.outflow] = qOut;
  }
  return out;
}

// CC-52: the model samples of the latest beat grid, min(T − 0.001, i·T/n).
// The blood-flow view takes a beat's net flow and both AV leaks on the same
// grid (volumeFlowIntegrals, regurgitantIntegral) and the filling view takes
// it again; one set of samples serves them all. Samples are only read.
let lastGrid = null;
function gridSamples(model, hr, modifiers, beatIndex, n) {
  const g = lastGrid;
  if (
    g?.model === model &&
    g.version === (model.ectopy?.version ?? 0) &&
    g.hr === hr &&
    g.beatIndex === beatIndex &&
    g.n === n &&
    g.preload === modifiers.preload &&
    g.afterload === modifiers.afterload &&
    g.contractility === modifiers.contractility
  )
    return g.samples;
  const T = model.cycleDuration(hr, beatIndex),
    samples = [];
  for (let i = 0; i <= n; i++)
    samples.push(
      model.sample(Math.min(T - 0.001, (i * T) / n), hr, modifiers, beatIndex),
    );
  const { preload, afterload, contractility } = modifiers;
  lastGrid = { model, hr, beatIndex, n, preload, afterload, contractility, samples, version: model.ectopy?.version ?? 0 };
  return samples;
}

// Cumulative volume (mL) through each source over one beat, on n uniform
// steps (trapezoids); `total` is the net volume per beat.
export function volumeFlowIntegrals(
  model,
  hr,
  modifiers = {},
  beatIndex = 0,
  atrialSettings = null,
  n = 360,
) {
  // Exact per step: the volume change between grid samples, split by the
  // valve state at the step's midpoint flows (average of its two ends).
  const T = model.cycleDuration(hr, beatIndex),
    samples = gridSamples(model, hr, modifiers, beatIndex, n),
    grid = [];
  for (let i = 0; i <= n; i++) {
    const t = Math.min(T - 0.001, (i * T) / n),
      sample = samples[i];
    grid.push({
      t,
      sample,
      atria: atrialSettings
        ? atrialVolumeTargets(
            model,
            sample,
            t,
            hr,
            modifiers,
            beatIndex,
            atrialSettings,
          )
        : null,
    });
  }
  const sources = atrialSettings ? FLOW_SOURCES : FLOW_VALVES;
  const series = Object.fromEntries(
    sources.map((id) => [
      id,
      {
        values: new Float64Array(n + 1),
        times: new Float64Array(n + 1),
        T,
        total: 0,
      },
    ]),
  );
  for (let i = 1; i <= n; i++) {
    const a = grid[i - 1],
      b = grid[i];
    const valves = Object.fromEntries(
      FLOW_VALVES.map((id) => [
        id,
        { flow: (a.sample.valves[id].flow + b.sample.valves[id].flow) / 2 },
      ]),
    );
    const step = splitVolumeChange(
      model,
      {
        lv: b.sample.volume.lv - a.sample.volume.lv,
        rv: b.sample.volume.rv - a.sample.volume.rv,
      },
      valves,
    );
    if (atrialSettings)
      for (const side of SIDES)
        step[side.veins] =
          b.atria[side.atrium] - a.atria[side.atrium] + step[side.inflow];
    for (const id of sources) {
      series[id].times[i] = (i * T) / n;
      series[id].values[i] = series[id].values[i - 1] + step[id];
    }
  }
  for (const id of sources) series[id].total = series[id].values[n];
  return series;
}

// Forward and backward parts of a cumulative series (CC-31): each step's volume
// goes to one of them by its sign, so forward.total + backward.total = total
// and backward is never positive. A valve that never leaks has a zero backward
// series and a forward series equal to the net one.
export function directionalIntegrals(integral) {
  const { values, times, T } = integral,
    n = values.length;
  const part = () => ({ values: new Float64Array(n), times, T, total: 0 });
  const forward = part(),
    backward = part();
  for (let i = 1; i < n; i++) {
    const step = values[i] - values[i - 1];
    forward.values[i] = forward.values[i - 1] + Math.max(0, step);
    backward.values[i] = backward.values[i - 1] + Math.min(0, step);
  }
  forward.total = forward.values[n - 1];
  backward.total = backward.values[n - 1];
  return { forward, backward };
}

// Cumulative leak (mL, <= 0) through a regurgitant AV valve over one beat
// (CC-31). Splitting the ventricle's volume loss at a fixed regurgitant
// fraction gives the right volume per beat but a leak that nearly stops
// whenever the ventricle's volume pauses (MR: 0.28 mL/ms at 220 ms, 0.01 at
// 280 ms). A regurgitant jet is driven by the ventricle-atrium pressure
// difference all through systole, so this keeps the per-beat volume
// (`backwardTotal`, the backward part of the valve's volume series) and takes
// its timing from the model's own regurgitant valve flow (-sqrt of the
// gradient: holosystolic, through isovolumetric contraction and relaxation).
export function regurgitantIntegral(
  model,
  valve,
  backwardTotal,
  hr,
  modifiers = {},
  beatIndex = 0,
  n = 360,
) {
  const T = model.cycleDuration(hr, beatIndex),
    values = new Float64Array(n + 1),
    times = new Float64Array(n + 1),
    samples = gridSamples(model, hr, modifiers, beatIndex, n);
  const leak = (i) =>
    Math.min(0, Number(samples[i].valves[valve]?.flow ?? 0));
  let previous = leak(0);
  for (let i = 1; i <= n; i++) {
    const next = leak(i);
    times[i] = (i * T) / n;
    values[i] = values[i - 1] + 0.5 * (previous + next);
    previous = next;
  }
  const scale =
    values[n] < 0 && backwardTotal < 0 ? backwardTotal / values[n] : 0;
  for (let i = 0; i <= n; i++) values[i] *= scale;
  return { values, times, T, total: values[n] };
}

// Volume through a source from the start of the beat to t (mL). t may lie
// outside [0, T): whole beats add their net volume, so D(t + T) = D(t) + total
// and a time just before the beat start is continuous with the beat after it.
export function volumeAt(integral, t) {
  const { values, times, T, total } = integral,
    beats = Math.floor(t / T),
    time = t - beats * T;
  let lo = 0,
    hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const f =
    times[hi] > times[lo] ? (time - times[lo]) / (times[hi] - times[lo]) : 0;
  return beats * total + values[lo] + (values[hi] - values[lo]) * f;
}
