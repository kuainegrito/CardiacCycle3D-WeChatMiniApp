// The realistic heart's view that shows each scenario best, with its
// chamber-wall opacity (owner, 2026-10-10: "when switching to different
// scenarios, ideally use filling, or conduction, or blood flow to best
// represent the disease with ideal opacity"; then: "node/branch blocks use
// conduction; stenosis, regurgitation and PFO use blood flow"). Applied when
// the learner picks a scenario (js/app.js; the WeChat mini program copies this
// file); any view can still be chosen afterwards. The opacities are the presets' own, which were
// tuned for each view (atlas-lab-view.js PRESET_WALL_OPACITY). The camera is
// one of the named views (atlas-lab-view.js VIEWS; owner, 2026-10-11: "for
// different scenarios, can you also automatically rotate to an ideal
// position"): anterior for the conduction system, LAO for the aortic and
// mitral jets, the echo view for dilated or slowly filling cavities, and the
// atrial septum view (the owner's own) for the PFO and the ASD.
// No imports: shared as-is with the mini program.
export const SCENARIO_VIEWS = Object.freeze({
  // The heart itself.
  normal: { preset: "anatomy", wallOpacity: 1, camera: "anterior" },
  // Faster, shorter ejection and filling streams.
  exercise: { preset: "flow", wallOpacity: 0.15, camera: "anterior" },
  // The long diastasis: a weak inflow stream between the E and A jets.
  vagal: { preset: "filling", wallOpacity: 0.2, camera: "echo" },
  // Node and branch blocks and the other rhythm disorders: the activation wave.
  af: { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  vf: { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  "first-degree": { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  "complete-block": { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  lbbb: { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  rbbb: { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  wpw: { preset: "conduction", wallOpacity: 0.35, camera: "anterior" },
  // Stenosis, regurgitation and the PFO: blood flow. The fast jet through the
  // narrowed aortic valve; the regurgitant stream back into the left atrium.
  as: { preset: "flow", wallOpacity: 0.15, camera: "lao" },
  mr: { preset: "flow", wallOpacity: 0.15, camera: "lao" },
  // Dilated cavities and a small ejection.
  hfref: { preset: "filling", wallOpacity: 0.2, camera: "echo" },
  // Flow through the atria, with the foramen ovale and its contrast bubbles,
  // and the atrial septal defect with its left-to-right stream.
  pfo: { preset: "flow", wallOpacity: 0.15, camera: "septum" },
  asd: { preset: "flow", wallOpacity: 0.15, camera: "septum" },
});

export const scenarioView = (id) => SCENARIO_VIEWS[id] ?? null;
