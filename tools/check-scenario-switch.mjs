// Scenario switches through the real page handlers (pages/lab/lab.js) and the
// website's own 3D heart and motion rig, in Node: model samples, whole motion
// steps and time per switch. Uses the website's AtlasLabView source instead of
// vendor/atlas3d.js, so the page and the 3D heart share one copy of the
// per-model tables, as inside the bundle. For a phone without JIT (WeChat on
// iOS), run it with node --jitless.
// Run from this folder: node tools/check-scenario-switch.mjs [path/to/apps/cardiac_cycle]
import assert from "node:assert/strict";
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// JSON imports without attributes (atlas-lab-view.js), and a count of model
// samples in every waveforms.js (the page's and the website's).
register("data:text/javascript," + encodeURIComponent(`
import { readFile } from "node:fs/promises";
export async function load(url, context, next) {
  if (url.startsWith("file:") && url.endsWith(".json"))
    return { format: "module", source: "export default " + (await readFile(new URL(url), "utf8")), shortCircuit: true };
  if (url.startsWith("file:") && url.endsWith("/waveforms.js")) {
    const head = "function sample(t,hr=scenario.hr??75,modifiers={},beatIndex=0){";
    const source = await readFile(new URL(url), "utf8");
    if (!source.includes(head)) throw Error("model sample() not found in " + url);
    return { format: "module", source: source.replace(head, head + "globalThis.modelSamples++;"), shortCircuit: true };
  }
  return next(url, context);
}`));

const web = resolve(process.argv[2] ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle");
const url = (path) => pathToFileURL(path).href;
globalThis.modelSamples = 0;
const { atlasLab } = await import(url(web + "/tests/atlas-lab-node.mjs"));
const { AtlasLabView } = await import(url(web + "/js/atlas-lab-view.js"));
const { MasterClock } = await import("../engine/clock.js");
const { createModel } = await import("../engine/waveforms.js");
const baseline = (await import("../data/baseline.js")).default;
const scenarios = (await import("../data/scenarios.js")).default;
let definition;
globalThis.Page = (page) => { definition = page; };
globalThis.wx = { getWindowInfo: () => ({ pixelRatio: 1 }), setNavigationBarTitle() {} };
await import("../pages/lab/lab.js");
delete globalThis.Page;

const lab = await atlasLab();
const view = new AtlasLabView(null, { i18n: { t: (key) => key, local: (v) => v?.en ?? v, language: "en", dictionaries: { en: {}, zh: {} } } });
view.motion = lab.motion;
view.meshes = lab.meshes;
let steps = 0;
const step = lab.motion.layers.step;
lab.motion.layers.step = (frame) => (steps++, step(frame));

const page = {
  ...definition,
  data: { ...definition.data, heartModel: "atlas" },
  canvases: { atlas: { node: { requestAnimationFrame() {} } } },
  setData(values, callback) { Object.assign(this.data, values); callback?.(); },
  visible: true,
  modifiers: { preload: 1, afterload: 1, contractility: 1 },
  chartsSeen: { strips: true, pv: true, ap: true },
};
page.clock = new MasterClock(createModel(baseline, scenarios[0]), { playing: true });
page.onScenario({ detail: { value: 0 } });
page.atlas = view;
view.setPreset("anatomy");
page.restartLoop(); // one frame: the heart posed on the normal scenario, as the 3D warm-up does
await view.layersReady;

const settle = () => new Promise((done) => setTimeout(done, 0));
const results = [];
async function choose(id) {
  modelSamples = 0;
  steps = 0;
  const started = performance.now();
  page.onScenario({ detail: { value: scenarios.findIndex((s) => s.id === id) } });
  const tap = { ms: performance.now() - started, steps };
  page.restartLoop(); // the next frame: the 3D heart's step (settleAtlas)
  await view.layersReady;
  await settle();
  if (page.shareUntilStep) page.restartLoop(); // after a view change: the step that ends the switch
  assert.equal(page.atlasScene, null, `${id}: the switch settled`);
  assert.equal(page.shareUntilStep, false, `${id}: samples are no longer shared`);
  const result = { id, preset: view.preset, tap, ms: performance.now() - started, samples: modelSamples, steps };
  results.push(result);
  console.log(
    `${id.padEnd(15)} ${result.preset.padEnd(10)} tap ${tap.ms.toFixed(0).padStart(4)} ms, all ${result.ms.toFixed(0).padStart(5)} ms, ` +
      `${String(result.samples).padStart(5)} model samples, ${result.steps} motion steps`,
  );
  for (let k = 0; k < 3; k++) page.restartLoop();
}

for (const id of ["as", "normal", "as", "normal", "mr", "pfo", "normal", "pfo", "af", "normal", "lbbb", "rbbb", "hfref", "normal"])
  await choose(id);

for (const r of results) {
  assert.equal(r.tap.steps, 0, `${r.id}: no 3D step while the traces switch`);
  assert.ok(r.steps <= 2, `${r.id}: one step poses the scenario (and one more ends a view change), not ${r.steps}`);
}
// Returning to a scenario finds its tables: only per-frame samples remain.
for (const r of results.slice(1, 4)) assert.ok(r.samples < 20, `${r.id} again: ${r.samples} samples`);
// A first visit shares the traces' samples with the atrial tables and the flow layer's three passes.
assert.ok(results[0].samples < 1500, `first visit to AS: ${results[0].samples} samples`);
console.log("Scenario switches: one 3D step a frame after the traces; returning to a scenario reuses its tables.");
