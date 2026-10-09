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
    atlasLoading: "正在载入三维心脏模型…请耐心等待大约10~30秒",
    atlasFailed: "三维心脏模型载入失败，已改用二维心脏。",
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
    atlasLoading: "Loading the 3D heart model… please allow about 10–30 seconds",
    atlasFailed: "The 3D heart could not load; showing the 2D heart.",
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
  "rightHeart", "readValues", "colorSafe", "structurePicker", "selectStructure", "inspectTitle", "inspectHint",
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
    docked: false, // pinned heart shown above the scroll area
    heartModel: "2d", // opens on the 2D heart; "atlas" = 3D heart
    atlasStatus: "",
    atlasReady: false,
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
    structures: [],
    structureIndex: 0,
    inspector: null,
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
      onPick: (id, info) => this.showStructure(info),
    });
    this.heart2d.init().then(async () => {
      this.painter = new SvgPainter(this.host.children[0]);
      this.setData({ structures: this.structureOptions() });
      await this.attachPanel();
      this.visible = true;
      this.restartLoop();
      this.measureStage();
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
    clearInterval(this.watchdog);
    this.chartObserver?.disconnect();
    this.atlas?.dispose();
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
  update(force = false) {
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
      if (this.atlas) this.stepAtlas(frame, force);
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
    if (!force && this.clock.playing && now - (this.atlasStepAt ?? 0) < (this.atlasCost ?? 0) / 0.75) return;
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
      this.setData({ structures: this.structureOptions() });
      if (this.picked) this.showStructure(this.activeView().pickDetails(this.picked));
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
        resolve();
      }),
    );
  },

  // ---- 3D heart (the website's AtlasLabView, vendor/atlas3d.js) -----
  chooseModel(e) {
    const heartModel = e.currentTarget.dataset.model;
    if (heartModel === this.data.heartModel || this.atlasStarting) return;
    if (heartModel === "2d") this.closeAtlas();
    this.setData({ heartModel, structures: [], structureIndex: 0, inspector: null }, async () => {
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
      this.setData({ structures: this.structureOptions() });
      this.update(true);
      this.restartLoop();
    });
  },
  closeAtlas() {
    // Release the GPU resources once every shader compile started by a preset
    // has settled (AtlasLabView counts them in holdFrame; three.js polls them
    // on a timer and would otherwise read freed programs). Gives up after 5 s.
    const atlas = this.atlas;
    if (atlas) {
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
    this.atlas = null;
    this.setData({ atlasReady: false, atlasStatus: "" });
  },
  async startAtlas() {
    if (this.atlas || this.atlasStarting) return;
    this.atlasStarting = true;
    this.setData({ atlasStatus: i18n.t("atlasLoading") });
    try {
      // Loaded on first use: about 1 MB of three.js and the atlas engine.
      const shim = require("../../vendor/atlas-shim.js");
      const { AtlasLabView } = require("../../vendor/atlas3d.js");
      const { GLB_URL, CONTENT_URL } = require("../../vendor/atlas-asset.js");
      this.atlasShim = shim;
      const canvas = this.canvases.atlas;
      if (!canvas) throw new Error("WebGL canvas missing");
      const { node, w, h } = canvas;
      const view = new AtlasLabView(shim.useCanvas(node, w, h), {
        i18n,
        readJSON: (name) => requestJSON(CONTENT_URL + name),
        glb: cachedDownload(GLB_URL),
        onPick: (id, info) => this.showStructure(info),
        onGraphicsChange: (lost) => lost && this.atlasFailed(new Error("WebGL context lost")),
      });
      await view.init();
      view.setPreset(this.data.preset);
      this.atlas = view;
      this.setData({ atlasReady: true, atlasStatus: "", structures: this.structureOptions(), structureIndex: 0 });
      this.syncWall();
      this.update(true);
      this.restartLoop();
    } catch (error) {
      this.atlasFailed(error);
    } finally {
      this.atlasStarting = false;
    }
  },
  atlasFailed(error) {
    console.error("3D heart unavailable:", error);
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
    wx.showModal({
      title: i18n.t("atlasFailedTitle"),
      content: i18n.t("atlasFailed") + "\n\n" + (why ? why + "\n\n" : "") + i18n.t("reason") + ": " + message.slice(0, 160),
      showCancel: false,
    });
    this.closeAtlas();
    this.setData({ heartModel: "2d" }, async () => {
      await this.syncDock();
      if (this.data.docked) await this.bindCanvas("heartDock");
      this.setData({ structures: this.structureOptions() });
      this.restartLoop();
    });
  },
  // Touches on the WebGL canvas drive OrbitControls and the atlas picker.
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
  tapHeart(e) {
    if (!this.painter) return;
    const touch = e.changedTouches?.[0] ?? e.touches?.[0] ?? e.detail;
    const target = this.canvases[e.currentTarget.id];
    if (!target) return;
    const { ctx, w, h } = target;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); // same space as paintHeart
    const id = this.painter.hitTest(ctx, { x: 0, y: 0, w, h }, devicePixelRatio, touch.x, touch.y);
    if (id) this.heart2d.selectStructure(id);
  },
  activeView() {
    return this.data.heartModel === "atlas" && this.atlas ? this.atlas : this.heart2d;
  },
  structureOptions() {
    return [{ id: "", label: i18n.t("selectStructure") }, ...(this.activeView()?.structureOptions() ?? [])];
  },
  onStructure(e) {
    const index = Number(e.detail.value), option = this.data.structures[index];
    this.setData({ structureIndex: index });
    if (option?.id) this.activeView().selectStructure(option.id);
  },
  showStructure(info) {
    if (!info) return;
    const id = info.id ?? info.structureId ?? info.name;
    this.picked = id;
    this.setData({
      inspector: {
        name: i18n.local(info.label ?? info.name) || id,
        note: (i18n.local(info.note ?? info.description) || i18n.t("inspectHint")) + " · " + (info.phaseNote || i18n.local(this.sample?.phase?.name)),
      },
      structureIndex: Math.max(0, this.data.structures.findIndex((s) => s.id === id)),
    });
    this.update(true);
  },
  toggleColorSafe() {
    this.setData({ colorSafe: !this.data.colorSafe }, () => this.update(true));
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
    if (this.drag && !this.drag.active) this.seekStrip(this.drag.startX);
    this.drag = null;
  },
  seekStrip(x) {
    this.clock.playing = false;
    this.clock.seek(this.charts.timeAt(x));
    this.update(true);
  },
  toggleRelations() {
    this.setData({ relations: !this.data.relations }, () => this.update(true));
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
  onScrub(e) {
    this.clock.playing = false;
    this.clock.seek(Number(e.detail.value));
    this.update(true);
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
  return new Promise((resolve, reject) =>
    wx.request({
      url,
      success: (res) => (res.statusCode === 200 ? resolve(res.data) : reject(new Error(url + ": HTTP " + res.statusCode))),
      fail: (err) => reject(new Error(url + ": " + err.errMsg)),
    }),
  );
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
    const download = () =>
      wx.request({
        url,
        responseType: "arraybuffer",
        success: (res) => {
          if (res.statusCode !== 200) return reject(new Error(url + ": HTTP " + res.statusCode));
          if (!complete(res.data)) return reject(new Error(url + ": incomplete download"));
          fs.writeFile({ filePath: path, data: res.data, fail: () => {} });
          resolve(res.data);
        },
        fail: (err) => reject(new Error(url + ": " + err.errMsg)),
      });
    fs.readFile({
      filePath: path,
      success: (r) => (complete(r.data) ? resolve(r.data) : fs.unlink({ filePath: path, complete: download })),
      fail: download,
    });
  });
}
