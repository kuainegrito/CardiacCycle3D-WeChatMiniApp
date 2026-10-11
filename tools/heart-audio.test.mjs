import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HeartAudio } from "../engine/heart-audio.js";
import { createModel } from "../engine/waveforms.js";
import baseline from "../data/baseline.js";
import scenarios from "../data/scenarios.js";

function webApi() {
  const started = [], stopped = [];
  let resumes = 0, closed = false;
  const context = {
    currentTime: 10, destination: {},
    resume: async () => { resumes++; }, suspend: async () => {}, close: async () => { closed = true; },
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    createOscillator: () => {
      const node = { type: "", hz: 0,
        frequency: { setValueAtTime(hz) { node.hz = hz; } },
        connect() {}, disconnect() {}, start() { started.push(node); },
        stop(when) { if (when === undefined) { stopped.push(node); node.onended?.(); } },
      };
      return node;
    },
  };
  const api = { createWebAudioContext: () => context,
    onAudioInterruptionBegin(f) { this.begin = f; }, onAudioInterruptionEnd(f) { this.end = f; },
    offAudioInterruptionBegin(f) { assert.equal(f, this.begin); }, offAudioInterruptionEnd(f) { assert.equal(f, this.end); },
  };
  return { api, started, stopped, get resumes() { return resumes; }, get closed() { return closed; } };
}

test("model heart sounds match waveform rises across scenarios, rates and beat wrap", async () => {
  for (const scenario of scenarios) for (const hr of [40, 75, 180]) {
    const fixture = webApi(), audio = new HeartAudio(fixture.api);
    await audio.setEnabled(true);
    const model = createModel(baseline, scenario);
    const heard = [];
    audio.pulse = (key) => heard.push(key);
    const expected = [];
    for (let beat = 0; beat < 3; beat++) {
      const samples = model.series(hr, {}, beat, 400);
      const rises = [];
      for (let i = 0; i < samples.length; i++) for (const key of Object.keys(samples[i].sounds)) {
        if (samples[i].sounds[key] > 0.12 && samples[(i + 399) % 400].sounds[key] <= 0.12) rises.push({ key, t: samples[i].t });
      }
      rises.sort((a, b) => a.t - b.t);
      expected.push(...rises.filter((e) => beat > 0 || e.t > 0).map((e) => e.key));
      audio.setCycle(samples);
      for (const sample of samples) audio.update(sample, true, beat);
      // Include events occurring between the last chart sample and the boundary.
      audio.update(model.sample(model.cycleDuration(hr, beat) - 0.001, hr, {}, beat), true, beat);
    }
    // Multiple sound types may rise on the same frame; compare their multiset.
    assert.deepEqual(heard.slice().sort(), expected.slice().sort(), `${scenario.id}/${hr}`);
    audio.destroy();
  }
});

test("mute, pause, hide, interruption and destruction stop active sounds without replay", async () => {
  const f = webApi(), audio = new HeartAudio(f.api);
  const model = createModel(baseline, scenarios[0]);
  audio.setCycle(model.series(75, {}, 0, 400));
  await audio.setEnabled(true);
  audio.update(model.sample(0, 75), true, 0);
  audio.update(model.sample(160, 75), true, 0);
  assert.ok(f.started.length);
  assert.equal(f.started[0].hz, 65);
  audio.update(model.sample(160, 75), false, 0);
  assert.equal(audio.nodes.size, 0);
  const before = f.started.length;
  audio.update(model.sample(400, 75), true, 0);
  assert.equal(f.started.length, before, "resume does not replay missed heart sounds");
  audio.pulse("s2");
  audio.setActive(false);
  assert.equal(audio.nodes.size, 0);
  audio.update(model.sample(600, 75), true, 0);
  assert.equal(audio.previous, null);
  audio.setActive(true);
  f.api.begin();
  audio.update(model.sample(700, 75), true, 0);
  assert.equal(audio.previous, null);
  f.api.end();
  await audio.setEnabled(false);
  assert.equal(audio.enabled, false);
  audio.destroy();
  assert.ok(f.closed);
  assert.equal(await audio.setEnabled(true), false);
});

test("fallback uses bundled PCM clips, handles split S2 and reports playback errors", async () => {
  const players = [], errors = [];
  const api = { createWebAudioContext() { throw Error("unsupported"); }, createInnerAudioContext() {
    const p = { playCount: 0, stop() {}, destroy() {}, onError(f) { this.error = f; }, play() { this.playCount++; } };
    players.push(p); return p;
  } };
  const audio = new HeartAudio(api, (e) => errors.push(e));
  await audio.setEnabled(true);
  audio.pulse("s2"); audio.pulse("s2");
  assert.equal(audio.players.s2[0].playCount, 1);
  assert.equal(audio.players.s2[1].playCount, 1);
  for (const p of players) {
    const wav = await readFile(new URL(`..${p.src}`, import.meta.url));
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.ok(wav.subarray(44).some((v) => v !== 0));
  }
  players[0].error(Error("decode failed"));
  assert.equal(audio.enabled, false);
  assert.equal(errors.length, 1);
  audio.destroy();
});

test("missing audio API leaves the switch off with a useful error", async () => {
  let reported = 0;
  const audio = new HeartAudio({}, () => reported++);
  assert.equal(await audio.setEnabled(true), false);
  assert.equal(reported, 1);
  audio.destroy();
});
