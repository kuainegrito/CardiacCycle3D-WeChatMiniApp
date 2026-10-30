import test from "node:test";
import assert from "node:assert/strict";
import { Heart2DView } from "../engine/heart2d.js";
import { SvgElement } from "../engine/mp-dom.js";
import { SvgPainter } from "../engine/svg-canvas.js";
import { createModel } from "../engine/waveforms.js";
import { MasterClock } from "../engine/clock.js";
import baseline from "../data/baseline.js";
import scenarios from "../data/scenarios.js";
import atrialSettings from "../data/atrial-volume.js";
globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 1 }) };
let definition;
globalThis.Page = p => { definition = p; };
await import("../pages/lab/lab.js");
delete globalThis.Page;

test("real Mini App page update paints AF, VF, ectopic contraction, pause and post-pause into its 2D canvas", async () => {
  const host = new SvgElement("div");
  const view = new Heart2DView(host, { readJSON: async () => atrialSettings });
  await view.init();
  const calls = [];
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, { get: (_, k) => (...args) => {
    if (["bezierCurveTo", "fillText", "stroke"].includes(k)) calls.push([k, ...args]);
    return k.startsWith("create") ? gradient : undefined;
  }, set: () => true });
  const page = { ...definition, data: { ...definition.data, heartModel: "2d", docked: true },
    modifiers: {}, visible: true, heart2d: view, painter: new SvgPainter(host.children[0]),
    canvases: { heartDock: { ctx, w: 390, h: 500 } },
    setData(values) { Object.assign(this.data, values); } };
  const open = id => {
    page.model = createModel(baseline, scenarios.find(s => s.id === id));
    page.clock = new MasterClock(page.model, { hr: 75, playing: false });
  };
  const paint = (t, beat = 0) => {
    page.clock.beatIndex = beat; page.clock.seek(t);
    calls.length = 0; page.update(true);
    return JSON.stringify(calls);
  };
  for (const id of ["af", "vf"]) {
    open(id);
    const first = paint(200, 2);
    assert.notEqual(first, paint(247, 2), `${id} actually repaints`);
    assert.equal(first, paint(200, 2), `${id} backwards scrub`);
    assert.match(view.rhythmText.textContent, id === "af" ? /atrial quivering/ : /no effective pumping/);
  }
  open("normal");
  page.model.ectopy.stimulate(2, 380, 75);
  const onset = page.model.sample(0, 75, {}, 3).ectopy.mechanicalOnsetMs;
  paint(onset + 160, 3);
  assert.equal(page.sample.sv, 0);
  assert.ok(view.state.rhythmMotion.pvc.RV > 0);
  assert.match(view.rhythmText.textContent, /early ventricular beat/);
  paint(page.sample.schedule[5].end + 120, 3);
  assert.match(view.rhythmText.textContent, /Compensatory pause/);
  paint(100, 4);
  assert.match(view.rhythmText.textContent, /Post-pause beat/);
  open("normal"); paint(100);
  assert.equal(view.rhythmCue.attributes.display, "none");
});
