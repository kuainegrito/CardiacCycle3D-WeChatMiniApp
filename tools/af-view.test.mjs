import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { conduction2dState } from "../engine/heart2d-conduction.js";
import { createModel } from "../engine/waveforms.js";
import baseline from "../data/baseline.js";
import scenarios from "../data/scenarios.js";

test("mini-program 2D AF fronts match web code, affect both atria, and follow absolute time", async () => {
  const web = resolve(process.env.CARDIAC_WEB ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle");
  assert.equal(await readFile("engine/heart2d-conduction.js", "utf8"), await readFile(web + "/js/heart2d-conduction.js", "utf8"));
  const m = createModel(baseline, scenarios.find(s => s.id === "af"));
  const s = m.sample(145, 75, {}, 2);
  const at = t => conduction2dState(s.conduction, {}, t).routes.filter(r => r.id.startsWith("af-"));
  const waves = at(s.absolute);
  assert.equal(waves.length, 6);
  for (const chamber of ["RA", "LA"]) assert.equal(waves.filter(r => r.id.includes(chamber)).length, 3);
  assert.notDeepEqual(waves, at(s.absolute + 41));
  assert.deepEqual(waves, at(s.absolute));
  const drawing = await readFile("engine/heart2d.js", "utf8");
  assert.match(drawing, /conductionView.update\(frame.sample\?\.conduction, this.state.s, g.shell, frame.sample\?\.absolute\)/);
});
