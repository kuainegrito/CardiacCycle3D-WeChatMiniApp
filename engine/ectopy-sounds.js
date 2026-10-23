// CC-59: heart sounds of a premature ventricular beat, gated by its own valve
// events. The engine's premature beat (engine/ectopy.js) reads S1 and S2 off
// the template's reference time, which puts them about where a sinus beat has
// them; its valves, however, close when its own pressures say (a weak beat
// may eject briefly, or not at all). Here, on the lab's 400-sample series of
// that beat (the series the audio, the Wiggers sound strip and the caption
// use), S1 sits on the closure of the AV valves after the contraction starts
// and S2 on the closure of each semilunar valve that opened: no aortic
// ejection, no A2. Every other beat is returned as it is (the same array).
const WIDTH_S1 = 7,
  WIDTH_S2 = 6,
  DELAY_S1 = 10,
  DELAY_S2 = 6,
  // P2 relative to A2, as the engine's split second sound (splitS2Ms).
  P2 = 0.85;

const burst = (t, at, width) => Math.exp(-(((t - at) / width) ** 2));
// First instant (series time) at or after `from` when a valve goes open → closed.
function closure(series, valve, from) {
  for (let i = 1; i < series.length; i++)
    if (series[i].t >= from && series[i - 1].valves[valve].open && !series[i].valves[valve].open) return series[i].t;
  return null;
}
const opened = (series, valve, from) => series.some((s) => s.t >= from && s.valves[valve].open);

/** The S1/S2 events of a premature beat's series, or null for any other beat. */
export function prematureSoundEvents(series) {
  const info = series?.[0]?.ectopy;
  if (info?.kind !== "pvc") return null;
  const onset = info.mechanicalOnsetMs ?? 0;
  const s1 = closure(series, "mitral", onset) ?? closure(series, "tricuspid", onset);
  const a2 = opened(series, "aortic", onset) ? closure(series, "aortic", onset) : null;
  const p2 = opened(series, "pulmonary", onset) ? closure(series, "pulmonary", onset) : null;
  return { s1, a2, p2 };
}

/** baseline: content/cycle.baseline.json (for the template S2 amplitude). */
export function gatePrematureSounds(series, baseline) {
  const events = prematureSoundEvents(series);
  if (!events) return series;
  const a1 = Math.max(0, ...series.map((s) => s.sounds.s1)),
    s2 = baseline.waveforms.s2,
    a2 = Math.max(...(s2.samples ?? s2));
  return series.map((s) => {
    const t = s.t,
      first = events.s1 === null ? 0 : a1 * burst(t, events.s1 + DELAY_S1, WIDTH_S1),
      second =
        (events.a2 === null ? 0 : a2 * burst(t, events.a2 + DELAY_S2, WIDTH_S2)) +
        (events.p2 === null ? 0 : P2 * a2 * burst(t, events.p2 + DELAY_S2, WIDTH_S2));
    return { ...s, sounds: { ...s.sounds, s1: first, s2: second } };
  });
}

/** The gated sounds of the series row nearest time t (the lab's caption). */
export function soundsAt(series, t) {
  const T = series[0].T,
    i = Math.max(0, Math.min(series.length - 1, Math.round((t / T) * series.length)));
  return series[i].sounds;
}
