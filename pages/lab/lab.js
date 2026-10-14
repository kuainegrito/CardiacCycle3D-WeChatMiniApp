// The lab page: the website's phone layout (apps/cardiac_cycle/index.html +
// js/app.js) rebuilt in WXML, driving the website's own model, 2D heart and
// charts (copied into engine/ by tools/sync-from-web.mjs). No login, storage
// or tracking; the author's details appear only in the "?" dialog.
import baseline from "../../data/baseline.js";
import scenarios from "../../data/scenarios.js";
import labels from "../../data/labels.js";
import heartLabels from "../../data/heart-labels.js";
import atrialVolume from "../../data/atrial-volume.js";
import { createModel } from "../../engine/waveforms.js";
import { MasterClock } from "../../engine/clock.js";
import { PlotResume } from "../../engine/plot-resume.js";
import { selectPfoInspectionBeat } from "../../engine/pfo-inspection.js";
import { HeartAudio } from "../../engine/heart-audio.js";
import { Charts } from "../../engine/charts.js";
import { Heart2DView } from "../../engine/heart2d.js";
import { SvgElement, controls, adoptCanvas, devicePixelRatio } from "../../engine/mp-dom.js";
import { SvgPainter } from "../../engine/svg-canvas.js";
import { scenarioView } from "../../engine/scenario-views.js";

const PRESETS = ["anatomy", "xray", "conduction", "filling", "flow"];
const VERSION = "1.0.0"; // the website's package.json version this copy follows
const SPEEDS = [0.1, 0.25, 0.5, 1, 2];
const VALVES = ["mitral", "aortic", "tricuspid", "pulmonary"];
const UI_MS = 100; // setData throttle while playing
const SETTLE_HOLD_MS = 2000; // longest a scenario switch holds the 3D heart (settleAtlas)
// 3D views whose teaching layer builds blood-flow tables for each scenario
// (AtlasLabView's flow streaks, filling jets and inflow).
const FLOW_VIEWS = new Set(["flow", "filling"]);
// Beat-to-beat differences below this (mV, mL, mmHg) are rounding (checkBeats);
// real ones are 0.1 and more.
const BEAT_TOLERANCE = 1e-9;
// Preparing the next beat (prepareNextBeat): at most this long a frame,
// assuming frames this far apart (slower than 60 Hz on a busy phone).
const PREPARE_MS = 8;
const PREPARE_FRAME_MS = 33;
// The 3D heart's motion steps: at most one per 60 Hz frame (a 120 Hz screen
// would draw it twice as often), and on a slow phone at most three quarters
// of the time (stepAtlas).
const ATLAS_MIN_MS = 15;
// A camera nearer the heart's centre than this share of its diagonal may be
// inside a chamber, where the chordae and their seating can be seen
// (syncChords). The named views frame the heart from 1.3–1.6 diagonals; the
// PFO's close-up of the septum is about half a diagonal away.
const CHORD_CAMERA = 0.6;
const HEART_TEXT = {
  labels: Object.fromEntries(Object.keys(heartLabels.en.labels).map((k) => [k, [heartLabels.en.labels[k], heartLabels.zh.labels[k]]])),
  notes: Object.fromEntries(Object.keys(heartLabels.en.notes).map((k) => [k, [heartLabels.en.notes[k], heartLabels.zh.notes[k]]])),
};

// The author line of the website's header (index.html), shown in the "?" dialog.
const AUTHOR = { name: "于快", email: "yukuai@gmc.edu.cn", site: "https://www.kuaiyu.site/" };
// Mini program wording that differs from the website (owner, 2026-10-09).
const OVERRIDES = {
  zh: {
    // The share card title (the website dropped this banner line on 2026-10-10).
    title: "一次心跳，贯通所有联系。",
    heartAtlas: "三维心脏",
    audioUnavailable: "无法播放心音，请检查设备声音设置或更新微信。",
    atlasLoading: "正在载入三维心脏模型…请耐心等待大约10~30秒\n载入后：单指拖动旋转心脏；双指捏合缩放，双指同时拖动可平移心脏。",
    atlasFailed: "三维心脏模型载入失败，已改用二维心脏。",
    loadTitle: "正在载入三维心脏",
    loadWait: "约 10~30 秒",
    "load.glb": "下载心脏模型（2.3 MB）",
    "load.glbCached": "读取心脏模型（本机已缓存）",
    "load.engine": "载入三维引擎",
    "load.build": "构建三维心脏",
    "load.warm": "预热，让心脏一出现就在跳",
    loadSlow: "网络较慢时，可先点左侧「二维心脏」；三维心脏会在后台继续载入，好了会在右上角提示。",
    loadSlowDownload: "网络较慢时，可先点左侧「二维心脏」；模型会在后台继续下载，之后再切回「三维心脏」即可。",
    atlasStandby: "三维心脏已载入 · 点此切换",
    loadTip: "小知识",
    atlasPinned: "三维心脏始终固定在顶部",
    atlasFailedTitle: "三维心脏载入失败",
    atlasDomain: "无法连接 kuaiyu.site。真机预览请在小程序后台「开发管理 → 服务器域名」的 request 合法域名中加入 https://www.kuaiyu.site，或在右上角菜单中打开「开发调试」。",
    atlasNetwork: "下载三维心脏模型失败，请检查网络后重试。",
    atlasNoWebgl: "此设备的微信无法提供 WebGL2，暂时只能使用二维心脏。",
    atlasLost: "图形环境被系统中断，请重试。",
    reason: "原因",
    authorEmail: "邮箱",
    authorSite: "个人网站",
    copyHint: "点击复制邮箱或网址，也可长按选择文字。",
    copied: "已复制",
    copyFailed: "请长按文字复制",
  },
  en: {
    title: "One heartbeat. Every connection.",
    heartAtlas: "3D heart",
    audioUnavailable: "Cannot play heart sounds. Check device sound settings or update WeChat.",
    atlasLoading: "Loading the 3D heart model… please allow about 10–30 seconds\nThen: drag with one finger to turn the heart; pinch with two fingers to zoom, and drag with two fingers to move it.",
    atlasFailed: "The 3D heart could not load; showing the 2D heart.",
    loadTitle: "Loading the 3D heart",
    loadWait: "about 10–30 s",
    "load.glb": "Downloading the heart model (2.3 MB)",
    "load.glbCached": "Reading the heart model (saved on this phone)",
    "load.engine": "Loading the 3D engine",
    "load.build": "Building the 3D heart",
    "load.warm": "Warming up, so it beats from the start",
    loadSlow: "On a slow network, tap “2D heart” on the left; the 3D heart keeps loading, and a note in the top-right corner says when it is ready.",
    loadSlowDownload: "On a slow network, tap “2D heart” on the left; the model keeps downloading, and you can switch back to the 3D heart later.",
    atlasStandby: "3D heart ready · tap to switch",
    loadTip: "Did you know?",
    atlasPinned: "The 3D heart stays pinned",
    atlasFailedTitle: "3D heart unavailable",
    atlasDomain: "Cannot reach kuaiyu.site. For a phone preview, add https://www.kuaiyu.site to the request domains in the mini program console, or turn on debug mode from the top-right menu.",
    atlasNetwork: "The 3D heart model could not be downloaded. Check the network and try again.",
    atlasNoWebgl: "WeChat on this device has no WebGL2; only the 2D heart is available.",
    atlasLost: "The graphics context was interrupted. Please try again.",
    reason: "Reason",
    authorEmail: "Email",
    authorSite: "Website",
    copyHint: "Tap to copy the email or address, or long-press to select it.",
    copied: "Copied",
    copyFailed: "Long-press the text to copy it",
  },
};
// Shown one after another (6 s each) on the 3D heart's loading card; the first
// one explains the gestures.
const LOAD_TIPS = {
  zh: [
    "载入后：单指拖动旋转心脏；双指捏合缩放，双指同时拖动可平移。",
    "下方的曲线已经在播放：可以先看压力、容积和心电图如何随时相变化。",
    "心率 75 次/分时，一个心动周期约 0.8 秒，其中舒张期约占三分之二。",
    "等容收缩期四个瓣膜全部关闭：心室压力陡升，容积不变。",
    "第一心音主要来自房室瓣关闭，第二心音来自主动脉瓣和肺动脉瓣关闭。",
    "安静时心室充盈大部分在舒张早期被动完成，心房收缩只再补充约两成。",
    "压力–容积环围成的面积，约等于心室一次搏动所做的外功。",
    "射血分数 = 每搏量 ÷ 舒张末期容积，正常约 55%~70%。",
    "心率加快时，缩短得最多的是舒张期。",
  ],
  en: [
    "Once loaded: drag with one finger to turn the heart; pinch to zoom, and drag with two fingers to move it.",
    "The traces below are already playing: see how pressure, volume and the ECG change through the phases.",
    "At 75 beats/min one cardiac cycle lasts about 0.8 s, and diastole takes about two thirds of it.",
    "In isovolumic contraction all four valves are closed: ventricular pressure rises steeply at constant volume.",
    "The first heart sound comes mainly from the closing AV valves; the second from the closing aortic and pulmonary valves.",
    "At rest most ventricular filling happens passively in early diastole; atrial contraction adds only about a fifth.",
    "The area inside the pressure–volume loop is roughly the external work of one beat.",
    "Ejection fraction = stroke volume ÷ end-diastolic volume; normally about 55–70%.",
    "When the heart rate rises, diastole is what shortens most.",
  ],
};
const LOAD_STEPS = ["glb", "engine", "build", "warm"];
const i18n = {
  language: "zh",
  dictionaries: labels, // read by the 3D heart (AtlasLabView)
  t(key) {
    return OVERRIDES[this.language][key] ?? labels[this.language][key] ?? labels.en[key] ?? key;
  },
  local(value) {
    return typeof value === "object" ? (value?.[this.language] ?? value?.en ?? "") : (value ?? "");
  },
};
const TEXT_KEYS = [
  "mobileHeart", "mobilePhases", "pinHeart", "pinHeartHint",
  "heartAtlas", "heart2d", "cyclePhases", "liveValues", "lvPressure", "lvVolume", "aorticPressure",
  "strokeVolume", "ef", "valveStates", "valveHint", "diastasisGone", "wiggers", "cursorHint", "leftHeart",
  "rightHeart", "readValues", "sounds", "muted", "unmuted",
  "pvTitle", "preload", "afterload", "contractility", "resetLoads", "apTitle",
  "apHint", "tWave", "erp", "electricalNote", "loop", "speed", "heartRate", "scenario",
  "atlasLoading", "atlasStandby", "wallOpacity", "wallOriginContext", "institution", "authorEmail", "authorSite", "copyHint", "currentValues", "valuesHint", "close", "welcome", "helpText", "validationNote", "motionNote", "open", "closed",
];

