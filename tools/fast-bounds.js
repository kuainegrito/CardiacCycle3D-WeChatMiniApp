// BufferGeometry.computeBoundingBox / computeBoundingSphere for the 3D heart
// bundle (tools/atlas-entry.js installs them). The heart rewrites its 83
// chord tubes at every motion step, and each rewrite recomputes the tube's
// bounding box and sphere (the website's writeCableGeometry): about 17 ms of
// a 55 ms step without JIT (WeChat on iOS). For plain float positions without
// morph targets these give three.js r180's numbers exactly
// (tools/check-chord-insertions.mjs), without a function call per vertex;
// any other geometry keeps three.js's own methods.

const plain = (geometry) => {
  const p = geometry.attributes.position;
  return (
    !!p &&
    !geometry.morphAttributes.position &&
    p.array instanceof Float32Array &&
    p.itemSize === 3 &&
    !p.normalized &&
    !p.isInterleavedBufferAttribute &&
    !p.isGLBufferAttribute
  );
};

// Box3.setFromBufferAttribute: the same Math.min / Math.max, vertex by vertex.
function extent(position, box) {
  const a = position.array,
    n = 3 * position.count;
  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < n; i += 3) {
    const x = a[i],
      y = a[i + 1],
      z = a[i + 2];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
    z1 = Math.max(z1, z);
  }
  box.min.set(x0, y0, z0);
  box.max.set(x1, y1, z1);
  return box;
}

export function boundingBox(THREE, geometry) {
  const box = (geometry.boundingBox ??= new THREE.Box3());
  extent(geometry.attributes.position, box);
  if (isNaN(box.min.x) || isNaN(box.min.y) || isNaN(box.min.z))
    console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', geometry);
}

export function boundingSphere(THREE, geometry, box = new THREE.Box3()) {
  const sphere = (geometry.boundingSphere ??= new THREE.Sphere()),
    centre = sphere.center,
    position = geometry.attributes.position;
  extent(position, box).getCenter(centre);
  const a = position.array,
    n = 3 * position.count,
    { x, y, z } = centre;
  let radiusSq = 0;
  for (let i = 0; i < n; i += 3) {
    const dx = x - a[i],
      dy = y - a[i + 1],
      dz = z - a[i + 2];
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }
  sphere.radius = Math.sqrt(radiusSq);
  if (isNaN(sphere.radius))
    console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', geometry);
}

export function installFastBounds(THREE) {
  const prototype = THREE.BufferGeometry.prototype,
    { computeBoundingBox, computeBoundingSphere } = prototype,
    box = new THREE.Box3();
  prototype.computeBoundingBox = function () {
    if (!plain(this)) return computeBoundingBox.call(this);
    boundingBox(THREE, this);
  };
  prototype.computeBoundingSphere = function () {
    if (!plain(this)) return computeBoundingSphere.call(this);
    boundingSphere(THREE, this, box);
  };
}
