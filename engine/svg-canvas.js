// Paints the SVG tree that heart2d.js builds (mp-dom.js SvgElement objects) on
// a canvas 2d context, and finds which structure a tap hits. Covers what that
// drawing uses: path (M L H V C S Q T A Z), rect, ellipse, line, text, groups,
// translate/rotate/scale transforms, linear/radial gradients, opacity, dashes,
// paint-order on text and feDropShadow (applied per shape).

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const pathCache = new Map();

// Parse "d" into absolute commands: [op, ...numbers] with op in M L C Q A Z.
function parsePath(d) {
  let cached = pathCache.get(d);
  if (cached) return cached;
  const out = [];
  const tokens = d.match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  const n = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i]) && !/^-?[\d.]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") {
      out.push(["Z"]); x = sx; y = sy; lc = lq = null;
      continue;
    }
    if (C === "M") {
      x = ox + n(); y = oy + n(); sx = x; sy = y;
      out.push(["M", x, y]);
      cmd = rel ? "l" : "L"; lc = lq = null;
    } else if (C === "L") { x = ox + n(); y = oy + n(); out.push(["L", x, y]); lc = lq = null; }
    else if (C === "H") { x = (rel ? x : 0) + n(); out.push(["L", x, y]); lc = lq = null; }
    else if (C === "V") { y = (rel ? y : 0) + n(); out.push(["L", x, y]); lc = lq = null; }
    else if (C === "C" || C === "S") {
      let x1, y1;
      if (C === "C") { x1 = ox + n(); y1 = oy + n(); }
      else { x1 = lc ? 2 * x - lc[0] : x; y1 = lc ? 2 * y - lc[1] : y; }
      const x2 = ox + n(), y2 = oy + n(), ex = ox + n(), ey = oy + n();
      out.push(["C", x1, y1, x2, y2, ex, ey]);
      lc = [x2, y2]; lq = null; x = ex; y = ey;
    } else if (C === "Q" || C === "T") {
      let x1, y1;
      if (C === "Q") { x1 = ox + n(); y1 = oy + n(); }
      else { x1 = lq ? 2 * x - lq[0] : x; y1 = lq ? 2 * y - lq[1] : y; }
      const ex = ox + n(), ey = oy + n();
      out.push(["Q", x1, y1, ex, ey]);
      lq = [x1, y1]; lc = null; x = ex; y = ey;
    } else if (C === "A") {
      const rx = n(), ry = n(), rot = n(), large = n(), sweep = n(), ex = ox + n(), ey = oy + n();
      out.push(["A", x, y, rx, ry, rot, large, sweep, ex, ey]);
      x = ex; y = ey; lc = lq = null;
    } else i++; // unknown token: skip
  }
  if (pathCache.size > 400) pathCache.clear();
  pathCache.set(d, out);
  return out;
}

// SVG endpoint arc -> canvas ellipse (W3C SVG implementation notes F.6.5).
function arc(ctx, x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return ctx.lineTo(x2, y2);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  ctx.ellipse(cx, cy, rx, ry, phi, t1, t1 + dt, !fs);
}

function tracePath(ctx, cmds) {
  ctx.beginPath();
  for (const c of cmds) {
    if (c[0] === "M") ctx.moveTo(c[1], c[2]);
    else if (c[0] === "L") ctx.lineTo(c[1], c[2]);
    else if (c[0] === "C") ctx.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
    else if (c[0] === "Q") ctx.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else if (c[0] === "A") arc(ctx, ...c.slice(1));
    else if (c[0] === "Z") ctx.closePath();
  }
}
function pathBox(cmds) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cmds) {
    const pts = c[0] === "A" ? [c[8], c[9], c[1], c[2]] : c.slice(1);
    for (let i = 0; i + 1 < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
    }
  }
  return { x: x0, y: y0, w: x1 - x0 || 1, h: y1 - y0 || 1 };
}

const num = (v, d = 0) => (v === undefined || v === null || v === "" ? d : parseFloat(v));
const INHERITED = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-opacity", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "font-family", "font-size", "font-weight", "paint-order", "text-anchor", "pointer-events"];
const SKIP = new Set(["title", "desc", "defs", "stop", "filter", "feDropShadow", "linearGradient", "radialGradient"]);

