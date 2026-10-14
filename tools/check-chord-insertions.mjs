// The mini program's chord seating (tools/chord-insertions.js, bundled in
// place of the website's js/engine/chord-insertions.js) against the website's
// own, on the website's motion rig: the same chord tubes, bit for bit (vertices
// and normals), over beats of several scenarios, and the time each takes.
// For a phone without JIT (WeChat on iOS), run it with node --jitless.
// Run from this folder: node tools/check-chord-insertions.mjs [path/to/apps/cardiac_cycle]
import assert from "node:assert/strict";
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const web = resolve(process.argv[2] ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle");
const url = (path) => pathToFileURL(path).href;
// The bundle's aliases (tools/build-vendor.mjs): "@web/" is the web app, and
// "three" is the web app's own copy.
register(
  "data:text/javascript," +
    encodeURIComponent(`
const web = ${JSON.stringify(url(web) + "/")};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@web/")) return next(web + specifier.slice(5), context);
  if (specifier === "three") return next(specifier, { ...context, parentURL: web + "js/engine/chord-cable.js" });
  return next(specifier, context);
}`),
);

const { atlasLab } = await import(url(web + "/tests/atlas-lab-node.mjs"));
const { seatChordInsertions: websiteSeat } = await import(url(web + "/js/engine/chord-insertions.js"));
const { updateAvChords, writeCableGeometry } = await import(url(web + "/js/engine/av-chord-runtime.js"));
const { seatChordInsertions: miniSeat } = await import("./chord-insertions.js");
const { boundingBox, boundingSphere } = await import("./fast-bounds.js");
const THREE = await import("three");

const lab = await atlasLab();
const { avPreview, mitralBranches } = lab.motion;
const chords = [...avPreview.attachments, ...mitralBranches.attachments];
const snapshot = () =>
  chords.map(({ line }) => [line.geometry.attributes.position.array.slice(), line.geometry.attributes.normal.array.slice()]);
// The tubes of this pose as the motion step writes them before seating.
function unseated() {
  updateAvChords(avPreview);
  for (const c of mitralBranches.attachments) writeCableGeometry(c.line.geometry, c.cable.points, 0.00018);
}
const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));

// The tubes' bounding boxes and spheres (tools/fast-bounds.js, installed in
// the bundle) against three.js's own.
const bounds = (g) => [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray(), ...g.boundingSphere.center.toArray(), g.boundingSphere.radius];
let threeBoundsMs = 0,
  fastBoundsMs = 0;
function checkBounds(where) {
  let start = performance.now();
  const three = chords.map(({ line: { geometry: g } }) => (g.computeBoundingBox(), g.computeBoundingSphere(), bounds(g)));
  threeBoundsMs += performance.now() - start;
  start = performance.now();
  const fast = chords.map(({ line: { geometry: g } }) => (boundingBox(THREE, g), boundingSphere(THREE, g), bounds(g)));
  fastBoundsMs += performance.now() - start;
  fast.forEach((b, k) => assert.ok(same(b, three[k]), `${where}: chord ${k} bounding box and sphere`));
}

let poses = 0,
  websiteMs = 0,
  miniMs = 0;
