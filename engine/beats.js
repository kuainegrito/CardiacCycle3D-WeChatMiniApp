// CC-51: beat bookkeeping for the lab (js/app.js), first measured and fixed
// in the WeChat mini program (its pages/lab/lab.js). Identical beats are drawn
// and moved as beat 0, so neither the traces nor the hearts' per-beat tables
// (atrial volumes, blood flow) are rebuilt at every beat; beats that differ
// are prepared during the beat before.

// Beat-to-beat differences below this (mV, mL, mmHg) are rounding: away from
// 75 bpm a beat's absolute time (beat × RR + t) carries ~1e-15, so identical
// beats never compare exactly equal. Real differences are 0.1 and more.
export const BEAT_TOLERANCE = 1e-9;

const checks = new WeakMap();

// Whether every beat of this model at this rate and loading is the same:
// beat 0 against beats 1–7 at 16 instants (the PFO replays its Valsalva
// release every fourth beat). Kept per model, rate, loading and ectopic beat
// plan (CC-57: a stimulus makes the beats differ, wherever it falls).
export function sameBeats(model, hr, modifiers = {}) {
  let cache = checks.get(model);
  if (!cache) checks.set(model, (cache = new Map()));
  const key = [
    hr,
    modifiers.preload,
    modifiers.afterload,
    modifiers.contractility,
    model.ectopy?.version ?? 0,
  ].join("|");
  if (cache.has(key)) return cache.get(key);
  if (model.ectopy?.events.some((e) => e.hr === hr)) {
    if (cache.size > 64) cache.clear();
    cache.set(key, false);
    return false;
  }
  const T = model.cycleDuration(hr, 0),
    differ = (x, y) => !(Math.abs(x - y) <= BEAT_TOLERANCE);
  let same = true;
  for (let beat = 1; beat < 8 && same; beat++) {
    if (model.cycleDuration(hr, beat) !== T) same = false;
    for (let k = 0; k < 16 && same; k++) {
      const t = (T * k) / 16,
        a = model.sample(t, hr, modifiers, 0),
        b = model.sample(t, hr, modifiers, beat);
      if (
        differ(a.ecg, b.ecg) ||
        differ(a.volume.lv, b.volume.lv) ||
        ["la", "lv", "ra", "rv"].some((p) =>
          differ(a.pressures[p], b.pressures[p]),
        ) ||
        a.interatrial?.open !== b.interatrial?.open
      )
        same = false;
    }
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, same);
  return same;
}

// The PFO's beats differ only by the Valsalva release, which lifts RA, RV and
// PA together and so leaves valve gradients, volumes and with them the 3D
// heart's motion tables as they are in beat 0 — unless an ectopic stimulus
// changed the beat plan (CC-57).
export const pfoRepeats = (model) => {
  const p = model?.patch;
  return (
    !!p?.pfo && !p.asd && !p.rrSequence && !p.atrialFibrillation && !p.completeBlock &&
    !model.ectopy?.active
  );
};

// The instants a new beat's tables sample: the atrial volume table
// (engine/atrial-targets.js beatTable: 0 and i·T/N, N = T / samplingMs rounded
// up) and flow integrals of n steps (engine/atlas-valve-flow.js
// volumeFlowIntegrals and regurgitantIntegral: min(T − 0.001, i·T/n)).
export function beatGrid(T, samplingMs, flowSteps = []) {
  if (!(samplingMs > 0)) return [];
  const N = Math.ceil(T / samplingMs),
    dt = T / N,
    grid = [0];
  for (let i = 0; i <= N; i++) grid.push(i * dt);
  for (const n of flowSteps)
    for (let i = 0; i <= n; i++) grid.push(Math.min(T - 0.001, (i * T) / n));
  return grid;
}

// model.keepBeat(beat) keeps every sample of that beat (prepareNextBeat in
// js/app.js) until keepBeat(null): the beat's tables are then built from them
// at its start. Samples are only read, so sharing them changes nothing. The
// key carries the ectopic beat plan's version (CC-57): a stimulus during the
// beat before can turn the kept beat into a premature one.
const KEPT_SAMPLES = 2000;
export function keepBeatSamples(model) {
  const sample = model.sample;
  let keptBeat = null,
    kept = null;
  model.sample = (
    t,
    hr = model.scenario.hr ?? 75,
    modifiers = {},
    beatIndex = 0,
  ) => {
    if (beatIndex !== keptBeat) return sample(t, hr, modifiers, beatIndex);
    const key = `${model.ectopy?.version ?? 0}|${t}|${hr}|${modifiers.preload}|${modifiers.afterload}|${modifiers.contractility}`;
    let s = kept.get(key);
    if (!s) {
      s = sample(t, hr, modifiers, beatIndex);
      if (kept.size < KEPT_SAMPLES) kept.set(key, s);
    }
    return s;
  };
  model.keepBeat = (beat) => {
    keptBeat = beat ?? null;
    kept = keptBeat === null ? null : new Map();
  };
  return model;
}

/**
 * CC-61 R1: true while beat beatIndex is a stimulus's shortened beat (k) or
 * its premature beat (k + 1), so that a clock with Loop off runs on through
 * them and stops at the end of the post-pause beat (k + 2).
 */
export function ectopicRunOn(model, beatIndex, hr) {
  return !!model?.ectopy?.active && model.ectopy.events.some((e) => e.hr === hr && e.beat <= beatIndex && beatIndex <= e.beat + 1);
}
