// CC-06 illustrative atrial volume targets for the teaching model. The model has
// no atrial volume, so each atrium is given a blood-volume balance against the
// model's own ventricular volume curve (the curve both 3D ventricles hold):
//   - reservoir: veins fill the atrium at a constant rate while the AV valves are
//     closed (isovolumetric contraction to the end of isovolumetric relaxation);
//   - conduit: a fixed share of passive ventricular filling comes from the atrium,
//     the rest passes straight from the veins;
//   - booster: the model's atrial kick leaves the atrium on the model's atrial
//     clock. Contraction the ventricle does not take (closed valve, or complete
//     block, whose ventricle has no kick) returns to the veins and refills;
//   - mitral regurgitation returns its fraction of LV systolic loss to the LA.
// AF has no organized contraction. Each beat balances, so beats join without a
// step. Size: the normal curve's maximum, plus a compliance times the scenario's
// mean atrial pressure above the normal model. A teaching choice, not measured
// atrial volumes or a haemodynamic solver.
import { createModel } from "./waveforms.js";

const SIDES = ["LA", "RA"];
const REGURGITANT_VALVE = { LA: "mitral", RA: "tricuspid" };
const CACHE_LIMIT = 64;
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};

export function validateAtrialTargets(settings) {
  const t = settings?.targets;
  const positive = (x) => Number.isFinite(x) && x > 0;
  if (
    settings?.version !== 1 ||
    !positive(t?.samplingMs) ||
    t.samplingMs > 10 ||
    !Number.isFinite(t.reservoirShare) ||
    t.reservoirShare < 0 ||
    t.reservoirShare > 1 ||
    !Number.isFinite(t.complianceMlPerMmHg) ||
    t.complianceMlPerMmHg < 0 ||
    !positive(t.refillReferenceMs) ||
    !positive(t.pressureReferenceHr) ||
    !SIDES.every((side) => positive(t.normalMaximumMl?.[side]))
  )
    throw Error("Invalid atrial target settings");
  return settings;
}

// Progress (0..1) of the model's organized atrial contraction at time t of the
// beat of `sample`, or -1 outside it. Mirrors the a-wave clock in waveforms.js,
// including a contraction that starts near the end of the preceding display cycle.
export function organizedAtrialProgress(sample, t) {
  const c = sample.conduction,
    timing = sample.timing;
  if (c.fibrillating || c.dissociated) return -1;
  const start = timing.saStart + 80 * timing.atrialScale;
  const end = sample.schedule[0].end;
  const duration = Math.max(1, Math.min(100 * timing.atrialScale, end - start));
  const age =
    t < end
      ? t - start
      : start < 0 && t >= sample.T + start
        ? t - sample.T - start
        : -1;
  const progress = age / duration;
  return progress >= 0 && progress < 1 ? progress : -1;
}

const kickMl = (sample, physiology) =>
  (sample.atrialKick * sample.sv) / (physiology.edv - physiology.esv);

function remember(map, key, make) {
  if (map.has(key)) return map.get(key);
  const value = make();
  if (map.size >= CACHE_LIMIT) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

// One beat's cumulative volume change per atrium on a uniform grid, split into
// the balance without returned contraction ("base") and the return-and-refill dip.
function beatTable(model, hr, modifiers, beatIndex, t) {
  const T = model.cycleDuration(hr, beatIndex),
    N = Math.ceil(T / t.samplingMs),
    dt = T / N;
  const first = model.sample(0, hr, modifiers, beatIndex),
    physiology = model.baseline.physiology;
  const volume = Array.from(
    { length: N + 1 },
    (_, i) => model.sample(i * dt, hr, modifiers, beatIndex).volume.lv,
  );
  const progress = Array.from({ length: N + 1 }, (_, i) =>
    organizedAtrialProgress(first, i * dt),
  );
  const closedStart = first.schedule[1].start,
    open = first.schedule[4].end,
    kick = kickMl(first, physiology);
  const isClosed = (i) =>
    (i + 0.5) * dt >= closedStart && (i + 0.5) * dt < open;
  // Grid index at which the closed-valve steps end: the anchor for the maximum.
  let openIndex = 0;
  for (let i = 0; i < N; i++) if (isClosed(i)) openIndex = i + 1;
  // Refill starts after the step in which the organized contraction ends.
  const contractionEnd = progress.findIndex(
    (p, i) => i < N && p >= 0 && progress[i + 1] < 0,
  );
  const refillSteps = Math.max(
    1,
    Math.round((t.refillReferenceMs * first.timing.atrialScale) / dt),
  );
  const sides = {};
  let balanced = true;
  for (const side of SIDES) {
    const fraction =
      model.patch.regurgitation === REGURGITANT_VALVE[side]
        ? (model.patch.regurgitantFraction ?? 0)
        : 0;
    const empty = new Float64Array(N),
      regurgitant = new Float64Array(N),
      returned = new Float64Array(N),
      closed = new Uint8Array(N);
    let emptied = 0,
      regurgitated = 0,
      closedMs = 0,
      returnedMl = 0;
    for (let i = 0; i < N; i++) {
      const change = volume[i + 1] - volume[i],
        [a, b] = [progress[i], progress[i + 1]];
      const contracted =
        kick *
        Math.max(
          0,
          (b >= 0 ? smooth(b) : a >= 0 ? 1 : 0) - (a >= 0 ? smooth(a) : 0),
        );
      const filling = Math.max(0, change),
        active = Math.min(filling, contracted);
      empty[i] = active + t.reservoirShare * (filling - active);
      returned[i] = contracted - active;
      regurgitant[i] = Math.max(0, -change) * fraction;
      closed[i] = isClosed(i);
      emptied += empty[i];
      regurgitated += regurgitant[i];
      returnedMl += returned[i];
      closedMs += closed[i] ? dt : 0;
    }
    const inflow = Math.max(0, emptied - regurgitated);
    balanced &&= inflow === emptied - regurgitated;
    const rate = closedMs > 0 ? inflow / closedMs : 0;
    const refill = new Float64Array(N);
    if (returnedMl > 0 && contractionEnd >= 0)
      for (let k = 1; k <= refillSteps; k++)
        refill[(contractionEnd + k) % N] += returnedMl / refillSteps;
    const base = new Float64Array(N + 1),
      dip = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) {
      base[i + 1] =
        base[i] + (closed[i] ? rate * dt : 0) + regurgitant[i] - empty[i];
      dip[i + 1] = dip[i] + refill[i] - returned[i];
    }
    // The dip is zero outside the return-and-refill event.
    const top = Math.max(...dip);
    for (let i = 0; i <= N; i++) dip[i] -= top;
    sides[side] = {
      base,
      dip,
      closingMl: base[N],
      reservoirInflowMl: inflow,
      regurgitantMl: regurgitated,
      returnedMl,
    };
  }
  return { T, N, dt, open, openIndex, balanced, sides };
}

