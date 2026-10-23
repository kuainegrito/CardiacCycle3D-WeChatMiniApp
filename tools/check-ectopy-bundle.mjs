// CC-60: the actual 3D bundle (vendor/atlas3d.js) builds the website's
// premature-beat conduction field (js/atlas-ectopic-conduction.js, website
// CC-59) on the website's production rig, swaps it in for a premature beat
// only, and shows the ectopic mark (made without a document: the bundle's
// browser globals are vendor/atlas-shim.js here).
// Run: node tools/check-ectopy-bundle.mjs [path/to/apps/cardiac_cycle]
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
const ectopic = view.ectopicConduction;
assert.ok(ectopic, "the premature-beat field is built in the bundle");
assert.ok(ectopic.field.entries.length > 0 && ectopic.field.maxDistance > 0.05);
assert.equal(ectopic.marker.isMesh, true);

const model = await lab.model("lbbb");
assert.equal(model.ectopy.stimulate(2, 560, 75).outcome, "pvc");
const layer = view.views.conduction.layer;
await lab.pose("lbbb", 30, 75, 3); // 20 ms into the premature beat's QRS
assert.equal(ectopic.swapped, true);
assert.equal(ectopic.marker.visible, true);
assert.equal(layer.uniforms.uCondLeftDelay.value, 0, "no bundle-branch delay in the premature beat");
const entry = ectopic.field.entries.find((e) => e.geometry === e.mesh.geometry);
assert.deepEqual(Array.from(entry.geometry.attributes.atlasActivation.array), Array.from(entry.activation));
await lab.pose("lbbb", 100, 75, 5); // a beat after the pause
assert.equal(ectopic.swapped, false);
assert.equal(ectopic.marker.visible, false);
assert.equal(layer.uniforms.uCondLeftDelay.value, 70);
assert.deepEqual(Array.from(entry.geometry.attributes.atlasActivation.array), Array.from(entry.record.activation));
console.log(
  `Bundled premature-beat conduction: field over ${ectopic.field.entries.length} geometries (max ${(ectopic.field.maxDistance * 1000).toFixed(0)} mm), swapped in the PVC only, delay off, mark shown`,
);
