// The realistic heart's view that shows each scenario best, with its
// chamber-wall opacity (owner, 2026-10-10: "when switching to different
// scenarios, ideally use filling, or conduction, or blood flow to best
// represent the disease with ideal opacity"; then: "node/branch blocks use
// conduction; stenosis, regurgitation and PFO use blood flow"). Applied when
// the learner picks a scenario (js/app.js; the WeChat mini program copies this
// file); any view can still be chosen afterwards. The opacities are the presets' own, which were
// tuned for each view (atlas-lab-view.js PRESET_WALL_OPACITY).
// No imports: shared as-is with the mini program.
export const SCENARIO_VIEWS = Object.freeze({
  // The heart itself.
  normal: { preset: "anatomy", wallOpacity: 1 },
  // Faster, shorter ejection and filling streams.
  exercise: { preset: "flow", wallOpacity: 0.15 },
  // The long diastasis: a weak inflow stream between the E and A jets.
  vagal: { preset: "filling", wallOpacity: 0.2 },
  // Node and branch blocks and the other rhythm disorders: the activation wave.
  af: { preset: "conduction", wallOpacity: 0.35 },
  "first-degree": { preset: "conduction", wallOpacity: 0.35 },
  "complete-block": { preset: "conduction", wallOpacity: 0.35 },
  lbbb: { preset: "conduction", wallOpacity: 0.35 },
  rbbb: { preset: "conduction", wallOpacity: 0.35 },
  wpw: { preset: "conduction", wallOpacity: 0.35 },
  // Stenosis, regurgitation and the PFO: blood flow. The fast jet through the
  // narrowed aortic valve; the regurgitant stream back into the left atrium.
  as: { preset: "flow", wallOpacity: 0.15 },
  mr: { preset: "flow", wallOpacity: 0.15 },
  // Dilated cavities and a small ejection.
  hfref: { preset: "filling", wallOpacity: 0.2 },
  // Flow through the atria, with the foramen ovale and its contrast bubbles.
  pfo: { preset: "flow", wallOpacity: 0.15 },
});

export const scenarioView = (id) => SCENARIO_VIEWS[id] ?? null;