function applyTransform(ctx, t) {
  if (!t) return;
  for (const [, op, args] of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = (args.match(NUM) ?? []).map(Number);
    if (op === "translate") ctx.translate(a[0] ?? 0, a[1] ?? 0);
    else if (op === "scale") ctx.scale(a[0] ?? 1, a[1] ?? a[0] ?? 1);
    else if (op === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      if (a.length >= 3) { ctx.translate(a[1], a[2]); ctx.rotate(r); ctx.translate(-a[1], -a[2]); }
      else ctx.rotate(r);
    }
  }
}

export class SvgPainter {
  constructor(root) {
    this.root = root; // the <svg> SvgElement
  }
  index() {
    this.ids = {};
    const walk = (n) => {
      if (n.attributes?.id) this.ids[n.attributes.id] = n;
      n.children?.forEach(walk);
    };
    walk(this.root);
  }
  paint(ctx, box, scale) {
    // box: { x, y, w, h } in CSS px; scale: device pixels per CSS px.
    this.index();
    const [vx, vy, vw, vh] = String(this.root.attributes.viewBox ?? "0 0 100 100").split(/[\s,]+/).map(Number);
    const k = Math.min(box.w / vw, box.h / vh);
    this.view = { ox: box.x + (box.w - vw * k) / 2 - vx * k, oy: box.y + (box.h - vh * k) / 2 - vy * k, k };
    this.pxPerUnit = k * scale;
    ctx.save();
    ctx.translate(this.view.ox, this.view.oy);
    ctx.scale(k, k);
    this.draw(ctx, this.root, {}, 1, null, null);
    ctx.restore();
  }
  paintOf(value, ctx, box) {
    if (!value || value === "none") return null;
    const m = /^url\(#([^)]+)\)$/.exec(value);
    if (!m) return value;
    const g = this.ids[m[1]];
    if (!g) return null;
    const stops = g.children.filter((s) => s.tagName === "stop");
    let grad;
    if (g.tagName === "linearGradient") {
      const a = g.attributes;
      grad = ctx.createLinearGradient(box.x + num(a.x1, 0) * box.w, box.y + num(a.y1, 0) * box.h, box.x + num(a.x2, 1) * box.w, box.y + num(a.y2, 0) * box.h);
    } else {
      const a = g.attributes, cx = box.x + num(a.cx, 0.5) * box.w, cy = box.y + num(a.cy, 0.5) * box.h;
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, num(a.r, 0.5) * Math.max(box.w, box.h));
    }
    for (const s of stops) grad.addColorStop(Math.min(1, Math.max(0, num(s.attributes.offset))), s.attributes["stop-color"] ?? "#000");
    return grad;
  }
  shadowOf(filter) {
    const m = /^url\(#([^)]+)\)$/.exec(filter ?? "");
    const f = m && this.ids[m[1]];
    const s = f?.children.find((c) => c.tagName === "feDropShadow");
    if (!s) return null;
    const a = s.attributes, u = this.pxPerUnit;
    const op = num(a["flood-opacity"], 1);
    return { x: num(a.dx, 2) * u, y: num(a.dy, 2) * u, blur: num(a.stdDeviation, 2) * 2 * u, color: `rgba(0,0,0,${op})` };
  }
  draw(ctx, node, inherited, alpha, shadow, structure) {
    if (SKIP.has(node.tagName)) return;
    const a = node.attributes;
    if (a.display === "none" || a.visibility === "hidden") return;
    const style = { ...inherited };
    for (const key of INHERITED) if (a[key] !== undefined) style[key] = a[key];
    const op = alpha * num(a.opacity, 1);
    if (op <= 0) return;
    const ownShadow = a.filter ? this.shadowOf(a.filter) : null;
    const sh = ownShadow ?? shadow;
    const pick = node.dataset?.structure ?? structure;
    ctx.save();
    applyTransform(ctx, a.transform);
    if (node.tagName === "svg" || node.tagName === "g") {
      for (const c of node.children) this.draw(ctx, c, style, op, sh, pick);
    } else this.shape(ctx, node, style, op, sh, pick);
    ctx.restore();
  }
  geometry(ctx, node) {
    const a = node.attributes;
    switch (node.tagName) {
      case "path": {
        if (!a.d) return null;
        const cmds = parsePath(String(a.d));
        tracePath(ctx, cmds);
        return pathBox(cmds);
      }
      case "rect": {
        const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height), r = Math.min(num(a.rx, num(a.ry)), w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        return { x, y, w, h };
      }
      case "ellipse":
      case "circle": {
        const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx, num(a.r)), ry = num(a.ry, num(a.r));
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
        return { x: cx - rx, y: cy - ry, w: 2 * rx || 1, h: 2 * ry || 1 };
      }
      case "line": {
        const x1 = num(a.x1), y1 = num(a.y1), x2 = num(a.x2), y2 = num(a.y2);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 1, h: Math.abs(y2 - y1) || 1 };
      }
    }
    return null;
  }
  strokeStyle(ctx, style) {
    ctx.lineWidth = num(style["stroke-width"], 1);
    ctx.lineCap = style["stroke-linecap"] ?? "butt";
    ctx.lineJoin = style["stroke-linejoin"] ?? "miter";
    const dash = style["stroke-dasharray"];
    ctx.setLineDash(dash && dash !== "none" ? String(dash).split(/[\s,]+/).map(Number) : []);
    ctx.lineDashOffset = num(style["stroke-dashoffset"], 0);
  }
  shape(ctx, node, style, op, shadow, structure) {
    if (node.tagName === "text") return this.text(ctx, node, style, op);
    const box = this.geometry(ctx, node);
    if (!box) return;
    const fillValue = node.tagName === "line" ? "none" : (style.fill ?? "#000");
    const fill = this.paintOf(fillValue, ctx, box), stroke = this.paintOf(style.stroke, ctx, box);
    if (shadow) {
      ctx.shadowOffsetX = shadow.x;
      ctx.shadowOffsetY = shadow.y;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowColor = shadow.color;
    }
    if (fill) {
      ctx.globalAlpha = op * num(style["fill-opacity"], 1);
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      if (fill) ctx.shadowColor = "rgba(0,0,0,0)";
      ctx.globalAlpha = op * num(style["stroke-opacity"], 1);
      ctx.strokeStyle = stroke;
      this.strokeStyle(ctx, style);
      ctx.stroke();
    }
  }
  text(ctx, node, style, op) {
    const a = node.attributes, content = node.textContent;
    if (!content) return;
    ctx.font = `${style["font-weight"] ?? 400} ${num(style["font-size"], 16)}px sans-serif`;
    ctx.textAlign = { middle: "center", end: "right" }[a["text-anchor"] ?? style["text-anchor"]] ?? "left";
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = op;
    const x = num(a.x), y = num(a.y);
    if (style.stroke && style.stroke !== "none") {
      ctx.strokeStyle = style.stroke;
      this.strokeStyle(ctx, style);
      ctx.lineJoin = style["stroke-linejoin"] ?? "round";
      ctx.strokeText(content, x, y);
    }
    ctx.fillStyle = style.fill ?? "#000";
    ctx.fillText(content, x, y);
  }
  // Which data-structure a tap at canvas CSS point (px, py) lands on (topmost).
  hitTest(ctx, box, scale, px, py) {
    // Re-run the painter with a shape step that only builds each path and
    // tests it (isPointInPath takes device pixels, untransformed).
    ctx.save();
    const found = [];
    const original = this.shape.bind(this);
    this.shape = (c, node, style, op, shadow, structure) => {
      if (node.tagName === "text") return;
      const b = this.geometry(c, node);
      if (!b || !structure || style["pointer-events"] === "none") return;
      const X = px * scale, Y = py * scale;
      const filled = (style.fill ?? "#000") !== "none" || style["pointer-events"] === "all";
      const w = num(style["stroke-width"], 1);
      if ((filled && c.isPointInPath(X, Y)) || (style.stroke && style.stroke !== "none" && (c.lineWidth = Math.max(w, 14), c.isPointInStroke?.(X, Y))))
        found.push(structure);
    };
    try {
      this.paint(ctx, box, scale);
    } finally {
      this.shape = original;
      ctx.restore();
    }
    return found.length ? found[found.length - 1] : null;
  }
}