Page({
  data: {
    lang: "zh",
    t: {},
    langButton: "EN",
    version: VERSION,
    author: AUTHOR,
    panel: "heart", // mobile tab: heart | phases
    pinned: true,
    docked: true, // pinned heart shown above the scroll area (the 3D heart is always docked)
    heartModel: "atlas", // opens on the 3D heart; falls back to "2d" if it cannot load
    atlasStatus: "",
    atlasReady: false,
    loadCard: null, // the 3D heart's loading card (renderLoadCard)
    shuntKey: null, // PFO / ASD key under the heart (syncShuntKey)
    atlasStandby: false, // a 3D heart built behind the 2D heart is ready (buildAtlas)
    presets: [],
    preset: "anatomy",
    wallOpacity: 1,
    wallOpacityText: "1.00",
    wallNote: false,
    sideIndex: 0,
    sides: [],
    colorSafe: true,
    relations: true,
    repolarization: false,
    erpOn: true,
    mods: { preload: 1, afterload: 1, contractility: 1 },
    modsText: { preload: "1.00×", afterload: "1.00×", contractility: "1.00×" },
    scenarioNames: [],
    scenarioIndex: 0,
    speedIndex: 2,
    speedLabels: SPEEDS.map((s) => `${s}×`),
    hr: 75,
    loop: true,
    playing: true,
    time: "0.000",
    cycle: "0.800",
    scrubMax: 800,
    scrub: 0,
    phases: [],
    phaseIndex: -1,
    currentPhase: "",
    diastasisGone: false,
    values: { lvp: "—", lvv: "—", aop: "—", sv: "—", ef: "—" },
    valves: [],
    soundCaption: "S1 · S2",
    audioEnabled: false,
    audioBusy: false,
    dialog: null, // "values" | "help"
    valueRows: [],
  },

  // ---- lifecycle -----------------------------------------------------------
  onLoad() {
    this.plotResume = new PlotResume(() => {
      if (!this.visible || this.unloaded) return;
      this.clock.playing = true;
      this.clock.lastNow = null;
      this.update(true);
    });
    this.audio = new HeartAudio(wx, () => {
      if (this.unloaded) return;
      this.setData({ audioEnabled: false });
      wx.showToast({ title: i18n.t("audioUnavailable"), icon: "none" });
      if (this.sample) this.update(true);
    });
    // The model download starts with the page, in parallel with the 2D setup.
    prefetchAtlas();
    this.atlasSteps = freshSteps();
    // A heart kept for the 3D view (parked) is let go when the phone runs low.
    this.onMemory = () => {
      seriesCache.clear();
      if (this.data.heartModel !== "atlas") this.releaseParked();
    };
    wx.onMemoryWarning?.(this.onMemory);
    this.modifiers = { preload: 1, afterload: 1, contractility: 1 };
    this.chartsSeen = { strips: true, pv: true, ap: true };
    this.model = scenarioModel(scenarios[0]);
    this.clock = new MasterClock(this.model, { hr: scenarios[0].hr ?? 75, speed: SPEEDS[2], playing: true });
    this.refreshContent();
  },
  onReady() {
    this.canvases = {};
    this.host = new SvgElement("div");
    this.heart2d = new Heart2DView(this.host, {
      ...HEART_TEXT,
      language: i18n.language,
      readJSON: async () => atrialVolume,
    });
    this.heart2d.init().then(async () => {
      this.painter = new SvgPainter(this.host.children[0]);
      await this.attachPanel();
      this.visible = true;
      this.restartLoop();
      if (this.data.heartModel === "atlas") {
        await this.bindCanvas("atlas", "webgl");
        this.startAtlas({ auto: true });
      }
      // Keeps the frame loop alive if the canvas it was waiting on goes away.
      this.watchdog = setInterval(() => {
        if (this.visible && Date.now() - (this.lastFrame ?? 0) > 300) this.restartLoop();
      }, 300);
    });
  },
  onShow() {
    this.audio?.setActive(true);
    if (this.painter && !this.visible) {
      this.visible = true;
      this.clock.lastNow = null;
      this.restartLoop();
    }
  },
  onHide() {
    this.plotResume?.cancel();
    this.visible = false;
    this.audio?.setActive(false);
  },
  onUnload() {
    this.plotResume?.cancel();
    this.visible = false;
    this.unloaded = true;
    this.audio?.destroy();
    clearInterval(this.watchdog);
    this.chartObserver?.disconnect();
    wx.offMemoryWarning?.(this.onMemory);
    this.closeAtlas();
    this.releaseParked();
  },
  onShareAppMessage() {
    return { title: i18n.t("title"), path: "/pages/lab/lab" };
  },

  // ---- model and drawing (as js/app.js rebuild / update / animate) ---------
  // Whether every beat of the current model is the same (true for 10 of the 13
  // scenarios; atrial fibrillation and complete heart block differ beat to beat,
  // and the PFO scenario replays a Valsalva release every fourth beat, so beat 0
  // is compared with each of the next seven).
  // Values are compared to within BEAT_TOLERANCE: away from 75 bpm a beat's
  // absolute time (beat × RR + t) carries rounding, so identical beats used to
  // differ by ~1e-15 and every beat was rebuilt, traces and 3D tables alike
  // (the stutter at any other rate, e.g. exercise or bradycardia).
  // The answer is kept per scenario, rate and loading (beatChecks).
  checkBeats() {
    const { model, clock } = this, hr = clock.hr, mods = this.modifiers, T = model.cycleDuration(hr, 0);
    const key = [model.scenario.id, hr, mods.preload, mods.afterload, mods.contractility].join("|");
    const differ = (x, y) => !(Math.abs(x - y) <= BEAT_TOLERANCE);
    this.nextBeat = null;
    model.shareBeat?.(null);
    if (beatChecks.has(key)) return void (this.sameBeats = beatChecks.get(key));
    this.sameBeats = true;
    for (let beat = 1; beat < 8 && this.sameBeats; beat++) {
      if (model.cycleDuration(hr, beat) !== T) this.sameBeats = false;
      for (let k = 0; k < 16 && this.sameBeats; k++) {
        const t = (T * k) / 16, a = model.sample(t, hr, mods, 0), b = model.sample(t, hr, mods, beat);
        if (differ(a.ecg, b.ecg) || differ(a.volume.lv, b.volume.lv) || ["la", "lv", "ra", "rv"].some((p) => differ(a.pressures[p], b.pressures[p])) || a.interatrial?.open !== b.interatrial?.open)
          this.sameBeats = false;
      }
    }
    if (beatChecks.size > 200) beatChecks.clear();
    beatChecks.set(key, this.sameBeats);
  },
  // At a new beat the website recomputes the whole cycle (400 samples, ~50 ms
  // on a phone): the stall at the end of each cycle. Identical beats keep the
  // current traces; differing beats use the next beat, prepared a few samples
  // per frame during the current one (prepareNextBeat).
  newBeat() {
    const beat = this.clock.beatIndex;
    if (this.sameBeats) {
      this.previousBeat = beat;
      return;
    }
    const next = this.nextBeat;
    this.rebuild(next && next.beat === beat && next.out.length === 400 ? next.out : null);
    this.model.shareBeat?.(null); // the new beat's tables are built
  },
  // During each beat the next one is prepared: its traces (400 samples) and
  // the samples the hearts' tables for it will ask for (beatGrid), which the
  // model keeps until that beat starts (shareableSamples shareBeat), so the
  // beat change only builds tables from them. Otherwise a new beat of atrial
  // fibrillation or complete block waited for 250–750 fresh samples. The work
  // is spread over the frames left in the current beat, at most PREPARE_MS a
  // frame.
  prepareNextBeat() {
    if (this.sameBeats || !this.clock.playing) return;
    const { model, clock } = this, beat = clock.beatIndex + 1;
    let next = this.nextBeat;
    if (!next || next.beat !== beat || next.hr !== clock.hr) {
      const T = model.cycleDuration(clock.hr, beat);
      next = this.nextBeat = { beat, hr: clock.hr, T, out: [], grid: this.beatGrid(T), done: false };
      model.shareBeat?.(beat);
    }
    const left = (model.cycleDuration(clock.hr, clock.beatIndex) - clock.t) / Math.max(clock.speed, 1e-3);
    let count = Math.ceil((400 - next.out.length + next.grid.length) / Math.max(1, Math.floor(left / PREPARE_FRAME_MS) - 1));
    const end = Date.now() + PREPARE_MS;
    while (!next.done && count-- > 0 && Date.now() < end) {
      if (next.out.length < 400) next.out.push(model.sample((next.T * next.out.length) / 400, clock.hr, this.modifiers, beat));
      else model.sample(next.grid.pop(), clock.hr, this.modifiers, beat);
      next.done = next.out.length === 400 && !next.grid.length;
    }
  },
  // The instants a new beat's tables sample: the atrial volume table (the
  // website's atrial-targets.js beatTable: 0 and i·T/N, N = T/samplingMs
  // rounded up) of the heart shown, and for the 3D blood-flow and filling
  // views their flow integrals (atlas-valve-flow.js volumeFlowIntegrals:
  // min(T − 0.001, i·T/n), n = 360 and the inflow's 60; the 2D heart's
  // filling uses the 60). The 3D heart steps PFO beats as beat 0 (stepAtlas).
  beatGrid(T) {
    const atlas = this.data.heartModel === "atlas" ? this.atlas : null;
    if (this.data.heartModel === "atlas" && (!atlas || pfoRepeats(this.model))) return [];
    const samplingMs = (atlas ? atlas.motion?.atrialSettings : this.heart2d?.atrialSettings)?.targets?.samplingMs;
    if (!(samplingMs > 0)) return [];
    const N = Math.ceil(T / samplingMs), dt = T / N, grid = [0];
    for (let i = 0; i <= N; i++) grid.push(i * dt);
    for (const n of atlas ? ({ flow: [360], filling: [360, 60] }[atlas.preset] ?? []) : [60])
      for (let i = 0; i <= n; i++) grid.push(Math.min(T - 0.001, (i * T) / n));
    return grid;
  },
  rebuild(prepared = null) {
    const { model, clock } = this;
    this.series = prepared ?? this.cycleSeries();
    this.audio?.setCycle(this.series);
    const schedule = model.phaseSchedule(clock.hr, clock.beatIndex);
    this.charts?.setData(this.series, schedule, baseline, this.data.sideIndex ? "right" : "left");
    const T = model.cycleDuration(clock.hr, clock.beatIndex);
    this.setData({
      phases: schedule.map((p, index) => ({
        index,
        no: String(index + 1).padStart(2, "0"),
        name: i18n.local(p.name),
        range: `${Math.round(p.start)}–${Math.round(p.end)} ms`,
        absent: p.duration < 1,
      })),
      phaseCount: `01—${String(schedule.length).padStart(2, "0")}`,
      diastasisGone: !(schedule[6].duration > 1),
      scrubMax: Math.max(1, Math.floor(T - 0.001)),
      cycle: (T / 1000).toFixed(3),
    });
    this.previousBeat = clock.beatIndex;
    if (!prepared) this.checkBeats();
    this.update(true);
  },
  // The traces' 400 samples of this beat (model.series, but through
  // model.sample so a scenario switch shares them; see shareableSamples).
  // The last few are kept: returning to a scenario, or a language, side or
  // display toggle, redraws without resampling (a series is about 1 MB).
  cycleSeries() {
    const { model, clock } = this, hr = clock.hr, beat = clock.beatIndex, mods = this.modifiers;
    const key = [model.scenario.id, hr, beat, mods.preload, mods.afterload, mods.contractility].join("|");
    let series = seriesCache.get(key);
    seriesCache.delete(key);
    if (!series) {
      const T = model.cycleDuration(hr, beat);
      series = Array.from({ length: 400 }, (_, i) => model.sample((T * i) / 400, hr, mods, beat));
    }
    seriesCache.set(key, series);
    if (seriesCache.size > 3) seriesCache.delete(seriesCache.keys().next().value);
    return series;
  },
  // force: refresh the readouts now. atlasForce: also step the 3D heart now
  // instead of at its throttled rate (stepAtlas).
  update(force = false, atlasForce = force) {
    const { model, clock } = this;
    // Identical beats are all drawn as beat 0: same result, and the engine's
    // per-beat caches (e.g. the atrial volume table) stay warm across beats.
    const beat = this.sameBeats ? 0 : clock.beatIndex;
    const sample = (this.sample = model.sample(clock.t, clock.hr, this.modifiers, beat));
    this.audio?.update(sample, this.visible && clock.playing, clock.beatIndex);
    if (this.charts) {
      const seen = this.chartsSeen;
      if (seen.strips || seen.pv) this.charts.update(sample, this.data.relations);
      else if (seen.ap) this.charts.renderAP(sample);
    }
    const frame = { model, sample, t: clock.t, hr: clock.hr, beatIndex: beat, modifiers: this.modifiers, baseline };
    if (this.data.heartModel === "atlas") {
      if (this.atlas) this.stepAtlas(frame, atlasForce);
    } else if (this.painter && this.activeHeart()) {
      this.heart2d.setVisual({ colorSafe: this.data.colorSafe });
      this.heart2d.update(frame);
      this.paintHeart();
    }
    const now = Date.now();
    if (!force && clock.playing && now - (this.lastUi ?? 0) < UI_MS) return;
    this.lastUi = now;
    const sounds = Object.entries(sample.sounds).filter(([, v]) => v > 0.08).map(([k]) => k.toUpperCase());
    this.setData({
      time: (sample.t / 1000).toFixed(3),
      scrub: Math.round(sample.t),
      playing: clock.playing,
      hr: clock.hr,
      values: {
        lvp: sample.pressures.lv.toFixed(0),
        aop: sample.pressures.ao.toFixed(0),
        lvv: sample.volume.lv.toFixed(0),
        sv: sample.sv.toFixed(0),
        ef: sample.ef.toFixed(0),
      },
      valves: VALVES.map((id) => ({ id, name: i18n.t(id), open: sample.valves[id].open, state: i18n.t(sample.valves[id].open ? "open" : "closed") })),
      phaseIndex: sample.phaseIndex,
      currentPhase: i18n.local(sample.phase.name),
      soundCaption: (sounds.join(" · ") || "S1 · S2") + "  ·  " + i18n.t(this.audio?.enabled ? "unmuted" : "muted"),
    });
  },
  // ---- canvases ----------------------------------------------------------
  // In WeChat a canvas is a native-backed view: CSS display/visibility changes
  // and scroll clipping are not reliable for it (the developer tool even keeps
  // drawing hidden canvases in place). Every canvas is therefore created with
  // wx:if when it is needed and bound here after it exists.
  bindCanvas(id, type = "2d") {
    return new Promise((resolve) =>
      wx.createSelectorQuery().in(this).select("#" + id).fields({ node: true, size: true }).exec(([r]) => {
        if (!r?.node) return resolve((this.canvases[id] = null));
        const entry = { node: r.node, w: r.width, h: r.height };
        if (type === "2d") {
          r.node.width = Math.round(r.width * devicePixelRatio);
          r.node.height = Math.round(r.height * devicePixelRatio);
          entry.ctx = r.node.getContext("2d");
        }
        resolve((this.canvases[id] = entry));
      }),
    );
  },
  // The heart & traces tab: charts and the inline 2D heart.
  async attachPanel() {
    if (this.data.panel !== "heart") {
      this.charts = null;
      return;
    }
    const [strips, pv, ap] = await Promise.all(["strips", "pv", "ap"].map((id) => this.bindCanvas(id, "raw")));
    if (!this.data.docked) await this.bindCanvas("heart");
    this.charts = new Charts(
      adoptCanvas(strips.node, strips.w, strips.h),
      adoptCanvas(pv.node, pv.w, pv.h),
      adoptCanvas(ap.node, ap.w, ap.h, () => !this.chartsSeen.ap),
      i18n,
    );
    this.watchCharts();
    this.rebuild();
  },
  // The 3D heart's motion step (the website's motion pipeline) costs ~12 ms on
  // a desktop and several times that on phones. It runs at most at a rate that
  // keeps it under three quarters of the time, so playback, traces and touch
  // stay smooth; while a finger turns the heart only the cheap render runs.
  stepAtlas(frame, force) {
    const atlas = this.atlas, now = Date.now();
    atlas.setVisual({ colorSafe: this.data.colorSafe, repolarization: this.data.repolarization, erp: this.data.erpOn });
    if (this.atlasScene) return; // a scenario switch is settling (settleAtlas)
    // Steps run in the frame loop. An input handler only asks for one, so
    // that its own changes (slider, button, traces) show first.
    if (!this.inFrame) return void (this.atlasWant = force || this.atlasWant === "now" ? "now" : "step");
    force ||= this.atlasWant === "now";
    if (this.atlasDragging && !force) return;
    // (A clock set back makes the time since the last step negative: step.)
    const since = now - (this.atlasStepAt ?? 0);
    if (!force && since >= 0 && since < Math.max(ATLAS_MIN_MS, (this.atlasCost ?? 0) / 0.75)) return;
    this.atlasWant = undefined;
    // PFO's Valsalva release shifts RA/RV/PA pressures together, leaving
    // valve gradients and chamber volume curves unchanged. Reuse beat-zero
    // motion/flow tables instead of rebuilding hundreds of samples at every
    // beat boundary. Keep the real sample (including interatrial state and
    // absolute time) so the flap, shunt and bubbles remain intermittent.
    const repeatingPfo = pfoRepeats(frame.model);
    if (repeatingPfo && this.atlasPfoBeat !== frame.beatIndex) atlas.stateKey = undefined;
    this.atlasPfoBeat = repeatingPfo ? frame.beatIndex : undefined;
    atlas.update(repeatingPfo ? { ...frame, beatIndex: 0 } : frame);
    if (this.shareUntilStep) this.stopSharing(); // the last step of a scenario switch
    const cost = Date.now() - now;
    this.atlasCost = this.atlasCost === undefined ? cost : this.atlasCost * 0.8 + cost * 0.2;
    this.atlasStepAt = now;
  },
  // Charts scrolled out of the scroll area are not drawn.
  watchCharts() {
    this.chartObserver?.disconnect();
    this.chartsSeen = { strips: true, pv: true, ap: true };
    const observer = (this.chartObserver = wx.createIntersectionObserver(this, { observeAll: true }));
    observer.relativeTo(".main").observe(".chart-canvas", (r) => {
      this.chartsSeen[r.id] = r.intersectionRatio > 0;
    });
  },
  activeHeart() {
    return this.data.docked ? this.canvases.heartDock : this.canvases.heart;
  },
  paintHeart() {
    const target = this.activeHeart();
    if (!target) return;
    const { ctx, w, h } = target;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.painter.paint(ctx, { x: 0, y: 0, w, h }, devicePixelRatio);
  },
  restartLoop() {
    const token = (this.loopToken = {});
    this.loop(token);
  },
  loop(token) {
    if (token !== this.loopToken || !this.visible) return;
    this.lastFrame = Date.now();
    this.inFrame = true; // 3D steps happen here (stepAtlas)
    try {
      this.clock.update(this.lastFrame);
      if (this.previousBeat !== this.clock.beatIndex) this.newBeat();
      if (this.atlasScene && !this.atlasScene.settling) this.settleAtlas();
      else if (this.clock.playing || this.atlasWant || Math.abs(this.clock.t - (this.sample?.t ?? -1)) > 1e-5)
        this.update(false, this.atlasWant === "now");
      this.prepareNextBeat();
    } finally {
      this.inFrame = false;
    }
    // WebGL frames are presented on their own canvas's frame callback.
    const target = (this.data.heartModel === "atlas" && this.canvases.atlas) || this.activeHeart() || this.canvases.strips;
    if (target?.node?.requestAnimationFrame) target.node.requestAnimationFrame(() => this.loop(token));
    else setTimeout(() => this.loop(token), 16);
  },

  // ---- language and text ---------------------------------------------------
  refreshContent() {
    const t = {};
    for (const key of TEXT_KEYS) t[key] = i18n.t(key);
    this.setData({
      lang: i18n.language,
      t,
      langButton: i18n.language === "en" ? "中文" : "EN",
      sides: [i18n.t("leftHeart"), i18n.t("rightHeart")],
      presets: PRESETS.map((id) => ({ id, label: i18n.t(id) })),
      scenarioNames: scenarios.map((s) => i18n.local(s.name)),
      scenarioIndex: scenarios.indexOf(this.model.scenario),
    });
    wx.setNavigationBarTitle({ title: i18n.language === "zh" ? "心动周期" : "Cardiac Cycle" });
    if (this.model) this.syncShuntKey();
    if (this.heart2d) {
      this.heart2d.setLanguage(i18n.language);
      this.atlas?.translate();
      this.rebuild();
    }
  },
  toggleLanguage() {
    i18n.language = i18n.language === "en" ? "zh" : "en";
    this.refreshContent();
  },

  // ---- tabs, dialogs -----------------------------------------------
  setPanel(e) {
    const panel = e.currentTarget.dataset.panel;
    if (panel !== "heart") this.charts = null; // its canvases are about to go
    this.setData({ panel }, async () => {
      await this.syncDock();
      await this.attachPanel();
    });
  },
  copyText(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.copy,
      success: () => wx.showToast({ title: i18n.t("copied"), icon: "none" }),
      fail: () => wx.showToast({ title: i18n.t("copyFailed"), icon: "none" }),
    });
  },
  openHelp() {
    this.setData({ dialog: "help" });
  },
  closeDialog() {
    this.setData({ dialog: null });
  },
  noop() {},
  readValues() {
    this.plotResume?.cancel();
    this.clock.playing = false;
    this.update(true);
    const s = this.sample;
    const rows = [
      [i18n.t("phase"), i18n.local(s.phase.name)],
      [i18n.t("time"), `${s.t.toFixed(1)} ms`],
      [i18n.t("heartRate"), `${this.clock.hr} bpm`],
      [i18n.t("ecg"), `${s.ecg.toFixed(2)} mV`],
      ...Object.entries(s.pressures).map(([id, v]) => [i18n.t(`pressure.${id}`), `${v.toFixed(1)} mmHg`]),
      [i18n.t("lvVolume"), `${s.volume.lv.toFixed(1)} mL`],
      ...Object.entries(s.valves).map(([id, v]) => [i18n.t(id), `${i18n.t(v.open ? "open" : "closed")} · ΔP ${v.gradient.toFixed(1)} mmHg`]),
      // The foramen ovale or the ASD (as the website's values table).
      ...(s.interatrial ? [s.interatrial.defect === "asd"
        ? [i18n.t("atrialSeptalDefect"), `${i18n.t("asdLeftToRight")} · LA−RA ${(-s.interatrial.gradient).toFixed(1)} mmHg`]
        : [i18n.t("foramenOvale"), `${i18n.t(s.interatrial.open ? "foramenOpen" : "foramenClosed")} · RA−LA ${s.interatrial.gradient.toFixed(1)} mmHg`]] : []),
      ...Object.entries(s.ap ?? {}).map(([id, v]) => [i18n.t(id), `${Number(v).toFixed(1)} mV`]),
      [i18n.t("sounds"), Object.entries(s.sounds).filter(([, v]) => v > 0.08).map(([id]) => id.toUpperCase()).join(" · ") || i18n.t("noSound")],
    ];
    this.setData({ dialog: "values", valueRows: rows.map(([k, v]) => ({ k, v })) });
  },

  // ---- heart panel ---------------------------------------------------------
  togglePin() {
    if (this.data.heartModel === "atlas")
      return wx.showToast({ title: i18n.t("atlasPinned"), icon: "none" });
    this.setData({ pinned: !this.data.pinned }, () => this.syncDock());
  },
  // Keep a pinned heart in the dock from the outset. Moving a native canvas
  // between the scroll area and dock destroys it and leaves a blank frame.
  // Scrolling must never rebuild it. The 3D canvas also stays on both tabs.
  syncDock() {
    const docked = this.data.heartModel === "atlas" || (this.data.panel === "heart" && this.data.pinned);
    if (docked === this.data.docked) return Promise.resolve();
    this.canvases[docked ? "heart" : "heartDock"] = null; // the stage that is about to go
    return new Promise((resolve) =>
      this.setData({ docked }, async () => {
        if (docked) {
          if (this.data.heartModel === "atlas") await this.bindCanvas("atlas", "webgl");
          else await this.bindCanvas("heartDock");
        } else if (this.data.panel === "heart") await this.bindCanvas("heart");
        this.update(true);
        this.restartLoop();
        resolve();
      }),
    );
  },

  // ---- 3D heart (the website's AtlasLabView, vendor/atlas3d.js) -----
  chooseModel(e) {
    const heartModel = e.currentTarget.dataset.model;
    // The 2D heart can be chosen while the 3D one is still loading (startAtlas
    // then discards it); the 3D heart is never started twice.
    if (heartModel === this.data.heartModel || (heartModel === "atlas" && this.atlasStarting)) return;
    if (heartModel === "2d") {
      this.atlasRun = (this.atlasRun ?? 0) + 1; // a 3D heart still loading goes on off screen
      this.atlasStarting = false;
      this.closeAtlas(true);
    }
    this.setData({ heartModel }, async () => {
      if (heartModel === "atlas") {
        // From an undocked page the dock appears now; from a docked 2D heart
        // the dock's 2D canvas is replaced by the WebGL one.
        if (this.data.docked) await this.bindCanvas("atlas", "webgl");
        else await this.syncDock();
        await this.startAtlas();
      } else {
        await this.syncDock();
        if (this.data.docked) await this.bindCanvas("heartDock");
      }
      this.update(true);
      this.restartLoop();
    });
  },
  // Leaving the 3D heart: a ready one is parked (kept built, without its
  // canvas) so coming back is quick; otherwise it is released. keep = false
  // releases in any case (failures, page closed).
  closeAtlas(keep = false) {
    const atlas = this.atlas, scene = this.atlasScene;
    this.atlas = this.atlasScene = null;
    if (atlas) {
      if (keep && atlas.holdFrame === 0 && this.parkAtlas(atlas)) {
        this.parkedAtlas = atlas;
        // A scenario view not yet applied (settleAtlas) is applied on return.
        if (scene && !scene.settling) atlas.presetPending = true;
      } else releaseAtlas(atlas);
    }
    this.stopSharing();
    this.endLoadCard();
    if (!this.unloaded) this.setData({ atlasReady: false, atlasStatus: "" });
  },
  parkAtlas(view) {
    try {
      require("../../vendor/atlas3d.js").parkAtlasView(view);
      return true;
    } catch (error) {
      console.warn("3D heart park:", error);
      return false;
    }
  },
  releaseParked() {
    if (this.parkedAtlas) releaseAtlas(this.parkedAtlas);
    this.parkedAtlas = null;
    if (!this.unloaded && this.data.atlasStandby) this.setData({ atlasStandby: false });
  },
  // Builds the 3D heart on an off-screen canvas, so the build goes on while
  // the 2D heart is shown; the result is parked until a canvas shows it. If
  // it finishes while the 2D heart is shown, the stage's top-right corner says
  // so (atlasStandby). Resolves to null where WeChat has no off-screen WebGL2
  // (startAtlas then builds on the page's canvas).
  buildAtlas() {
    if (!this.atlasBuild) {
      this.atlasBuild = this.buildOffscreen().then(
        (view) => {
          this.atlasBuild = null;
          if (view && this.unloaded) releaseAtlas(view);
          else if (view) {
            this.parkedAtlas = view;
            if (this.data.heartModel !== "atlas") this.setData({ atlasStandby: true });
          }
          return view;
        },
        (error) => {
          this.atlasBuild = null;
          throw error;
        },
      );
      this.atlasBuild.catch((error) => console.warn("3D heart build:", error));
    }
    return this.atlasBuild;
  },
  async buildOffscreen() {
    const { AtlasLabView, shim, CONTENT_URL } = await this.loadEngine();
    const glb = prefetchAtlas();
    const canvas = this.canvases.atlas ?? { w: 364, h: 299 };
    const node = takeOffscreen();
    if (!node) return null;
    this.markStep("build", "active");
    const view = new AtlasLabView(shim.useCanvas(node, canvas.w, canvas.h), {
      i18n,
      readJSON: (name) => requestJSON(CONTENT_URL + name),
      glb,
      onGraphicsChange: (lost) => lost && this.atlas === view && this.atlasFailed(new Error("WebGL context lost")),
    });
    view.holdFrame++; // nothing is drawn (or compiled) off screen
    try {
      await view.init();
    } catch (error) {
      this.markStep("build", "wait");
      // A model that did not arrive is a real failure; anything else is taken
      // as this WeChat's off-screen WebGL falling short: build on screen.
      if (!(await glb.then(() => true, () => false))) throw error;
      console.warn("3D heart off-screen build failed; building on screen:", error);
      offscreenBroken = true;
      return null;
    }
    view.holdFrame--;
    view.presetPending = true;
    if (!this.parkAtlas(view)) {
      releaseAtlas(view);
      offscreenBroken = true;
      return null;
    }
    this.markStep("build", "done");
    return view;
  },
  // The 3D engine (about 1 MB of three.js and the atlas engine), loaded on first use.
  async loadEngine() {
    if (!this.engine) {
      this.markStep("engine", "active");
      // Let the loading card appear before the engine code is parsed (it blocks).
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { AtlasLabView, resumeAtlasView, setChords } = require("../../vendor/atlas3d.js");
      this.engine = {
        AtlasLabView,
        resumeAtlasView,
        setChords,
        shim: require("../../vendor/atlas-shim.js"),
        CONTENT_URL: require("../../vendor/atlas-asset.js").CONTENT_URL,
      };
      this.atlasShim = this.engine.shim;
      this.markStep("engine", "done");
    }
    return this.engine;
  },
  // auto: started when the page opened (a failure then only shows a toast).
  async startAtlas({ auto = false } = {}) {
    if (this.atlas || this.atlasStarting) return;
    this.atlasStarting = true;
    const run = (this.atlasRun = (this.atlasRun ?? 0) + 1), current = () => run === this.atlasRun && !this.unloaded;
    this.setData({ atlasStatus: i18n.t("atlasLoading"), atlasStandby: false });
    // A parked heart only reconnects (about a second): no loading card for that.
    if (!this.parkedAtlas) this.beginLoadCard();
    let view = null;
    try {
      if (!this.parkedAtlas) await this.buildAtlas();
      // The 2D heart was chosen meanwhile: a finished build stays parked.
      if (!current()) return;
      const { AtlasLabView, resumeAtlasView, shim, CONTENT_URL } = await this.loadEngine();
      const canvas = this.canvases.atlas;
      if (!canvas) throw new Error("WebGL canvas missing");
      const { node, w, h } = canvas;
      if (this.parkedAtlas) {
        view = this.parkedAtlas;
        this.parkedAtlas = null;
        resumeAtlasView(view, shim.useCanvas(node, w, h));
      } else {
        // No off-screen WebGL2 here: build on the page's canvas (choosing the
        // 2D heart meanwhile abandons this build).
        this.markStep("build", "active");
        view = new AtlasLabView(shim.useCanvas(node, w, h), {
          i18n,
          readJSON: (name) => requestJSON(CONTENT_URL + name),
          glb: prefetchAtlas(),
          onGraphicsChange: (lost) => lost && this.atlas === view && this.atlasFailed(new Error("WebGL context lost")),
        });
        await view.init();
        // No tap-to-select here: drop the website's picker, keep OrbitControls.
        node.removeEventListener("pointerdown", view.handlePointerDown);
        node.removeEventListener("pointerup", view.handlePointerUp);
        view.presetPending = true;
      }
      this.markStep("build", "done");
      // A newly built heart takes the chosen view; a parked one keeps its own
      // (including a custom wall opacity).
      if (view.presetPending) {
        view.presetPending = false;
        view.setPreset(this.data.preset);
      }
      this.markStep("warm", "active");
      await this.warmAtlas(view);
      if (!current()) {
        // The 2D heart was chosen during the warm-up: keep the heart parked.
        if (!this.unloaded && this.parkAtlas(view)) {
          this.parkedAtlas = view;
          this.setData({ atlasStandby: true });
        } else releaseAtlas(view);
        return;
      }
      this.atlas = view;
      if (this.wantedCamera) view.setView(this.wantedCamera);
      this.wantedCamera = null;
      this.endLoadCard();
      this.setData({ atlasReady: true, atlasStatus: "" });
      this.syncWall();
      this.update(true);
      this.restartLoop();
    } catch (error) {
      if (view) releaseAtlas(view);
      this.atlasSteps = freshSteps();
      if (current()) this.atlasFailed(error, auto);
    } finally {
      if (run === this.atlasRun) this.atlasStarting = false;
    }
  },
  // Loading card: the steps with their real progress, the time so far, a tip
  // that changes every 6 s, and how to go to the 2D heart on a slow network.
  // The steps belong to the 3D heart (this.atlasSteps), so a build that went
  // on behind the 2D heart shows its progress when the card returns.
  markStep(id, state) {
    this.atlasSteps[id] = state;
    this.renderLoadCard();
  },
  beginLoadCard() {
    clearInterval(this.loadTimer);
    const steps = this.atlasSteps;
    if (this.parkedAtlas) Object.assign(steps, { glb: "done", engine: "done", build: "done" });
    if (steps.glb === "wait") steps.glb = "active";
    steps.warm = "wait";
    this.load = { started: Date.now() };
    prefetchAtlas().then(() => this.markStep("glb", "done"), () => {});
    this.loadTimer = setInterval(() => this.renderLoadCard(), 1000);
    this.renderLoadCard();
  },
  endLoadCard() {
    clearInterval(this.loadTimer);
    this.load = null;
    if (!this.unloaded && this.data.loadCard) this.setData({ loadCard: null });
  },
  renderLoadCard() {
    const load = this.load, steps = this.atlasSteps;
    if (!load || this.unloaded) return;
    const seconds = Math.floor((Date.now() - load.started) / 1000), tips = LOAD_TIPS[i18n.language];
    const score = LOAD_STEPS.reduce((sum, id) => sum + { done: 1, active: 0.35, wait: 0 }[steps[id]], 0);
    this.setData({
      loadCard: {
        title: i18n.t("loadTitle"),
        time: `${seconds} s · ${i18n.t("loadWait")}`,
        progress: Math.round((score / LOAD_STEPS.length) * 100),
        steps: LOAD_STEPS.map((id) => ({
          id,
          state: steps[id],
          mark: { done: "✓", active: "●", wait: "○" }[steps[id]],
          label: i18n.t(id === "glb" && atlasGlbCached ? "load.glbCached" : "load." + id),
        })),
        slow: i18n.t(offscreenBroken || !canBuildOffscreen() ? "loadSlowDownload" : "loadSlow"),
        tipLabel: i18n.t("loadTip"),
        tip: tips[Math.floor(seconds / 6) % tips.length],
      },
    });
  },
  // The first motion steps build the engine's caches and the first renders
  // compile shaders: seconds on a phone. Do that behind the loading message
  // (rendering held), then start the step-rate budget from steady costs, so
  // the heart appears already beating instead of freezing for a few seconds.
  async warmAtlas(view) {
    const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
    view.holdFrame++; // AtlasLabView.render() draws nothing while held
    try {
      await Promise.resolve(view.layersReady).catch(() => {});
      const { model, clock } = this, hr = clock.hr, T = model.cycleDuration(hr, 0), costs = [];
      for (let k = 0; k < 6; k++) {
        const t = (T * k) / 6, sample = model.sample(t, hr, this.modifiers, 0);
        const start = Date.now();
        view.update({ model, sample, t, hr, beatIndex: 0, modifiers: this.modifiers, baseline });
        costs.push(Date.now() - start);
        await pause();
      }
      await view.renderer.compileAsync(view.scene, view.camera).catch?.(() => {});
      const steady = costs.slice(2).sort((a, b) => a - b);
      this.atlasCost = steady[Math.floor(steady.length / 2)];
      this.atlasStepAt = 0;
    } finally {
      view.holdFrame--;
    }
  },
  atlasFailed(error, auto = false) {
    console.error("3D heart unavailable:", error);
    if (this.data.heartModel !== "atlas") return; // already back on the 2D heart
    const message = String(error?.message ?? error);
    const why = /domain|合法域名|url not in/i.test(message)
      ? i18n.t("atlasDomain")
      : /webgl2|WebGL canvas/i.test(message)
        ? i18n.t("atlasNoWebgl")
        : /context lost/i.test(message)
          ? i18n.t("atlasLost")
          : /request|HTTP|timeout|fail/i.test(message)
            ? i18n.t("atlasNetwork")
            : "";
    // Opening the mini program never stops on a dialog: the 2D heart takes over
    // with a short note; the details are shown when the 3D heart was chosen by hand.
    if (auto) wx.showToast({ title: i18n.t("atlasFailed"), icon: "none", duration: 3000 });
    else
      wx.showModal({
        title: i18n.t("atlasFailedTitle"),
        content: i18n.t("atlasFailed") + "\n\n" + (why ? why + "\n\n" : "") + i18n.t("reason") + ": " + message.slice(0, 160),
        showCancel: false,
      });
    this.closeAtlas();
    this.setData({ heartModel: "2d" }, async () => {
      await this.syncDock();
      if (this.data.docked) await this.bindCanvas("heartDock");
      this.restartLoop();
    });
  },
  // Touches on the WebGL canvas turn and zoom the heart (OrbitControls).
  atlasTouch(e) {
    const type = { touchstart: "pointerdown", touchmove: "pointermove", touchend: "pointerup", touchcancel: "pointercancel" }[e.type];
    this.atlasDragging = (e.touches?.length ?? 0) > 0;
    if (!this.atlasDragging) this.atlasStepAt = 0; // resume beating at once
    for (const touch of e.changedTouches ?? []) this.atlasShim?.pointer(type, touch);
    this.syncChords(); // the camera may have moved into the heart
  },
  setPreset(e) {
    const preset = e.currentTarget.dataset.id;
    this.setData({ preset });
    this.atlas?.setPreset(preset);
    this.syncWall();
    this.update(true);
  },
  // Chamber-wall opacity (the website's atlas-wall-opacity slider); a value
  // that matches no preset turns the preset buttons off ("custom").
  onWallOpacity(e) {
    if (!this.atlas) return;
    this.atlas.setWallOpacity(Number(e.detail.value));
    this.syncWall();
  },
  syncWall() {
    const atlas = this.atlas;
    if (!atlas) return;
    const contexts = atlas.motion?.chordWallInsertions?.contexts;
    this.setData({
      preset: atlas.preset,
      wallOpacity: atlas.wallOpacity,
      wallOpacityText: atlas.wallOpacity.toFixed(2),
      wallNote: !!contexts && [...contexts.values()].some((m) => m.visible),
    });
    this.syncChords();
  },
  // The chordae lie inside the ventricles. Behind opaque walls, with the
  // camera outside the heart, they cannot be seen, so the 3D heart neither
  // moves nor draws them (moving them was most of a motion step). A
  // translucent view, or a camera moved into the heart, brings them back,
  // moved before they are drawn. Their seating, a taper of a fraction of a
  // millimetre where each tube meets its leaflet (half of their cost), is
  // done only with the camera that close (tools/chord-gate.js).
  syncChords() {
    const atlas = this.atlas, setChords = this.engine?.setChords;
    if (!atlas?.camera || !setChords) return;
    const near = atlas.camera.position.length() < CHORD_CAMERA * (atlas.diagonal ?? Infinity);
    const state = { active: atlas.wallOpacity < 1 || near, seat: near };
    if (state.active === this.chords?.active && state.seat === this.chords?.seat) return;
    const more = !this.chords || (state.active && !this.chords.active) || (state.seat && !this.chords.seat);
    this.chords = state;
    setChords(state);
    if (more) {
      atlas.stateKey = undefined; // a whole step, even at this instant
      this.update(true, true);
    }
  },

  // ---- traces --------------------------------------------------------------
  onSide(e) {
    this.setData({ sideIndex: Number(e.detail.value) }, () => this.rebuild());
  },
  // Tap or drag on the plot (not the label gutter) seeks the shared clock.
  stripStart(e) {
    this.plotResume.begin();
    const x = e.touches[0].x;
    this.drag = this.charts?.inPlot(x) ? { startX: x, active: false } : null;
  },
  stripMove(e) {
    if (!this.drag) return;
    const x = e.touches[0].x;
    if (!this.drag.active && Math.abs(x - this.drag.startX) < 6) return;
    this.drag.active = true;
    this.seekStrip(x);
  },
  stripEnd(e) {
    if (this.drag && !this.drag.active) this.seekStrip(this.drag.startX, true);
    else if (this.drag) this.update(true, true); // place the 3D heart exactly
    this.drag = null;
    this.plotResume.end();
  },
  stripCancel() {
    this.drag = null;
    this.plotResume.end();
  },
  seekStrip(x, final = false) {
    const t = this.charts.timeAt(x);
    this.plotResume.pause(this.clock.playing);
    this.clock.playing = false;
    const changed = selectPfoInspectionBeat(this.model, this.clock);
    this.clock.seek(t);
    if (changed) this.rebuild();
    this.update(true, final);
  },
  toggleRelations() {
    this.setData({ relations: !this.data.relations }, () => this.update(true));
  },
  // While a load slider is dragged only its value label follows; the cycle
  // (400 samples, new atrial tables, the 3D state) is recomputed once on
  // release. Recomputing on every drag event froze phones.
  onLoadingPreview(e) {
    this.setData({ [`modsText.${e.currentTarget.dataset.key}`]: Number(e.detail.value).toFixed(2) + "×" });
  },
  onLoading(e) {
    const key = e.currentTarget.dataset.key, value = Number(e.detail.value);
    this.modifiers[key] = value;
    this.setData({ [`mods.${key}`]: value, [`modsText.${key}`]: value.toFixed(2) + "×" });
    this.rebuild();
  },
  resetLoads() {
    this.modifiers = { preload: 1, afterload: 1, contractility: 1 };
    this.setData({ mods: { ...this.modifiers }, modsText: { preload: "1.00×", afterload: "1.00×", contractility: "1.00×" } });
    this.rebuild();
  },
  toggleRepolarization() {
    controls.repolarization.checked = !this.data.repolarization;
    this.setData({ repolarization: controls.repolarization.checked }, () => this.rebuild());
  },
  toggleErp() {
    controls.erp.checked = !this.data.erpOn;
    this.setData({ erpOn: controls.erp.checked }, () => this.rebuild());
  },

  // ---- phases panel --------------------------------------------------------
  jumpPhase(e) {
    const index = Number(e.currentTarget.dataset.index);
    const p = this.model.phaseSchedule(this.clock.hr, this.clock.beatIndex)[index];
    if (!p || p.duration < 1) return;
    this.plotResume?.cancel();
    this.clock.playing = false;
    this.clock.seek(p.start + Math.min(2, p.duration / 2));
    this.update(true);
  },

  // ---- transport -----------------------------------------------------------
  async toggleAudio(e) {
    if (this.data.audioBusy) return;
    this.setData({ audioBusy: true });
    const audioEnabled = await this.audio.setEnabled(!!e.detail.value);
    if (this.unloaded) return;
    this.setData({ audioEnabled, audioBusy: false });
    this.update(true);
  },
  togglePlay() {
    this.plotResume?.cancel();
    this.clock.playing = !this.clock.playing;
    this.clock.lastNow = null;
    this.update(true);
  },
  stepPhase(e) {
    this.plotResume?.cancel();
    this.clock.playing = false;
    this.clock.stepPhase(Number(e.currentTarget.dataset.dir));
    this.update(true);
  },
  // Dragging the timeline redraws the traces and 2D heart at once; the 3D
  // heart follows at its own step rate and is placed exactly on release.
  onScrub(e) {
    this.plotResume?.cancel();
    this.clock.playing = false;
    this.clock.seek(Number(e.detail.value));
    this.update(true, e.type === "change");
  },
  toggleLoop() {
    this.clock.loop = !this.data.loop;
    this.setData({ loop: this.clock.loop });
  },
  onSpeed(e) {
    const speedIndex = Number(e.detail.value);
    this.clock.speed = SPEEDS[speedIndex];
    this.setData({ speedIndex });
  },
  onHR(e) {
    this.clock.setHR(Number(e.detail.value));
    this.rebuild();
  },
  // The traces, values and a 2D heart switch at once; a shown 3D heart on
  // the next frame (settleAtlas), so the two costs fall in separate frames.
  // Each scenario keeps its model (scenarioModel), and the samples a switch
  // needs more than once are computed once (shareableSamples).
  onScenario(e) {
    const index = Number(e.detail.value), scenario = scenarios[index];
    this.stopSharing();
    this.model?.shareBeat?.(null);
    this.model = scenarioModel(scenario);
    this.model.shareSamples(true);
    this.clock.reset(this.model);
    this.clock.setHR(scenario.hr);
    this.setData({ scenarioIndex: index });
    this.applyScenarioView(scenario.id);
    this.rebuild();
    this.syncShuntKey();
    if (!this.atlasScene) this.stopSharing();
  },
  // Ends a switch's shared samples (shareableSamples).
  stopSharing() {
    this.shareUntilStep = false;
    this.model?.shareSamples?.(false);
  },
  // The 3D view that shows the scenario best (the website's js/scenario-views.js):
  // conduction for rhythm and conduction disorders, blood flow for stenosis,
  // regurgitation and the PFO, filling for HFrEF and bradycardia. A 3D heart
  // still loading or parked behind the 2D heart takes it when it is shown.
  // The camera is one of the 3D heart's named views; a heart not yet shown
  // takes it when it appears (startAtlas).
  applyScenarioView(id) {
    const view = scenarioView(id);
    if (!view) return;
    this.setData({ preset: view.preset });
    this.wantedCamera = view.camera ?? null;
    if (this.atlas) this.atlasScene = { view };
    else if (this.parkedAtlas) this.parkedAtlas.presetPending = true;
  },
  // A shown 3D heart's part of a scenario switch, a frame after onScenario:
  // one motion step poses the new scenario (its tables built from the
  // samples the traces just took) and the scenario's view is set. The heart
  // then holds still until that view's shaders are compiled and its teaching
  // layer is shown (AtlasLabView layersReady), instead of stepping frames
  // that are not drawn. A layer shown places itself from the last step, so
  // the view's own re-step of the same instant is skipped (lastArgs); a
  // layer built just now is placed by the next step. On a phone without JIT
  // a motion step takes about as long as the switch's model samples, and a
  // switch used to take two or three steps.
  settleAtlas() {
    const atlas = this.atlas, scene = this.atlasScene, { view } = scene;
    const change = atlas.preset !== view.preset;
    // Leaving a blood-flow or filling view for one without such a layer, the
    // view is set first and the step waits: a layer still shown would build
    // its flow tables for the new scenario only to be hidden.
    const viewFirst = change && FLOW_VIEWS.has(atlas.preset) && !FLOW_VIEWS.has(view.preset);
    scene.settling = true;
    if (viewFirst) this.update(true); // the traces go on; the heart holds (stepAtlas)
    else {
      this.atlasScene = null;
      this.update(true, true);
      this.atlasScene = scene;
    }
    if (change) {
      atlas.setPreset(view.preset);
      atlas.lastArgs = null;
    }
    if (atlas.wallOpacity !== view.wallOpacity) atlas.setWallOpacity(view.wallOpacity);
    if (this.wantedCamera) atlas.setView(this.wantedCamera);
    this.wantedCamera = null;
    this.syncWall();
    // A layer built for the first time on a slow phone goes on building while the heart beats.
    const ready = Promise.resolve(atlas.layersReady).catch(() => {});
    Promise.race([ready, new Promise((resolve) => setTimeout(resolve, SETTLE_HOLD_MS))]).then(() => {
      if (this.atlasScene !== scene) return;
      this.atlasScene = null;
      this.shareUntilStep = true; // stepAtlas
      if (this.clock.playing) this.atlasStepAt = 0; // beat on at once
      else {
        atlas.stateKey = undefined; // paused: place the view at this instant
        this.update(true, true);
      }
    });
  },
  // What the dots of the PFO / ASD mean (the website's key), under the heart.
  syncShuntKey() {
    const p = this.model?.patch ?? {},
      defect = p.asd ? "asd" : p.pfo ? "pfo" : null;
    this.setData({
      shuntKey: defect && {
        asd: defect === "asd",
        text: i18n.t(defect === "asd" ? "shuntKeyAsd" : "shuntKeyBubbles") + (i18n.language === "zh" ? "；" : " · ") + i18n.t(defect === "asd" ? "shuntKeyAsdPath" : "shuntKeyPfoPath"),
      },
    });
  },
});

