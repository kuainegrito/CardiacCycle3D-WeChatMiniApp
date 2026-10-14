// Scenario switching in the real page handlers (pages/lab/lab.js), with a
// stand-in for the 3D heart: models kept per scenario, samples shared while a
// switch settles, and the 3D heart posed by a single step a frame after the
// traces. Run: node --test tools/scenario-switch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { MasterClock } from "../engine/clock.js";
import { createModel } from "../engine/waveforms.js";
import baseline from "../data/baseline.js";
import scenarios from "../data/scenarios.js";
import atrialSettings from "../data/atrial-volume.js";

let definition;
globalThis.Page = (page) => { definition = page; };
globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 1 }), setNavigationBarTitle() {} };
await import("../pages/lab/lab.js");
delete globalThis.Page;

const pick = (id) => ({ detail: { value: scenarios.findIndex((s) => s.id === id) } });
const settle = () => new Promise((resolve) => setImmediate(resolve));

// What the page uses of AtlasLabView. layersReady resolves when ready() is called.
function atlasStandIn() {
  return {
    preset: "anatomy", wallOpacity: 1, stateKey: "posed", lastArgs: null, layersReady: Promise.resolve(), holdFrame: 0,
    frames: [], presets: [], cameras: [],
    setVisual() {},
    update(frame) { this.frames.push(frame); this.lastArgs = frame; },
    setPreset(name) {
      this.preset = name;
      this.wallOpacity = { anatomy: 1, xray: 0.3, conduction: 0.35, filling: 0.2, flow: 0.15 }[name];
      this.presets.push(name);
      this.layersReady = new Promise((resolve) => (this.ready = resolve));
    },
    setWallOpacity(value) { this.wallOpacity = value; },
    setView(name) { this.cameras.push(name); },
  };
}

// The page on the 3D heart, opened on the normal scenario; restartLoop() runs one frame.
function lab({ playing = true } = {}) {
  const page = {
    ...definition,
    data: { ...definition.data, heartModel: "atlas" },
    canvases: { atlas: { node: { requestAnimationFrame() {} } } },
    setData(values, callback) { Object.assign(this.data, values); callback?.(); },
    visible: true,
    modifiers: { preload: 1, afterload: 1, contractility: 1 },
    chartsSeen: { strips: true, pv: true, ap: true },
  };
  page.clock = new MasterClock(createModel(baseline, scenarios[0]), { playing });
  page.onScenario(pick("normal"));
  page.atlas = atlasStandIn();
  return page;
}

test("each scenario keeps one model, so switching back finds its tables", () => {
  const page = lab(), normal = page.model;
  page.onScenario(pick("as"));
  const as = page.model;
  page.onScenario(pick("normal"));
  assert.equal(page.model, normal);
  page.onScenario(pick("as"));
  assert.equal(page.model, as);
  assert.notEqual(as, normal);
  assert.equal(as.scenario.id, "as");
});

test("a switch shares equal samples until the 3D heart's last step for it", async () => {
  const page = lab(), { atlas } = page;
  page.onScenario(pick("mr"));
  const { model, modifiers } = page, T = model.cycleDuration(75, 0);
  // At 75 bpm the traces sample the atrial volume table's grid (atrial-targets.js).
  const N = Math.ceil(T / atrialSettings.targets.samplingMs), dt = T / N;
  assert.equal(N, 400);
  for (let i = 0; i < 400; i++) assert.equal(page.series[i], model.sample(i * dt, 75, { ...modifiers }, 0));
  page.restartLoop(); // the 3D step
  atlas.ready();
  await settle();
  assert.equal(model.sample(1, 75, modifiers, 0), model.sample(1, 75, modifiers, 0));
  page.restartLoop(); // the step after the view settled
  assert.equal(atlas.frames.length, 2);
  assert.notEqual(model.sample(1, 75, modifiers, 0), model.sample(1, 75, modifiers, 0));
});

