// CC-53: chest-lead (V1–V6) morphology as a small set of timed cardiac
// dipoles. A scenario's spec = the normal dipole set, then the modifiers its
// patch implies (bundle-branch delay, pre-excitation, AF, ventricular escape),
// then the modifiers declared in content/ecg12/<id>.json. Timing is never
// set here: every window is placed on the engine's own clocks by ecg12.js.
//
// Units: amplitudes in mV along the dipole direction (x = patient's left,
// y = inferior, z = anterior). QRS windows are ms on the rate-independent QRS
// timeline (0 … conduction baseQrs); P windows are fractions of the P wave;
// T windows are fractions of QT measured from QRS onset; ST windows start at
// the J point. Each lobe is a raised-cosine pulse, exactly zero outside its
// window, so the derived leads start and stop where the engine says.

const lobe = (dir, amp, from, to, peak = 0.5, shape = "lobe") => ({
  dir,
  amp,
  from,
  to,
  peak,
  shape,
});

/** The normal dipole set (QRS 90 ms, P 80 ms at the reference rate). */
export function normalDipoles() {
  return {
    p: {
      ra: lobe([0.25, 0.85, 0.45], 0.2, 0, 0.7),
      la: lobe([0.75, 0.35, -0.55], 0.14, 0.3, 1),
    },
    pScale: 1,
    qrs: {
      septal: lobe([-0.55, 0.15, 0.8], 0.3, 0, 24, 0.42),
      main: lobe([0.8, 0.5, -0.28], 1.45, 8, 54),
      late: lobe([-0.35, -0.55, -0.6], 0.42, 40, 90, 0.5),
    },
    t: { main: lobe([0.62, 0.6, 0.28], 0.32, 0.55, 1, 0.62) },
    st: {},
    fib: null,
  };
}

const PREEXCITATION_SITES = {
  // Type A: an anterior, slightly superior initial vector (positive delta in V1–V6).
  leftPosterior: [0.15, -0.25, 0.95],
  // Lateral pathway: a rightward initial vector (negative delta in I, aVL, V6).
  leftLateral: [-0.5, 0.4, 0.75],
};

/**
 * Registry: id → { apply(spec, params, patch), auto?(patch) → params|null }.
 * `auto` marks a modifier the scenario patch already implies; a declared
 * entry with the same id only overrides its parameters.
 */
