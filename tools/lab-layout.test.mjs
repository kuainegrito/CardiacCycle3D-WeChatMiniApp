import test from "node:test";
import assert from "node:assert/strict";
import { PlotResume } from "../engine/plot-resume.js";
import { MasterClock } from "../engine/clock.js";
import { createModel } from "../engine/waveforms.js";
import baseline from "../data/baseline.js";
import scenarios from "../data/scenarios.js";

// Load the real page without launching model downloads or a native renderer.
let definition;
globalThis.Page = (page) => { definition = page; };
globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 1 }) };
await import("../pages/lab/lab.js");
delete globalThis.Page;

function fixture(heartModel, pinned = true) {
  const bindings = [];
  const page = {
    ...definition,
    data: { ...definition.data, heartModel, pinned, docked: true },
    canvases: { heartDock: { node: {} }, atlas: { node: {} } },
    setData(values, callback) { Object.assign(this.data, values); callback?.(); },
    async bindCanvas(id, type) {
      bindings.push([id, type]);
      this.canvases[id] = { node: {} };
    },
    update() {}, restartLoop() {},
  };
  return { page, bindings };
}

test("PFO atlas reuses motion tables across beats without freezing release or bubble time", () => {
  const { page } = fixture("atlas");
  const model = createModel(baseline, scenarios.find(s => s.id === "pfo"));
  const frames = [];
  page.atlas = { setVisual() {}, update(frame) { frames.push(frame); } };
  for (let beat = 0; beat < 8; beat++) {
    const t = 400, sample = model.sample(t, 75, {}, beat);
    page.stepAtlas({ model, sample, t, hr: 75, beatIndex: beat, modifiers: {}, baseline }, true);
    assert.equal(frames.at(-1).beatIndex, 0);
    assert.equal(frames.at(-1).sample, sample);
    assert.equal(sample.interatrial.flow > 0, beat % 4 === 3);
    assert.equal(sample.absolute, beat * 800 + t);
    for (let k = 0; k < 40; k++) {
      const a = model.sample(k * 20, 75, {}, 0), b = model.sample(k * 20, 75, {}, beat);
      assert.deepEqual(a.volume, b.volume);
      for (const valve of ["mitral", "aortic", "tricuspid", "pulmonary"]) {
        assert.equal(a.valves[valve].open, b.valves[valve].open);
        assert.ok(Math.abs(a.valves[valve].blend - b.valves[valve].blend) < 1e-10);
      }
    }
  }
  const normal = createModel(baseline, scenarios.find(s => s.id === "normal"));
  page.stepAtlas({ model: normal, beatIndex: 7 }, true);
  assert.equal(frames.at(-1).beatIndex, 7);
});

test("manual Wiggers inspection rebuilds the mini PFO release cycle once and preserves the picked time", () => {
  const { page } = fixture("2d");
  page.model = createModel(baseline, scenarios.find(s => s.id === "pfo"));
  page.clock = new MasterClock(page.model);
  page.charts = { timeAt: x => x };
  page.plotResume = new PlotResume(() => {});
  let rebuilds = 0;
  page.rebuild = () => rebuilds++;
  page.seekStrip(400, true);
  assert.equal(page.clock.beatIndex, 3);
  assert.equal(page.clock.t, 400);
  assert.ok(page.model.sample(400, 75, {}, 3).interatrial.flow > 0);
  page.seekStrip(500, true);
  assert.equal(page.clock.beatIndex, 3);
  assert.equal(page.clock.t, 500);
  assert.equal(rebuilds, 1);
  page.plotResume.cancel();
});

test("pinned 2D heart retains its native canvas through scrolling and reverse scrolling", async () => {
  const { page, bindings } = fixture("2d");
  const original = page.activeHeart();
  // These offsets used to move the heart in and out of the dock, resetting it.
  page.stageTop = 58;
  for (const scrollTop of [0, 30, 59, 180, 800, 180, 59, 30, 0]) {
    page.scrollTop = scrollTop;
    await page.syncDock();
    assert.equal(page.data.docked, true);
    assert.equal(page.activeHeart(), original);
  }
  assert.deepEqual(bindings, []);
});

test("unpinning restores the inline heart; repinning binds the dock once", async () => {
  const { page, bindings } = fixture("2d");
  page.data.pinned = false;
  await page.syncDock();
  assert.equal(page.data.docked, false);
  assert.equal(page.activeHeart(), page.canvases.heart);
  for (const scrollTop of [0, 400, 0]) {
    page.scrollTop = scrollTop;
    await page.syncDock();
    assert.equal(page.data.docked, false);
  }
  page.data.pinned = true;
  await page.syncDock();
  await page.syncDock();
  assert.equal(page.activeHeart(), page.canvases.heartDock);
  assert.deepEqual(bindings.map(([id]) => id), ["heart", "heartDock"]);
});

test("2D tabs remove and restore the heart; 3D tabs preserve the WebGL canvas", async () => {
  const two = fixture("2d");
  two.page.data.panel = "phases";
  await two.page.syncDock();
  assert.equal(two.page.data.docked, false);
  assert.deepEqual(two.bindings, []);
  two.page.data.panel = "heart";
  await two.page.syncDock();
  assert.deepEqual(two.bindings.map(([id]) => id), ["heartDock"]);

  const three = fixture("atlas", false), original = three.page.canvases.atlas;
  for (const panel of ["phases", "heart", "phases"]) {
    three.page.data.panel = panel;
    await three.page.syncDock();
    assert.equal(three.page.data.docked, true);
    assert.equal(three.page.canvases.atlas, original);
  }
  assert.deepEqual(three.bindings, []);
});

test("real mini page handlers auto-resume plot pauses and cancel on manual timeline actions", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page } = fixture("2d");
  page.clock = { playing: true, seek() {} };
  page.charts = { inPlot: () => true, timeAt: x => x };
  page.plotResume = new PlotResume(() => { page.clock.playing = true; });
  const start = () => page.stripStart({ touches: [{ x: 150 }] });
  start(); page.stripEnd();
  assert.equal(page.clock.playing, false);
  t.mock.timers.tick(6999); assert.equal(page.clock.playing, false);
  t.mock.timers.tick(1); assert.equal(page.clock.playing, true);
  start(); page.stripMove({ touches: [{ x: 180 }] });
  t.mock.timers.tick(10000); assert.equal(page.clock.playing, false);
  page.stripCancel();
  page.onScrub({ detail: { value: 50 }, type: "change" });
  t.mock.timers.tick(8000); assert.equal(page.clock.playing, false);
  start(); page.stripEnd();
  t.mock.timers.tick(8000); assert.equal(page.clock.playing, false);
});
