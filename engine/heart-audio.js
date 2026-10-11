// Mini-program heart sounds: the model clock triggers events; speed changes
// their spacing, never pitch. WebAudio synthesis matches the website's audio.
export const SOUND_SPEC = {
  s1: { frequency: 65, duration: 0.12, level: 0.17 },
  s2: { frequency: 90, duration: 0.085, level: 0.17 },
  s3: { frequency: 35, duration: 0.085, level: 0.17 },
  s4: { frequency: 30, duration: 0.085, level: 0.17 },
  murmur: { frequency: 170, duration: 0.22, level: 0.025 },
};

export class HeartAudio {
  constructor(api, onError = () => {}) {
    this.api = api;
    this.onError = onError;
    this.enabled = false;
    this.active = true;
    this.interrupted = false;
    this.destroyed = false;
    this.context = null;
    this.players = null;
    this.nodes = new Set();
    this.events = [];
    this.previous = null;
    this.begin = () => { this.interrupted = true; this.stop(); };
    this.end = () => { this.interrupted = false; this.resume(); };
    api.onAudioInterruptionBegin?.(this.begin);
    api.onAudioInterruptionEnd?.(this.end);
  }

  setCycle(samples) {
    this.events = [];
    for (const key of Object.keys(SOUND_SPEC)) {
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].sounds[key] > 0.12 && samples[(i + samples.length - 1) % samples.length].sounds[key] <= 0.12)
          this.events.push({ key, t: samples[i].t });
      }
    }
  }

  init() {
    if (this.context || this.players) return;
    // Some clients expose the factory but cannot create a working context.
    try {
      const context = this.api.createWebAudioContext?.();
      if (context && context.createOscillator && context.createGain) this.context = context;
      else context?.close?.()?.catch?.(() => {});
    } catch {}
    if (this.context) return;
    if (!this.api.createInnerAudioContext) throw new Error("Audio unavailable");
    this.players = {};
    for (const key of Object.keys(SOUND_SPEC)) {
      // Separate players preserve the two components of split S2.
      this.players[key] = Array.from({ length: key === "s2" ? 2 : 1 }, () => {
        const player = this.api.createInnerAudioContext();
        player.src = `/assets/sounds/${key}.wav`;
        player.autoplay = false;
        player.loop = false;
        player.obeyMuteSwitch = true;
        player.onError?.((error) => this.fail(error));
        return player;
      });
    }
    this.nextS2 = 0;
  }

  async setEnabled(enabled) {
    if (this.destroyed) return false;
    if (!enabled) { this.enabled = false; this.stop(); return false; }
    this.reported = false;
    try {
      this.init();
      if (this.context) await this.context.resume();
      if (this.destroyed) return false;
      this.enabled = true;
      this.previous = null;
      if (!this.active || this.interrupted) this.stop();
      return true;
    } catch (error) { this.fail(error); return false; }
  }

  setActive(active) {
    this.active = active;
    if (active) this.resume();
    else {
      this.stop();
      this.context?.suspend?.()?.catch?.(() => {});
    }
  }

  resume() {
    this.previous = null;
    if (this.enabled && this.active && !this.interrupted && !this.destroyed)
      this.context?.resume?.()?.catch?.((error) => this.fail(error));
  }

  stop() {
    this.previous = null;
    for (const node of this.nodes) { try { node.stop(); } catch {} }
    this.nodes.clear();
    if (this.players) for (const group of Object.values(this.players))
      for (const player of group) player.stop();
  }

  fail(error) {
    const wasEnabled = this.enabled;
    this.enabled = false;
    this.stop();
    if (!this.destroyed && (wasEnabled || !this.reported)) {
      this.reported = true;
      this.onError(error);
    }
  }

  update(sample, playing, beatIndex) {
    if (!this.enabled || !playing || !this.active || this.interrupted || this.destroyed) {
      if (this.previous || this.nodes.size) this.stop();
      return;
    }
    const prior = this.previous;
    if (prior && prior.scenarioId === sample.scenarioId) {
      if (beatIndex === prior.beatIndex && sample.T === prior.T && sample.t >= prior.t) {
        for (const e of this.events) if (e.t > prior.t && e.t <= sample.t) this.pulse(e.key);
      } else if (beatIndex === prior.beatIndex + 1) {
        for (const e of prior.events) if (e.t > prior.t) this.pulse(e.key);
        for (const e of this.events) if (e.t <= sample.t) this.pulse(e.key);
      }
    }
    this.previous = { t: sample.t, T: sample.T, scenarioId: sample.scenarioId, beatIndex, events: this.events };
  }

  pulse(key) {
    if (!this.enabled) return;
    try {
      if (this.players) {
        const group = this.players[key];
        const player = group[key === "s2" ? this.nextS2++ % 2 : 0];
        player.stop();
        player.play();
        return;
      }
      const c = this.context, now = c.currentTime;
      const { frequency, duration, level } = SOUND_SPEC[key];
      const oscillator = c.createOscillator(), gain = c.createGain();
      oscillator.type = key === "murmur" ? "sawtooth" : "sine";
      oscillator.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(c.destination);
      oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      this.nodes.add(oscillator);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.01);
    } catch (error) { this.fail(error); }
  }

  destroy() {
    this.destroyed = true;
    this.enabled = false;
    this.stop();
    this.api.offAudioInterruptionBegin?.(this.begin);
    this.api.offAudioInterruptionEnd?.(this.end);
    this.context?.close?.()?.catch?.(() => {});
    if (this.players) for (const group of Object.values(this.players))
      for (const player of group) player.destroy();
  }
}