export const MODIFIERS = {
  rightBundleDelay: {
    auto: (p) => (p.block === "right" ? {} : null),
    apply(s, m, p) {
      const d = p.branchDelayMs ?? 60;
      s.qrs.late.amp = 0.22;
      s.qrs.terminal = lobe([-0.75, 0.15, 0.64], 0.8, 88, 90 + d);
      s.t = { main: lobe([0.75, 0.5, -0.38], 0.28, 0.55, 1, 0.62) };
    },
  },
  leftBundleDelay: {
    auto: (p) => (p.block === "left" ? {} : null),
    apply(s, m, p) {
      const d = p.branchDelayMs ?? 70;
      s.qrs = {
        septal: lobe([0.7, 0.1, -0.7], 0.25, 0, 34),
        main: lobe([0.82, 0.35, -0.45], 1.2, 8, 96),
        main2: lobe([0.8, 0.4, -0.45], 1.3, Math.min(70, 90 + d - 50), 90 + d),
      };
      s.t = { main: lobe([-0.62, -0.25, 0.55], 0.36, 0.55, 1, 0.62) };
    },
  },
  preexcitation: {
    auto: (p) => (p.accessoryPathway ? {} : null),
    apply(s, m, p) {
      const adv = p.accessoryAdvanceMs ?? 45;
      for (const c of Object.values(s.qrs)) {
        c.from += adv;
        c.to += adv;
      }
      s.qrs.septal.amp = 0.1;
      s.qrs.delta = lobe(
        PREEXCITATION_SITES[m.site ?? "leftPosterior"],
        0.5,
        0,
        adv + 35,
        adv / (adv + 35),
        "ramp",
      );
      s.t.main.amp = 0.2;
      s.t.secondary = lobe([0.2, 0.3, -0.8], 0.12, 0.38, 1, 0.7);
    },
  },
  fibrillatoryWaves: {
    auto: (p) => (p.atrialFibrillation ? {} : null),
    apply(s, m) {
      s.p = {};
      s.fib = { dir: [-0.55, 0.4, 0.73], amp: m.amplitudeMv ?? 0.09 };
    },
  },
  ventricularEscape: {
    auto: (p) =>
      p.completeBlock && (p.escapeQrsMs ?? 0) >= 120 ? { origin: "rv" } : null,
    apply(s, m, p) {
      // CC-59: a premature ventricular beat (content/ecg12/ectopic.json) gives its own width.
      const e = m.qrsMs ?? p.escapeQrsMs ?? 140,
        rv = (m.origin ?? "rv") === "rv";
      // An RV focus activates the LV late (LBBB-like); an LV focus the reverse.
      s.qrs = {
        initial: lobe(rv ? [-0.3, -0.1, 0.6] : [0.6, 0.1, -0.3], 0.15, 0, 30),
        main: lobe(rv ? [0.78, 0.3, -0.55] : [-0.6, 0.35, 0.7], 1.35, 12, e),
      };
      s.t = {
        main: lobe(
          rv ? [-0.6, -0.3, 0.5] : [0.6, -0.2, -0.6],
          0.32,
          0.55,
          1,
          0.62,
        ),
      };
    },
  },
  lvh: {
    apply(s, m) {
      const volume = m.kind === "volume";
      s.qrs.main.amp *= m.voltage ?? 1.7;
      s.qrs.main.dir = volume ? [0.8, 0.45, -0.4] : [0.72, 0.42, -0.55];
      s.qrs.septal.amp *= volume ? 1.2 : 0.8;
      if (volume) s.t.main.amp = 0.42;
    },
  },
  lvStrain: {
    apply(s) {
      const dir = [-0.6, 0.35, 0.5];
      s.t = { main: lobe(dir, 0.3, 0.55, 1, 0.62) };
      s.st.strain = {
        dir: [-0.85, 0.1, 0.5],
        amp: 0.12,
        shape: "plateau",
        toQt: 0.75,
      };
    },
  },
  laEnlargement: {
    apply(s, m) {
      const mild = m.severity === "mild";
      s.p.la.amp *= mild ? 1.6 : 2.4;
      s.p.la.from = 0.36;
      s.pScale = mild ? 1.12 : 1.45;
    },
  },
  rvVolumeLoad: {
    apply(s) {
      s.qrs.main.dir = [0.18, 0.93, -0.3];
      s.qrs.main.amp = 1.3;
      s.qrs.late.amp = 0.2;
      s.qrs.rPrime = lobe([-0.72, 0.1, 0.68], 0.38, 64, 90);
    },
  },
  poorRProgression: {
    apply(s) {
      s.qrs.septal.amp = 0.04;
      s.qrs.main.dir = [0.86, 0.38, -0.4];
      s.qrs.main.amp = 1.1;
      s.t = { main: lobe([0.3, 0.7, 0], 0.12, 0.55, 1, 0.62) };
    },
  },
  physiologicJDepression: {
    apply(s) {
      s.st.j = {
        dir: [-0.8, -0.5, 0.25],
        amp: 0.14,
        shape: "decay",
        durationMs: 80,
      };
      s.t.main.amp = 0.3;
    },
  },
};

/** Modifier list in application order: patch-implied first, then declared. */
export function resolveModifiers(patch = {}, declared = []) {
  const list = [];
  for (const [id, mod] of Object.entries(MODIFIERS)) {
    const params = mod.auto?.(patch);
    if (params) list.push({ id, ...params, source: "auto" });
  }
  for (const entry of declared) {
    if (!MODIFIERS[entry.id])
      throw new Error(`Unknown ECG modifier: ${entry.id}`);
    const auto = list.find((m) => m.id === entry.id);
    if (auto) Object.assign(auto, entry, { source: "auto+declared" });
    else list.push({ ...entry, source: "declared" });
  }
  return list;
}