const interpolate = (table, values, time) => {
  const x = (((time % table.T) + table.T) % table.T) / table.dt,
    i = Math.min(table.N - 1, Math.floor(x));
  return values[i] + (values[i + 1] - values[i]) * (x - i);
};

const meanPressures = (model, hr, modifiers, stepMs) => {
  const T = model.cycleDuration(hr, 0),
    sum = { LA: 0, RA: 0 };
  let n = 0;
  for (let time = 0; time < T; time += stepMs, n++) {
    const p = model.sample(time, hr, modifiers, 0).pressures;
    sum.LA += p.la;
    sum.RA += p.ra;
  }
  return { LA: sum.LA / n, RA: sum.RA / n };
};

const caches = new WeakMap();
function cacheFor(model, settings) {
  let cache = caches.get(model);
  if (!cache || cache.settings !== settings) {
    cache = { settings, tables: new Map(), offsets: new Map() };
    caches.set(model, cache);
  }
  return cache;
}

// Beat-level pressure offsets (mmHg) of this scenario from the normal model at
// the reference rate; independent of the displayed HR and beat.
export function atrialPressureOffsets(model, modifiers = {}, settings) {
  const t = validateAtrialTargets(settings).targets,
    cache = cacheFor(model, settings);
  return remember(cache.offsets, JSON.stringify(modifiers), () => {
    const scenario = meanPressures(
        model,
        t.pressureReferenceHr,
        modifiers,
        t.samplingMs,
      ),
      normal = meanPressures(
        createModel(model.baseline),
        t.pressureReferenceHr,
        {},
        t.samplingMs,
      );
    return { LA: scenario.LA - normal.LA, RA: scenario.RA - normal.RA };
  });
}

export function atrialBeatTable(
  model,
  hr,
  modifiers = {},
  beatIndex = 0,
  settings,
) {
  const t = validateAtrialTargets(settings).targets,
    cache = cacheFor(model, settings);
  return remember(
    cache.tables,
    `${hr}|${beatIndex}|${JSON.stringify(modifiers)}`,
    () => beatTable(model, hr, modifiers, beatIndex, t),
  );
}

// Complete block: the independent atrial beat returns its stroke to the veins.
function dissociatedDipMl(sample, physiology, t) {
  const c = sample.conduction;
  if (!c.dissociated || c.fibrillating) return 0;
  const p = (c.atrialTime / sample.timing.atrialScale - 80) / 100,
    refill = t.refillReferenceMs / 100;
  const shape =
    p < 0
      ? 0
      : p < 1
        ? smooth(p)
        : p < 1 + refill
          ? 1 - smooth((p - 1) / refill)
          : 0;
  return (
    shape *
    kickMl({ atrialKick: physiology.atrialKickMl, sv: sample.sv }, physiology)
  );
}

// LA/RA target volumes (mL) at time t of this beat. Like ventricularVolumes, each
// atrium follows its own ventricle's branch delay, so it stays with that
// ventricle's 3D volume and valve timing.
export function atrialVolumeTargets(
  model,
  sample,
  t,
  hr,
  modifiers = {},
  beatIndex = 0,
  settings,
) {
  const targets = validateAtrialTargets(settings).targets;
  const table = atrialBeatTable(model, hr, modifiers, beatIndex, settings),
    offsets = atrialPressureOffsets(model, modifiers, settings),
    physiology = model.baseline.physiology;
  const { leftDelay = 0, rightDelay = 0 } = sample.conduction ?? {};
  const out = {};
  for (const side of SIDES) {
    const delay = side === "LA" ? leftDelay : rightDelay,
      time = t - delay,
      { base, dip } = table.sides[side];
    const shifted = delay
      ? model.sample(time, hr, modifiers, beatIndex)
      : sample;
    out[side] =
      targets.normalMaximumMl[side] +
      targets.complianceMlPerMmHg * offsets[side] +
      interpolate(table, base, time) -
      base[table.openIndex] +
      interpolate(table, dip, time) -
      dissociatedDipMl(shifted, physiology, targets);
  }
  return out;
}
