// Bundle-branch dyssynchrony for the main lab's schematic heart: the blocked
// ventricle follows the model's volume curve delayed by the branch delay, so it
// visibly contracts after the other one. Without a block both ventricles use the
// current sample. Illustrative timing, not a separate per-ventricle haemodynamic model.
export function ventricularVolumes(model, sample, t, hr, modifiers, beatIndex) {
  const { leftDelay = 0, rightDelay = 0 } = sample.conduction ?? {};
  const at = (delayMs) => {
    if (!delayMs) return sample.volume.lv;
    const [time, beat] = delayedInstant(model, t - delayMs, hr, beatIndex);
    return model.sample(time, hr, modifiers, beat).volume.lv;
  };
  return { LV: at(leftDelay), RV: at(rightDelay) };
}

// CC-61: a delayed instant before this beat's start. Without an ectopic plan
// every beat is the same and the model's own wrap round this beat is kept;
// with one, beats differ (a premature beat's start is not its end), so the
// instant is read in the beat before.
export function delayedInstant(model, time, hr, beatIndex) {
  let beat = beatIndex;
  if (model.ectopy?.events?.length > 0)
    while (time < 0 && beat > 0) {
      beat--;
      time += model.cycleDuration(hr, beat);
    }
  return [time, beat];
}
