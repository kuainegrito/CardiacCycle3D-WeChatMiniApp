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
import { Charts } from "../../engine/charts.js";
import { Heart2DView } from "../../engine/heart2d.js";
import { SvgElement, controls, adoptCanvas, devicePixelRatio } from "../../engine/mp-dom.js";
import { SvgPainter } from "../../engine/svg-canvas.js";

const PRESETS = ["anatomy", "xray", "conduction", "filling", "flow"];
const VERSION = "1.0.0"; // the website's package.json version this copy follows
const SPEEDS = [0.1, 0.25, 0.5, 1, 2];
const VALVES = ["mitral", "aortic", "tricuspid", "pulmonary"];
const UI_MS = 100; // setData throttle while playing
const HEART_TEXT = {
  labels: Object.fromEntries(Object.keys(heartLabels.en.labels).map((k) => [k, [heartLabels.en.labels[k], heartLabels.zh.labels[k]]])),
  notes: Object.fromEntries(Object.keys(heartLabels.en.notes).map((k) => [k, [heartLabels.en.notes[k], heartLabels.zh.notes[k]]])),
};

// The author line of the website's header (index.html), shown in the "?" dialog.
const AUTHOR = { name: "于快", email: "yukuai@gmc.edu.cn", site: "https://www.kuaiyu.site/" };
// Mini program wording that differs from the website (owner, 2026-10-09).
const OVERRIDES = {
  zh: {
    heartAtlas: "三维心脏",
    atlasLoading: "正在载入三维心脏模型…请耐心等待大约10~30秒\n载入后：单指拖动旋转心脏；双指捏合缩放，双指同时拖动可平移心脏。",
    atlasFailed: "三维心脏模型载入失败，已改用二维心脏。",
    loadTitle: "正在载入三维心脏",
    loadWait: "约 10~30 秒",
    "load.glb": "下载心脏模型（2.3 MB）",
    "load.glbCached": "读取心脏模型（本机已缓存）",
    "load.engine": "载入三维引擎",
    "load.build": "构建三维心脏",
    "load.warm": "预热，让心脏一出现就在跳",
    loadSlow: "网络较慢时，可先点左侧「二维心脏」；模型会在后台继续下载，之后再切回「三维心脏」即可。",
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
    heartAtlas: "3D heart",
    atlasLoading: "Loading the 3D heart model… please allow about 10–30 seconds\nThen: drag with one finger to turn the heart; pinch with two fingers to zoom, and drag with two fingers to move it.",
    atlasFailed: "The 3D heart could not load; showing the 2D heart.",
    loadTitle: "Loading the 3D heart",
    loadWait: "about 10–30 s",
    "load.glb": "Downloading the heart model (2.3 MB)",
    "load.glbCached": "Reading the heart model (saved on this phone)",
    "load.engine": "Loading the 3D engine",
    "load.build": "Building the 3D heart",
    "load.warm": "Warming up, so it beats from the start",
    loadSlow: "On a slow network, tap “2D heart” on the left; the model keeps downloading, and you can switch back to the 3D heart later.",
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
  "rightHeart", "readValues",
  "pvTitle", "preload", "afterload", "contractility", "resetLoads", "apTitle",
  "apHint", "tWave", "erp", "electricalNote", "loop", "speed", "heartRate", "scenario",
  "atlasLoading", "wallOpacity", "wallOriginContext", "institution", "authorEmail", "authorSite", "copyHint", "currentValues", "valuesHint", "close", "welcome", "helpText", "validationNote", "motionNote", "open", "closed",
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
    dialog: null, // "values" | "help"
    valueRows: [],
  },

  // ---- lifecycle -----------------------------------------------------------
  onLoad() {
    // The model download starts with the page, in parallel with the 2D setup.
    prefetchAtlas();
    this.modifiers = { preload: 1, afterload: 1, contractility: 1 };
    this.chartsSeen = { strips: true, pv: true, ap: true };
    this.model = createModel(baseline, scenarios[0]);
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
      this.measureStage();
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
    if (this.painter && !this.visible) {
      this.visible = true;
      this.clock.lastNow = null;
      this.restartLoop();
    }
  },
  onHide() {
    this.visible = false;
  },
  onUnload() {
    this.visible = false;
    this.unloaded = true;
    clearInterval(this.watchdog);
    this.chartObserver?.disconnect();
    this.closeAtlas();
  },
  onShareAppMessage() {
    return { title: i18n.t("title"), path: "/pages/lab/lab" };
  },

  // ---- model and drawing (as js/app.js rebuild / update / animate) ---------
  // Whether every beat of the current model is the same (true for 10 of the 12
  // scenarios; atrial fibrillation and complete heart block differ beat to beat).
  checkBeats() {
    const { model, clock } = this, hr = clock.hr, mods = this.modifiers;
    this.sameBeats = model.cycleDuration(hr, 0) === model.cycleDuration(hr, 1);
    for (let k = 0; k < 16 && this.sameBeats; k++) {
      const t = (model.cycleDuration(hr, 0) * k) / 16, a = model.sample(t, hr, mods, 0), b = model.sample(t, hr, mods, 1);
      if (a.ecg !== b.ecg || a.volume.lv !== b.volume.lv || a.pressures.la !== b.pressures.la || a.pressures.lv !== b.pressures.lv) this.sameBeats = false;
    }
    this.nextBeat = null;
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
    this.rebuild(next && next.beat === beat && next.done ? next.out : null);
  },
  prepareNextBeat(budgetMs = 3) {
    if (this.sameBeats || !this.clock.playing) return;
    const { model, clock } = this, beat = clock.beatIndex + 1;
    if (!this.nextBeat || this.nextBeat.beat !== beat || this.nextBeat.hr !== clock.hr) {
      this.nextBeat = { beat, hr: clock.hr, T: model.cycleDuration(clock.hr, beat), out: [], done: false };
    }
    const next = this.nextBeat, end = Date.now() + budgetMs;
    while (!next.done && Date.now() < end) {
      const i = next.out.length;
      next.out.push(model.sample((next.T * i) / 400, clock.hr, this.modifiers, beat));
      next.done = next.out.length === 400;
    }
  },
  rebuild(prepared = null) {
    const { model, clock } = this;
    this.series = prepared ?? model.series(clock.hr, this.modifiers, clock.beatIndex, 400);
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
  // force: refresh the readouts now. atlasForce: also step the 3D heart now
  // instead of at its throttled rate (stepAtlas).
  update(force = false, atlasForce = force) {
    const { model, clock } = this;
    // Identical beats are all drawn as beat 0: same result, and the engine's
    // per-beat caches (e.g. the atrial volume table) stay warm across beats.
    const beat = this.sameBeats ? 0 : clock.beatIndex;
    const sample = (this.sample = model.sample(clock.t, clock.hr, this.modifiers, beat));
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
      soundCaption: (sounds.join(" · ") || "S1 · S2") + "  ·  " + i18n.t("muted"),
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
    if (this.atlasDragging && !force) return;
    if (!force && now - (this.atlasStepAt ?? 0) < (this.atlasCost ?? 0) / 0.75) return;
    atlas.update(frame);
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
    this.clock.update(this.lastFrame);
    if (this.previousBeat !== this.clock.beatIndex) this.newBeat();
    if (this.clock.playing || Math.abs(this.clock.t - (this.sample?.t ?? -1)) > 1e-5) this.update();
    this.prepareNextBeat();
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
    if (this.heart2d) {
      this.heart2d.setLanguage(i18n.language);
      this.atlas?.translate();
      this.rebuild();
      wx.nextTick?.(() => this.measureStage());
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
      this.measureStage();
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
      ...Object.entries(s.ap ?? {}).map(([id, v]) => [i18n.t(id), `${Number(v).toFixed(1)} mV`]),
      [i18n.t("sounds"), Object.entries(s.sounds).filter(([, v]) => v > 0.08).map(([id]) => id.toUpperCase()).join(" · ") || i18n.t("noSound")],
    ];
    this.setData({ dialog: "values", valueRows: rows.map(([k, v]) => ({ k, v })) });
  },

  // ---- heart panel ---------------------------------------------------------
  togglePin() {
    if (this.data.heartModel === "atlas")
      return wx.showToast({ title: i18n.t("atlasPinned"), icon: "none" });
    this.setData({ pinned: !this.data.pinned }, () => this.syncDock().then(() => this.measureStage()));
  },
  // Pinning without sticky: once the page scrolls past the heart, the inline
  // stage collapses and a docked copy is shown above the scroll area. The
  // content below keeps its screen position because the scroll offset stays.
  measureStage() {
    if (this.data.docked) return;
    const q = wx.createSelectorQuery().in(this);
    q.select(".stage-slot").boundingClientRect();
    q.select(".main").boundingClientRect();
    q.select(".main").scrollOffset();
    q.exec(([slot, main, offset]) => {
      if (slot && main && offset && slot.height) this.stageTop = slot.top - main.top + offset.scrollTop;
    });
  },
  onScroll(e) {
    this.scrollTop = e.detail.scrollTop;
    this.syncDock();
  },
  // The realistic heart has one WebGL canvas, in the dock, so while it is
  // chosen the stage stays docked (on both tabs: closing the canvas would lose
  // the WebGL scene).
  syncDock() {
    const scrolled = this.data.pinned && this.stageTop !== undefined && (this.scrollTop ?? 0) > this.stageTop;
    const docked = this.data.heartModel === "atlas" || (this.data.panel === "heart" && !!scrolled);
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
        if (!docked) this.measureStage(); // first measurement when the page opened docked
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
      this.atlasRun = (this.atlasRun ?? 0) + 1; // abandons a 3D heart still loading
      this.atlasStarting = false;
      this.closeAtlas();
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
  closeAtlas() {
    if (this.atlas) releaseAtlas(this.atlas);
    this.atlas = null;
    this.endLoadCard();
    if (!this.unloaded) this.setData({ atlasReady: false, atlasStatus: "" });
  },
  // auto: started when the page opened (a failure then only shows a toast).
  async startAtlas({ auto = false } = {}) {
    if (this.atlas || this.atlasStarting) return;
    this.atlasStarting = true;
    const run = (this.atlasRun = (this.atlasRun ?? 0) + 1), current = () => run === this.atlasRun && !this.unloaded;
    const step = (id, state) => current() && this.loadStep(id, state);
    this.setData({ atlasStatus: i18n.t("atlasLoading") });
    this.beginLoadCard();
    try {
      const glb = prefetchAtlas();
      glb.then(() => step("glb", "done"), () => {});
      // Let the card appear before the engine code is parsed (it blocks).
      step("engine", "active");
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Loaded on first use: about 1 MB of three.js and the atlas engine.
      const shim = require("../../vendor/atlas-shim.js");
      const { AtlasLabView } = require("../../vendor/atlas3d.js");
      const { CONTENT_URL } = require("../../vendor/atlas-asset.js");
      step("engine", "done");
      step("build", "active");
      this.atlasShim = shim;
      const canvas = this.canvases.atlas;
      if (!canvas) throw new Error("WebGL canvas missing");
      const { node, w, h } = canvas;
      const view = new AtlasLabView(shim.useCanvas(node, w, h), {
        i18n,
        readJSON: (name) => requestJSON(CONTENT_URL + name),
        glb,
        onGraphicsChange: (lost) => lost && run === this.atlasRun && this.atlasFailed(new Error("WebGL context lost")),
      });
      await view.init();
      // No tap-to-select here: drop the website's picker, keep OrbitControls.
      node.removeEventListener("pointerdown", view.handlePointerDown);
      node.removeEventListener("pointerup", view.handlePointerUp);
      view.setPreset(this.data.preset);
      step("build", "done");
      step("warm", "active");
      await this.warmAtlas(view);
      if (!current()) return releaseAtlas(view);
      this.atlas = view;
      this.endLoadCard();
      this.setData({ atlasReady: true, atlasStatus: "" });
      this.syncWall();
      this.update(true);
      this.restartLoop();
    } catch (error) {
      if (current()) this.atlasFailed(error, auto);
    } finally {
      if (run === this.atlasRun) this.atlasStarting = false;
    }
  },
  // Loading card: the steps with their real progress, the time so far, a tip
  // that changes every 6 s, and how to go to the 2D heart on a slow network.
  beginLoadCard() {
    clearInterval(this.loadTimer);
    this.load = { started: Date.now(), steps: { glb: "active", engine: "wait", build: "wait", warm: "wait" } };
    this.loadTimer = setInterval(() => this.renderLoadCard(), 1000);
    this.renderLoadCard();
  },
  loadStep(id, state) {
    if (!this.load) return;
    this.load.steps[id] = state;
    this.renderLoadCard();
  },
  endLoadCard() {
    clearInterval(this.loadTimer);
    this.load = null;
    if (!this.unloaded && this.data.loadCard) this.setData({ loadCard: null });
  },
  renderLoadCard() {
    const load = this.load;
    if (!load || this.unloaded) return;
    const seconds = Math.floor((Date.now() - load.started) / 1000), tips = LOAD_TIPS[i18n.language];
    const score = LOAD_STEPS.reduce((sum, id) => sum + { done: 1, active: 0.35, wait: 0 }[load.steps[id]], 0);
    this.setData({
      loadCard: {
        title: i18n.t("loadTitle"),
        time: `${seconds} s · ${i18n.t("loadWait")}`,
        progress: Math.round((score / LOAD_STEPS.length) * 100),
        steps: LOAD_STEPS.map((id) => ({
          id,
          state: load.steps[id],
          mark: { done: "✓", active: "●", wait: "○" }[load.steps[id]],
          label: i18n.t(id === "glb" && atlasGlbCached ? "load.glbCached" : "load." + id),
        })),
        slow: i18n.t("loadSlow"),
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
  },

  // ---- traces --------------------------------------------------------------
  onSide(e) {
    this.setData({ sideIndex: Number(e.detail.value) }, () => this.rebuild());
  },
  // Tap or drag on the plot (not the label gutter) seeks the shared clock.
  stripStart(e) {
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
  },
  seekStrip(x, final = false) {
    this.clock.playing = false;
    this.clock.seek(this.charts.timeAt(x));
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
    this.clock.playing = false;
    this.clock.seek(p.start + Math.min(2, p.duration / 2));
    this.update(true);
  },

  // ---- transport -----------------------------------------------------------
  togglePlay() {
    this.clock.playing = !this.clock.playing;
    this.clock.lastNow = null;
    this.update(true);
  },
  stepPhase(e) {
    this.clock.playing = false;
    this.clock.stepPhase(Number(e.currentTarget.dataset.dir));
    this.update(true);
  },
  // Dragging the timeline redraws the traces and 2D heart at once; the 3D
  // heart follows at its own step rate and is placed exactly on release.
  onScrub(e) {
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
  onScenario(e) {
    const index = Number(e.detail.value), scenario = scenarios[index];
    this.model = createModel(baseline, scenario);
    this.clock.reset(this.model);
    this.clock.setHR(scenario.hr);
    this.setData({ scenarioIndex: index });
    this.rebuild();
  },
});

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
