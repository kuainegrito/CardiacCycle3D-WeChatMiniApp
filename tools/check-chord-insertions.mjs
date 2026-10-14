// The 3D bundle's chordae against the website's own, on the website's motion
// rig. Since 2026-10-14 the bundle (vendor/atlas3d.js) carries the website's
// chord seating unchanged (the website's CC-51 made it as fast as the mini
// program's former tools/chord-insertions.js, bit for bit), and the website's
// 3D heart gates the chordae itself (AtlasLabView.syncChords, motion.chords);
// the mini program only asks it to seat them close up (chordSeating "near",
// pages/lab/lab.js). Checked here: the bundle's whole motion step writes the
// website's chord tubes, vertices and normals, bit for bit; behind opaque
// walls with the camera outside they are hidden and left as they are; through
// translucent walls from afar they are the tubes before seating; close up, or
// with "always", seated as on the website; and tools/fast-bounds.js gives
// three.js's own bounding boxes and spheres. For a phone without JIT (WeChat
// on iOS), run it with node --jitless: the step times are printed.
// Run from this folder: node tools/check-chord-insertions.mjs [path/to/apps/cardiac_cycle]
import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const web = resolve(process.argv[2] ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle");
const url = (path) => pathToFileURL(path).href;
// "three" as the web app's own copy (tools/build-vendor.mjs bundles that one).
register(
  "data:text/javascript," +
    encodeURIComponent(`
const web = ${JSON.stringify(url(web) + "/")};
export async function resolve(specifier, context, next) {
  if (specifier === "three") return next(specifier, { ...context, parentURL: web + "js/engine/chord-cable.js" });
  return next(specifier, context);
}`),
);

const { atlasLab } = await import(url(web + "/tests/atlas-lab-node.mjs"));
const { updateAvChords } = await import(url(web + "/js/engine/av-chord-runtime.js"));
const { updateMitralChordBranches } = await import(url(web + "/js/engine/mitral-chord-branches.js"));
const { boundingBox, boundingSphere } = await import("./fast-bounds.js");
const THREE = await import("three");

const lab = await atlasLab();
const { motion } = lab;
const { avPreview, mitralBranches } = motion;
const chords = [...avPreview.attachments, ...mitralBranches.attachments];
const lines = chords.map(({ line }) => line);
const snapshot = () =>
  chords.map(({ line }) => [line.geometry.attributes.position.array.slice(), line.geometry.attributes.normal.array.slice()]);
const same = (x, y) => x.length === y.length && x.every((v, i) => Object.is(v, y[i]));
const sameTubes = (expected, where) =>
  snapshot().forEach(([p, n], k) => assert.ok(same(p, expected[k][0]) && same(n, expected[k][1]), `${where}: chord ${k}`));
// The tubes of the current pose as a step writes them before seating.
function unseated() {
  updateAvChords(avPreview);
  updateMitralChordBranches(mitralBranches, { seat: false });
}

// The tubes' bounding boxes and spheres (tools/fast-bounds.js, installed in
// the bundle) against three.js's own, over the website's own steps.
const bounds = (g) => [...g.boundingBox.min.toArray(), ...g.boundingBox.max.toArray(), ...g.boundingSphere.center.toArray(), g.boundingSphere.radius];
let poses = 0;
for (const [id, beats] of [["normal", [0]], ["as", [0]], ["mr", [0]], ["pfo", [0, 3]], ["lbbb", [0]], ["af", [0, 1]]])
  for (const beat of beats)
    for (let t = 0; t < 800; t += 23) {
      delete motion.chords; // the website's whole step, all chordae seated
      await lab.pose(id, t, 75, beat);
      const three = chords.map(({ line: { geometry: g } }) => (g.computeBoundingBox(), g.computeBoundingSphere(), bounds(g)));
      const fast = chords.map(({ line: { geometry: g } }) => (boundingBox(THREE, g), boundingSphere(THREE, g), bounds(g)));
      fast.forEach((b, k) => assert.ok(same(b, three[k]), `${id} beat ${beat} at ${t} ms: chord ${k} bounding box and sphere`));
      poses++;
    }
console.log(`${poses} poses, ${chords.length} chords: tools/fast-bounds.js gives three.js's bounding boxes and spheres.`);

// The bundle's AtlasLabView on the same rig, with a stand-in camera at a
// named view's distance (1.4 diagonals) or inside the heart (0.3).
const bundle = createRequire(import.meta.url)("../vendor/atlas3d.js");
const view = new bundle.AtlasLabView(null, { i18n: { t: (key) => key } });
view.motion = motion;
view.render = view.describe = () => {};
view.diagonal = 0.2;
let distance = 0.28;
view.camera = { position: { length: () => distance } };
view.chordSeating = "near";
const settle = () => new Promise((done) => setTimeout(done, 0)); // the gate's re-step (a microtask)
const step = async (id, t) => {
  const model = await lab.model(id);
  view.stateKey = undefined;
  view.update({ model, sample: model.sample(t, 75, {}, 0), t, hr: 75, beatIndex: 0, modifiers: {}, baseline: lab.baseline });
};
const gate = async ({ opacity, inside, seating = "near" }) => {
  view.wallOpacity = opacity;
  distance = inside ? 0.06 : 0.28;
  view.chordSeating = seating;
  view.syncChords();
  await settle();
};
// The bundle compiles its own chamber-volume tensors at its first step.
delete motion.chords;
await step("normal", 0);
const ms = { inactive: 0, unseated: 0, seated: 0 };
let steps = 0;
const timed = async (kind, id, t) => {
  const start = performance.now();
  await step(id, t);
  ms[kind] += performance.now() - start;
};
for (const [id, t] of [["normal", 120], ["as", 300], ["mr", 260], ["pfo", 480], ["lbbb", 700]]) {
  delete motion.chords;
  await lab.pose(id, t); // the website's step
  const website = snapshot(),
    shown = lines.map((line) => line.visible);
  unseated();
  const straight = snapshot();
  await gate({ opacity: 1, inside: true });
  await step(id, t); // (also builds this scenario's tables)
  sameTubes(website, `bundle ${id} at ${t} ms, inside the heart`);

  await gate({ opacity: 1, inside: false }); // anatomy view from outside
  assert.deepEqual(motion.chords, { active: false, seat: false }, `${id}: opaque walls, camera outside`);
  const before = snapshot();
  await timed("inactive", id, t + 200);
  assert.ok(lines.every((line) => !line.visible), `${id}: hidden behind opaque walls`);
  sameTubes(before, `${id}: hidden chordae are left as they were`);

  await gate({ opacity: 0.3, inside: false }); // a translucent view from afar
  assert.deepEqual(motion.chords, { active: true, seat: false }, `${id}: translucent walls from afar`);
  await timed("unseated", id, t);
  assert.deepEqual(lines.map((line) => line.visible), shown, `${id}: shown again as before`);
  sameTubes(straight, `bundle ${id} at ${t} ms, unseated from afar`);

  await gate({ opacity: 0.3, inside: true }); // zoomed into a chamber
  assert.deepEqual(motion.chords, { active: true, seat: true }, `${id}: inside the heart`);
  await timed("seated", id, t);
  sameTubes(website, `bundle ${id} at ${t} ms, seated close up`);

  await gate({ opacity: 0.3, inside: false, seating: "always" }); // the website's own setting
  assert.deepEqual(motion.chords, { active: true, seat: true }, `${id}: "always" seats from afar`);
  await step(id, t);
  sameTubes(website, `bundle ${id} at ${t} ms, seated from afar ("always")`);
  steps++;
}
const per = (v) => (v / steps).toFixed(1);
console.log(
  `vendor/atlas3d.js: the website's chord tubes, hidden, unseated and seated as the gate says. Whole motion step: ` +
    `${per(ms.inactive)} ms hidden, ${per(ms.unseated)} ms unseated, ${per(ms.seated)} ms seated`,
);
