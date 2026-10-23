// Website CC-61 freeze fix: the actual 3D bundle (vendor/atlas3d.js) poses a
// premature beat that does not eject (an ejection-phase stimulus: EDV = ESV,
// which made the loading response throw and stopped the page's loop) and the
// beat after a stimulus at t = 0 (once a zero-length beat).
// Run: node tools/check-stimulus-bundle.mjs [path/to/apps/cardiac_cycle]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const web = resolve(process.argv[2] ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle");
const { atlasLab } = await import(pathToFileURL(web + "/tests/atlas-lab-node.mjs"));
const { AtlasLabView } = createRequire(import.meta.url)("../vendor/atlas3d.js");
const lab = await atlasLab();
const view = new AtlasLabView(null, { i18n: { t: (key) => key } });
view.motion = lab.motion;
view.prepareShaders = async () => {};
view.describe = () => {};
view.preset = "anatomy";
await view.applyLayers();
const hr = 75;
const step = (model, t, beatIndex) =>
  view.update({ model, sample: model.sample(t, hr, {}, beatIndex), t, hr, beatIndex, modifiers: {}, baseline: lab.baseline });
const late = await lab.model("mr");
const r = late.ectopy.stimulate(2, 400, hr);
assert.equal(r.outcome, "pvc");
assert.equal(r.ejected, false, "an ejection-phase stimulus: the premature beat does not eject");
for (const beat of [2, 3, 4]) for (const f of [0, 0.3, 0.6, 0.95]) step(late, f * late.cycleDuration(hr, beat), beat);
const early = await lab.model("normal");
const e = early.ectopy.stimulate(0, 0, hr);
assert.ok(e.tMs >= 1 && early.cycleDuration(hr, 0) >= 1, "no zero-length beat");
step(early, 0, 0);
for (const f of [0, 0.5, 0.95]) step(early, f * early.cycleDuration(hr, 1), 1);
console.log("Bundled stimulus edge cases: a non-ejecting premature beat and the beats after a stimulus at t = 0 pose without error");
