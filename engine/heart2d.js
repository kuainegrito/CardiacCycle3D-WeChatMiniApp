// Copied by tools/sync-from-web.mjs from js/heart2d.js; only this line is added.
import { document } from "./mp-dom.js";
// CC-30: the 2D heart. An original frontal-section drawing in the style of the
// classic textbook animation the owner sent (a GIF of unknown licence: nothing
// is copied, traced or embedded; the layout was measured as landmarks and
// every outline below is hand-placed control points), driven by the lab's own
// model on the shared clock: each chamber is drawn between a small and a large
// outline in proportion to its model volume (the same volumes the 3D atlas
// holds), and each valve between closed and open by the same blended valve
// state. It needs no WebGL, so it is also the heart shown when 3D graphics are
// unavailable. Teaching illustration, not measured anatomy.
import { ventricularVolumes } from "./ventricular-timing.js";
import { atrialVolumeTargets } from "./atrial-targets.js";
import { diseasedValveBlends, stenosisLevel } from "./valve-disease.js";

export const HEART2D_VERSION = 4;
const SVG = "http://www.w3.org/2000/svg";

// Volume (mL) drawn as the small (s = 0) and large (s = 1) outline. Normal
// 75 bpm ranges: ventricles 50-120 mL, LA 44-73 mL, RA 79-109 mL. Larger or
// smaller volumes extrapolate (a dilated HFrEF ventricle is drawn larger),
// within LIMITS.
export const VOLUME_RANGE = Object.freeze({
  LV: [50, 120],
  RV: [50, 120],
  LA: [44, 73],
  RA: [79, 109],
});
const LIMITS = [-0.35, 1.9];

// CC-47 (owner, 2026-10-10: the stenotic valve looked soft and opened too
// wide): calcified aortic cusps do not bend. Each keeps its closed shape and
// swings about its hinge as one rigid piece, by at most STENOTIC_SWING at the
// model's capped excursion; the second (fused) cusp swings only
// STENOTIC_SECOND of that, so the orifice is narrow and eccentric (about a
// third of the normal opening between the drawn cusps). They are drawn
// thicker, in a calcified colour, with nodules.
export const STENOTIC_SWING = (75 * Math.PI) / 180;
export const STENOTIC_SECOND = 0.8;

// A point drawn at small + s * (large - small) of its chamber's driver; a
// point without a driver is fixed. [x, y] pairs in a 640 x 800 view box.
const P = (small, large = small, driver = null) => ({ small, large, driver });
const RA = (small, large) => P(small, large, "RA"),
  RV = (small, large) => P(small, large, "RV"),
  LA = (small, large) => P(small, large, "LA"),
  LV = (small, large) => P(small, large, "LV");

// Valve annuli (fixed): tricuspid lateral T1 and septal T2 hinges, mitral
// aortic-side M1 and lateral M2 hinges, the aortic and pulmonary cusp hinges.
const T1 = [130, 513],
  T2 = [247, 448],
  M1 = [340, 387],
  M2 = [475, 326],
  AO = [
    [210, 338],
    [252, 342],
  ],
  PU = [
    [258, 398],
    [322, 398],
  ];
// Where the closed mitral leaflets lie: the boundary of the left atrium and
// the left ventricle, and the middle of the tricuspid annulus.
const MITRAL_LINE = [P([380, 397]), P([441, 391])];
const TRICUSPID_MID = P([190, 490]);

