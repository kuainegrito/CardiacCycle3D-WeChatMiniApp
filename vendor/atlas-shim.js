// Browser stand-ins for vendor/atlas3d.js (the website's three.js + realistic
// heart, bundled by tools/build-vendor.mjs). The bundle's first line binds
// document, window, self, ResizeObserver, MessageChannel, performance,
// navigator and devicePixelRatio to the objects below, so the website's code
// runs unchanged (tools/build-vendor.mjs lists the names). useCanvas() hands three.js the page's webgl2 canvas, and
// pointer() turns mini program touches into the pointer events OrbitControls
// and the atlas picker listen for.

const info = typeof wx !== "undefined" ? (wx.getWindowInfo?.() ?? wx.getSystemInfoSync()) : {};
const devicePixelRatio = Math.min(info.pixelRatio || 2, 2);

function events(target) {
  const listeners = {};
  target.addEventListener = (type, fn) => {
    (listeners[type] || (listeners[type] = [])).push(fn);
  };
  target.removeEventListener = (type, fn) => {
    listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
  };
  target.dispatchEvent = (event) => {
    for (const fn of [...(listeners[event.type] || [])]) fn.call(target, event);
    return true;
  };
  return target;
}

function element(tag) {
  const el = events({ tagName: tag.toUpperCase(), style: {}, children: [], dataset: {}, className: "", textContent: "" });
  el.setAttribute = (k, v) => (el[k] = v);
  el.removeAttribute = (k) => delete el[k];
  el.append = (...nodes) => el.children.push(...nodes);
  el.appendChild = (n) => (el.children.push(n), n);
  el.remove = () => {};
  el.replaceChildren = (...nodes) => (el.children = nodes);
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: el.width || 0, height: el.height || 0 });
  return el;
}

const document = events({
  documentElement: element("html"),
  body: element("body"),
  hidden: false,
  createElement: (tag) => (tag === "canvas" ? current.canvas : element(tag)),
  createElementNS: (_ns, tag) => (tag === "canvas" ? current.canvas : element(tag)),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
});
const window = events({
  document,
  devicePixelRatio,
  innerWidth: info.windowWidth || 390,
  innerHeight: info.windowHeight || 800,
  // three.js keeps self as its animation context and cancels on dispose; the
  // page drives frames itself, so a timer is enough here.
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
});
const self = window;
const navigator = { userAgent: "miniprogram", language: "zh-CN" };
const performance = { now: () => Date.now() };

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// Used only to yield between build stages (atlas-motion-pipeline yieldToMain).
class MessageChannel {
  constructor() {
    this.port1 = { onmessage: null, close() {} };
    this.port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.({ data: null }), 0), close() {} };
  }
}

// three.js loaders create these when they are constructed; nothing here aborts.
class AbortController {
  constructor() {
    this.signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
  }
  abort() {
    this.signal.aborted = true;
  }
}
// GLTFLoader reads the model's JSON chunk with TextDecoder (UTF-8 only here).
class TextDecoder {
  decode(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength);
    let out = "";
    for (let i = 0; i < bytes.length; ) {
      const b = bytes[i++];
      let cp = b;
      if (b >= 0xf0) cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (b >= 0xe0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (b >= 0xc0) cp = ((b & 31) << 6) | (bytes[i++] & 63);
      out += String.fromCodePoint(cp);
    }
    return out;
  }
}

const current = { canvas: null, container: null };

// Make the page's webgl2 canvas node look enough like an HTMLCanvasElement.
function useCanvas(node, width, height) {
  events(node);
  const props = {
    style: node.style || {},
    tabIndex: 0,
    ownerDocument: document,
    clientWidth: width,
    clientHeight: height,
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    remove() {}, // AtlasLabView.dispose(); the page removes the canvas with wx:if
    getRootNode: () => document,
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 }),
  };
  // Own properties, so read-only getters (a real canvas in tests) are shadowed too.
  for (const [key, value] of Object.entries(props)) {
    try {
      Object.defineProperty(node, key, { value, writable: true, configurable: true });
    } catch (error) {
      node[key] = value;
    }
  }
  current.canvas = node;
  // The atlas view appends its canvas and status line to this container and
  // sizes the renderer from it.
  current.container = element("div");
  current.container.getBoundingClientRect = node.getBoundingClientRect;
  return current.container;
}

// type: pointerdown | pointermove | pointerup | pointercancel; touch: {x, y, identifier}.
function pointer(type, touch) {
  if (!current.canvas || !touch) return;
  const x = touch.x ?? touch.clientX, y = touch.y ?? touch.clientY;
  current.canvas.dispatchEvent({
    type,
    pointerId: (touch.identifier ?? 0) + 1,
    pointerType: "touch",
    isPrimary: (touch.identifier ?? 0) === 0,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
    pageX: x,
    pageY: y,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: current.canvas,
    preventDefault() {},
    stopPropagation() {},
  });
}

module.exports = { document, window, self, navigator, performance, ResizeObserver, MessageChannel, AbortController, TextDecoder, devicePixelRatio, useCanvas, pointer };
