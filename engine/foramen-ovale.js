// CC-48: patent foramen ovale (PFO). Pure functions shared by the model
// (waveforms.js), the traces (charts.js) and both hearts.
//
// Anatomy: the foramen ovale persists as a flap valve. The thin septum primum
// (left-atrial side) overlaps the muscular rim of the septum secundum
// (right-atrial side), leaving a slanted tunnel between them. The flap is held
// shut while LA pressure exceeds RA pressure, which in this model is the case
// at every instant of a resting beat (RA - LA from -7 to -2 mmHg), and it is
// pushed open into the LA only when RA pressure rises above LA pressure:
// a right-to-left shunt, the route of a paradoxical embolus.
//
// Valsalva release: every `valsalvaEvery`-th beat (beat index = every - 1, so
// beat 0 is a resting beat) the right-heart pressures RA, RV and PA rise
// together by `valsalvaRaRise` mmHg times a sin^2 window over the beat, as
// when venous blood pooled during a strain floods the right heart before the
// left. Raising the three together keeps every valve gradient, and so every
// valve event, unchanged; only the RA-LA relation reverses (from about 190 to
// 650 ms at 75 bpm, by up to ~4.5 mmHg). The window is zero at both beat
// boundaries, so the traces stay continuous. A reproducible teaching sequence,
// not a respiratory or intrathoracic-pressure model; the small shunt does not
// change the modelled volumes (the model is not a closed loop).
export const FORAMEN_OVALE_VERSION = 1;
export const PFO_DEFAULTS = Object.freeze({
  valsalvaEvery: 4,
  valsalvaRaRise: 10,
  // Flow per sqrt(mmHg) through the tunnel, in the model's arbitrary flow
  // units (an open valve has conductance 1): a slit, not a valve orifice.
  conductance: 0.5,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const modulo = (a, n) => ((a % n) + n) % n;

// Whether beat `beatIndex` replays the Valsalva release.
export function isReleaseBeat(patch, beatIndex) {
  if (!patch?.pfo) return false;
  const every = Math.max(1, Math.round(patch.valsalvaEvery ?? PFO_DEFAULTS.valsalvaEvery));
  return modulo(beatIndex, every) === every - 1;
}

// Right-heart pressure rise (mmHg) at time t of a beat of duration T.
export function valsalvaRise(patch, beatIndex, t, T) {
  if (!isReleaseBeat(patch, beatIndex) || !(T > 0)) return 0;
  const x = clamp(t / T, 0, 1),
    w = Math.sin(Math.PI * x) ** 2;
  return w * (patch.valsalvaRaRise ?? PFO_DEFAULTS.valsalvaRaRise);
}

// The flap at one instant: `history` holds the pressures over the last valve
// ramp (newest first, as valves.js samples them), so the flap swings open and
// shut over the same 15 ms as a valve leaflet. A seek gives the same state as
// playback. Flow is positive from right to left.
export function interatrialState(pressures, history, patch = {}) {
  const gradient = pressures.ra - pressures.la,
    open = gradient > 1e-6;
  let blend = 0;
  for (const p of history) if (p.ra > p.la + 1e-6) blend += 1 / history.length;
  const conductance = patch.pfoConductance ?? PFO_DEFAULTS.conductance;
  return {
    patent: true,
    open,
    blend: Math.min(1, blend),
    gradient,
    flow: open ? Math.sqrt(gradient) * conductance : 0,
    direction: open ? "right-to-left" : null,
  };
}

// How strongly to draw the shunt (0..1) from a sample: the flap's opening,
// scaled by the flow relative to a ~4 mmHg gradient.
export function shuntStrength(sample) {
  const s = sample?.interatrial;
  if (!s?.open) return 0;
  const reference = Math.sqrt(4) * PFO_DEFAULTS.conductance;
  return clamp(s.blend * Math.min(1, s.flow / reference) ** 0.5, 0, 1);
}