// Myocardium: the heart's outer outline, clockwise from the top of the right
// atrium. Wall thickness is the gap to the cavities below.
const SHELL = [
  RA([176, 284], [166, 270]),
  RA([130, 300], [122, 283]),
  RA([100, 346], [88, 322]),
  RA([88, 403], [72, 392]),
  RA([92, 456], [76, 446]),
  RA([112, 498], [100, 494]),
  RV([140, 540], [132, 534]),
  RV([185, 586], [172, 580]),
  RV([240, 626], [225, 628]),
  RV([300, 652], [285, 668]),
  RV([365, 672], [355, 690]),
  RV([420, 682], [413, 702]),
  LV([472, 682], [467, 708]),
  LV([530, 676], [540, 702]),
  LV([562, 648], [595, 682]),
  LV([574, 600], [618, 640]),
  LV([574, 556], [628, 588]),
  LV([566, 515], [622, 536]),
  LV([541, 468], [603, 481]),
  LV([514, 420], [577, 428]),
  LV([493, 380], [548, 380]),
  LV([480, 346], [514, 340]),
  LA([473, 316], [497, 308]),
  LA([458, 281], [477, 274]),
  LA([433, 246], [452, 248]),
  LA([401, 225], [425, 228]),
  LA([373, 225], [392, 221]),
  LA([353, 237], [366, 229]),
  P([320, 258]),
  P([262, 252]),
  P([215, 258]),
  P([185, 268]),
];
const CAVITIES = {
  RA: [
    RA([128, 318], [118, 304]),
    RA([160, 303], [150, 291]),
    RA([198, 299], [196, 288]),
    P([234, 332]),
    P([248, 396]),
    P(T2),
    TRICUSPID_MID,
    P(T1),
    RA([106, 494], [100, 492]),
    RA([98, 446], [86, 448]),
    RA([100, 398], [84, 396]),
    RA([108, 350], [90, 346]),
  ],
  RV: [
    P(T1),
    RV([155, 542], [144, 540]),
    RV([195, 577], [182, 580]),
    RV([250, 610], [236, 618]),
    RV([309, 631], [294, 650]),
    RV([370, 648], [354, 674]),
    RV([421, 655], [410, 686]),
    RV([438, 648], [472, 672]),
    RV([447, 631], [490, 652]),
    RV([435, 614], [472, 637]),
    RV([401, 598], [432, 619]),
    RV([378, 581], [398, 598]),
    RV([355, 563], [366, 570]),
    RV([335, 549], [336, 552]),
    P([329, 500]),
    P([327, 462]),
    P([300, 456]),
    P(T2),
    TRICUSPID_MID,
  ],
  LA: [
    P(M1),
    P([336, 350]),
    P([338, 306]),
    LA([354, 264], [352, 257]),
    LA([378, 247], [375, 238]),
    LA([408, 240], [404, 230]),
    LA([438, 258], [446, 247]),
    LA([460, 290], [469, 284]),
    LA([472, 318], [481, 314]),
    P(M2),
    MITRAL_LINE[1],
    MITRAL_LINE[0],
  ],
  LV: [
    P(M2),
    LV([491, 344], [496, 344]),
    LV([500, 399], [522, 400]),
    LV([508, 453], [547, 452]),
    LV([521, 505], [573, 505]),
    LV([535, 556], [588, 552]),
    LV([530, 581], [589, 584]),
    LV([501, 590], [553, 602]),
    LV([466, 576], [506, 594]),
    LV([426, 548], [459, 573]),
    LV([387, 512], [415, 543]),
    LV([357, 477], [375, 502]),
    LV([343, 453], [352, 466]),
    P([333, 425]),
    P(M1),
    MITRAL_LINE[0],
    MITRAL_LINE[1],
  ],
};
// Papillary muscles: [base, tip] for small and large ventricles.
const MUSCLES = {
  "RV-anterior": {
    driver: "RV",
    small: [
      [320, 636],
      [244, 588],
    ],
    large: [
      [312, 656],
      [236, 596],
    ],
  },
  "RV-posterior": {
    driver: "RV",
    small: [
      [402, 596],
      [336, 562],
    ],
    large: [
      [412, 616],
      [334, 568],
    ],
  },
  "LV-anterolateral": {
    driver: "LV",
    small: [
      [528, 500],
      [506, 452],
    ],
    large: [
      [548, 512],
      [514, 450],
    ],
  },
  "LV-posteromedial": {
    driver: "LV",
    small: [
      [474, 572],
      [448, 498],
    ],
    large: [
      [484, 592],
      [452, 500],
    ],
  },
};
// AV leaflets: hinge, then the tip and control point of the curve when closed
// (the leaflets meet and bow toward the atrium) and when open (hanging into
// the ventricle), and the muscles their chordae reach.
const LEAFLETS = {
  "tricuspid-anterior": {
    valve: "tricuspid",
    hinge: T1,
    closed: { tip: [192, 505], control: [160, 513] },
    open: { tip: [197, 536], control: [165, 514] },
    muscles: ["RV-anterior"],
  },
  "tricuspid-septal": {
    valve: "tricuspid",
    hinge: T2,
    closed: { tip: [192, 505], control: [228, 482] },
    open: { tip: [252, 510], control: [236, 480] },
    muscles: ["RV-posterior"],
  },
  "mitral-anterior": {
    valve: "mitral",
    hinge: M1,
    closed: { tip: [410, 396], control: [372, 401] },
    open: { tip: [430, 436], control: [372, 399] },
    muscles: ["LV-posteromedial", "LV-anterolateral"],
  },
  "mitral-posterior": {
    valve: "mitral",
    hinge: M2,
    closed: { tip: [410, 396], control: [456, 394] },
    open: { tip: [481, 398], control: [474, 362] },
    muscles: ["LV-anterolateral"],
  },
};

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ease = (t) => t * t * (3 - 2 * t);

// CC-32: mitral regurgitation. The leak is the model's own reverse flow
// through the mitral valve (valves.js: -sqrt(LV-LA gradient) x regurgitant
// fraction; about -3.7 at its largest in the Mitral regurgitation scenario),
// so it is holosystolic and follows the pressure difference, not the
// ventricle's volume. LEAK_REFERENCE is the flow drawn as a full jet.
export const LEAK_REFERENCE = 3.7;
const JET_ORIFICE = [410, 393];
export function leakStrength(sample) {
  const v = sample?.valves?.mitral;
  return v && v.regurgitant && v.flow < 0
    ? clamp(-v.flow / LEAK_REFERENCE, 0, 1)
    : 0;
}

// The jet as plain data: a centre line from the closed leaflets back into the
// left atrium (a quadratic curve that leans toward the back wall), and the
// jet's width at the orifice and at its head.
export function jetGeometry(strength) {
  if (!(strength > 0.02)) return null;
  const length = 26 + 84 * strength,
    base = JET_ORIFICE,
    tip = [base[0] - 5 - 12 * strength, base[1] - length],
    control = [base[0] + 7 * strength, base[1] - length * 0.55];
  return {
    strength,
    base,
    control,
    tip,
    startWidth: 3 + 3 * strength,
    endWidth: 9 + 17 * strength,
  };
}

// Where a point is drawn for the chamber parameters s.
export function place(point, s) {
  if (!point.driver) return point.small;
  return mix(point.small, point.large, s[point.driver]);
}

// Closed smooth path through points (centripetal-free Catmull-Rom, tension
// 0.5) as cubic Beziers.
export function smoothPath(points) {
  const n = points.length,
    f = (v) => Math.round(v * 10) / 10;
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n],
      p1 = points[i],
      p2 = points[(i + 1) % n],
      p3 = points[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + "Z";
}

