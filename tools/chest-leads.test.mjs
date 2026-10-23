// CC-55: the chest-lead (V1–V6) tab of the lab page, driven through the real
// page definition with stub canvases (no WeChat runtime, no native drawing).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import scenarios from "../data/scenarios.js";
import ecg12 from "../data/ecg12.js";

// A 2D context that accepts every call; drawing is checked on the website.
const context = () =>
  new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k, v) => ((t[k] = v), true) });
const node = (w = 360, h = 420) => ({ width: w, height: h, getContext: context });
globalThis.wx = {
  getWindowInfo: () => ({ pixelRatio: 1 }),
  createOffscreenCanvas: () => node(1, 1),
  createIntersectionObserver: () => ({ relativeTo: () => ({ observe() {} }), disconnect() {} }),
  setNavigationBarTitle() {},
  showToast() {},
};
let definition;
globalThis.Page = (page) => { definition = page; };
await import("../pages/lab/lab.js");
delete globalThis.Page;
const { createModel } = await import("../engine/waveforms.js");
const { MasterClock } = await import("../engine/clock.js");
const { PlotResume } = await import("../engine/plot-resume.js");

function lab() {
  const bound = [];
  const page = {
    ...definition,
    data: { ...definition.data, heartModel: "2d", docked: true, panel: "heart", t: {} },
    canvases: {},
    setData(values, callback) {
      Object.assign(this.data, values);
      callback?.();
    },
    async bindCanvas(id) {
      bound.push(id);
      const size = { strips: [360, 412], pv: [330, 240], ap: [360, 350], chestStrips: [360, 420], chestDiagram: [132, 118] }[id] ?? [100, 100];
      return (this.canvases[id] = { node: node(...size), w: size[0], h: size[1] });
    },
  };
  page.modifiers = { preload: 1, afterload: 1, contractility: 1 };
  page.chartsSeen = {};
  page.plotResume = new PlotResume(() => {});
  return { page, bound };
}
// The page builds its models from data/baseline.js through scenarioModel; use the same.
const baseline = (await import("../data/baseline.js")).default;
const tab = (page, name) => new Promise((resolve) => {
  const before = page.rebuild;
  page.rebuild = function (...args) {
    page.rebuild = before;
    before.apply(this, args);
    resolve();
  };
  page.setEcgTab({ currentTarget: { dataset: { tab: name } } });
});
async function open(id = "rbbb") {
  const { page, bound } = lab();
  const scenario = scenarios.find((s) => s.id === id);
  page.model = createModel(baseline, scenario);
  page.clock = new MasterClock(page.model, { hr: scenario.hr, speed: 0.5, playing: false });
  page.clock.seek(140);
  await page.attachPanel();
  return { page, bound };
}

test("every scenario has a chest-lead pattern and both languages have the same labels", () => {
  for (const s of scenarios) assert.ok(ecg12.entries[s.id]?.findings.length, s.id);
  assert.deepEqual(Object.keys(ecg12.labels.zh).sort(), Object.keys(ecg12.labels.en).sort());
});

test("the chest-lead tab binds its own canvases, shows the findings and the intervals", async () => {
  const { page, bound } = await open("rbbb");
  assert.equal(page.chest, null);
  assert.equal(page.data.chestKey, true);
  await tab(page, "chest");
  assert.ok(bound.includes("chestStrips") && bound.includes("chestDiagram"));
  assert.equal(page.canvases.strips, null, "the Wiggers canvas is gone on this tab");
  assert.equal(page.data.chestFindings.length, ecg12.entries.rbbb.findings.length);
  page.update(true);
  assert.deepEqual(page.data.chestRows.map((r) => r.k).slice(1), ["PR", "QRS", "QT"]);
  assert.equal(page.data.chestRows.find((r) => r.k === "QRS").v, "150 ms");
  // A finding lights its leads; the same tap clears them.
  page.toggleFinding({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.chestFindings[0].on, true);
  page.toggleFinding({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.chestFindings[0].on, false);
  // Back to the Wiggers strips: their canvas is bound again, the chest view dropped.
  await tab(page, "wiggers");
  assert.equal(page.chest, null);
  assert.ok(page.canvases.strips?.node);
});

test("a tap on a chest strip row lights that lead and seeks the clock in the synced mode", async () => {
  const { page } = await open("lbbb");
  await tab(page, "chest");
  assert.equal(page.chest.mode, "paper", "ECG paper by default");
  page.setChestMode({ currentTarget: { dataset: { mode: "sync" } } });
  page.clock.playing = true;
  // Row 1 of 7 (V1) on a 420 px canvas: top band 16 px, rows of ~55 px.
  page.chestStart({ touches: [{ x: 200, y: 16 + 55 * 1.5 }] });
  page.chestEnd();
  assert.deepEqual([...page.chest.highlight], ["V1"]);
  assert.equal(page.clock.playing, false);
  const t = page.clock.t;
  // Paper mode does not seek.
  page.setChestMode({ currentTarget: { dataset: { mode: "paper" } } });
  page.chestStart({ touches: [{ x: 300, y: 16 + 55 * 1.5 }] });
  page.chestEnd();
  assert.equal(page.clock.t, t);
  assert.deepEqual([...page.chest.highlight], []);
});

test("read values lists V1–V6 and a scenario without a chest-lead key finding has no dot", async () => {
  const { page } = await open("pfo");
  assert.equal(page.data.chestKey, false);
  page.update(true);
  page.readValues();
  const names = page.data.valueRows.map((r) => r.k);
  for (const lead of ["V1", "V2", "V3", "V4", "V5", "V6"]) assert.ok(names.includes(lead), lead);
});

// The copied modules must be the website's (tools/sync-from-web.mjs).
// CARDIAC_WEB: another website checkout (e.g. a branch's worktree), as the sync tools' argument.
const web = process.env.CARDIAC_WEB ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle";
test("chest-lead modules match the website", { skip: !existsSync(web) && "website checkout not beside this repo" }, async () => {
  for (const file of ["ecg12.js", "ecg12-modifiers.js"])
    assert.equal(await readFile(join("engine", file), "utf8"), await readFile(join(web, "js", file), "utf8"), file);
  const view = await readFile(join("engine", "chest-leads-view.js"), "utf8");
  const source = (await readFile(join(web, "js/chest-leads-view.js"), "utf8")).replace(/^import "\.\/[\w-]+\.css";\n/m, "");
  assert.equal(view.split("\n").slice(2).join("\n"), source);
});
