// Check the actual mini-program bundle against the website's production rig.
// Run: node tools/check-pfo-bundle.mjs [path/to/apps/cardiac_cycle]
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const web = resolve(process.argv[2] ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle");
const { atlasLab } = await import(pathToFileURL(web + "/tests/atlas-lab-node.mjs"));
const { AtlasLabView } = createRequire(import.meta.url)("../vendor/atlas3d.js");
const lab = await atlasLab();
const view = new AtlasLabView(null, { i18n: { t: key => key } });
view.motion = lab.motion;
view.prepareShaders = async () => {}; // no native renderer in this Node check
view.syncPfo(await lab.model("pfo"));
assert.ok(view.pfo?.visible);
const membrane = view.pfo.group.getObjectByName("Septum primum tissue");
assert.ok(membrane, "bundle contains the new septal membrane");
const secundum = view.pfo.group.getObjectByName("Septum secundum — descending fold");
secundum.geometry.computeBoundingBox();
const section = secundum.geometry.boundingBox;
membrane.geometry.computeBoundingBox();
const primum = membrane.geometry.boundingBox;
assert.ok(section.min.y < primum.max.y && section.max.y > primum.max.y,
  "upper muscular fold overlaps the inferior membrane, with staggered free margins");
assert.ok(primum.min.y < section.min.y, "primum continues inferior to the overlap");
assert.ok(Math.abs(section.max.x - primum.max.x) < 1e-7, "both tissues have the same section plane");
assert.ok(secundum.material.depthTest && membrane.material.depthTest);
const muscular = Array.from(secundum.geometry.attributes.position.array);
const snapshot = () => Array.from(membrane.geometry.attributes.position.array);
await lab.pose("pfo", 400, 75, 0);
const closed = snapshot();
assert.equal(view.pfo.strength, 0);
await lab.pose("pfo", 400, 75, 3);
const open = snapshot();
assert.ok(view.pfo.strength > 0.5);
assert.notDeepEqual(open, closed);
assert.deepEqual(Array.from(secundum.geometry.attributes.position.array), muscular);
assert.equal(membrane.parent.rotation.x, 0);
for (let k = 0; k < closed.length; k += 3) {
  assert.ok(open[k + 2] - closed[k + 2] <= 0.001401);
  if (closed[k + 1] < -0.0045) assert.deepEqual(open.slice(k, k + 3), closed.slice(k, k + 3));
}
const [ra, la] = view.pfo.group.children;
assert.ok(ra.position.distanceTo(la.position) < 0.001);
await lab.pose("pfo", 50, 75, 3);
assert.equal(view.pfo.strength, 0);
await lab.pose("pfo", 400, 75, 3);
assert.deepEqual(snapshot(), open);
view.syncPfo(await lab.model("asd"));
await lab.pose("asd", 400, 75, 0);
assert.equal(membrane.parent.visible, false);
assert.equal(secundum.visible, false);
view.pfo.dispose();
assert.equal(view.pfo.group.parent, null);
console.log("Mini-program bundled PFO overlap: staggered margins/shared section/closed/open/attached tissue/seek/ASD/cleanup pass");