for (const [id, beats] of [["normal", [0]], ["as", [0]], ["mr", [0]], ["pfo", [0, 3]], ["lbbb", [0]], ["af", [0, 1]]]) {
  for (const beat of beats) {
    for (let t = 0; t < 800; t += 23) {
      await lab.pose(id, t, 75, beat); // the website's whole step, seating included
      const website = snapshot();
      unseated();
      let start = performance.now();
      websiteSeat(avPreview);
      websiteSeat(mitralBranches);
      websiteMs += performance.now() - start;
      assert.ok(snapshot().every(([p, n], k) => same(p, website[k][0]) && same(n, website[k][1])), "the website's seating is repeatable");
      unseated();
      start = performance.now();
      miniSeat(avPreview);
      miniSeat(mitralBranches);
      miniMs += performance.now() - start;
      const mini = snapshot();
      chords.forEach(({ line }, k) => {
        assert.ok(same(mini[k][0], website[k][0]), `${id} beat ${beat} at ${t} ms: ${line.name || "chord " + k} vertices`);
        assert.ok(same(mini[k][1], website[k][1]), `${id} beat ${beat} at ${t} ms: ${line.name || "chord " + k} normals`);
      });
      checkBounds(`${id} beat ${beat} at ${t} ms`);
      poses++;
    }
  }
}
console.log(
  `${poses} poses, ${chords.length} chords: identical vertices, normals, bounding boxes and spheres. Per step: ` +
    `seating ${(websiteMs / poses).toFixed(2)} → ${(miniMs / poses).toFixed(2)} ms, bounds ${(threeBoundsMs / poses).toFixed(2)} → ${(fastBoundsMs / poses).toFixed(2)} ms (website → mini program)`,
);

// The bundle itself (vendor/atlas3d.js, AtlasLabView's whole motion step) on
// the same rig (setChords, tools/chord-gate.js): seated, the website's chord
// tubes; unseated, the website's tubes before seating (writeCableGeometry);
// inactive, hidden and untouched; active again, shown and moved.
const { createRequire } = await import("node:module");
const bundle = createRequire(import.meta.url)("../vendor/atlas3d.js");
const view = new bundle.AtlasLabView(null, { i18n: { t: (key) => key } });
view.motion = lab.motion;
view.render = view.describe = () => {};
const lines = chords.map(({ line }) => line);
const step = async (id, t) => {
  const model = await lab.model(id);
  view.stateKey = undefined;
  view.update({ model, sample: model.sample(t, 75, {}, 0), t, hr: 75, beatIndex: 0, modifiers: {}, baseline: lab.baseline });
};
const sameTubes = (expected, where) =>
  chords.forEach((c, k) => assert.ok(same(snapshot()[k][0], expected[k][0]) && same(snapshot()[k][1], expected[k][1]), `${where}: chord ${k}`));
// The bundle compiles its own chamber-volume tensors at its first step on a
// rig built by the website's modules (in the mini program it builds the rig).
await step("normal", 0);
const bundleMs = { seated: 0, unseated: 0, inactive: 0 };
let steps = 0;
for (const [id, t] of [["normal", 120], ["as", 300], ["mr", 260], ["pfo", 480], ["lbbb", 700]]) {
  await lab.pose(id, t); // the website's step
  const website = snapshot(),
    shown = lines.map((line) => line.visible);
  unseated();
  const straight = snapshot();
  await step(id, t); // (also builds this scenario's tables)
  sameTubes(website, `bundle ${id} at ${t} ms`);
  bundle.setChords({ active: true, seat: false });
  let start = performance.now();
  await step(id, t);
  bundleMs.unseated += performance.now() - start;
  sameTubes(straight, `bundle ${id} at ${t} ms unseated`);
  bundle.setChords({ active: false });
  const before = snapshot();
  start = performance.now();
  await step(id, t + 200);
  bundleMs.inactive += performance.now() - start;
  assert.ok(lines.every((line) => !line.visible), `${id}: inactive chordae are hidden`);
  sameTubes(before, `${id}: inactive chordae are left as they were`);
  bundle.setChords({ active: true, seat: true });
  start = performance.now();
  await step(id, t);
  bundleMs.seated += performance.now() - start;
  assert.deepEqual(lines.map((line) => line.visible), shown, `${id}: reactivated chordae are shown as before`);
  sameTubes(website, `bundle ${id} at ${t} ms after reactivation`);
  steps++;
}
const per = (ms) => (ms / steps).toFixed(1);
console.log(
  `vendor/atlas3d.js: seated, unseated and inactive chordae as expected. Whole motion step: ${per(bundleMs.seated)} ms seated, ${per(bundleMs.unseated)} ms unseated, ${per(bundleMs.inactive)} ms inactive`,
);