// One model per scenario for the whole visit. The 3D and 2D hearts keep
// their tables (atrial volumes and their mean pressures, blood flow) per
// model object, so returning to a scenario reuses them. A new model at every
// switch meant 2,000–3,000 fresh model samples: about a second on a phone
// without JIT.
const models = new Map();
function scenarioModel(scenario) {
  if (!models.has(scenario)) models.set(scenario, shareableSamples(createModel(baseline, scenario)));
  return models.get(scenario);
}
// While a scenario switch settles (onScenario → settleAtlas), equal samples
// are computed once: at 75 bpm the traces (T·i/400), the atrial volume table
// (2 ms steps) and its mean pressures sample the same instants, and the 3D
// blood flow samples its 360-step beat three times (net flow and both AV
// leaks). Off otherwise: a sample is about 3 kB, and samples are only read.
// shareBeat(beat) keeps the samples of one beat in the same way while it is
// prepared (prepareNextBeat), until it starts.
const SHARED_SAMPLES = 2000;
function shareableSamples(model) {
  const sample = model.sample;
  let shared = null,
    sharedBeat = null,
    beatSamples = null;
  model.sample = (t, hr = model.scenario.hr ?? 75, modifiers = {}, beatIndex = 0) => {
    const kept = beatIndex === sharedBeat ? beatSamples : shared;
    if (!kept) return sample(t, hr, modifiers, beatIndex);
    const key = `${t}|${hr}|${beatIndex}|${modifiers.preload}|${modifiers.afterload}|${modifiers.contractility}`;
    let s = kept.get(key);
    if (!s) {
      s = sample(t, hr, modifiers, beatIndex);
      if (kept.size < SHARED_SAMPLES) kept.set(key, s);
    }
    return s;
  };
  model.shareSamples = (on) => void (shared = on ? (shared ?? new Map()) : null);
  model.shareBeat = (beat) => void ((sharedBeat = beat ?? null), (beatSamples = sharedBeat === null ? null : new Map()));
  return model;
}
// The PFO scenario's beats differ only by the Valsalva release, which leaves
// the 3D heart's motion tables as they are in beat 0 (stepAtlas).
const pfoRepeats = (model) => {
  const p = model?.patch;
  return !!p?.pfo && !p.asd && !p.rrSequence && !p.atrialFibrillation && !p.completeBlock;
};
// The last few traces (cycleSeries) and every "same beats" answer (checkBeats).
const seriesCache = new Map(), beatChecks = new Map();

