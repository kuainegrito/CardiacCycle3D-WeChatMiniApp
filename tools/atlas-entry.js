// Entry for vendor/atlas3d.js (tools/build-vendor.mjs): the website's realistic
// heart view with its three.js release. "@web" is the web app folder.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { watchGraphicsContext } from "@web/js/engine/graphics-lifecycle.js";

export { THREE };
export { AtlasLabView } from "@web/js/atlas-lab-view.js";

// Switching to the 2D heart removes the WebGL canvas (pages/lab/lab.js). These
// two keep the built 3D heart meanwhile: parkAtlasView releases only what
// belongs to that canvas (renderer, controls, observers), while the scene, the
// parsed model, the motion engine and the teaching layers stay in memory;
// resumeAtlasView attaches them to a new canvas as AtlasLabView.init() does,
// so coming back costs a shader compile instead of the whole build.
// While parked view.renderer is null, which the view's methods already treat
// as "nothing to draw".
export function parkAtlasView(view) {
  const { renderer, controls } = view;
  view.resizeObserver?.disconnect();
  view.graphics?.dispose();
  view.parked = {
    target: controls.target.clone(),
    minDistance: controls.minDistance,
    maxDistance: controls.maxDistance,
    outputColorSpace: renderer.outputColorSpace,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
  };
  controls.dispose();
  view.controls = view.renderer = view.graphics = view.resizeObserver = null;
  // No forceContextLoss: the page removes its canvas (and with it the
  // context) itself, and a lost context could not be drawn on again.
  try {
    renderer.dispose();
  } catch (error) {
    console.warn("3D heart park:", error);
  }
  renderer.domElement.remove?.();
}

export function resumeAtlasView(view, container) {
  const saved = view.parked;
  view.container = container;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const canvas = renderer.domElement;
  view.graphics = watchGraphicsContext(canvas, {
    onLost: () => {
      if (view.controls) view.controls.enabled = false;
      view.onGraphicsChange(true);
    },
    onRestored: () => {
      renderer.setClearColor(0x000000, 0);
      if (view.controls) view.controls.enabled = true;
      view.render();
      view.onGraphicsChange(false);
    },
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = saved.outputColorSpace;
  renderer.toneMapping = saved.toneMapping;
  renderer.toneMappingExposure = saved.toneMappingExposure;
  container.append(canvas);
  const controls = new OrbitControls(view.camera, canvas);
  controls.enableDamping = false;
  controls.minDistance = saved.minDistance;
  controls.maxDistance = saved.maxDistance;
  controls.target.copy(saved.target);
  controls.addEventListener("change", () => view.render());
  controls.update();
  Object.assign(view, { renderer, controls, parked: null });
  view.resizeObserver = new ResizeObserver(() => view.resize());
  view.resizeObserver.observe(container);
  view.translate();
  view.resize();
}
