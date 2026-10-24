// Website CC-61 freeze fix: the actual 3D bundle (vendor/atlas3d.js) poses a
// premature beat that does not eject (an ejection-phase stimulus: EDV = ESV,
// which made the loading response throw and stopped the page's loop) and the
// beat after a stimulus at t = 0 (once a zero-length beat). Website CC-61
// motion: the walls do not snap where the premature beat begins (the cut
// beat's relaxation carries on) and the non-ejecting beat still contracts.
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
// No snap at the beat boundary: the 3D contraction weights 5 ms before and
// at the premature beat's start (before CC-61's fix they dropped 0.95 -> 0).
const weights = () => [...view.motion.rig.weights.slice(0, 3)];
const snap = await lab.model("normal");
snap.ectopy.clear();
snap.ectopy.stimulate(2, 400, hr);
step(snap, 395, 2);
const before = weights();
step(snap, 0, 3);
const jump = Math.max(...weights().map((w, i) => Math.abs(w - before[i])));
assert.ok(jump < 0.08, `contraction weights jump ${jump.toFixed(3)} where the premature beat begins`);
// The non-ejecting premature beat contracts on its own once the cut beat has relaxed.
let own = 0;
for (let t = 0; t < snap.cycleDuration(hr, 3); t += 10) {
  const s = snap.sample(t, hr, {}, 3);
  if (s.relaxing) continue;
  step(snap, t, 3);
  own = Math.max(own, view.motion.rig.weights[0]);
}
assert.ok(own > 0.1, `the non-ejecting premature beat contracts (${own.toFixed(2)})`);
console.log(`Bundled stimulus edge cases: a non-ejecting premature beat and the beats after a stimulus at t = 0 pose without error; no snap where the premature beat begins (largest weight step ${jump.toFixed(3)}), its own contraction ${own.toFixed(2)}`);