// JSON from the website's content/ folder (the same files the website reads).
function requestJSON(url) {
  return retryOnce(() =>
    new Promise((resolve, reject) =>
      wx.request({
        url,
        timeout: 20000,
        success: (res) => (res.statusCode === 200 ? resolve(res.data) : reject(new Error(url + ": HTTP " + res.statusCode))),
        fail: (err) => reject(new Error(url + ": " + err.errMsg)),
      }),
    ),
  );
}
// A dropped connection (common on mobile networks) gets one more try after a
// short pause; HTTP errors and domain refusals do not.
function retryOnce(run) {
  return run().catch((error) => {
    if (/HTTP \d|domain|合法域名|url not in/i.test(error.message)) throw error;
    return new Promise((resolve) => setTimeout(resolve, 1500)).then(run);
  });
}
// One download per launch, shared by the prefetch in onLoad and the 3D heart;
// a failed one is forgotten so choosing the 3D heart again starts afresh.
let atlasGlb = null, atlasGlbCached = false;
const freshSteps = () => ({ glb: "wait", engine: "wait", build: "wait", warm: "wait" });
// Off-screen WebGL2 (wx.createOffscreenCanvas) lets the 3D heart be built
// without a canvas on the page. Probed once; a build that fails there for
// any reason other than the network marks it broken for this launch.
let offscreenNode = null, offscreenSupported = null, offscreenBroken = false;
function makeOffscreen() {
  try {
    const node = wx.createOffscreenCanvas?.({ type: "webgl", width: 364, height: 299 });
    return node?.getContext?.("webgl2") ? node : null;
  } catch (error) {
    console.warn("off-screen WebGL2:", error);
    return null;
  }
}
function canBuildOffscreen() {
  if (offscreenSupported === null) {
    offscreenNode = makeOffscreen();
    offscreenSupported = !!offscreenNode;
  }
  return offscreenSupported && !offscreenBroken;
}
function takeOffscreen() {
  if (!canBuildOffscreen()) return null;
  const node = offscreenNode ?? makeOffscreen();
  offscreenNode = null;
  return node;
}
function prefetchAtlas() {
  if (!atlasGlb) {
    const { GLB_URL } = require("../../vendor/atlas-asset.js");
    atlasGlb = cachedDownload(GLB_URL);
    atlasGlb.catch(() => (atlasGlb = null));
  }
  return atlasGlb;
}
// Release a 3D heart's GPU resources once every shader compile started by a
// preset has settled (AtlasLabView counts them in holdFrame; three.js polls
// them on a timer and would otherwise read freed programs). Gives up after 5 s.
function releaseAtlas(atlas) {
  const started = Date.now();
  const release = () => {
    if (atlas.holdFrame > 0 && Date.now() - started < 5000) return setTimeout(release, 50);
    try {
      atlas.dispose();
    } catch (error) {
      console.warn("3D heart dispose:", error);
    }
  };
  release();
}
// The heart model (2.3 MB), kept in the mini program's file space after the
// first download; its hashed name changes whenever the website's file does.
function cachedDownload(url) {
  const fs = wx.getFileSystemManager(),
    path = wx.env.USER_DATA_PATH + "/" + url.split("/").pop();
  const complete = (data) => {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 12) return false;
    const head = new DataView(data); // GLB header: "glTF", version, total length
    return head.getUint32(0, true) === 0x46546c67 && head.getUint32(8, true) === data.byteLength;
  };
  return new Promise((resolve, reject) => {
    const fetch = () =>
      new Promise((ok, fail) =>
        wx.request({
          url,
          responseType: "arraybuffer",
          timeout: 60000,
          success: (res) => {
            if (res.statusCode !== 200) return fail(new Error(url + ": HTTP " + res.statusCode));
            if (!complete(res.data)) return fail(new Error(url + ": incomplete download"));
            ok(res.data);
          },
          fail: (err) => fail(new Error(url + ": " + err.errMsg)),
        }),
      );
    const download = () =>
      retryOnce(fetch).then((data) => {
        removeOldModels(fs, path);
        fs.writeFile({ filePath: path, data, fail: () => {} });
        resolve(data);
      }, reject);
    fs.readFile({
      filePath: path,
      success: (r) => {
        if (!complete(r.data)) return fs.unlink({ filePath: path, complete: download });
        atlasGlbCached = true;
        resolve(r.data);
      },
      fail: download,
    });
  });
}
// Models of earlier website releases (other hashes) are deleted when a new one
// is saved, so the cache holds a single 2.3 MB file.
function removeOldModels(fs, keep) {
  fs.readdir({
    dirPath: wx.env.USER_DATA_PATH,
    success: ({ files }) => {
      for (const name of files)
        if (/^heart-atlas-.*\.glb$/.test(name) && wx.env.USER_DATA_PATH + "/" + name !== keep)
          fs.unlink({ filePath: wx.env.USER_DATA_PATH + "/" + name, fail: () => {} });
    },
  });
}
