// Original schematic conduction network inspired by the owner's reference GIF.
// All excitation ages come from sample.conduction, never a second animation clock.
const clamp = (v) => Math.max(0, Math.min(1, v));
const p = (x, y, chamber, dx = 0, dy = 0) => ({ x, y, chamber, dx, dy });
const SA = p(124, 314, "RA", -12, -14);
const AV = p(235, 426);
const HIS = p(318, 457);
const routes = [
  {
    id: "internodal",
    clock: "atrial",
    start: 0,
    end: 55,
    points: [SA, p(153, 330, "RA", -8, -10), p(175, 374, "RA", -8, -5), AV],
  },
  {
    id: "right-atrium",
    clock: "atrial",
    start: 8,
    end: 75,
    points: [
      SA,
      p(105, 365, "RA", -14, -6),
      p(106, 430, "RA", -12, 0),
      p(121, 474, "RA", -8, 0),
      p(169, 455, "RA", -5, 0),
      AV,
    ],
  },
  {
    id: "left-atrium",
    clock: "atrial",
    start: 20,
    end: 85,
    points: [
      SA,
      p(227, 300),
      p(350, 270, "LA", 0, -8),
      p(403, 252, "LA", 0, -10),
      p(453, 296, "LA", 8, -4),
      p(442, 330, "LA", 8, -2),
    ],
  },
  {
    id: "his",
    clock: "ventricular",
    start: 0,
    end: 12,
    points: [AV, p(274, 438), HIS],
  },
  {
    id: "right-bundle",
    clock: "ventricular",
    side: "right",
    start: 12,
    end: 38,
    points: [
      HIS,
      p(329, 539, "RV", 0, 3),
      p(377, 600, "RV", 16, 18),
      p(438, 664, "RV", 23, 23),
    ],
  },
  {
    id: "left-bundle",
    clock: "ventricular",
    side: "left",
    start: 12,
    end: 38,
    points: [
      HIS,
      p(352, 486, "LV", 5, 3),
      p(395, 569, "LV", 7, 15),
      p(460, 675, "LV", 8, 25),
    ],
  },
  {
    id: "right-purkinje",
    clock: "ventricular",
    side: "right",
    start: 38,
    end: 85,
    points: [
      p(438, 664, "RV", 23, 23),
      p(365, 662, "RV", -10, 23),
      p(286, 637, "RV", -15, 17),
      p(203, 592, "RV", -13, 8),
      p(148, 541, "RV", -8, -2),
    ],
  },
  {
    id: "left-purkinje",
    clock: "ventricular",
    side: "left",
    start: 38,
    end: 85,
    points: [
      p(460, 675, "LV", 8, 25),
      p(518, 670, "LV", 12, 25),
      p(551, 642, "LV", 32, 33),
      p(553, 572, "LV", 45, 37),
      p(539, 493, "LV", 52, 22),
      p(510, 424, "LV", 45, 8),
    ],
  },
  {
    id: "accessory",
    clock: "accessory",
    start: 0,
    end: 45,
    points: [
      p(442, 330, "LA", 8, -2),
      p(484, 355, "LV", 15, 0),
      p(510, 424, "LV", 45, 8),
    ],
  },
];
// CC-59: a premature ventricular beat (engine/ectopy.js) starts at an
// illustrative right-ventricular free-wall site and spreads through working
// myocardium, slowly and without the bundles: across the RV wall to its base
// and apex first, back up the septum, and into the LV last (its 140 ms QRS on
// the rate-independent timeline). The normal His–Purkinje routes stay dark.
export const ECTOPIC_SITE = p(286, 637, "RV", -15, 17);
const ECTOPIC_ROUTES = [
  {
    id: "ectopic-rv-base",
    start: 0,
    end: 45,
    points: [ECTOPIC_SITE, p(203, 592, "RV", -13, 8), p(148, 541, "RV", -8, -2)],
  },
  {
    id: "ectopic-rv-apex",
    start: 0,
    end: 40,
    points: [ECTOPIC_SITE, p(365, 662, "RV", -10, 23), p(438, 664, "RV", 23, 23)],
  },
  {
    id: "ectopic-septum",
    start: 35,
    end: 85,
    points: [p(438, 664, "RV", 23, 23), p(377, 600, "RV", 16, 18), p(329, 539, "RV", 0, 3), HIS],
  },
  {
    id: "ectopic-lv",
    start: 55,
    end: 140,
    points: [
      p(460, 675, "LV", 8, 25),
      p(518, 670, "LV", 12, 25),
      p(551, 642, "LV", 32, 33),
      p(553, 572, "LV", 45, 37),
      p(539, 493, "LV", 52, 22),
      p(510, 424, "LV", 45, 8),
    ],
  },
];
for (const route of ECTOPIC_ROUTES) routes.push({ ...route, clock: "ectopic" });
// Short terminal arborizations, attached to each ventricular wall route.
for (const side of ["right", "left"]) {
  const wall = routes.find((r) => r.id === `${side}-purkinje`);
  wall.points.slice(1).forEach((root, i) => {
    const sign = side === "left" ? -1 : 1;
    // LV twigs stay short within the thin lateral myocardium. The basal
    // twig follows its narrow wall instead of extending into the cavity.
    const basal = side === "left" && i === wall.points.length - 2;
    const dx1 = side === "left" ? (basal ? 1 : 4) : 12;
    const dx2 = side === "left" ? (basal ? 3 : 6) : 22;
    routes.push({
      id: `${side}-twig-${i}`,
      clock: "ventricular",
      side,
      start: 48 + i * 9,
      end: 60 + i * 9,
      points: [
        root,
        { ...root, x: root.x + sign * dx1, y: root.y - (basal ? 6 : 12) },
        { ...root, x: root.x + sign * dx2, y: root.y - (basal ? 4 : 6) },
      ],
    });
  });
}
const locate = (v, s) => [
  v.x + v.dx * (s[v.chamber] ?? 0),
  v.y + v.dy * (s[v.chamber] ?? 0),
];
const pulse = (age) => (age < 0 ? 0 : clamp(1 - age / 100));

