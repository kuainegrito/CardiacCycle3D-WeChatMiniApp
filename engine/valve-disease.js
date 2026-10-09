// CC-45: how a diseased valve moves (pure; shared by the atlas and 2D hearts).
//
// Mitral regurgitation: the leaflets fail to coapt. While the model's mitral
// flow runs backwards (valves.js: the regurgitant fraction of the reverse
// LV-LA gradient, holosystolic), the leaflets keep a gap of up to MITRAL_GAP
// of their opening excursion instead of meeting.
//
// Aortic stenosis: thickened, calcified, partly fused cusps. The model already
// caps the excursion (maxOpening, valves.js); here the cusps share it
// unevenly (fused commissures leave an irregular, eccentric orifice) and move
// stiffly: the opening advances in STENOSIS_STEPS jerky steps, not smoothly.
//
// The model's own valve blends (valve-motion.js sampleValveMotion and
// heart2d.js valveBlends, pinned against each other by a CC-30 test) are
// untouched: callers apply these to what they draw.
// Teaching appearance, not a measured valve morphology.

export const VALVE_DISEASE_VERSION = 1;
// Share of the full opening excursion the incompetent mitral leaflets keep
// apart while the jet runs, and the reverse flow (valves.js units) at which
// the gap is fully open: a third of the scenario's peak (~3.7).
export const MITRAL_GAP = 0.18;
export const MITRAL_GAP_FLOW = 1.2;
// Per-cusp share of the stenotic excursion: the left coronary cusp opens
// most, the fused right and non-coronary cusps less. Unknown cusps get 1.
export const STENOTIC_CUSPS = Object.freeze({
  "Left coronary leaflet": 1,
  "Right coronary leaflet": 0.62,
  "Non-coronary leaflet": 0.78,
});
export const STENOSIS_STEPS = 3;

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};

// Gap (opening blend) the mitral leaflets keep at this sample (0 if none).
export function mitralGap(sample) {
  const v = sample?.valves?.mitral;
  if (!v || !v.regurgitant || !(v.flow < 0)) return 0;
  return MITRAL_GAP * smooth(-v.flow / MITRAL_GAP_FLOW);
}

// Stenosis severity 0..1 from the model's capped excursion
// (valves.js: maxOpening = 1 / (1 + 1.2 stenosis)).
export function stenosisLevel(sample) {
  const max = sample?.valves?.aortic?.maxOpening ?? 1;
  return max >= 1 ? 0 : clamp((1 / max - 1) / 1.2);
}

// A stiff cusp: progress x (0..1 of its own excursion) advances in steps,
// each a short quick rise after a hold; phase (0..1) staggers the cusps.
export function stiffProgress(x, steps = STENOSIS_STEPS, phase = 0) {
  x = clamp(x);
  if (x >= 1) return 1;
  const s = x * steps + phase,
    k = Math.floor(s),
    f = s - k;
  return clamp((k + smooth((f - 0.55) / 0.45) - phase) / steps);
}

// Opening influence of one stenotic aortic cusp from the valve's capped
// blend (0..maxOpening). share: the cusp's part of the excursion (1 for the
// valve as a whole); index staggers the cusps' steps.
export function stenoticOpening(
  blend,
  maxOpening,
  level,
  share = 1,
  index = 0,
) {
  if (!(level > 0) || !(maxOpening > 0)) return blend;
  const x = clamp(blend / maxOpening);
  const stiff = stiffProgress(x, STENOSIS_STEPS, (index * 0.31) % 1);
  const progress = x + (stiff - x) * level;
  return maxOpening * progress * (1 - (1 - share) * level);
}

// The valve blends a heart draws: the model's, with the leak gap and the
// stiff stenotic opening applied (2D heart; the atlas does this per cusp).
export function diseasedValveBlends(blends, sample) {
  const out = { ...blends };
  const gap = mitralGap(sample);
  if (gap > (out.mitral ?? 0)) out.mitral = gap;
  const level = stenosisLevel(sample);
  if (level > 0 && out.aortic !== undefined)
    out.aortic = stenoticOpening(
      out.aortic,
      sample.valves.aortic.maxOpening,
      level,
    );
  return out;
}
