// Bundle-branch dyssynchrony for the main lab's schematic heart: the blocked
// ventricle follows the model's volume curve delayed by the branch delay, so it
// visibly contracts after the other one. Without a block both ventricles use the
// current sample. Illustrative timing, not a separate per-ventricle haemodynamic model.
export function ventricularVolumes(model, sample, t, hr, modifiers, beatIndex) {
  const { leftDelay = 0, rightDelay = 0 } = sample.conduction ?? {};
  const at = (delayMs) =>
    delayMs
      ? model.sample(t - delayMs, hr, modifiers, beatIndex).volume.lv
      : sample.volume.lv;
  return { LV: at(leftDelay), RV: at(rightDelay) };
}