// Same rule as valve-motion.js sampleValveMotion (kept here so the 2D heart
// does not load three.js): each valve follows its own ventricle's delay, and
// closure finishes AT the event (forward window of the valve ramp).
export function valveBlends(
  model,
  sample,
  t,
  hr,
  modifiers = {},
  beatIndex = 0,
) {
  const { leftDelay = 0, rightDelay = 0 } = sample.conduction ?? {};
  const ramp = model.baseline.physiology.valveRampMs ?? 15;
  const at = new Map([[0, sample]]);
  const get = (offset) => {
    if (!at.has(offset))
      at.set(offset, model.sample(t + offset, hr, modifiers, beatIndex));
    return at.get(offset);
  };
  const out = {};
  for (const [valve, left] of [
    ["aortic", true],
    ["mitral", true],
    ["pulmonary", false],
    ["tricuspid", false],
  ]) {
    const offset = -(left ? leftDelay : rightDelay);
    const state = get(offset).valves[valve],
      future = get(offset + ramp).valves[valve];
    // maxOpening (valves.js): a stenotic valve opens with the same timing but
    // only part of the full excursion.
    out[valve] = state.open
      ? clamp(
          Math.min(state.blend, future.blend) * (state.maxOpening ?? 1),
          0,
          1,
        )
      : 0;
  }
  return out;
}

// Everything the drawing needs at one instant: chamber parameters, volumes
// and valve blends. Pure; the same instant always gives the same picture.
export function heart2dState({
  model,
  sample,
  t,
  hr,
  beatIndex = 0,
  modifiers = {},
  atrialSettings,
}) {
  const ventricles = ventricularVolumes(
    model,
    sample,
    t,
    hr,
    modifiers,
    beatIndex,
  );
  const atria = atrialSettings
    ? atrialVolumeTargets(
        model,
        sample,
        t,
        hr,
        modifiers,
        beatIndex,
        atrialSettings,
      )
    : { LA: VOLUME_RANGE.LA[1], RA: VOLUME_RANGE.RA[1] };
  const volumes = { ...ventricles, ...atria };
  const s = {};
  for (const [chamber, [small, large]] of Object.entries(VOLUME_RANGE))
    s[chamber] = clamp((volumes[chamber] - small) / (large - small), ...LIMITS);
  return {
    s,
    volumes,
    // CC-45: what is drawn keeps the leak gap and the stiff stenotic opening.
    valves: diseasedValveBlends(
      valveBlends(model, sample, t, hr, modifiers, beatIndex),
      sample,
    ),
    leak: leakStrength(sample),
    stenosis: {
      level: stenosisLevel(sample),
      maxOpening: sample.valves?.aortic?.maxOpening ?? 1,
    },
  };
}

// Geometry for one state, as plain data (tested without a DOM).
export function heart2dGeometry({ s, valves, leak = 0, stenosis = null }) {
  const at = (point) => place(point, s);
  const muscles = Object.fromEntries(
    Object.entries(MUSCLES).map(([id, m]) => {
      const k = s[m.driver];
      return [
        id,
        {
          base: mix(m.small[0], m.large[0], k),
          tip: mix(m.small[1], m.large[1], k),
        },
      ];
    }),
  );
  const leaflets = Object.fromEntries(
    Object.entries(LEAFLETS).map(([id, l]) => {
      // Closed: the leaflets meet and bow toward the atrium. Open: they hang
      // into the ventricle. In between, the curve is the blend of the two.
      const open = ease(valves[l.valve] ?? 0);
      return [
        id,
        {
          hinge: l.hinge,
          tip: mix(l.closed.tip, l.open.tip, open),
          control: mix(l.closed.control, l.open.control, open),
          muscles: l.muscles,
        },
      ];
    }),
  );
  // Semilunar cusps: closed they meet in the middle of the root, bulging
  // toward the ventricle; open they fold up against the root's walls.
  const cusps = (valve, [a, b], stiff = null) => {
    const open = ease(valves[valve] ?? 0),
      centre = mix(a, b, 0.5);
    const closedTip = [centre[0], centre[1] + 4],
      openTip = (p, side) => [p[0] + side * 4, p[1] - 34];
    return [a, b].map((hinge, i) => {
      const side = i ? -1 : 1;
      const closedControl = [mix(hinge, closedTip, 0.5)[0], hinge[1] + 20];
      let tip = mix(closedTip, openTip(hinge, side), open);
      let control = mix(
        closedControl,
        [hinge[0] + side * 12, hinge[1] - 14],
        open,
      );
      if (stiff) {
        // Its own excursion (0..1 of the capped opening) turns the rigid
        // closed cusp toward the outflow (up): counter-clockwise on the left.
        const x = ease(clamp((valves[valve] ?? 0) / stiff.maxOpening, 0, 1));
        const angle = -side * STENOTIC_SWING * (i ? STENOTIC_SECOND : 1) * x;
        tip = mix(tip, rotate(closedTip, hinge, angle), stiff.level);
        control = mix(control, rotate(closedControl, hinge, angle), stiff.level);
      }
      return { hinge, tip, control, calcified: !!stiff };
    });
  };
  const stiff = stenosis?.level > 0 && stenosis.maxOpening > 0 ? stenosis : null;
  return {
    shell: smoothPath(SHELL.map(at)),
    cavities: Object.fromEntries(
      Object.entries(CAVITIES).map(([id, pts]) => [
        id,
        smoothPath(pts.map(at)),
      ]),
    ),
    muscles,
    leaflets,
    jet: jetGeometry(leak),
    aortic: cusps("aortic", AO, stiff),
    pulmonary: cusps("pulmonary", PU),
    // Orifices move with the atrial walls around them.
    orifices: {
      SVC: mix([166, 335], [162, 330], s.RA),
      IVC: mix([164, 474], [160, 476], s.RA),
      veins: [
        [416, 266],
        [441, 304],
        [375, 343],
        [350, 308],
      ].map(([x, y], i) => [
        x + (i % 2 ? 5 : -5) * (s.LA - 0.5),
        y - 9 * (s.LA - 0.5),
      ]),
    },
  };
}

