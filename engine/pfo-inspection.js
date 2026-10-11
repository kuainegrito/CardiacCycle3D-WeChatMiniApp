import { PFO_DEFAULTS } from "./foramen-ovale.js";

// Inspect the next release beat without changing the chosen phase or the
// intermittent sequence. Playback resumes into resting beats afterwards.
export function selectPfoInspectionBeat(model, clock) {
  if (!model?.patch?.pfo || model.patch.asd) return false;
  const every = Math.max(1, Math.round(model.patch.valsalvaEvery ?? PFO_DEFAULTS.valsalvaEvery));
  const remainder = ((clock.beatIndex % every) + every) % every;
  const advance = every - 1 - remainder;
  if (!advance) return false;
  clock.beatIndex += advance;
  return true;
}