test("the 3D heart follows the traces a frame later with one step, then holds until its view is ready", async () => {
  const page = lab(), { atlas } = page;
  page.onScenario(pick("as"));
  assert.equal(atlas.frames.length, 0);
  assert.equal(page.series[0].scenarioId, "as");
  assert.equal(page.data.preset, "flow");
  page.restartLoop();
  assert.equal(atlas.frames.length, 1);
  assert.equal(atlas.frames[0].model, page.model);
  assert.deepEqual(atlas.presets, ["flow"]);
  assert.deepEqual(atlas.cameras, ["lao"]);
  assert.equal(atlas.lastArgs, null, "the view does not re-step the instant just stepped");
  page.restartLoop();
  page.restartLoop();
  assert.equal(atlas.frames.length, 1, "no steps while the view's shaders compile");
  atlas.ready();
  await settle();
  page.restartLoop();
  assert.equal(atlas.frames.length, 2);
  assert.equal(page.atlasScene, null);
});

test("leaving the blood-flow view hides it before the scenario's single step", async () => {
  const page = lab(), { atlas } = page;
  page.onScenario(pick("as"));
  page.restartLoop();
  atlas.ready();
  await settle();
  page.restartLoop();
  const steps = atlas.frames.length;
  page.onScenario(pick("normal"));
  page.restartLoop();
  assert.equal(atlas.frames.length, steps, "the view changes first");
  assert.equal(atlas.preset, "anatomy");
  atlas.ready();
  await settle();
  page.restartLoop();
  assert.equal(atlas.frames.length, steps + 1);
  assert.equal(atlas.frames.at(-1).model, page.model);
  assert.equal(page.model.scenario.id, "normal");
});

test("a scenario with the same view keeps it: one step, no shader work", async () => {
  const page = lab(), { atlas } = page;
  page.onScenario(pick("as"));
  page.restartLoop();
  atlas.ready();
  await settle();
  page.restartLoop();
  const steps = atlas.frames.length;
  page.onScenario(pick("mr"));
  page.restartLoop();
  assert.equal(atlas.frames.length, steps + 1);
  assert.deepEqual(atlas.presets, ["flow"]);
  await settle();
  assert.equal(page.atlasScene, null);
});

test("a paused switch places the new view at the paused instant", async () => {
  const page = lab({ playing: false }), { atlas } = page;
  page.onScenario(pick("lbbb"));
  page.restartLoop();
  assert.equal(atlas.frames.length, 1);
  atlas.ready();
  await settle();
  assert.equal(atlas.stateKey, undefined, "a whole step, so a layer built just now is placed");
  page.restartLoop();
  assert.equal(atlas.frames.length, 2);
  assert.equal(atlas.frames[1].t, atlas.frames[0].t);
});

test("an input handler leaves the 3D step to the next frame, and steps are at most one per 60 Hz frame", () => {
  const page = lab(), { atlas } = page;
  page.restartLoop();
  const steps = atlas.frames.length;
  page.onHR({ detail: { value: 120 } });
  assert.equal(atlas.frames.length, steps, "the traces and readouts switch first");
  assert.equal(page.data.hr, 120);
  page.restartLoop();
  assert.equal(atlas.frames.length, steps + 1);
  assert.equal(atlas.frames.at(-1).hr, 120);
  for (let k = 0; k < 5; k++) page.restartLoop(); // frames well within 15 ms
  assert.equal(atlas.frames.length, steps + 1);
});

test("the chordae are moved and drawn only where they can be seen, and seated only close up", () => {
  const page = lab(), { atlas } = page;
  const states = [];
  page.engine = { setChords: (state) => states.push(`${state.active ? "on" : "off"}${state.seat ? "+seat" : ""}`) };
  atlas.diagonal = 0.21;
  atlas.camera = { position: { length: () => 0.29 } }; // a named view frames the heart from outside
  page.syncWall();
  assert.deepEqual(states, ["off"], "opaque walls, camera outside");
  atlas.camera.position.length = () => 0.05; // zoomed into a chamber
  page.atlasTouch({ type: "touchend", touches: [], changedTouches: [] });
  assert.deepEqual(states, ["off", "on+seat"]);
  assert.equal(atlas.stateKey, undefined, "moved at the next step, even at the same instant");
  page.restartLoop();
  assert.equal(atlas.frames.at(-1).model, page.model);
  atlas.camera.position.length = () => 0.29;
  page.atlasTouch({ type: "touchend", touches: [], changedTouches: [] });
  atlas.setPreset("xray");
  atlas.stateKey = "posed";
  page.syncWall();
  assert.deepEqual(states, ["off", "on+seat", "off", "on"], "translucent walls show them, unseated from afar");
  assert.equal(atlas.stateKey, undefined);
  atlas.camera.position.length = () => 0.1; // the PFO's close-up of the septum
  page.atlasTouch({ type: "touchmove", touches: [{}], changedTouches: [] });
  assert.deepEqual(states.at(-1), "on+seat");
});

