// Small, spatially out-of-phase wall motion; no common contraction envelope.
// Coordinates and time are deterministic. This is a visual illustration only.
export function vfOffset(x, y, time, amplitude = 1) {
  const s = time / 1000;
  return [
    amplitude * Math.sin(x * 0.037 + y * 0.021 + s * 33.3),
    amplitude * Math.sin(x * 0.023 - y * 0.041 + s * 44.6),
  ];
}
export function createVfLayer(layers) {
  const uniforms = { uVfTime: { value: 0 }, uVfOn: { value: 0 }, uVfConduction: { value: 0 } };
  const meshes = layers.rig.meshes.filter((m) => /ventricle/i.test(m.userData.sourceName ?? ""));
  layers.attachShader(meshes, {
    id: "vf-disorder",
    version: 1,
    uniforms,
    vertexDeclarations: "uniform float uVfTime; uniform float uVfOn; varying vec3 vVfPosition;",
    vertexMorphed: `vVfPosition = position;
      transformed += uVfOn * 0.00045 * vec3(sin(position.y*430.0+position.x*290.0+uVfTime*33.3), sin(position.z*470.0-position.y*310.0+uVfTime*44.6), sin(position.x*510.0-position.z*370.0+uVfTime*26.4));`,
    fragmentDeclarations:
      "uniform float uVfTime; uniform float uVfOn; uniform float uVfConduction; varying vec3 vVfPosition;",
    fragmentEmissive: `float vfWave = pow(max(0.0, sin(vVfPosition.x*380.0+vVfPosition.y*510.0+sin(vVfPosition.z*350.0+uVfTime*31.4)+uVfTime*42.7)),8.0);
      totalEmissiveRadiance += uVfOn * uVfConduction * vfWave * vec3(1.0,0.64,0.04);`,
  });
  return {
    uniforms,
    update(sample, conduction) {
      uniforms.uVfTime.value = sample.absolute / 1000;
      uniforms.uVfOn.value = sample.conduction?.rhythm === "vf" ? Math.min(1, (sample.ectopy?.ageMs ?? 100) / 30) : 0;
      uniforms.uVfConduction.value = conduction ? 1 : 0;
    },
  };
}
