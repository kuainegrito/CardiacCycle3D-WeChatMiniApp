// CC-60: the ectopic stimulus in the lab page (website CC-57…59), driven
// through the real page definition with stub canvases, as chest-leads.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import scenarios from "../data/scenarios.js";
import ecg12 from "../data/ecg12.js";
import ectopyLabels from "../data/ectopy.js";
import labels from "../data/labels.js";

const context = () =>
  new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ width: 0 })), set: (t, k, v) => ((t[k] = v), true) });
const node = (w = 360, h = 380) => ({ width: w, height: h, getContext: context });
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
const baseline = (await import("../data/baseline.js")).default;

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
      const size = { strips: [360, 412], pv: [330, 240], ap: [360, 350], chestStrips: [360, 420], chestDiagram: [132, 118], rhythmStrip: [360, 380] }[id] ?? [100, 100];
      return (this.canvases[id] = { node: node(...size), w: size[0], h: size[1] });
    },
  };
  page.modifiers = { preload: 1, afterload: 1, contractility: 1 };
  page.chartsSeen = {};
  page.plotResume = new PlotResume(() => {});
  return { page, bound };
}
async function open(id = "normal") {
  const { page, bound } = lab();
  const scenario = scenarios.find((s) => s.id === id);
  page.model = createModel(baseline, scenario);
  page.clock = new MasterClock(page.model, { hr: scenario.hr, speed: 0.5, playing: false });
  page.clock.seek(100);
  await page.attachPanel();
  page.renderEctopyResult();
  return { page, bound };
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
// Pause at a share of the time after the ventricular ERP (negative: inside it).
function pauseAt(page, share) {
  const { clock, model } = page,
    s = model.sample(0, clock.hr, {}, clock.beatIndex),
    q = s.timing.qrsStart,
    erp = 250 * s.timing.rateScale,
    T = model.cycleDuration(clock.hr, clock.beatIndex);
  clock.playing = false;
  clock.seek(share < 0 ? q + erp * 0.4 : q + erp + 5 + share * (T - q - erp - 10));
}
// One 16 ms frame of the page's own loop (lab.js loop): the stimulus hold,
// the Loop rule, the clock, a new beat, preparing the next one.
let now = 1e6;
function frame(page) {
  now += 16;
  if (page.holding(now)) page.clock.lastNow = now;
  else {
    page.syncLoop();
    page.clock.update(now);
  }
  if (page.previousBeat !== page.clock.beatIndex) page.newBeat();
  page.prepareNextBeat();
}
// Play the clock on through the page's own beat handling.
function play(page, ms) {
  page.clock.playing = true;
  page.clock.lastNow = now;
  for (let t = 0; t < ms; t += 16) frame(page);
  page.clock.playing = false;
  page.update(true);
}

test("the copied modules, labels and chest-lead entry are the website's", { skip: !existsSync(process.env.CARDIAC_WEB ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle") && "website checkout not beside this repo" }, async () => {
  const web = process.env.CARDIAC_WEB ?? "../../My_webpage/cycling-metabolism_simulator/apps/cardiac_cycle";
  const own = (f) => readFile(join("engine", f), "utf8");
  assert.equal(await own("ectopy.js"), await readFile(join(web, "js/engine/ectopy.js"), "utf8"));
  assert.equal(await own("ectopy-sounds.js"), await readFile(join(web, "js/ectopy-sounds.js"), "utf8"));
  const view = await own("ectopy-view.js"),
    source = (await readFile(join(web, "js/ectopy-view.js"), "utf8")).replace(/^import "\.\/[\w-]+\.css";\n/m, "");
  assert.equal(view.split("\n").slice(2).join("\n"), source);
  assert.deepEqual(ectopyLabels, JSON.parse(await readFile(join(web, "content/ectopy/labels.json"), "utf8")));
  assert.deepEqual(ecg12.ectopic, JSON.parse(await readFile(join(web, "content/ecg12/ectopic.json"), "utf8")));
  // CC-61 / CC-64: the Loop-off rule and the fibrillation wall jitter.
  for (const file of ["beats.js", "vf-view.js"]) assert.equal(await own(file), await readFile(join(web, "js", file), "utf8"), file);
  assert.ok(scenarios.some((x) => x.id === "vf"), "the VF scenario is synced");
});

test("the help text explains the stimulus and has no quiz pointer (no quiz here)", () => {
  assert.match(labels.zh.helpText, /⚡ 异位刺激/);
  assert.match(labels.en.helpText, /Ectopic stimulus/);
  assert.doesNotMatch(labels.zh.helpText, /小测/);
  assert.doesNotMatch(labels.en.helpText, /quiz/);
  assert.deepEqual(Object.keys(ectopyLabels.zh).sort(), Object.keys(ectopyLabels.en).sort());
});

test("inside the ERP no response; after it a premature beat with a complete compensatory pause", async () => {
  const { page, bound } = await open("normal");
  assert.equal(page.data.ectopyText, "", "no hint line before the first stimulus");
  assert.equal(page.data.stimulusDisabled, false);
  // Refractory: nothing changes, playback resumes, the rhythm strip opens once.
  pauseAt(page, -1);
  const T = page.model.cycleDuration(page.clock.hr, page.clock.beatIndex);
  page.stimulate();
  await settle();
  assert.equal(page.data.ectopyOutcome, "refractory");
  assert.equal(page.model.ectopy.version, 0);
  assert.equal(page.model.cycleDuration(page.clock.hr, page.clock.beatIndex), T);
  assert.equal(page.clock.playing, true, "a paused stimulus plays on");
  assert.equal(page.data.ecgTab, "rhythm");
  assert.ok(bound.includes("rhythmStrip") && page.rhythm.canvas);
  assert.match(page.data.ectopyText, /有效不应期（QRS 后 0–250 ms）/);
  // After the ERP: a premature beat.
  pauseAt(page, 0.45);
  const k = page.clock.beatIndex;
  page.stimulate();
  assert.equal(page.data.ectopyOutcome, "pvc");
  assert.match(page.data.ectopyText, /= 1\.60 s = 2 × 0\.80 s（完全代偿间歇）/);
  assert.doesNotMatch(page.data.ectopyText, /已切换到节律条/, "the strip opens only once");
  assert.ok(page.stimulusHold, "the clock waits for the premature beat (CC-61)");
  play(page, 3200);
  const kinds = [...page.rhythm.beats.entries()].filter(([b]) => b > k).map(([, b]) => b.kind);
  assert.ok(kinds.includes("pvc") && kinds.includes("post"), kinds.join(","));
  const pauses = page.rhythm.pauses(page.clock.t);
  assert.equal(pauses.length, 1);
  assert.ok(Math.abs(pauses[0].to - pauses[0].from - 2 * pauses[0].rrMs) < 1);
  // The values dialog names the kind of beat.
  page.readValues();
  assert.ok(page.data.valueRows.some((r) => r.k === "本拍类型"));
});

test("a scenario, rate or loading change clears the stimuli; AF and complete block disable the button", async () => {
  const { page } = await open("normal");
  const stimulated = () => {
    pauseAt(page, 0.45);
    page.stimulate();
    assert.equal(page.model.ectopy.active, true);
  };
  stimulated();
  page.onHR({ detail: { value: 90 } });
  assert.equal(page.model.ectopy.active, false);
  assert.equal(page.data.ectopyText, "");
  stimulated();
  page.onLoading({ currentTarget: { dataset: { key: "preload" } }, detail: { value: 1.2 } });
  assert.equal(page.model.ectopy.active, false);
  page.resetLoads();
  stimulated();
  const before = page.model;
  page.onScenario({ detail: { value: scenarios.findIndex((s) => s.id === "mr") } });
  assert.equal(page.model.ectopy.active, false);
  page.onScenario({ detail: { value: scenarios.findIndex((s) => s.id === "normal") } });
  assert.equal(page.model.ectopy.active, false, "the scenario's model comes back without stimuli");
  assert.notEqual(page.model, before);
  for (const [id, text] of [["af", /房颤/], ["complete-block", /三度房室阻滞/]]) {
    page.onScenario({ detail: { value: scenarios.findIndex((s) => s.id === id) } });
    assert.equal(page.data.stimulusDisabled, true, id);
    assert.match(page.data.ectopyText, text);
    page.stimulate();
    assert.equal(page.model.ectopy.active, false);
  }
});

test("CC-61: the clock waits at the stimulus while the premature beat is prepared, then plays it", async () => {
  const { page } = await open("normal");
  pauseAt(page, 0.45);
  const k = page.clock.beatIndex,
    c = page.clock.t;
  page.stimulate();
  page.clock.lastNow = now;
  let held = 0;
  while (page.clock.beatIndex === k && held < 2000) {
    frame(page);
    if (page.clock.beatIndex === k) {
      held++;
      assert.equal(page.clock.t, c, "the clock does not move while it waits");
    }
  }
  assert.equal(page.clock.beatIndex, k + 1);
  assert.ok(held >= 1, "it waited at least one frame");
  assert.equal(page.stimulusHold, null);
  assert.equal(page.sameBeats, false);
  assert.equal(page.series[0].ectopy?.kind, "pvc", "the premature beat's prepared traces");
  assert.equal(page.series.length, 400);
});

test("CC-61 R1: with Loop off the premature beat, the pause and the post-pause beat still play", async () => {
  const { page } = await open("normal");
  page.toggleLoop();
  assert.equal(page.data.loop, false);
  pauseAt(page, 0.45);
  const k = page.clock.beatIndex;
  page.stimulate();
  assert.equal(page.clock.playing, true);
  page.clock.lastNow = now;
  for (let i = 0; i < 5000 && page.clock.playing; i++) frame(page);
  assert.equal(page.clock.playing, false);
  assert.equal(page.clock.beatIndex, k + 2, "stops in the post-pause beat");
  assert.ok(page.model.cycleDuration(page.clock.hr, k + 2) - page.clock.t < 0.01, "at its end");
  assert.equal(page.data.loop, false, "the Loop setting itself is unchanged");
  // Without a stimulus, Loop off still stops at the end of the beat.
  const plain = (await open("normal")).page;
  plain.toggleLoop();
  plain.clock.playing = true;
  plain.clock.lastNow = now;
  const b = plain.clock.beatIndex;
  for (let i = 0; i < 500 && plain.clock.playing; i++) frame(plain);
  assert.equal(plain.clock.beatIndex, b);
});

// CC-64 (website js/aed.js): the vulnerable period, the AED and the shock.
test("CC-64: a stimulus at the T-wave peak with the vulnerable switch on starts VF; the AED advises and the shock restores sinus rhythm", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page } = await open("normal");
  assert.equal(page.data.vulnerable, false, "off by default");
  // Off: a stimulus at the peak is an ordinary premature beat.
  const peak = (p) => p.model.ectopy.vulnerablePeak(p.clock.beatIndex, p.clock.hr);
  page.clock.playing = false;
  page.clock.seek(peak(page));
  page.stimulate();
  assert.equal(page.data.ectopyOutcome, "pvc");
  // In sinus rhythm the AED does not advise a shock.
  page.analyzeAed();
  assert.equal(page.data.aedStatus, "analyzing");
  assert.equal(page.data.ecgTab, "rhythm");
  t.mock.timers.tick(2000);
  assert.equal(page.data.aedStatus, "notAdvised");
  assert.match(page.data.aedText, /不建议电击/);
  // On, at the peak of a later beat: fibrillation.
  page.onHR({ detail: { value: 75 } }); // a clean plan (and the switch back off)
  assert.equal(page.data.aedStatus, "idle");
  page.toggleVulnerable();
  assert.equal(page.data.vulnerable, true);
  page.clock.playing = false;
  page.clock.seek(peak(page));
  page.stimulate();
  assert.equal(page.data.ectopyOutcome, "vf");
  assert.match(page.data.ectopyText, /心室颤动/);
  assert.equal(page.model.ectopy.rhythmAt(page.clock.beatIndex, page.clock.t + 50, page.clock.hr), "vf");
  play(page, 1200);
  assert.equal(page.sample.conduction.rhythm, "vf");
  assert.equal(page.beatTypeText(page.sample), "心室颤动");
  // No shock button until the analysis advises one.
  page.deliverShock();
  assert.equal(page.model.ectopy.events.filter((e) => e.type === "shock").length, 0);
  page.analyzeAed();
  t.mock.timers.tick(2000);
  assert.equal(page.data.aedStatus, "advised");
  page.deliverShock();
  assert.equal(page.data.aedStatus, "shock");
  assert.match(page.data.aedText, /首次电击即成功/);
  assert.match(page.data.aedText, /不是 AED 操作培训/);
  play(page, 400);
  assert.equal(page.sample.conduction.rhythm, "asystole");
  play(page, 3200); // the 1.5 s pause at speed 0.5, then sinus
  assert.equal(page.sample.conduction.rhythm, "sinus");
});

