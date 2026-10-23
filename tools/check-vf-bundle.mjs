// CC-64: the actual 3D bundle (vendor/atlas3d.js) builds the website's
// fibrillation layer (js/vf-view.js) on the website's production rig: on in
// ventricular fibrillation (with the disordered wavelets in the conduction
// view), off in sinus rhythm and in the post-shock pause, and the ordered
// conduction is switched off while the ventricles fibrillate.
// Run: node tools/check-vf-bundle.mjs [path/to/apps/cardiac_cycle]
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
view.prepareShaders = async () => {}; // no native renderer in this Node check
view.describe = () => {};
view.preset = "conduction";
await view.applyLayers();
const start = Date.now();
while (!view.ectopicConduction && Date.now() - start < 120000) await new Promise((r) => setTimeout(r, 50));

const hr = 75,
  step = (model, t, beatIndex) => {
    const sample = model.sample(t, hr, {}, beatIndex);
    view.update({ model, sample, t, hr, beatIndex, modifiers: {}, baseline: lab.baseline });
    return sample;
  };
const vf = await lab.model("vf");
const s = step(vf, 300, 2);
assert.equal(s.conduction.rhythm, "vf");
assert.ok(view.vfLayer, "the fibrillation layer is built in the bundle");
const u = view.vfLayer.uniforms;
assert.equal(u.uVfOn.value, 1, "on in VF");
assert.equal(u.uVfConduction.value, 1, "wavelets in the conduction view");
assert.equal(view.views.conduction.layer.uniforms.uCondEnabled.value, 0, "ordered conduction off in VF");
const time = u.uVfTime.value;
step(vf, 340, 2);
assert.notEqual(u.uVfTime.value, time, "driven by the model's absolute time");
// The shock: electrical silence (no fibrillation), then sinus rhythm.
const shocked = await lab.model("vf");
assert.equal(shocked.ectopy.shock(2, 300, hr).outcome, "shock");
assert.equal(step(shocked, 600, 2).conduction.rhythm, "asystole");
assert.equal(u.uVfOn.value, 0, "off in the post-shock pause");
const normal = await lab.model("normal");
assert.equal(step(normal, 300, 2).conduction.rhythm ?? "sinus", "sinus");
assert.equal(u.uVfOn.value, 0, "off in sinus rhythm");
console.log(`Bundled fibrillation layer: on in VF (wavelets in the conduction view, ordered conduction off), off after the shock and in sinus rhythm`);