export function conduction2dState(conduction, s = {}) {
  if (!conduction) return null;
  const c = conduction;
  const atrialAge = c.atrialShaderTime;
  // rapidQrsStart distinguishes the normal His pathway from WPW pre-excitation.
  const rapidOffset = (c.rapidQrsStart - c.qrsStart) / c.qrsScale;
  const ventricularAge = c.ventricularTime / c.qrsScale - rapidOffset;
  const ectopic = !!c.ectopic,
    ectopicAge = c.ventricularTime / c.qrsScale;
  return {
    // CC-59: the ectopic site, lit at its excitation and marked through the
    // premature beat; null in every other beat.
    ectopic: ectopic
      ? { position: locate(ECTOPIC_SITE, s), alpha: pulse(ectopicAge) }
      : null,
    sa: {
      position: locate(SA, s),
      alpha: c.fibrillating || c.rhythm === "vf" || c.rhythm === "asystole" ? 0 : pulse(atrialAge),
    },
    av: {
      position: locate(AV, s),
      alpha:
        c.dissociated || c.fibrillating || c.rhythm === "vf" || c.rhythm === "asystole"
          ? 0
          : c.avDelay
            ? 0.75
            : pulse(atrialAge - 55),
    },
    routes: routes
      .filter((r) => (r.clock !== "accessory" || c.accessory) && (r.clock !== "ectopic" || ectopic))
      .map((r) => {
        const points = r.points.map((v) => locate(v, s));
        const age =
          r.clock === "atrial"
            ? atrialAge
            : r.clock === "ectopic"
              ? ectopicAge
              : r.clock === "accessory"
              ? c.ventricularTime / c.qrsScale
              : ventricularAge -
                (r.side === "left"
                  ? c.leftDelay
                  : r.side === "right"
                    ? c.rightDelay
                    : 0);
        // In a premature ventricular beat the bundles and Purkinje fibres are
        // not the route: they stay dark (the ectopic routes carry the wave).
        const suppressed =
          (r.clock === "atrial" && c.fibrillating) ||
          (r.id === "his" && c.dissociated) ||
          (ectopic && (r.clock === "ventricular" || r.clock === "accessory"));
        const segments = points.slice(1).map((end, i) => ({
          start: points[i],
          end,
          controls: [
            points[i].map(
              (v, k) => v + (end[k] - points[Math.max(0, i - 1)][k]) / 6,
            ),
            end.map(
              (v, k) =>
                v -
                (points[Math.min(points.length - 1, i + 2)][k] - points[i][k]) /
                  6,
            ),
          ],
          alpha: c.rhythm === "vf"
            ? (r.clock === "ventricular" ? Math.max(0, Math.sin((c.absolute ?? 0) * .037 + i * 2.3 + r.start)) ** 8 : 0)
            : c.rhythm === "asystole" || suppressed
            ? 0
            : pulse(
                age - (r.start + ((r.end - r.start) * i) / (points.length - 1)),
              ),
        }));
        return { id: r.id, segments };
      }),
  };
}

