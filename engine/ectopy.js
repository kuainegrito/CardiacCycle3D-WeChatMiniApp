// CC-57: the heart's event layer and the ectopic stimulus beat plan
// (docs/CC57_61_ECTOPIC_STIMULUS_PLAN.md sections 3 and 10.2; record
// docs/CC57_ECTOPY_ENGINE.md; VF/shock contract: docs/CC63_VF_ENGINE.md).
//
// The model (waveforms.js) plays template beats: beat b is the 800 ms template
// scaled to the sinus cycle T. A model owns one event list here. Events carry
// a `type` and the rhythm they happened in; the model's rhythm state is
// `rhythm`. CC-63 extends this list with VF induction and shock events;
// rhythmAt() resolves their arrest, electrical pause and sinus recovery.
//
// A stimulus at time c of beat k is either refractory (inside the ventricular
// effective refractory period of the last ventricular excitation, the same
// rule as sample().erp), or it starts a premature ventricular contraction from
// a right-ventricular site. An accepted stimulus rewrites the beat plan from c
// on and never before it:
//
//   beat k     the beat as it was, cut at c (cycleDuration = c);
//   beat k+1   the premature beat (PVC), from c to the start of the sinus
//              beat after the next one that reaches the ventricles: the first
//              sinus impulse after the PVC is blocked (it finds the ventricles
//              and the junction refractory, concealed retrograde conduction),
//              the following one conducts. Its length is 2T - c when c falls
//              after this beat's QRS and T - c when it falls in the PR interval
//              (the PVC then takes this beat's own QRS);
//   beat k+2   the post-pause sinus beat (more filling, potentiated by x1.15),
//   beat k+3   x1.05, then plain sinus beats again.
//
// The sinus node is not reset, so the beat after the pause starts exactly on
// the sinus clock: pre RR + post RR = 2T for every c, by construction (the
// complete compensatory pause). P waves stay on the absolute sinus clock and
// keep coming during the PVC (a buried P; with the AV valves shut, a cannon a
// wave).
//
// Haemodynamics are a teaching illustration, not measured or validated values
// (decision D8, review in CC-61): the PVC contracts with 0.85 of the sinus
// beat's elastance against a two-element Windkessel fitted to the sinus beat,
// so an early PVC (small filling) may not open the aortic valve; the PVC's
// contraction does not start before the previous beat has relaxed (no
// summation); the long pause adds filling and lowers the diastolic aortic
// pressure; the next two beats are potentiated. Every beat boundary and the
// cut are continuous in volume and pressures.
import { valveStates } from "./valves.js";
import { sampleConduction, ectopicTiming } from "./conduction.js";
import { reducedFillingFraction } from "./reduced-filling.js";
import { interatrialState } from "./foramen-ovale.js";