test("CC-64: a scenario change during the analysis cancels it; the VF scenario says so and is advised a shock", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { page } = await open("normal");
  page.analyzeAed();
  page.onScenario({ detail: { value: scenarios.findIndex((s) => s.id === "vf") } });
  assert.equal(page.data.aedStatus, "idle");
  t.mock.timers.tick(2000);
  assert.equal(page.data.aedStatus, "idle", "the old analysis does not come back");
  assert.match(page.data.ectopyText, /心室颤动：心室无有效输出/);
  page.analyzeAed();
  t.mock.timers.tick(2000);
  assert.equal(page.data.aedStatus, "advised");
});

// Website CC-61 freeze fix: a stimulus at t = 0 (a paused cursor at the
// beat start) used to cut a zero-length beat; the rhythm strip drew the rest
// of the old beat over the premature one.
test("CC-61: a stimulus at t = 0 plays on, and the strip's shortened beat ends at the stimulus", async () => {
  const { page } = await open("normal");
  page.clock.playing = false;
  page.clock.seek(0);
  const k = page.clock.beatIndex;
  page.stimulate();
  assert.equal(page.data.ectopyOutcome, "pvc");
  assert.ok(page.model.cycleDuration(page.clock.hr, k) >= 1, "no zero-length beat");
  page.clock.lastNow = now;
  for (let i = 0; i < 400 && page.clock.beatIndex < k + 2; i++) frame(page);
  assert.ok(page.clock.beatIndex >= k + 2, "the clock runs on through the premature beat");
  // A later stimulus: the strip keeps the shortened beat only up to it.
  pauseAt(page, 0.45);
  const b = page.clock.beatIndex, c = page.clock.t;
  page.stimulate();
  const beat = page.rhythm.beats.get(b);
  assert.ok(Math.abs(beat.T - c) < 1e-6);
  assert.ok(beat.rows.at(-1).t <= c + 1e-6 && beat.rows.every((r) => r.t <= c + 1e-6), "no rows past the stimulus");
});