export class Conduction2D {
  constructor(svg, create) {
    const el = (tag, attrs, parent) => create(tag, attrs, parent);
    const defs = el("defs", {}, svg);
    const clip = el(
      "clipPath",
      { id: "h2d-conduction-clip", clipPathUnits: "userSpaceOnUse" },
      defs,
    );
    this.clip = el("path", {}, clip);
    this.group = el(
      "g",
      {
        "data-conduction": "network",
        "clip-path": "url(#h2d-conduction-clip)",
        "pointer-events": "none",
        "aria-hidden": "true",
      },
      svg,
    );
    this.routes = new Map();
    for (const route of routes) {
      const group = el("g", { "data-conduction-route": route.id }, this.group);
      const segments = route.points.slice(1).map(() => {
        const attrs = {
          fill: "none",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        };
        return [
          el(
            "path",
            { ...attrs, stroke: "#c6a529", "stroke-width": 4.5, opacity: 0.75 },
            group,
          ),
          el(
            "path",
            { ...attrs, stroke: "#ffc928", "stroke-width": 13, opacity: 0 },
            group,
          ),
          el(
            "path",
            { ...attrs, stroke: "#fff38a", "stroke-width": 3, opacity: 0 },
            group,
          ),
        ];
      });
      this.routes.set(route.id, { group, segments });
    }
    // CC-59: the ectopic site, a lightning mark with a glow.
    const ectopic = el("g", { "data-conduction-node": "ectopic", display: "none" }, this.group);
    this.ectopic = {
      group: ectopic,
      halo: el("circle", { r: 24, fill: "#ffb347", opacity: 0 }, ectopic),
      bolt: el(
        "path",
        {
          d: "M4,-20 L-11,3 L-1,3 L-6,20 L11,-4 L1,-4 Z",
          fill: "#ffd84d",
          stroke: "#7a4a10",
          "stroke-width": 1.5,
          "stroke-linejoin": "round",
        },
        ectopic,
      ),
    };
    this.nodes = {};
    for (const name of ["sa", "av"]) {
      const group = el("g", { "data-conduction-node": name }, this.group);
      this.nodes[name] = [
        el("circle", { r: 21, fill: "#ffdb34", opacity: 0 }, group),
        el(
          "circle",
          { r: 8, fill: "#ffda42", stroke: "#785b13", "stroke-width": 1.5 },
          group,
        ),
      ];
    }
  }
  update(conduction, s, shell) {
    if (shell) this.clip.setAttribute("d", shell);
    const state = conduction2dState(conduction, s);
    this.group.setAttribute("display", state ? "inline" : "none");
    if (!state) return;
    const visible = new Set(state.routes.map((r) => r.id));
    for (const [id, view] of this.routes)
      view.group.setAttribute("display", visible.has(id) ? "inline" : "none");
    for (const route of state.routes)
      route.segments.forEach((segment, i) => {
        const paths = this.routes.get(route.id).segments[i];
        const coords = (p) => p.map((v) => v.toFixed(1)).join(",");
        const d = `M${coords(segment.start)}C${coords(segment.controls[0])} ${coords(segment.controls[1])} ${coords(segment.end)}`;
        paths.forEach((path) => path.setAttribute("d", d));
        paths[1].setAttribute("opacity", (segment.alpha * 0.25).toFixed(3));
        paths[2].setAttribute("opacity", segment.alpha.toFixed(3));
      });
    const e = state.ectopic;
    this.ectopic.group.setAttribute("display", e ? "inline" : "none");
    if (e) {
      const [x, y] = e.position.map((v) => v.toFixed(1));
      this.ectopic.group.setAttribute("transform", `translate(${x},${y})`);
      this.ectopic.halo.setAttribute("opacity", (e.alpha * 0.55).toFixed(3));
      this.ectopic.bolt.setAttribute("fill", e.alpha > 0.2 ? "#fff6b0" : "#ffd84d");
    }
    for (const name of ["sa", "av"]) {
      const { position, alpha } = state[name];
      this.nodes[name].forEach((node) => {
        node.setAttribute("cx", position[0].toFixed(1));
        node.setAttribute("cy", position[1].toFixed(1));
      });
      this.nodes[name][0].setAttribute("opacity", (alpha * 0.45).toFixed(3));
      this.nodes[name][1].setAttribute(
        "fill",
        alpha > 0.2 ? "#fff9aa" : "#ffda42",
      );
    }
  }
}
