// The few browser DOM features the website's heart2d.js and charts.js use,
// for the mini program (no DOM there). heart2d builds an SVG tree with
// createElementNS/setAttribute; here that tree is plain objects which
// svg-canvas.js paints on a canvas. charts.js asks for an offscreen canvas and
// for two checkboxes by id.

// Checkbox state read by charts.js (document.getElementById(id).checked).
export const controls = {
  repolarization: { checked: false },
  erp: { checked: true },
};

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export class SvgElement {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on),
      contains: (c) => classes.has(c),
    };
    this._classes = classes;
  }
  setAttribute(name, value) {
    if (name === "class") String(value).split(/\s+/).filter(Boolean).forEach((c) => this._classes.add(c));
    else if (name.startsWith("data-")) this.dataset[camel(name.slice(5))] = String(value);
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  append(...nodes) {
    for (const n of nodes) {
      n.parentNode = this;
      this.children.push(n);
    }
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    const p = this.parentNode;
    if (p) p.children = p.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  // Selectors used by heart2d.js: ".class", "[data-x]" and '[data-x="v"]'.
  matches(selector) {
    if (selector.startsWith(".")) return this._classes.has(selector.slice(1));
    const m = selector.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/);
    if (m) {
      const v = this.dataset[camel(m[1])];
      return m[2] === undefined ? v !== undefined : v === m[2];
    }
    return false;
  }
  closest(selector) {
    for (let n = this; n; n = n.parentNode) if (n.matches?.(selector)) return n;
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => (c.matches(selector) && out.push(c), walk(c)));
    walk(this);
    return out;
  }
}

function offscreenCanvas() {
  // Mini program 2d offscreen canvas; the browser test harness has its own.
  if (typeof wx !== "undefined" && wx.createOffscreenCanvas)
    return wx.createOffscreenCanvas({ type: "2d", width: 1, height: 1 });
  return globalThis.document?.createElement?.("canvas");
}

export const document = {
  createElementNS: (_ns, tag) => new SvgElement(tag),
  createElement: (tag) => (tag === "canvas" ? offscreenCanvas() : new SvgElement(tag)),
  getElementById: (id) => controls[id] ?? null,
};

const info = typeof wx !== "undefined" ? (wx.getWindowInfo?.() ?? wx.getSystemInfoSync()) : null;
export const devicePixelRatio = info?.pixelRatio ?? 2;

// Give a mini program canvas node the two element methods charts.js calls.
export function adoptCanvas(node, width, height, isHidden = () => false) {
  node.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height });
  node.closest = (selector) => (selector === "[hidden]" && isHidden() ? node : null);
  return node;
}
