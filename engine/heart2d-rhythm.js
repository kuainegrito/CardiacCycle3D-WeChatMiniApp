import { vfOffset } from "./vf-view.js";

const clamp = v => Math.max(0, Math.min(1, v));
const smooth = v => { const x = clamp(v); return x * x * (3 - 2 * x); };

// Visual mechanics only: volumes, pressure, output and valve timing still
// come from the engine. No private clock, random state or extra heartbeat.
export function rhythm2dMotion(sample) {
  const c = sample.conduction ?? {}, e = sample.ectopy ?? {};
  const vf = c.rhythm === "vf", quiet = c.rhythm === "asystole";
  const motion = { absolute: sample.absolute, af: !!c.fibrillating && !vf && !quiet,
    vf: vf ? smooth((e.ageMs ?? 100) / 30) : 0, pvc: { RV: 0, LV: 0 } };
  if (!vf && !quiet && e.kind === "pvc") {
    for (const [chamber, delay] of [["RV", c.rightDelay ?? 0], ["LV", c.leftDelay ?? 0]]) {
      const onset = e.mechanicalOnsetMs + delay;
      const peak = sample.schedule[2].end + delay;
      const end = sample.schedule[5].end + delay;
      const t = sample.t;
      const envelope = t < peak ? smooth((t - onset) / Math.max(1, peak - onset))
        : 1 - smooth((t - peak) / Math.max(1, end - peak));
      motion.pvc[chamber] = clamp(e.contraction ?? 0) * envelope;
    }
  }
  return motion;
}

export function rhythm2dPoint(xy, chamber, motion) {
  if (!motion) return xy;
  let [x, y] = xy;
  const atrial = chamber === "RA" || chamber === "LA";
  const ventricular = chamber === "RV" || chamber === "LV";
  const amplitude = atrial && motion.af ? 2.8 : ventricular ? 5 * motion.vf : 0;
  if (amplitude) {
    const offset = vfOffset(x, y, motion.absolute + (chamber === "LA" ? 83 : 0), amplitude);
    x += offset[0]; y += offset[1];
  }
  if (ventricular && motion.pvc?.[chamber]) {
    // A basal-anchored free-wall shear illustrates contraction even without
    // ejection; its local map has determinant 1 and annuli stay fixed.
    // Magnitude is schematic, not measured strain. Timing comes from this PVC.
    const base = chamber === "RV" ? 480 : 380;
    x += (chamber === "RV" ? -1 : 1) * 0.09 * motion.pvc[chamber] * (y - base);
  }
  return [x, y];
}

export function rhythm2dCue(sample, language = "en") {
  const c = sample.conduction ?? {}, e = sample.ectopy ?? {};
  const key = c.rhythm === "vf" ? "vf" : c.rhythm === "asystole" ? "quiet" : c.fibrillating ? "af"
    : e.kind === "pvc" ? (sample.t >= sample.schedule[5].end ? "pause" : "pvc")
    : e.kind === "post" && e.order === 1 ? "post" : null;
  const text = {
    af: ["房颤 · 心房局部颤动", "AF · local atrial quivering"],
    vf: ["室颤 · 无有效泵血", "VF · no effective pumping"],
    quiet: ["电击后电静止", "Post-shock electrical pause"],
    pvc: ["室性期前收缩 · 提前搏动", "PVC · early ventricular beat"],
    pause: ["代偿间歇 · 等待下一搏", "Compensatory pause"],
    post: ["间歇后搏动", "Post-pause beat"],
  };
  return key ? text[key][language === "zh" ? 0 : 1] : "";
}