const rotate = (p, about, angle) => {
  const dx = p[0] - about[0],
    dy = p[1] - about[1],
    c = Math.cos(angle),
    sn = Math.sin(angle);
  return [about[0] + dx * c - dy * sn, about[1] + dx * sn + dy * c];
};
const quad = (a, c, b) => `M${a[0]},${a[1]}Q${c[0]},${c[1]} ${b[0]},${b[1]}`;
const point = (a, c, b, t) => [
  (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
  (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];

// Outline of the jet: sample the centre line and offset it by the width that
// grows toward the head, closing the head with a rounded point.
export function jetOutline(jet, steps = 8) {
  const left = [],
    right = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      [x, y] = point(jet.base, jet.control, jet.tip, t),
      [x2, y2] = point(jet.base, jet.control, jet.tip, Math.min(1, t + 0.01)),
      [x1, y1] = point(jet.base, jet.control, jet.tip, Math.max(0, t - 0.01)),
      len = Math.hypot(x2 - x1, y2 - y1) || 1,
      nx = -(y2 - y1) / len,
      ny = (x2 - x1) / len,
      w = (jet.startWidth + (jet.endWidth - jet.startWidth) * t ** 0.8) / 2;
    left.push([x + nx * w, y + ny * w]);
    right.push([x - nx * w, y - ny * w]);
  }
  const head = point(jet.base, jet.control, jet.tip, 1),
    cap = [head[0], head[1] - jet.endWidth * 0.45];
  return [...left, cap, ...right.reverse()];
}

// The structures a learner can pick, with the keys of assets/heart-labels.
export const HEART2D_STRUCTURES = Object.freeze([
  "RA",
  "RV",
  "LA",
  "LV",
  "IVS",
  "tricuspid",
  "mitral",
  "aortic",
  "pulmonary",
  "aorta",
  "pulmonary_trunk",
  "SVC",
  "IVC",
]);

// Blood colours of the four chambers. "classic" follows the textbook
// animation (mauve right heart, salmon left); "safe" separates the sides by
// brightness as well as hue (CIE L* differs by more than 15), like the
// realistic heart's colour-blind-safe variant. Top and bottom gradient stops.
export const PALETTES = Object.freeze({
  classic: {
    right: ["#cda2b6", "#c58fa7"],
    left: ["#e69797", "#de7e7e"],
    leftAtrium: ["#f0b0b0", "#e49090"],
  },
  safe: {
    right: ["#bc90ad", "#a47a9d"],
    left: ["#f8bab4", "#f0a09b"],
    leftAtrium: ["#fbcac4", "#f4aca7"],
  },
});

function el(name, attributes = {}, parent = null) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

const COLOURS = {
  red: "#e05050",
  redLight: "#ef8f8f",
  redOstium: "#c25456",
  blue: "#6699cc",
  blueEdge: "#3d6a9c",
  blueLight: "#83afdb",
  blueOpening: "#5b8dc7",
  shell: "#ffcccc",
  shellEdge: "#f19999",
  valve: "#fffdfb",
  valveShadow: "#4a3a45",
  calcified: "#f1e4c3",
  calcium: "#e2cb8c",
  calciumEdge: "#9c8350",
};

// Static drawing (vessels behind and in front of the heart), built once.
// Every vessel is a filled shape, as in the textbook drawing; blue vessels
// carry a thin dark edge, red ones do not.
function shape(parent, d, fill, structure, extra = {}) {
  return el(
    "path",
    {
      d,
      fill,
      class: "h2d-pick",
      "data-structure": structure,
      ...extra,
    },
    parent,
  );
}
function stub(parent, d, width, fill, structure) {
  return el(
    "path",
    {
      d,
      fill: "none",
      stroke: fill,
      "stroke-width": width,
      "stroke-linecap": "round",
      class: "h2d-pick",
      "data-structure": structure,
    },
    parent,
  );
}
function highlight(parent, d, width, colour, opacity = 0.8) {
  return el(
    "path",
    {
      d,
      fill: "none",
      stroke: colour,
      "stroke-width": width,
      "stroke-linecap": "round",
      opacity,
      "pointer-events": "none",
    },
    parent,
  );
}

export class Heart2DView {
  constructor(
    container,
    {
      labels = {},
      notes = {},
      language = "en",
      readJSON = null,
      onPick = () => {},
    } = {},
  ) {
    this.container = container;
    this.labels = labels;
    this.notes = notes;
    this.language = language;
    this.readJSON = readJSON;
    this.onPick = onPick;
    this.meshes = [...HEART2D_STRUCTURES];
    this.selection = null;
    this.state = null;
    this.frame = null;
    this.visual = { colorSafe: true };
  }

  async init() {
    this.atrialSettings = this.readJSON
      ? await this.readJSON("atlas-atrial-volume.json")
      : null;
    const svg = (this.svg = el("svg", {
      viewBox: "0 0 640 800",
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      class: "heart2d",
      "aria-labelledby": "heart2d-title heart2d-desc",
      focusable: "false",
    }));
    this.title = el("title", { id: "heart2d-title" }, svg);
    this.desc = el("desc", { id: "heart2d-desc" }, svg);
    const defs = el("defs", {}, svg);
    this.stops = {};
    const gradient = (id, key) => {
      const g = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      this.stops[key] = [
        el("stop", { offset: "0" }, g),
        el("stop", { offset: "1" }, g),
      ];
    };
    gradient("h2d-right", "right");
    gradient("h2d-left", "left");
    gradient("h2d-left-atrium", "leftAtrium");
    const root = el(
      "linearGradient",
      { id: "h2d-root", x1: 0, y1: 0, x2: 0, y2: 1 },
      defs,
    );
    el("stop", { offset: "0", "stop-color": "#c3d5ee" }, root);
    el("stop", { offset: "0.25", "stop-color": "#a9bfe7" }, root);
    el("stop", { offset: "1", "stop-color": "#b4c8ea" }, root);
    const ostium = el(
      "radialGradient",
      { id: "h2d-ostium", cx: 0.5, cy: 0.5, r: 0.6 },
      defs,
    );
    el("stop", { offset: "0", "stop-color": "#b8494c" }, ostium);
    el("stop", { offset: "1", "stop-color": "#d27375" }, ostium);
    const shadow = el(
      "filter",
      { id: "h2d-shadow", x: "-10%", y: "-10%", width: "125%", height: "125%" },
      defs,
    );
    el(
      "feDropShadow",
      {
        dx: 4,
        dy: 7,
        stdDeviation: 5,
        "flood-color": "#000",
        "flood-opacity": 0.3,
      },
      shadow,
    );
    this.applyPalette();
    const C = COLOURS;
    // Behind the heart: descending aorta, IVC, SVC, right pulmonary artery,
    // pulmonary veins, the aortic arch and its branches.
    const back = el("g", { filter: "url(#h2d-shadow)" }, svg);
    shape(back, "M318 640L318 784Q365 802 412 784L412 640Z", C.red, "aorta");
    el(
      "rect",
      {
        x: 335,
        y: 716,
        width: 12,
        height: 56,
        rx: 6,
        fill: C.redLight,
        opacity: 0.85,
        "pointer-events": "none",
      },
      back,
    );
    shape(
      back,
      "M112 480L126 668Q166 692 207 668L207 560L192 480Z",
      C.blue,
      "IVC",
      {
        stroke: C.blueEdge,
        "stroke-width": 1.2,
      },
    );
    el(
      "rect",
      {
        x: 132,
        y: 600,
        width: 13,
        height: 56,
        rx: 6.5,
        fill: C.blueLight,
        opacity: 0.55,
        "pointer-events": "none",
      },
      back,
    );
    shape(back, "M122 186A38 9 0 0 1 198 186L198 310L116 310Z", C.blue, "SVC", {
      stroke: C.blueEdge,
      "stroke-width": 1.2,
    });
    shape(
      back,
      "M205 104L160 89Q150 89 150 100L151 113L173 123L152 128Q144 131 144 141L146 151L192 169Z",
      C.blue,
      "pulmonary_trunk",
      {
        stroke: C.blueEdge,
        "stroke-width": 1.2,
      },
    );
    for (const d of [
      "M30 363L112 357",
      "M30 414L112 408",
      "M450 238L500 222",
      "M482 289L524 271",
    ])
      stub(back, d, d.startsWith("M4") ? 30 : 38, C.red, "LA");
    shape(
      back,
      "M164 262C158 188 166 118 230 80C262 62 286 56 305 56C352 56 396 72 418 132C432 168 438 198 438 242L438 266Z",
      C.red,
      "aorta",
    );
    for (const d of ["M236 82L220 38", "M285 62L281 26", "M333 60L343 28"])
      stub(back, d, 27, C.red, "aorta");
    highlight(back, "M233 125C252 106 281 93 316 91", 11, C.redLight, 0.8);
    // The open end of the superior vena cava lies in front of the arch.
    el(
      "ellipse",
      {
        cx: 160,
        cy: 186,
        rx: 38,
        ry: 9,
        fill: C.blueOpening,
        stroke: "#a9c6e6",
        "stroke-width": 3.5,
        class: "h2d-pick",
        "data-structure": "SVC",
      },
      svg,
    );
    // The heart.
    const heart = el("g", {}, svg);
    this.shell = el(
      "path",
      {
        fill: C.shell,
        stroke: C.shellEdge,
        "stroke-width": 1.8,
        filter: "url(#h2d-shadow)",
        class: "h2d-pick",
        "data-structure": "IVS",
      },
      heart,
    );
    this.cavity = {};
    for (const [id, fill] of [
      ["RA", "url(#h2d-right)"],
      ["RV", "url(#h2d-right)"],
      ["LA", "url(#h2d-left-atrium)"],
      ["LV", "url(#h2d-left)"],
    ])
      this.cavity[id] = el(
        "path",
        {
          fill,
          stroke: "#e08b97",
          "stroke-width": 1.2,
          class: "h2d-pick",
          "data-structure": id,
        },
        heart,
      );
    this.orifice = {
      SVC: el(
        "ellipse",
        {
          rx: 38,
          ry: 11,
          fill: C.blueOpening,
          "pointer-events": "all",
          class: "h2d-pick",
          "data-structure": "SVC",
        },
        heart,
      ),
      IVC: el(
        "ellipse",
        {
          rx: 40,
          ry: 12,
          fill: C.blueOpening,
          "pointer-events": "all",
          class: "h2d-pick",
          "data-structure": "IVC",
        },
        heart,
      ),
      veins: [0, 1, 2, 3].map(() =>
        el(
          "ellipse",
          {
            rx: 11,
            ry: 21,
            fill: "url(#h2d-ostium)",
            transform: "",
            "pointer-events": "none",
          },
          heart,
        ),
      ),
    };
    // The aortic root: the cut wall of the outflow tract with the aortic valve
    // at its base, left of the pulmonary root.
    const aorticRoot = el(
      "g",
      { class: "h2d-pick", "data-structure": "aortic" },
      heart,
    );
    const rootOutline =
      "M178 264C205 246 240 244 262 248L262 322C262 352 255 380 248 398C220 376 190 330 178 264Z";
    el(
      "path",
      {
        d: rootOutline,
        fill: "#d98f8f",
        stroke: "#e87b7b",
        "stroke-width": 15,
        "stroke-linejoin": "round",
      },
      aorticRoot,
    );
    el(
      "path",
      {
        d: rootOutline,
        fill: "#d98f8f",
        stroke: C.shell,
        "stroke-width": 11,
        "stroke-linejoin": "round",
      },
      aorticRoot,
    );
    el("path", { d: rootOutline, fill: "#d98f8f" }, aorticRoot);
    this.aorticGroup = aorticRoot;
    // CC-32: the regurgitant jet, over the left atrium and under the leaflets.
    this.jet = el(
      "g",
      { "pointer-events": "none", display: "none", "data-jet": "mitral" },
      heart,
    );
    this.jetBody = el(
      "path",
      { fill: "#7a45c8", "fill-opacity": 0.5, stroke: "#5b2ea3" },
      this.jet,
    );
    this.jetStreaks = [-0.28, 0, 0.28].map((side) =>
      el(
        "path",
        {
          fill: "none",
          stroke: "#efe4ff",
          "stroke-width": 2.2,
          "stroke-linecap": "round",
          "stroke-dasharray": "5 10",
          opacity: 0.9,
        },
        this.jet,
      ),
    );
    this.jetSides = [-0.28, 0, 0.28];
    // Papillary muscles and chordae, under the leaflets.
    this.muscle = Object.fromEntries(
      Object.keys(MUSCLES).map((id) => [
        id,
        el(
          "path",
          {
            fill: "rgba(176,104,134,0.14)",
            stroke: id.startsWith("RV") ? "#a85e83" : "#b95468",
            "stroke-opacity": 0.85,
            "stroke-width": 1.3,
            "stroke-linejoin": "round",
            class: "h2d-pick",
            "data-structure": id.slice(0, 2),
          },
          heart,
        ),
      ]),
    );
    this.chords = el(
      "g",
      {
        stroke: "#eef3fb",
        "stroke-width": 1.1,
        opacity: 0.9,
        "stroke-linecap": "round",
        "pointer-events": "none",
      },
      heart,
    );
    this.chordLines = Object.keys(LEAFLETS).flatMap((leaflet) =>
      LEAFLETS[leaflet].muscles.flatMap((muscle) =>
        [0.5, 0.78, 1].map((t) => ({
          leaflet,
          muscle,
          t,
          line: el("line", {}, this.chords),
        })),
      ),
    );
    this.valve = {};
    for (const id of Object.keys(LEAFLETS)) {
      const g = el(
        "g",
        { class: "h2d-pick", "data-structure": LEAFLETS[id].valve },
        heart,
      );
      this.valve[id] = [
        el(
          "path",
          {
            fill: "none",
            stroke: C.valveShadow,
            "stroke-width": 12,
            "stroke-linecap": "round",
            opacity: 0.3,
            transform: "translate(2.5,4)",
          },
          g,
        ),
        el(
          "path",
          {
            fill: "none",
            stroke: C.valve,
            "stroke-width": 11,
            "stroke-linecap": "round",
          },
          g,
        ),
      ];
    }
    this.cuspPaths = { aortic: [], pulmonary: [] };
    this.nodules = [];
    const cuspGroup = (valve, parent) => {
      const g = el("g", { class: "h2d-pick", "data-structure": valve }, parent);
      if (valve === "aortic") this.aorticCusps = g;
      for (let i = 0; i < 2; i++)
        this.cuspPaths[valve].push([
          el(
            "path",
            {
              fill: "none",
              stroke: C.valveShadow,
              "stroke-width": 10,
              "stroke-linecap": "round",
              opacity: 0.3,
              transform: "translate(2,3.5)",
            },
            g,
          ),
          el(
            "path",
            {
              fill: "none",
              stroke: C.valve,
              "stroke-width": 8.5,
              "stroke-linecap": "round",
            },
            g,
          ),
        ]);
    };
    cuspGroup("aortic", heart);
    // CC-47: calcific nodules on stenotic aortic cusps (shown only then).
    for (let i = 0; i < 2; i++)
      this.nodules.push(
        el(
          "circle",
          { r: 2.6, fill: C.calcium, stroke: C.calciumEdge, "stroke-width": 0.8, display: "none" },
          this.aorticCusps,
        ),
      );
    // In front: the pulmonary trunk with its right and left branches, and the
    // pulmonary root with its valve.
    const front = el("g", { filter: "url(#h2d-shadow)" }, svg);
    shape(
      front,
      "M262 330L260 212C260 176 280 150 304 150C316 150 326 158 333 168C380 148 440 133 496 124C503 124 505 135 500 148L470 160L498 161C504 175 502 188 497 192C448 203 396 214 358 240L335 258L335 330Z",
      C.blue,
      "pulmonary_trunk",
      { stroke: C.blueEdge, "stroke-width": 1.2 },
    );
    highlight(front, "M356 172C386 160 411 152 433 147", 9, C.blueLight, 0.7);
    const rootBox = el(
      "g",
      { class: "h2d-pick", "data-structure": "pulmonary" },
      front,
    );
    el(
      "path",
      {
        d: "M246 324Q290 306 334 322L334 441Q290 462 246 443Z",
        fill: "url(#h2d-root)",
        stroke: "#c3d5ee",
        "stroke-width": 3,
        opacity: 0.9,
      },
      rootBox,
    );
    cuspGroup("pulmonary", rootBox);
    // Labels: short, light, never in the way of the valves.
    this.text = el(
      "g",
      {
        class: "h2d-labels",
        "font-family": "system-ui, sans-serif",
        "font-size": 22,
        "font-weight": 600,
        fill: "#4a2c43",
        stroke: "rgba(255,255,255,0.75)",
        "stroke-width": 4,
        "paint-order": "stroke",
        "stroke-linejoin": "round",
        "pointer-events": "none",
        "aria-hidden": "true",
      },
      svg,
    );
    this.labelNodes = [
      ["RA", [148, 424]],
      ["RV", [385, 630]],
      ["LA", [432, 352]],
      ["LV", [506, 520]],
    ].map(([id, [x, y]]) => {
      const t = el("text", { x, y, "text-anchor": "middle" }, this.text);
      t.dataset.structure = id;
      return t;
    });
    this.selectionRing = el(
      "path",
      {
        fill: "none",
        stroke: "#ffd84d",
        "stroke-width": 4,
        "pointer-events": "none",
        opacity: 0,
      },
      svg,
    );
    svg.addEventListener("click", (event) => {
      const target = event.target.closest?.("[data-structure]");
      if (target) this.selectStructure(target.dataset.structure);
    });
    this.container.replaceChildren(svg);
    this.setLanguage(this.language);
    this.ready = true;
  }

  // Recolour the four chambers: classic textbook colours or the
  // colour-blind-safe pair.
  applyPalette() {
    const palette = PALETTES[this.visual.colorSafe ? "safe" : "classic"];
    for (const [key, [top, bottom]] of Object.entries(palette)) {
      this.stops[key][0].setAttribute("stop-color", top);
      this.stops[key][1].setAttribute("stop-color", bottom);
    }
  }

  setVisual({ colorSafe = true } = {}) {
    colorSafe = !!colorSafe;
    if (colorSafe === this.visual.colorSafe) return;
    this.visual = { ...this.visual, colorSafe };
    if (this.svg) this.applyPalette();
  }

  setLanguage(language) {
    this.language = language;
    if (!this.svg) return;
    this.title.textContent =
      language === "zh"
        ? "二维心脏（冠状切面示意）"
        : "2D heart (frontal section)";
    for (const node of this.labelNodes)
      node.textContent = this.abbreviation(node.dataset.structure);
    this.describe();
  }

  abbreviation(id) {
    return this.language === "zh"
      ? { RA: "右房", RV: "右室", LA: "左房", LV: "左室" }[id]
      : id;
  }

  label(id) {
    const entry = this.labels[id];
    return entry ? entry[this.language === "zh" ? 1 : 0] : id;
  }

  structureOptions() {
    return HEART2D_STRUCTURES.map((id) => ({ id, label: this.label(id) })).sort(
      (a, b) =>
        a.label.localeCompare(b.label, this.language === "zh" ? "zh-CN" : "en"),
    );
  }

  pickDetails(id) {
    const zh = this.language === "zh",
      note = this.notes[id] ?? this.notes.vessels;
    const v = this.frame?.sample?.valves?.[id];
    const valveNote = v
      ? zh
        ? `此时瓣膜${v.open ? "开放" : "关闭"}；跨瓣压力梯度为 ${Number(v.gradient).toFixed(1)} mmHg。`
        : `The valve is ${v.open ? "open" : "closed"} now; its pressure gradient is ${Number(v.gradient).toFixed(1)} mmHg.`
      : null;
    return {
      id,
      name: id,
      label: this.label(id),
      note: note ? note[zh ? 1 : 0] : null,
      phaseNote: valveNote,
    };
  }

  selectStructure(id) {
    this.selection = id;
    this.drawSelection();
    this.onPick(id, this.pickDetails(id));
  }

  clearSelection() {
    this.selection = null;
    this.drawSelection();
  }

  // During the "identify the phase" quiz the drawing must not name the phase.
  setQuiet(quiet) {
    this.quiet = !!quiet;
    this.described = null;
    this.describe();
  }

  drawSelection() {
    const g = this.state && this.geometry;
    let d = "";
    if (this.selection && g) {
      if (g.cavities[this.selection]) d = g.cavities[this.selection];
      else if (this.selection === "IVS") d = g.shell;
    }
    this.selectionRing.setAttribute("d", d);
    this.selectionRing.setAttribute("opacity", d ? 0.9 : 0);
    this.svg
      ?.querySelectorAll(".h2d-selected")
      .forEach((n) => n.classList.remove("h2d-selected"));
    if (this.selection && !d)
      this.svg
        ?.querySelectorAll(`[data-structure="${this.selection}"]`)
        .forEach((n) => n.classList.add("h2d-selected"));
  }

  // One model instant: { model, sample, t, hr, beatIndex, modifiers }.
  update(frame) {
    if (!this.svg) return;
    this.frame = frame;
    this.state = heart2dState({
      ...frame,
      atrialSettings: this.atrialSettings,
    });
    const g = (this.geometry = heart2dGeometry(this.state));
    this.shell.setAttribute("d", g.shell);
    for (const [id, d] of Object.entries(g.cavities))
      this.cavity[id].setAttribute("d", d);
    this.orifice.SVC.setAttribute("cx", g.orifices.SVC[0]);
    this.orifice.SVC.setAttribute("cy", g.orifices.SVC[1]);
    this.orifice.IVC.setAttribute("cx", g.orifices.IVC[0]);
    this.orifice.IVC.setAttribute("cy", g.orifices.IVC[1]);
    g.orifices.veins.forEach(([x, y], i) => {
      const ellipse = this.orifice.veins[i];
      ellipse.setAttribute("cx", x.toFixed(1));
      ellipse.setAttribute("cy", y.toFixed(1));
      ellipse.setAttribute(
        "transform",
        `rotate(-22 ${x.toFixed(1)} ${y.toFixed(1)})`,
      );
    });
    for (const [id, { base, tip }] of Object.entries(g.muscles)) {
      const dx = tip[0] - base[0],
        dy = tip[1] - base[1],
        len = Math.hypot(dx, dy) || 1,
        nx = (-dy / len) * 6.5,
        ny = (dx / len) * 6.5;
      this.muscle[id].setAttribute(
        "d",
        `M${base[0] - nx},${base[1] - ny}Q${base[0] + dx * 0.55 - nx * 1.2},${base[1] + dy * 0.55 - ny * 1.2} ${tip[0]},${tip[1]}Q${base[0] + dx * 0.55 + nx * 1.2},${base[1] + dy * 0.55 + ny * 1.2} ${base[0] + nx},${base[1] + ny}Z`,
      );
    }
    for (const c of this.chordLines) {
      const l = g.leaflets[c.leaflet],
        from = point(l.hinge, l.control, l.tip, c.t),
        to = g.muscles[c.muscle].tip;
      c.line.setAttribute("x1", from[0].toFixed(1));
      c.line.setAttribute("y1", from[1].toFixed(1));
      c.line.setAttribute("x2", to[0].toFixed(1));
      c.line.setAttribute("y2", to[1].toFixed(1));
    }
    for (const [id, l] of Object.entries(g.leaflets)) {
      const d = quad(l.hinge, l.control, l.tip);
      for (const p of this.valve[id]) p.setAttribute("d", d);
    }
    for (const valve of ["aortic", "pulmonary"])
      g[valve].forEach((cusp, i) => {
        const d = quad(cusp.hinge, cusp.control, cusp.tip);
        for (const p of this.cuspPaths[valve][i]) p.setAttribute("d", d);
      });
    this.drawCalcification(g.aortic);
    this.drawJet(g.jet, frame.t);
    if (this.selection) this.drawSelection();
    const phase = frame.sample?.phase?.name;
    const key = `${phase?.en}|${Object.values(this.state.valves)
      .map((b) => b > 0.5)
      .join()}|${this.state.leak > 0.02}`;
    if (key !== this.described) this.describe();
  }

  // CC-47: stenotic aortic cusps are thicker and calcified, with a nodule
  // on the body of each cusp.
  drawCalcification(cusps) {
    const on = cusps.some((c) => c.calcified);
    if (on !== this.calcified) {
      this.calcified = on;
      this.svg.dataset.aorticCalcified = on ? "1" : "0";
      this.cuspPaths.aortic.forEach(([shadow, body]) => {
        shadow.setAttribute("stroke-width", on ? 11.5 : 10);
        body.setAttribute("stroke-width", on ? 10 : 8.5);
        body.setAttribute("stroke", on ? COLOURS.calcified : COLOURS.valve);
      });
      for (const n of this.nodules) n.setAttribute("display", on ? "inline" : "none");
    }
    if (!on) return;
    cusps.forEach((c, i) => {
      const [x, y] = point(c.hinge, c.control, c.tip, 0.6);
      this.nodules[i].setAttribute("cx", x.toFixed(1));
      this.nodules[i].setAttribute("cy", y.toFixed(1));
    });
  }

  // The leak: a violet plume from the closed mitral valve into the left
  // atrium whose length and width follow the model's reverse flow, with
  // streaks that run along it (a function of the model clock, so a seek and
  // playback draw the same picture).
  drawJet(jet, t = 0) {
    this.svg.dataset.mitralLeak = jet ? jet.strength.toFixed(2) : "0";
    this.jet.setAttribute("display", jet ? "inline" : "none");
    if (!jet) return;
    this.jetBody.setAttribute("d", smoothPath(jetOutline(jet)));
    this.jetBody.setAttribute(
      "fill-opacity",
      (0.35 + 0.35 * jet.strength).toFixed(2),
    );
    const phase = -((t || 0) * 0.12);
    this.jetStreaks.forEach((line, i) => {
      const k = this.jetSides[i] * jet.endWidth,
        shift = (p) => [p[0] + k * (p === jet.base ? 0.2 : 1), p[1]],
        d = quad(shift(jet.base), shift(jet.control), shift(jet.tip));
      line.setAttribute("d", d);
      line.setAttribute("stroke-dashoffset", phase.toFixed(1));
    });
  }

  // Screen-reader description: phase and which valves are open, refreshed
  // only when either changes. The open valves are also a data attribute.
  describe() {
    if (!this.desc || !this.frame) return;
    const zh = this.language === "zh",
      phase = this.frame.sample?.phase?.name;
    const open = Object.entries(this.state.valves)
      .filter(([, b]) => b > 0.5)
      .map(([v]) => v);
    this.svg.dataset.openValves = open.join(" ");
    this.described = `${phase?.en}|${Object.values(this.state.valves)
      .map((b) => b > 0.5)
      .join()}|${this.state.leak > 0.02}`;
    const names = open.map((v) => this.label(v)),
      leak = Number(this.svg.dataset.mitralLeak) > 0;
    if (this.quiet) {
      this.desc.textContent = zh
        ? "心腔大小随模型容积变化。"
        : "Chamber sizes follow the model volumes.";
      return;
    }
    this.desc.textContent = zh
      ? `${phase?.zh ?? ""}。开放的瓣膜：${names.join("、") || "无"}。${leak ? "血液经二尖瓣反流入左心房。" : ""}心腔大小随模型容积变化。`
      : `${phase?.en ?? ""}. Open valves: ${names.join(", ") || "none"}. ${leak ? "Blood leaks back through the mitral valve into the left atrium. " : ""}Chamber sizes follow the model volumes.`;
  }

  // The lab's 3D interface, where it applies to a drawing.
  setView() {}
  setPreset() {}
  render() {}
  resize() {}

  // A canvas copy for the PNG export.
  async toCanvas(width, height) {
    // An SVG image needs an intrinsic size to be drawn on a canvas (Firefox).
    const copy = this.svg.cloneNode(true);
    copy.setAttribute("width", 640);
    copy.setAttribute("height", 800);
    const xml = new XMLSerializer().serializeToString(copy);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d"),
      scale = Math.min(width / 640, height / 800);
    ctx.drawImage(
      image,
      (width - 640 * scale) / 2,
      (height - 800 * scale) / 2,
      640 * scale,
      800 * scale,
    );
    return canvas;
  }

  dispose() {
    this.svg?.remove();
    this.svg = null;
  }
}