test("the hold ends after two seconds if the view is still being built", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = lab(), { atlas } = page;
  page.onScenario(pick("af"));
  page.restartLoop();
  t.mock.timers.tick(1999);
  await settle();
  page.restartLoop();
  assert.equal(atlas.frames.length, 1);
  t.mock.timers.tick(1);
  await settle();
  page.restartLoop();
  assert.equal(atlas.frames.length, 2);
});

test("choosing the 2D heart before the 3D step keeps the scenario's view for its return", () => {
  const page = lab(), { atlas } = page;
  page.parkAtlas = () => true;
  page.onScenario(pick("pfo"));
  page.closeAtlas(true);
  assert.equal(page.parkedAtlas, atlas);
  assert.equal(atlas.presetPending, true);
  assert.equal(page.wantedCamera, "septum");
  assert.equal(page.atlasScene, null);
  const { model } = page;
  assert.notEqual(model.sample(1, 75, page.modifiers, 0), model.sample(1, 75, page.modifiers, 0));
});

test("beats that differ only by rounding count as the same beat, at any rate", () => {
  const page = lab();
  for (const [id, hr, same] of [
    ["normal", 75, true], ["normal", 150, true], ["normal", 45, true], ["exercise", 150, true], ["vagal", 45, true],
    ["lbbb", 110, true], ["af", 95, false], ["complete-block", 40, false], ["pfo", 75, false],
  ]) {
    page.onScenario(pick(id));
    page.clock.setHR(hr);
    page.checkBeats();
    assert.equal(page.sameBeats, same, `${id} at ${hr} bpm`);
  }
});

test("a beat that differs is prepared during the beat before: traces and its tables' samples", async () => {
  const page = lab(), { atlas } = page;
  atlas.motion = { atrialSettings };
  page.onScenario(pick("complete-block"));
  page.restartLoop(); // the switch settles: its shared samples end
  atlas.ready();
  await settle();
  page.restartLoop();
  assert.equal(page.atlasScene, null);
  assert.equal(page.sameBeats, false);
  const { model, modifiers } = page, hr = page.clock.hr;
  // Run the clock to just before the beat ends, preparing as the loop does.
  for (let k = 0; k < 400 && !page.nextBeat?.done; k++) {
    page.clock.advance(5);
    page.prepareNextBeat();
  }
  const next = page.nextBeat, T = next.T, N = Math.ceil(T / atrialSettings.targets.samplingMs);
  assert.ok(next.done && next.out.length === 400, "prepared before the beat ends");
  const at = (t) => model.sample(t, hr, modifiers, next.beat);
  assert.equal(at(N * (T / N)), at(N * (T / N)), "the atrial table's instants are kept");
  assert.equal(at(0), next.out[0]);
  page.clock.advance((page.model.cycleDuration(hr, 0) - page.clock.t) / page.clock.speed + 1); // into the new beat
  page.restartLoop();
  assert.equal(page.previousBeat, next.beat);
  assert.equal(page.series, next.out, "the prepared traces are used");
  assert.notEqual(model.sample(1, hr, modifiers, next.beat), model.sample(1, hr, modifiers, next.beat), "released once the beat starts");
});

test("a clock set back does not stop the 3D heart", () => {
  const page = lab(), { atlas } = page;
  page.restartLoop();
  const steps = atlas.frames.length;
  page.atlasStepAt = Date.now() + 60000; // the last step "in the future"
  page.clock.advance(40);
  page.restartLoop();
  assert.equal(atlas.frames.length, steps + 1);
});