export const ECTOPY_VERSION = 1;
export const EVENT_TYPES = Object.freeze(["stimulus", "shock"]);
export const RHYTHMS = Object.freeze(["sinus", "vf", "asystole"]);
export const SHOCK_PAUSE_MS = 1500;
// Deterministic, non-periodic on the displayed beat grid; all carriers 4–8 Hz.
export const vfVoltage = (absoluteMs) => {
  const s = absoluteMs / 1000;
  return (
    0.55 * Math.sin(2 * Math.PI * 5.3 * s) +
    0.27 * Math.sin(2 * Math.PI * 7.1 * s + 0.7) +
    0.18 * Math.sin(2 * Math.PI * 4.2 * s + 2)
  );
};
// CC-61: no event cuts a beat closer than this to its start (ms). A stimulus
// at t = 0 left a beat of zero length, whose per-beat tables (atrial volume)
// cannot be built; such a stimulus lands 1 ms into the beat instead.
export const MIN_CUT_MS = 1;
export const ECTOPY_DEFAULTS = Object.freeze({
  site: "rv",
  // Stimulus to ventricular excitation (ms), and the PVC's QRS width before
  // the rate scaling of conductionTiming's qrsScale.
  latencyMs: 10,
  qrsMs: 140,
  // Electromechanical delay of the PVC, as the sinus beat's 20 ms (x rate).
  mechanicalDelayMs: 20,
  // Incomplete mechanical restitution: the PVC's share of sinus elastance,
  // lower still the earlier it comes (restitution depth and time constant,
  // from the end of the ERP, x rate).
  contractility: 0.85,
  restitutionDepth: 0.4,
  restitutionMs: 150,
  // Post-extrasystolic potentiation of the next two beats (ESV / factor).
  potentiation: Object.freeze([1.15, 1.05]),
  // Extra filling of a long pause, as a fraction of EDV, reached when the
  // PVC's diastole is a quarter cycle longer than the sinus diastole.
  pauseFill: 0.06,
  // Pressure (mmHg) the arterial pressures decay towards in a long diastole.
  aorticFloor: 7,
  pulmonaryFloor: 5,
  // Volume intercept of the elastance (mL; sample().pv.volumeIntercept).
  volumeIntercept: 10,
  // Smoothing of the atrial pressures where the PVC's own curves take over.
  transitionMs: 30,
  // Only the most recent events are kept: as many as a learning record can
  // carry (engine/tracker.js keeps 12 items of an array, 3 levels deep).
  maxEvents: 12,
  dtMs: 0.25,
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const modulo = (x, n) => ((x % n) + n) % n;
const smooth = (x) => {
  const u = clamp(x, 0, 1);
  return u * u * (3 - 2 * u);
};

// Scenarios whose rhythm has no regular sinus cycle to compensate for, or whose
// ventricles follow an escape focus (decision D5).
export function ectopyDisabledReason(patch = {}) {
  if (patch.atrialFibrillation) return "atrial-fibrillation";
  if (patch.completeBlock) return "complete-block";
  if (patch.rrSequence) return "irregular-rhythm";
  return null;
}

const finite = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
// An exported plan holds one column per event field (event field -> column),
// so that a learning record (engine/tracker.js, nesting depth 3) keeps it whole.
export const EVENT_COLUMNS = Object.freeze({
  type: "types",
  rhythm: "rhythms",
  beat: "beats",
  cutMs: "cutsMs",
  hr: "rates",
  site: "sites",
  blocks: "blocks",
});
export function ectopyEvents(s) {
  return s.beats.map((_, i) => Object.fromEntries(Object.entries(EVENT_COLUMNS).map(([k, c]) => [k, s[c][i]])));
}
// Shape check of an exported plan (replay.js uses it before touching state).
export function validEctopyState(s) {
  if (s === null) return true;
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  if (s.version !== ECTOPY_VERSION || !RHYTHMS.includes(s.rhythm)) return false;
  if (!Array.isArray(s.beats) || s.beats.length > ECTOPY_DEFAULTS.maxEvents) return false;
  if (!Object.values(EVENT_COLUMNS).every((c) => Array.isArray(s[c]) && s[c].length === s.beats.length)) return false;
  let previous = -Infinity;
  let previousSinus = -Infinity;
  let previousCut = -Infinity;
  for (const e of ectopyEvents(s)) {
    if (!EVENT_TYPES.includes(e.type) || !RHYTHMS.includes(e.rhythm)) return false;
    if (!Number.isInteger(e.beat) || !finite(e.beat, 0, 100000)) return false;
    if (!finite(e.cutMs, MIN_CUT_MS, e.rhythm === "sinus" ? 2250 : 3000) || !finite(e.hr, 40, 180)) return false;
    if (e.site !== "rv" || !["own", "next"].includes(e.blocks)) return false;
    // A premature beat cannot itself be cut (one per sinus cycle).
    if (e.beat < previous) return false;
    if (e.beat === previous && e.cutMs <= previousCut) return false;
    if (e.type === "stimulus" && e.rhythm === "sinus") {
      if (e.beat < previousSinus + 2) return false;
      previousSinus = e.beat;
    }
    if (e.type === "shock" && e.rhythm !== "asystole") return false;
    if (e.type === "stimulus" && e.rhythm === "asystole") return false;
    previous = e.beat;
    previousCut = e.cutMs;
  }
  return true;
}

/**
 * The model's event layer. `host` gives the sinus model of waveforms.js:
 * sinusDuration(hr, s), scheduleFor(T), pressureVolume(t, hr, modifiers, s)
 * (the sinus state of sinus beat s), sinusSample(t, hr, modifiers, s),
 * timingFor(T, schedule), lookup(id, r), baseline, patch.
 */
export function createEctopy(host) {
  const { baseline, patch } = host,
    REF = [...baseline.phases.map((p) => p.start), baseline.phases.at(-1).end],
    refTime = (schedule, t) => referenceTime(REF, schedule, t),
    timeOfRef = (schedule, r) => scheduleTime(REF, schedule, r),
    phys = baseline.physiology,
    D = ECTOPY_DEFAULTS;
  const disabled = ectopyDisabledReason(patch);
  let events = [],
    version = 0;
  const plans = new Map(),
    pvcCache = new Map(),
    sinusRefs = new Map(),
    pressureCache = new Map();
  const bump = () => {
    version++;
    plans.clear();
    pvcCache.clear();
    pressureCache.clear();
  };
  const modKey = (m) => `${m.preload}|${m.afterload}|${m.contractility}`;
  const remember = (map, key, size, make) => {
    let v = map.get(key);
    if (v === undefined) {
      if (map.size >= size) map.clear();
      v = make();
      map.set(key, v);
    }
    return v;
  };

  // --- beat plan ----------------------------------------------------------
  // The events at this rate, oldest first. Events taken at another rate are
  // ignored there (CC-58: the lab clears the plan when the rate changes).
  const eventsAt = (hr) =>
    remember(plans, `${version}|${hr}`, 16, () =>
      events.filter((e) => e.hr === hr && e.type === "stimulus" && e.rhythm === "sinus"),
    );
  // What display beat `beat` is at this rate: null when there is no event.
  function describe(hr, beat) {
    const list = eventsAt(hr);
    if (!list.length) return null;
    const T = host.sinusDuration(hr, 0);
    let shift = 0,
      last = null;
    const base = (b, prev) => {
      const order = prev ? b - (prev.beat + 1) : 0,
        s = b - shift;
      return {
        beat: b,
        kind: order === 1 || order === 2 ? "post" : "sinus",
        order: order === 1 || order === 2 ? order : 0,
        sinus: s,
        start: s * T,
        lengthMs: T,
        T,
      };
    };
    for (const e of list) {
      if (e.beat > beat) break;
      if (e.beat === beat) return { ...base(beat, last), lengthMs: e.cutMs, cut: e };
      if (e.beat + 1 === beat) {
        const old = { ...base(e.beat, last), lengthMs: e.cutMs, cut: e },
          s = old.sinus,
          L = e.blocks === "own" ? T - e.cutMs : 2 * T - e.cutMs;
        return {
          beat,
          kind: "pvc",
          order: 0,
          sinus: s,
          next: e.blocks === "own" ? s + 1 : s + 2,
          start: s * T + e.cutMs,
          lengthMs: L,
          T,
          event: e,
          old,
        };
      }
      if (e.blocks === "own") shift++;
      last = e;
    }
    return base(beat, last);
  }
  const lengthOf = (hr, beat) => describe(hr, beat)?.lengthMs ?? host.sinusDuration(hr, beat);

  // --- sinus references, per rate and loading ---------------------------
  // The sinus beat sampled on the template's reference time r (systole r
  // 100-510): its elastance E = (P - passive) / (V - V0), and two-element
  // Windkessel constants that reproduce its diastolic decay and its ejection.
  function sinusRef(hr, modifiers) {
    return remember(sinusRefs, `${hr}|${modKey(modifiers)}`, 16, () => {
      const T = host.sinusDuration(hr, 0),
        sch = host.scheduleFor(T),
        at = (r) => timeOfRef(sch, r),
        state = (t) => host.pressureVolume(t, hr, modifiers, 0),
        V0 = D.volumeIntercept,
        grid = [];
      for (let r = 100; r <= 510; r++) {
        const s = state(at(Math.min(r, 509.999)));
        grid.push({ r, t: at(Math.min(r, 509.999)), V: s.volume.lv, ...s.pressures });
      }
      const first = grid[0],
        lastRow = grid.at(-1);
      for (const g of grid) {
        const u = (g.r - 100) / 410;
        g.lvPassive = first.lv + (lastRow.lv - first.lv) * u;
        g.rvPassive = first.rv + (lastRow.rv - first.rv) * u;
        g.E = Math.max(0, g.lv - g.lvPassive) / Math.max(1, g.V - V0);
        g.rvDev = g.rv - g.rvPassive;
      }
      const fit = (key, floor) => {
        // Diastolic decay from the end of rapid filling to the next opening,
        // of the template beat itself, scaled with rate as the template's
        // systole (sqrt(T / 800)). Fitted at each rate, the template's
        // time-scaled curves would make it far too short at fast rates; held
        // fixed, a long pause at slow rates would drop far below the
        // template's own diastolic pressure.
        const Tref = baseline.periodMs,
          schRef = host.scheduleFor(Tref),
          atRef = (t) => host.pressureVolume(t, 60000 / Tref, modifiers, 0).pressures[key],
          a1 = atRef(schRef[5].end - 1e-6),
          a2 = atRef(schRef[2].start),
          dt = Tref - schRef[5].end + schRef[2].start,
          tau = (dt / Math.log(Math.max(1.0001, (a1 - floor) / Math.max(0.5, a2 - floor)))) * Math.sqrt(T / Tref);
        // Ejection: SV = C ΔA + (1/R) ∫ (A - floor) dt with R = tau / C.
        let integral = 0,
          gradient = 0;
        const ej = grid.filter((g) => g.r >= 150 && g.r <= 450);
        for (let i = 1; i < ej.length; i++) {
          const dtj = ej[i].t - ej[i - 1].t,
            up = key === "ao" ? "lv" : "rv";
          integral += ((ej[i][key] + ej[i - 1][key]) / 2 - floor) * dtj;
          gradient += Math.max(0, (ej[i][up] - ej[i][key] + ej[i - 1][up] - ej[i - 1][key]) / 2) * dtj;
        }
        const sv = ej[0].V - ej.at(-1).V,
          dA = ej.at(-1)[key] - ej[0][key],
          C = sv / Math.max(1, dA + integral / tau);
        return { tau, C, R: tau / C, Rv: Math.max(1, gradient / Math.max(1, sv)), floor };
      };
      return {
        T,
        sch,
        grid,
        edv: grid[0].V,
        sv: grid[0].V - grid.find((g) => g.r === 450).V,
        aortic: fit("ao", D.aorticFloor),
        pulmonary: fit("pa", D.pulmonaryFloor),
        open: state(sch[2].start).pressures,
      };
    });
  }
  const refAt = (ref, r) => {
    const x = clamp(r, 100, 510) - 100,
      i = Math.min(ref.grid.length - 2, Math.floor(x)),
      f = x - i,
      a = ref.grid[i],
      b = ref.grid[i + 1];
    const mix = (k) => a[k] + (b[k] - a[k]) * f;
    return { E: mix("E"), rvDev: mix("rvDev"), V: mix("V") };
  };

  // --- the premature beat -------------------------------------------------
  function pvcSchedule(L, rs, pre) {
    const relax = 60 * rs,
      systole = Math.max(1, Math.min(350 * rs, L - pre - relax - Math.min(20, L * 0.06))),
      remaining = Math.max(0, L - pre - systole - relax),
      rapid = Math.min(140 * rs, remaining),
      rest = remaining - rapid,
      durations = [pre, systole / 7, (systole * 12) / 35, (systole * 18) / 35, relax, rapid, rest];
    let start = 0;
    return baseline.phases.map((phase, i) => {
      const p = { ...phase, index: i, start, end: start + durations[i], duration: durations[i] };
      start = p.end;
      return p;
    });
  }
  function pvcParams(desc, hr, modifiers) {
    return remember(pvcCache, `${version}|${hr}|${desc.beat}|${modKey(modifiers)}`, 32, () => {
      const T = desc.T,
        c = desc.event.cutMs,
        L = desc.lengthMs,
        rs = Math.sqrt(T / baseline.periodMs),
        oldSch = host.scheduleFor(T),
        sinusTiming = host.timingFor(T, oldSch),
        own = desc.event.blocks === "own",
        // The ectopic excitation always comes before the sinus impulse it
        // pre-empts (with pre-excitation at fast rates that QRS starts at or
        // before the beat boundary).
        lat = clamp((own ? sinusTiming.qrsStart : T + sinusTiming.qrsStart) - c - 0.5, 0.5, D.latencyMs),
        { since } = sinceExcitation(hr, desc.event.beat, c, desc.old),
        erp = phys.ventricularErpMs * rs,
        strength =
          D.contractility * (1 - D.restitutionDepth * Math.exp(-Math.max(0, since - erp) / (D.restitutionMs * rs)));
      // Mechanical onset: not before the previous beat has relaxed (no
      // summation); when the PVC takes this beat's own QRS, before the sinus
      // contraction would have started.
      const onset0 = lat + D.mechanicalDelayMs * rs,
        onset = own ? Math.min(onset0, oldSch[0].end - c) : Math.max(onset0, oldSch[4].end - c);
      const sch = pvcSchedule(L, rs, onset),
        timing = ectopicTiming(sinusTiming, {
          latencyMs: lat,
          qrsMs: D.qrsMs,
          normalQrsMs: phys.qrsMs,
          site: D.site,
        });
      const ref = sinusRef(hr, modifiers),
        old = (t) => statePressures(desc.old, c + t, hr, modifiers),
        start = old(onset),
        V0 = D.volumeIntercept;
      // Integrate systole and relaxation once: elastance x the sinus beat's
      // time course, aortic and pulmonary Windkessels.
      const sysEnd = sch[4].end,
        dt = D.dtMs,
        n = Math.max(1, Math.ceil((sysEnd - onset) / dt)),
        rows = new Array(n + 1),
        lvEnd = ref.grid.at(-1).lv,
        rvEnd = ref.grid.at(-1).rv,
        rho = (strength * Math.max(0, start.volume - V0)) / Math.max(1, ref.edv - V0);
      let V = start.volume,
        A = start.pressures.ao,
        Pa = start.pressures.pa,
        ejected = false,
        pulmonaryOpen = false;
      const { aortic: ao, pulmonary: pu } = ref;
      for (let i = 0; i <= n; i++) {
        const t = Math.min(sysEnd, onset + i * dt),
          r = refTime(sch, t),
          u = (r - 100) / 410,
          g = refAt(ref, r),
          E = strength * g.E,
          passive = start.pressures.lv + (lvEnd - start.pressures.lv) * u,
          P = passive + E * Math.max(0, V - V0),
          rv = start.pressures.rv + (rvEnd - start.pressures.rv) * u + rho * g.rvDev;
        rows[i] = { V, lv: P, ao: A, pa: Pa, rv };
        if (i === n) break;
        const Q = P > A ? (P - A) / (ao.Rv + (E + 1 / ao.C) * dt) : 0,
          Qp = rv > Pa ? (rv - Pa) / (pu.Rv + dt / pu.C) : 0;
        if (Q > 0) ejected = true;
        if (Qp > 0) pulmonaryOpen = true;
        V = Math.max(V0 + 1, V - Q * dt);
        A += ((Q - (A - ao.floor) / ao.R) * dt) / ao.C;
        Pa += ((Qp - (Pa - pu.floor) / pu.R) * dt) / pu.C;
      }
      // One ejection per valve: where the weak beat's pressure only just
      // matches the artery's, the valve would open and shut several times.
      // From the first to the last opening the artery stays just below the
      // ventricle (by at most the gap the valve rule needs).
      for (const [up, down] of [
        ["lv", "ao"],
        ["rv", "pa"],
      ]) {
        const open = rows.map((row) => row[up] > row[down] + 1e-6),
          first = open.indexOf(true),
          last = open.lastIndexOf(true);
        for (let i = first + 1; first >= 0 && i < last; i++) {
          const edge = Math.min(i - first, last - i) * dt;
          rows[i][down] = Math.min(rows[i][down], rows[i][up] - 0.05 * smooth(edge / 3));
          if (!(rows[i][up] > rows[i][down] + 1e-6)) rows[i][down] = rows[i][up] - 2e-6;
        }
      }
      const endRow = rows[n],
        esv = endRow.V,
        diastole = L - sysEnd,
        sinusDiastole = T - oldSch[4].end,
        extra = D.pauseFill * ref.edv * clamp((diastole - sinusDiastole) / (0.25 * T), 0, 1),
        // The next sinus beat's own state, and the PVC's arterial pressures
        // at its end (pure decay after relaxation).
        decay = (v, w) => w.floor + (v - w.floor) * Math.exp(-diastole / w.tau),
        aoEnd = decay(endRow.ao, ao),
        paEnd = decay(endRow.pa, pu),
        next0 = host.pressureVolume(0, hr, modifiers, desc.next);
      return {
        T,
        c,
        L,
        rs,
        onset,
        sch,
        timing,
        sinusTiming,
        oldSch,
        rows,
        dt,
        start,
        edv: start.volume,
        esv,
        sv: start.volume - esv,
        ejected,
        pulmonaryOpen,
        rho,
        strength,
        extra,
        aoEnd,
        paEnd,
        // Deviations the post-pause beat starts from.
        next: { volume: extra, ao: aoEnd - next0.pressures.ao, pa: paEnd - next0.pressures.pa },
        // Crossfade window of the diastolic pressures into the next beat.
        fade0: Math.max(sysEnd, L - (T - oldSch[5].start)),
        ref,
        onT: c >= sinusTiming.qrsStart && c - sinusTiming.qrsStart <= sinusTiming.qtMs,
      };
    });
  }

  // Volume and pressures of any described beat at time t (t < 0 is the
  // previous beat; beyond its length a sinus beat simply continues).
  function statePressures(desc, t, hr, modifiers) {
    if (t < 0 && desc.beat > 0 && (desc.kind === "pvc" || desc.kind === "post")) {
      const prev = describe(hr, desc.beat - 1) ?? sinusDesc(hr, desc.beat - 1);
      return statePressures(prev, prev.lengthMs + t, hr, modifiers);
    }
    const key = `${version}|${hr}|${desc.kind === "sinus" ? "s" + desc.sinus : desc.beat}|${desc.kind}|${t}|${modKey(modifiers)}`;
    let v = pressureCache.get(key);
    if (v) return v;
    if (desc.kind === "pvc") v = pvcState(desc, t, hr, modifiers);
    else if (desc.kind === "post") v = postState(desc, t, hr, modifiers);
    else {
      const s = host.pressureVolume(t, hr, modifiers, desc.sinus);
      v = { volume: s.volume.lv, pressures: s.pressures };
    }
    if (pressureCache.size >= 4096) pressureCache.clear();
    pressureCache.set(key, v);
    return v;
  }
  const sinusDesc = (hr, beat) => {
    const T = host.sinusDuration(hr, beat);
    return { beat, kind: "sinus", order: 0, sinus: beat, start: beat * T, lengthMs: T, T };
  };

  function pvcState(desc, t, hr, modifiers) {
    const p = pvcParams(desc, hr, modifiers);
    if (t < p.onset) {
      const o = statePressures(desc.old, p.c + t, hr, modifiers);
      return { volume: o.volume, pressures: { ...o.pressures } };
    }
    const r = refTime(p.sch, t),
      template = templateAt(desc, p, r, hr, modifiers),
      pressures = {};
    let volume;
    if (t <= p.sch[4].end) {
      const x = Math.min(p.rows.length - 1, (t - p.onset) / p.dt),
        i = Math.min(p.rows.length - 2, Math.floor(x)),
        f = x - i,
        a = p.rows[i],
        b = p.rows[Math.max(0, Math.min(p.rows.length - 1, i + 1))],
        mix = (k) => a[k] + (b[k] - a[k]) * f;
      volume = mix("V");
      for (const k of ["lv", "ao", "pa", "rv"]) pressures[k] = mix(k);
    } else {
      const since = t - p.sch[4].end,
        end = p.rows.at(-1),
        { aortic, pulmonary } = p.ref;
      pressures.ao = aortic.floor + (end.ao - aortic.floor) * Math.exp(-since / aortic.tau);
      pressures.pa = pulmonary.floor + (end.pa - pulmonary.floor) * Math.exp(-since / pulmonary.tau);
      pressures.lv = template.lv;
      pressures.rv = template.rv;
      // Filling from the PVC's end-systolic volume to the next beat's start
      // plus the pause's extra filling, on the template's filling curve.
      const tail = statePressures(
          sinusDesc(hr, desc.next),
          Math.max(t - p.L, -(p.T - p.oldSch[6].start)),
          hr,
          modifiers,
        ),
        progress = fillingProgress(r, p.sch) / Math.max(1e-9, fillingProgress(refTime(p.sch, p.L - 1e-9), p.sch));
      volume = p.esv + (tail.volume + p.extra - p.esv) * clamp(progress, 0, 1);
    }
    pressures.la = template.la;
    pressures.ra = template.ra;
    // The sinus P wave still contracts the atria; with the AV valves shut
    // (the PVC's systole) the rise is a cannon a wave.
    const a = atrialKickPressure(p, desc, t, hr),
      shut = smooth((r - 100) / 10) * (1 - smooth((r - 500) / 10)),
      loadScale = clamp(modifiers.afterload ?? 1, 0.7, 1.5);
    pressures.la += a * loadScale * (1 + 2 * shut);
    pressures.ra += a * (0.5 + shut);
    // The old beat's atrial pressures fade into the PVC's own.
    const o = statePressures(desc.old, p.c + p.onset, hr, modifiers),
      w = 1 - smooth((t - p.onset) / D.transitionMs);
    if (w > 0) {
      const own0 = templateAt(desc, p, refTime(p.sch, p.onset), hr, modifiers),
        a0 = atrialKickPressure(p, desc, p.onset, hr);
      pressures.la += (o.pressures.la - own0.la - a0 * loadScale) * w;
      pressures.ra += (o.pressures.ra - own0.ra - a0 * 0.5) * w;
    }
    // Late diastole merges into the next sinus beat (its P wave, its kick).
    if (t > p.fade0) {
      const h = smooth((t - p.fade0) / Math.max(1e-9, p.L - p.fade0)),
        n = statePressures(sinusDesc(hr, desc.next), t - p.L, hr, modifiers).pressures;
      for (const k of ["lv", "la", "ra", "rv"]) pressures[k] += (n[k] - pressures[k]) * h;
    }
    return { volume, pressures };
  }
  // The sinus template's pressures at reference time r (diastolic and atrial
  // curves of the PVC), taken where the sinus beat has no atrial kick.
  function templateAt(desc, p, r, hr, modifiers) {
    // (Not before filling starts: with a long PR at fast rates the kick
    // begins during relaxation.)
    const kick = refTime(p.oldSch, p.T + Math.min(0, p.sinusTiming.saStart + 80 * p.sinusTiming.atrialScale)) - 1e-6,
      safe = Math.min(clamp(r, 100, 800), Math.max(REF[5], kick));
    return host.pressureVolume(timeOfRef(p.oldSch, Math.max(100, safe)), hr, modifiers, desc.sinus).pressures;
  }
  // The a wave (mmHg above the template) of the sinus P waves during the PVC.
  function atrialKickPressure(p, desc, t, hr) {
    const timing = p.sinusTiming,
      tc = modulo(p.c + t, p.T),
      atrialStart = timing.saStart + 80 * timing.atrialScale,
      atrialDuration = Math.max(1, Math.min(100 * timing.atrialScale, p.oldSch[0].end - atrialStart));
    const age =
      tc < p.oldSch[0].end
        ? tc - atrialStart
        : atrialStart < 0 && tc >= p.T + atrialStart
          ? tc - p.T - atrialStart
          : -1;
    if (age < 0 || age >= atrialDuration) return 0;
    return Math.max(0, host.lookup("la", (age / atrialDuration) * 100) - 10);
  }
  const fillingProgress = (r, sch) => {
    if (r < 510) return 0;
    const { edv, esv, atrialKickMl } = phys,
      passive = 1 - atrialKickMl / (edv - esv),
      n = reducedFillingFraction((host.lookup("volume", r) - esv) / (edv - esv), r, sch, baseline);
    return clamp(n / passive, 0, 1);
  };

  // --- the beats after the pause ------------------------------------------
  function postParams(desc, hr, modifiers) {
    const T = desc.T,
      prev = describe(hr, desc.beat - 1),
      start =
        desc.order === 1 && prev?.kind === "pvc" ? pvcParams(prev, hr, modifiers).next : { volume: 0, ao: 0, pa: 0 },
      f = D.potentiation[desc.order - 1] ?? 1,
      sinus0 = host.pressureVolume(0, hr, modifiers, desc.sinus),
      ref = sinusRef(hr, modifiers),
      esv = sinus0.esv,
      dES = esv / f - esv,
      sv = sinus0.sv + start.volume - dES;
    return { T, f, start, dES, sv, gain: sv / sinus0.sv, open: ref.open, sch: host.scheduleFor(T) };
  }
  // Deviations from the sinus beat; all reach zero at the beat's own end
  // (fast rates compress the template's diastasis away).
  function postDeviation(q, r, s) {
    const ej = clamp((phys.edv - host.lookup("volume", clamp(r, 150, 450))) / (phys.edv - phys.esv), 0, 1),
      dv =
        r < 150
          ? q.start.volume
          : r < 450
            ? q.start.volume + (q.dES - q.start.volume) * ej
            : r < 510
              ? q.dES
              : q.dES * (1 - fillingProgress(r, q.sch) / Math.max(1e-9, q.fillEnd)),
      arterial = (key) => {
        const pulse = (q.gain - 1) * (s.pressures[key] - q.open[key]);
        if (r < 150) return q.start[key];
        if (r < 450) return q.start[key] * (1 - ej) + pulse;
        return q.endPulse[key] * (1 - smooth((s.t - q.closeMs) / Math.max(1e-9, q.T - q.closeMs)));
      },
      sigma = r < 100 ? 0 : r < 150 ? smooth((r - 100) / 50) : r < 450 ? 1 : r < 510 ? 1 - smooth((r - 450) / 60) : 0;
    const ao = arterial("ao"),
      pa = arterial("pa");
    return { volume: dv, ao, pa, lv: ao * sigma, rv: pa * sigma };
  }
  function postState(desc, t, hr, modifiers) {
    const q = postQ(desc, hr, modifiers),
      s = host.pressureVolume(t, hr, modifiers, desc.sinus),
      d = postDeviation(q, s.referenceTime, s),
      pressures = { ...s.pressures };
    for (const k of ["ao", "pa", "lv", "rv"]) pressures[k] += d[k];
    return { volume: s.volume.lv + d.volume, pressures, sinus: s, q };
  }
  function postQ(desc, hr, modifiers) {
    return remember(pvcCache, `${version}|${hr}|${desc.beat}|post|${modKey(modifiers)}`, 32, () => {
      const q = postParams(desc, hr, modifiers),
        // The pulse added at the end of ejection, which then decays in diastole.
        s450 = host.pressureVolume(timeOfRef(host.scheduleFor(desc.T), 449.999), hr, modifiers, desc.sinus);
      q.closeMs = timeOfRef(q.sch, REF[4]);
      q.fillEnd = fillingProgress(refTime(q.sch, desc.T - 1e-9), q.sch);
      q.endPulse = {
        ao: (q.gain - 1) * (s450.pressures.ao - q.open.ao),
        pa: (q.gain - 1) * (s450.pressures.pa - q.open.pa),
      };
      return q;
    });
  }

  // --- samples ------------------------------------------------------------
  function lookBack(desc, hr, modifiers) {
    return (at) => statePressures(desc, at, hr, modifiers).pressures;
  }
  function postSample(desc, t, hr, modifiers) {
    const time = modulo(t, desc.T),
      st = postState(desc, time, hr, modifiers),
      base = host.sinusSample(time, hr, modifiers, desc.sinus),
      q = st.q,
      pressureAt = lookBack(desc, hr, modifiers),
      valves = valveStates(st.pressures, pressureAt, time, patch, phys.valveRampMs),
      interatrial =
        patch.pfo || patch.asd
          ? interatrialState(
              st.pressures,
              Array.from({ length: 15 }, (_, i) => pressureAt(time - (i * phys.valveRampMs) / 15)),
              patch,
            )
          : null,
      edv = base.edv + q.start.volume,
      esv = base.esv + q.dES,
      sv = edv - esv;
    return {
      ...base,
      pressures: st.pressures,
      volume: { lv: st.volume, rv: st.volume },
      edv,
      esv,
      sv,
      ef: (sv / edv) * 100,
      forwardSV: sv * (1 - (patch.regurgitantFraction ?? 0)),
      valves,
      ...(interatrial && { interatrial }),
      ectopy: info(desc, hr),
    };
  }
  function pvcSample(desc, t, hr, modifiers) {
    const p = pvcParams(desc, hr, modifiers),
      L = p.L,
      time = modulo(t, L),
      st = pvcState(desc, time, hr, modifiers),
      sch = p.sch,
      index = Math.max(
        0,
        sch.findIndex((x) => time >= x.start && time < x.end),
      ),
      phase = sch[index],
      r = refTime(sch, time),
      sinusTiming = p.sinusTiming,
      timing = p.timing,
      absolute = desc.start + time,
      lookup = host.lookup;
    // Lead II: the old beat's T wave runs on until the PVC; a pacing spike;
    // a wide QRS and a discordant T wave; the sinus P waves on their clock.
    const oldSince = p.c + time - sinusTiming.qrsStart,
      oldT = p.onT && oldSince <= sinusTiming.qtMs ? lookup("twave", 80 + (oldSince * 380) / sinusTiming.qtMs) : 0,
      spike = time < 1 ? 1.5 * time : time < 2 ? 1.5 * (2 - time) : 0,
      since = time - timing.qrsStart,
      qrs = since >= 0 && since <= timing.qrsDuration ? 1.3 * lookup("qrs", 80 + (since * 90) / timing.qrsDuration) : 0,
      tw = since >= 0 && since <= timing.qtMs ? -1.2 * lookup("twave", 80 + (since * 380) / timing.qtMs) : 0,
      pAge = modulo(absolute - sinusTiming.saStart, sinusTiming.atrialPeriod),
      pWave = pAge < 80 * sinusTiming.atrialScale ? lookup("p", 720 + pAge / sinusTiming.atrialScale) : 0,
      ecg = oldT + spike + qrs + tw + pWave;
    const ap = {};
    for (const [id, table] of Object.entries(baseline.actionPotentials)) {
      const atrial = ["sa", "atrial", "av"].includes(id),
        offset = atrial ? { sa: 0, atrial: 35, av: 50 }[id] : { purkinje: 0, ventricular: 10 }[id];
      let local;
      if (atrial) {
        const age = modulo(pAge - offset * sinusTiming.atrialScale, sinusTiming.atrialPeriod);
        local = id === "sa" || id === "av" ? (age / sinusTiming.atrialPeriod) * 800 : age / sinusTiming.atrialScale;
      } else {
        const own = time - timing.rapidQrsStart - offset * timing.qrsScale,
          age = own >= 0 ? own : modulo(p.c + time - sinusTiming.rapidQrsStart - offset * sinusTiming.qrsScale, p.T);
        local = age / (own >= 0 ? timing.rateScale : sinusTiming.rateScale);
      }
      ap[id] = host.lookupTable(table, Math.min(local, 799.999));
    }
    const pressureAt = lookBack(desc, hr, modifiers),
      valves = valveStates(st.pressures, pressureAt, time, patch, phys.valveRampMs),
      interatrial =
        patch.pfo || patch.asd
          ? interatrialState(
              st.pressures,
              Array.from({ length: 15 }, (_, i) => pressureAt(time - (i * phys.valveRampMs) / 15)),
              patch,
            )
          : null;
    const mechanical = time >= p.onset,
      sounds = {
        s1: mechanical ? lookup("s1", r) * Math.min(1, p.rho) : 0,
        s2:
          p.ejected && mechanical
            ? lookup("s2", r) + (patch.splitS2Ms ? 0.85 * lookup("s2", r - patch.splitS2Ms) : 0)
            : 0,
        s3: mechanical ? lookup("s3", r) * (patch.s3 ?? 0) : 0,
        s4: 0,
        murmur:
          patch.murmur && p.ejected && mechanical
            ? lookup(patch.murmur === "ejection" ? "murmurSystolic" : "murmurHolosystolic", r) *
              0.6 *
              (patch.murmurGain ?? 1)
            : 0,
      };
    const conduction = sampleConduction(time, L, timing, patch, absolute),
      preload = clamp(modifiers.preload ?? 1, 0.7, 1.4),
      afterload = clamp(modifiers.afterload ?? 1, 0.7, 1.5),
      contractility = clamp(modifiers.contractility ?? 1, 0.6, 1.6);
    return {
      referenceTime: r,
      phaseIndex: index,
      phase,
      T: L,
      t: time,
      schedule: sch,
      pressures: st.pressures,
      volume: { lv: st.volume, rv: st.volume },
      edv: p.edv,
      esv: p.esv,
      sv: p.sv,
      ef: (p.sv / p.edv) * 100,
      forwardSV: p.sv * (1 - (patch.regurgitantFraction ?? 0)),
      timing,
      absolute,
      modifiers: { preload, afterload, contractility },
      ecg,
      ap,
      sounds,
      valves,
      ...(interatrial && { interatrial }),
      conduction,
      conductionTime: conduction.saRelative,
      scenarioId: host.scenarioId,
      erp: since >= 0 && since < phys.ventricularErpMs * timing.rateScale,
      pv: {
        espvrSlope: 2.2 * (patch.contractility ?? 1) * (modifiers.contractility ?? 1) * p.strength,
        edpvrStiffness: 0.025,
        volumeIntercept: D.volumeIntercept,
      },
      atrialKick: 0,
      ectopy: info(desc, hr, p),
    };
  }
  function info(desc, hr, p) {
    // What a beat is does not depend on what follows it (a later cut).
    const base = { kind: desc.kind, beat: desc.beat, sinusBeat: desc.sinus };
    if (desc.kind === "post") return { ...base, order: desc.order, potentiation: D.potentiation[desc.order - 1] };
    if (desc.kind !== "pvc") return base;
    return {
      ...base,
      lengthMs: desc.lengthMs,
      site: desc.event.site,
      stimulusMs: desc.event.cutMs,
      latencyMs: p.timing.qrsStart,
      strength: p.strength,
      blocks: desc.event.blocks,
      mechanicalOnsetMs: p.onset,
      ejected: p.ejected,
      onT: p.onT,
    };
  }
  function baseSample(t, hr, modifiers, beatIndex) {
    const desc = describe(hr, beatIndex);
    if (!desc) return host.sinusSample(t, hr, modifiers, beatIndex);
    if (desc.kind === "pvc") return pvcSample(desc, t, hr, modifiers);
    if (desc.kind === "post") return postSample(desc, t, hr, modifiers);
    return host.sinusSample(t, hr, modifiers, desc.sinus);
  }
  // VF and shocks keep the existing beat partition. Events take effect at an
  // absolute instant inside it, so neither an earlier sample nor a PVC's past
  // is re-timed. Beats during arrest are display windows, not contractions.
  const eventTime = (e) => (describe(e.hr, e.beat)?.start ?? e.beat * host.sinusDuration(e.hr, e.beat)) + e.cutMs;
  const rhythmEvents = (hr) => events.filter((e) => e.hr === hr && e.rhythm !== "sinus");
  function rhythmAt(beat, t, hr) {
    const absolute = (describe(hr, beat)?.start ?? beat * host.sinusDuration(hr, beat)) + t;
    const e = rhythmEvents(hr)
      .filter((e) => eventTime(e) <= absolute)
      .at(-1);
    return e
      ? e.type === "shock"
        ? absolute - eventTime(e) < SHOCK_PAUSE_MS
          ? "asystole"
          : "sinus"
        : "vf"
      : patch.vf
        ? "vf"
        : "sinus";
  }
  const anchors = new Map();
  function rhythmSample(s, hr, modifiers, before = Infinity) {
    const list = rhythmEvents(hr).filter((e) => eventTime(e) <= s.absolute && eventTime(e) < before);
    const e = list.at(-1);
    if (!e && !patch.vf) return s;
    const start = e ? eventTime(e) : 0;
    const age = Math.max(0, s.absolute - start);
    const key = `${version}|${hr}|${modKey(modifiers)}|${start}|${e?.type ?? "initial"}`;
    const anchor = remember(anchors, key, 32, () => {
      const raw = e ? baseSample(e.cutMs, hr, modifiers, e.beat) : host.sinusSample(0, hr, modifiers, 0);
      return e ? rhythmSample(raw, hr, modifiers, start) : raw;
    });
    const shock = e?.type === "shock",
      recovery = shock && age >= SHOCK_PAUSE_MS;
    const rhythm = recovery ? "sinus" : shock ? "asystole" : "vf";
    const T = host.sinusDuration(hr, 0);
    const quiet = (dt) => ({
      ao: 7 + (anchor.pressures.ao - 7) * Math.exp(-dt / 1200),
      pa: 5 + (anchor.pressures.pa - 5) * Math.exp(-dt / 1200),
      lv: 6 + (anchor.pressures.lv - 6) * Math.exp(-dt / 100),
      rv: 3 + (anchor.pressures.rv - 3) * Math.exp(-dt / 100),
      la: 8 + (anchor.pressures.la - 8) * Math.exp(-dt / 200),
      ra: 5 + (anchor.pressures.ra - 5) * Math.exp(-dt / 200),
    });
    const fill = (dt) => anchor.edv + (anchor.volume.lv - anchor.edv) * Math.exp(-dt / 400);
    let out = {
      ...s,
      pressures: quiet(age),
      volume: { lv: fill(age), rv: fill(age) },
      sv: 0,
      forwardSV: 0,
      ef: 0,
      atrialKick: 0,
      erp: false,
      interatrial: undefined,
      sounds: { s1: 0, s2: 0, s3: 0, s4: 0, murmur: 0 },
      valves: Object.fromEntries(
        Object.entries(s.valves).map(([k, v]) => [k, { ...v, open: false, blend: 0, flow: 0, regurgitant: false }]),
      ),
      ap: { sa: -60, atrial: -85, av: -60, purkinje: -90, ventricular: -90 },
      conduction: { ...s.conduction, rhythm, absolute: s.absolute, ectopic: false, leftDelay: 0, rightDelay: 0 },
      ectopy: { kind: rhythm, beat: s.ectopy?.beat, rhythm, shock: !!shock, recovery, ageMs: age },
      phase: {
        id: rhythm,
        name: {
          en: rhythm === "vf" ? "Ventricular fibrillation" : "Post-shock pause",
          zh: rhythm === "vf" ? "心室颤动" : "电击后电静止",
        },
      },
    };
    const join = smooth(age / 30);
    out.ecg = shock
      ? (1 - smooth(age / 3)) * anchor.ecg +
        (age < 60 ? 3 * Math.sin((Math.PI * age) / 15) * Math.sin((Math.PI * age) / 60) ** 2 : 0)
      : anchor.ecg * (1 - join) + vfVoltage(s.absolute) * join;
    if (rhythm === "vf") {
      const tremor = 0.18 * join * Math.sin(s.absolute * 0.041);
      out.volume = { lv: fill(age) + tremor, rv: fill(age) - tremor };
      out.ap.ventricular = -45 + 25 * vfVoltage(s.absolute);
    }
    if (recovery) {
      const elapsed = age - SHOCK_PAUSE_MS,
        local = elapsed % T;
      const normal = host.sinusSample(local, hr, modifiers, Math.floor(elapsed / T));
      const gain = smooth(elapsed / (3 * T)),
        electrical = smooth(elapsed / 30);
      out = {
        ...normal,
        absolute: s.absolute,
        t: s.t,
        T: s.T,
        motionTime: local,
        motionPeriod: T,
        pressures: Object.fromEntries(
          Object.entries(normal.pressures).map(([k, v]) => [k, quiet(age)[k] * (1 - gain) + v * gain]),
        ),
        volume: {
          lv: fill(age) * (1 - gain) + normal.volume.lv * gain,
          rv: fill(age) * (1 - gain) + normal.volume.rv * gain,
        },
        sv: normal.sv * gain,
        forwardSV: normal.forwardSV * gain,
        ef: normal.ef * gain,
        ecg: normal.ecg * electrical,
        ap: normal.ap,
        sounds: Object.fromEntries(Object.entries(normal.sounds).map(([k, v]) => [k, v * gain])),
        conduction: { ...normal.conduction, rhythm: "sinus", absolute: s.absolute },
        ectopy: out.ectopy,
      };
    }
    return out;
  }
  function sample(t, hr, modifiers, beatIndex) {
    return rhythmSample(baseSample(t, hr, modifiers, beatIndex), hr, modifiers);
  }
  function addRhythmEvent(type, rhythm, beat, t, hr) {
    if (
      !Number.isInteger(beat) ||
      beat < 0 ||
      !finite(hr, 40, 180) ||
      !finite(t, 0, lengthOf(hr, beat)) ||
      t >= lengthOf(hr, beat)
    )
      throw RangeError("Invalid rhythm event.");
    t = Math.min(Math.max(t, MIN_CUT_MS), lengthOf(hr, beat) - 1e-6);
    if (events.length >= D.maxEvents) return { outcome: "disabled", reason: "event-limit" };
    const absolute = (describe(hr, beat)?.start ?? beat * host.sinusDuration(hr, beat)) + t;
    if (events.some((e) => e.hr === hr && eventTime(e) >= absolute))
      return { outcome: "disabled", reason: "past-event" };
    events.push({ type, rhythm, beat, cutMs: t, hr, site: D.site, blocks: "next" });
    bump();
    return {
      outcome: type === "shock" ? "shock" : "vf",
      beat,
      tMs: t,
      pauseMs: type === "shock" ? SHOCK_PAUSE_MS : undefined,
    };
  }
  function schedule(hr, beatIndex) {
    const desc = describe(hr, beatIndex);
    if (!desc) return host.scheduleFor(host.sinusDuration(hr, beatIndex));
    if (desc.kind === "pvc") return pvcParams(desc, hr, {}).sch.map((p) => ({ ...p }));
    const full = host.scheduleFor(desc.T);
    if (!desc.cut) return full;
    const c = desc.cut.cutMs;
    // Every phase stays listed; those after the cut have no duration.
    return full.map((p) => {
      const start = Math.min(p.start, c),
        end = Math.min(p.end, c);
      return { ...p, start, end, duration: end - start };
    });
  }

  // --- stimulus -----------------------------------------------------------
  // Time since the last ventricular excitation at (beat, t).
  // As sample().erp: the sinus QRS of this cycle, or the PVC before it.
  function sinceExcitation(hr, beat, t, desc) {
    const T = desc.T,
      timing = host.timingFor(T, host.scheduleFor(T)),
      prev = beat > 0 && t < timing.qrsStart ? describe(hr, beat - 1) : null;
    if (prev?.kind === "pvc") return { since: prev.lengthMs - pvcParams(prev, hr, {}).timing.qrsStart + t, timing };
    return { since: modulo(t - timing.qrsStart, T), timing };
  }
  function stimulate(beatIndex, t, hr, modifiers = {}, options = {}) {
    if (!Number.isInteger(beatIndex) || beatIndex < 0) throw RangeError("Invalid stimulus beat.");
    if (!finite(hr, 40, 180)) throw RangeError("Invalid stimulus rate.");
    if (disabled) return { outcome: "disabled", reason: disabled };
    if (rhythmAt(beatIndex, t, hr) !== "sinus") return { outcome: "disabled", reason: "rhythm" };
    const desc = describe(hr, beatIndex) ?? sinusDesc(hr, beatIndex);
    if (!finite(t, 0, desc.lengthMs) || t >= desc.lengthMs) throw RangeError("Stimulus outside the beat.");
    t = Math.min(Math.max(t, MIN_CUT_MS), desc.lengthMs - 1e-6);
    const tPeak =
      desc.kind === "pvc" ? pvcParams(desc, hr, modifiers).timing : host.timingFor(desc.T, host.scheduleFor(desc.T));
    const electricalPeriod = desc.kind === "pvc" ? desc.lengthMs : desc.T;
    if (
      options.vulnerable &&
      Math.abs(modulo(t - tPeak.qrsStart, electricalPeriod) - (tPeak.qtMs * 320) / 380) <= 20 + 1e-9
    )
      return addRhythmEvent("stimulus", "vf", beatIndex, t, hr);
    const erpMs = (T) => phys.ventricularErpMs * Math.sqrt(T / baseline.periodMs);
    if (desc.kind === "pvc") {
      const since = t - pvcParams(desc, hr, {}).timing.qrsStart;
      return since >= 0 && since < erpMs(desc.T)
        ? { outcome: "refractory", beat: beatIndex, tMs: t, sinceExcitationMs: since, erpMs: erpMs(desc.T) }
        : { outcome: "disabled", reason: "one-per-cycle", beat: beatIndex, tMs: t };
    }
    const { since, timing } = sinceExcitation(hr, beatIndex, t, desc);
    if (since < erpMs(desc.T))
      return { outcome: "refractory", beat: beatIndex, tMs: t, sinceExcitationMs: since, erpMs: erpMs(desc.T) };
    const blocks = t < timing.qrsStart ? "own" : "next";
    // A new stimulus replaces any later plan (the clock never goes back in a
    // lesson; a replay restores its own plan).
    if (events.length >= D.maxEvents) return { outcome: "disabled", reason: "event-limit" };
    events = events.filter((e) => !(e.hr === hr && (e.beat > beatIndex || (e.beat === beatIndex && e.cutMs >= t))));
    events.push({ type: "stimulus", rhythm: "sinus", beat: beatIndex, cutMs: t, hr, site: D.site, blocks });
    events.sort((a, b) => a.beat - b.beat);
    bump();
    const pvc = describe(hr, beatIndex + 1),
      p = pvcParams(pvc, hr, modifiers);
    return {
      outcome: "pvc",
      beat: beatIndex,
      pvcBeat: beatIndex + 1,
      tMs: t,
      sinceExcitationMs: since,
      erpMs: erpMs(desc.T),
      blocks,
      onT: p.onT,
      lengthMs: pvc.lengthMs,
      ejected: p.ejected,
      strokeVolumeMl: p.sv,
    };
  }
  const api = {
    get rhythm() {
      return events.at(-1)?.rhythm ?? (patch.vf ? "vf" : "sinus");
    },
    rhythmAt,
    vulnerablePeak(beat, hr) {
      const desc = describe(hr, beat),
        T = desc?.T ?? host.sinusDuration(hr, beat),
        tm = desc?.kind === "pvc" ? pvcParams(desc, hr, {}).timing : host.timingFor(T, host.scheduleFor(T));
      return modulo(tm.qrsStart + (tm.qtMs * 320) / 380, desc?.kind === "pvc" ? desc.lengthMs : T);
    },
    fibrillate(beat, t, hr) {
      return addRhythmEvent("stimulus", "vf", beat, t, hr);
    },
    shock(beat, t, hr) {
      if (rhythmAt(beat, t, hr) !== "vf") return { outcome: "not-advised", beat, tMs: t };
      return addRhythmEvent("shock", "asystole", beat, t, hr);
    },
    disabledReason: disabled,
    get version() {
      return version;
    },
    get events() {
      return events.map((e) => ({ ...e }));
    },
    get active() {
      return events.length > 0 || !!patch.vf;
    },
    stimulate,
    clear() {
      if (!events.length) return;
      events = [];
      bump();
    },
    describe(hr, beatIndex) {
      const d = describe(hr, beatIndex) ?? sinusDesc(hr, beatIndex);
      return info(d, hr, d.kind === "pvc" ? pvcParams(d, hr, {}) : undefined);
    },
    // Plain JSON for replays and exports (replay.js REPLAY_STATE_KEYS ectopy).
    snapshot() {
      return {
        version: ECTOPY_VERSION,
        rhythm: api.rhythm,
        ...Object.fromEntries(Object.entries(EVENT_COLUMNS).map(([k, c]) => [c, events.map((e) => e[k])])),
      };
    },
    restore(state) {
      if (!validEctopyState(state)) throw Error("Invalid ectopy state.");
      const next = state === null ? [] : ectopyEvents(state);
      if (disabled && next.length) throw Error("Ectopic stimuli are disabled in this scenario.");
      events = next;
      bump();
    },
  };
  return { api, sample, schedule, lengthOf, describe };
}

// Reference (template) time of time t in a schedule, as waveforms.js
// mappedTime, and its inverse. ref: the baseline's phase boundaries.
function referenceTime(ref, schedule, t) {
  let i = schedule.findIndex((p) => t >= p.start && t < p.end);
  if (i < 0) i = t < schedule[0].start ? 0 : schedule.length - 1;
  const p = schedule[i];
  return ref[i] + ((clamp(t, p.start, p.end) - p.start) / (p.duration || 1)) * (ref[i + 1] - ref[i]);
}
function scheduleTime(ref, schedule, r) {
  let i = ref.findIndex((x, j) => j < schedule.length && r >= x && r < ref[j + 1]);
  if (i < 0) i = r < ref[0] ? 0 : schedule.length - 1;
  const p = schedule[i];
  return p.start + ((clamp(r, ref[i], ref[i + 1]) - ref[i]) / (ref[i + 1] - ref[i])) * p.duration;
}
