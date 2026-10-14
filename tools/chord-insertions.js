// The mini program's js/engine/chord-insertions.js: tools/build-vendor.mjs
// bundles this file in place of the website's (and stops if the website's
// changes, so the two stay in step). It seats the chordae exactly as the
// website does, number for number (tools/check-chord-insertions.mjs), with
// far less work. The seating runs at every 3D motion step, and without JIT
// (WeChat on iOS) it was about 85% of the step, ~150 ms:
//   - the website moves every vertex of all eleven valve leaflets on the CPU
//     (29 morph targets each), twice per step (the mitral branches seat
//     again); here only the leaflets that carry these chords are moved, and
//     once per pose;
//   - every insertion row tested every triangle of its leaflet, computing the
//     triangle's bounds each time; here the bounds are computed once per pose
//     and each chord first keeps the triangles near its insertion;
//   - the 83 tubes' normals are recomputed with the arithmetic of three.js's
//     computeVertexNormals on the arrays directly.
// While the chordae are inactive or unseated (tools/chord-gate.js) nothing is
// done: the tubes keep the straight ends writeCableGeometry gave them.
import * as THREE from "three";
import { CABLE_RADIUS, CABLE_SEGMENTS, CABLE_SIDES } from "@web/js/engine/chord-cable.js";
import { chords } from "./chord-gate.js";

// Rows of the tube this far from the insertion are seated (the website's 0.006).
const REACH = 0.006;
const triangle = new THREE.Triangle(),
  closest = new THREE.Vector3(),
  centre = new THREE.Vector3(),
  vertex = new THREE.Vector3(),
  a = new THREE.Vector3(),
  b = new THREE.Vector3(),
  c = new THREE.Vector3();
const surfaces = new WeakMap();

// Whether three.js's Mesh.getVertexPosition reduces to the sum below:
// relative morph targets in plain Float32 attributes of three components.
const plain = (attribute) =>
  attribute.array instanceof Float32Array && attribute.itemSize === 3 && !attribute.normalized && !attribute.isInterleavedBufferAttribute;

// The leaflet as it is posed now: its vertices (mesh.getVertexPosition's
// arithmetic, in the same order) and the bounds of each triangle. Kept until
// the pose changes (morph influences, geometry or its versions).
function leafletSurface(mesh) {
  const geometry = mesh.geometry,
    position = geometry.attributes.position,
    morphs = geometry.morphAttributes.position ?? [],
    weights = mesh.morphTargetInfluences ?? [],
    n = position.count;
  let s = surfaces.get(mesh);
  if (
    s &&
    s.geometry === geometry &&
    s.version === position.version &&
    s.morphs.length === morphs.length &&
    s.morphs.every((m, k) => m === morphs[k] && s.versions[k] === m.version && s.weights[k] === weights[k])
  )
    return s;
  s = {
    geometry,
    version: position.version,
    morphs: [...morphs],
    versions: morphs.map((m) => m.version),
    weights: morphs.map((_, k) => weights[k]),
    points: new Float64Array(3 * n),
    index: geometry.index.array,
    bounds: null,
  };
  const P = s.points;
  if (plain(position) && morphs.every(plain) && (geometry.morphTargetsRelative || !morphs.length || !mesh.morphTargetInfluences)) {
    const base = position.array;
    const active = mesh.morphTargetInfluences ? morphs.map((m, k) => [m.array, weights[k]]).filter(([, w]) => w !== 0) : [];
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      let x = 0,
        y = 0,
        z = 0;
      for (const [m, w] of active) {
        x += m[j] * w;
        y += m[j + 1] * w;
        z += m[j + 2] * w;
      }
      P[j] = base[j] + x;
      P[j + 1] = base[j + 1] + y;
      P[j + 2] = base[j + 2] + z;
    }
  } else
    for (let i = 0; i < n; i++) {
      mesh.getVertexPosition(i, vertex);
      P[3 * i] = vertex.x;
      P[3 * i + 1] = vertex.y;
      P[3 * i + 2] = vertex.z;
    }
  // min x, y, z, max x, y, z of each triangle (the website's Math.min/max).
  const index = s.index,
    B = (s.bounds = new Float64Array(2 * index.length));
  for (let f = 0; f < index.length; f += 3) {
    const i = 3 * index[f],
      j = 3 * index[f + 1],
      k = 3 * index[f + 2];
    for (let axis = 0; axis < 3; axis++) {
      B[2 * f + axis] = Math.min(P[i + axis], P[j + axis], P[k + axis]);
      B[2 * f + 3 + axis] = Math.max(P[i + axis], P[j + axis], P[k + axis]);
    }
  }
  surfaces.set(mesh, s);
  return s;
}

const setPoint = (v, P, i) => v.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
const rows = [];

// geometry.computeVertexNormals() (three r180) for a plain indexed tube: the
// same arithmetic, float32 normals summed triangle by triangle and then
// normalized, without a function call per vector operation.
function computeNormals(geometry) {
  const index = geometry.index,
    position = geometry.attributes.position,
    normal = geometry.attributes.normal;
  if (!index || !normal || !plain(position) || !plain(normal) || index.itemSize !== 1 || index.normalized || index.isInterleavedBufferAttribute)
    return geometry.computeVertexNormals();
  const P = position.array,
    N = normal.array,
    I = index.array;
  N.fill(0, 0, 3 * normal.count);
  for (let i = 0; i < index.count; i += 3) {
    const a = 3 * I[i],
      b = 3 * I[i + 1],
      c = 3 * I[i + 2];
    const cbx = P[c] - P[b],
      cby = P[c + 1] - P[b + 1],
      cbz = P[c + 2] - P[b + 2],
      abx = P[a] - P[b],
      aby = P[a + 1] - P[b + 1],
      abz = P[a + 2] - P[b + 2];
    const x = cby * abz - cbz * aby,
      y = cbz * abx - cbx * abz,
      z = cbx * aby - cby * abx;
    // All three read before any is written, as there.
    const ax = N[a] + x, ay = N[a + 1] + y, az = N[a + 2] + z;
    const bx = N[b] + x, by = N[b + 1] + y, bz = N[b + 2] + z;
    const cx = N[c] + x, cy = N[c + 1] + y, cz = N[c + 2] + z;
    N[a] = ax, N[a + 1] = ay, N[a + 2] = az;
    N[b] = bx, N[b + 1] = by, N[b + 2] = bz;
    N[c] = cx, N[c + 1] = cy, N[c + 2] = cz;
  }
  for (let j = 0; j < 3 * normal.count; j += 3) {
    const x = N[j],
      y = N[j + 1],
      z = N[j + 2],
      s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    N[j] = x * s;
    N[j + 1] = y * s;
    N[j + 2] = z * s;
  }
  normal.needsUpdate = true;
}

export function seatChordInsertions(preview) {
  if (!chords.active || !chords.seat) return;
  for (const chord of preview.attachments) {
    const { points: P, index, bounds: B } = leafletSurface(chord.mesh);
    const geometry = chord.line.geometry,
      p = geometry.attributes.position;
    const span = chord.cable.span;
    // The rows to seat (as the website: until one lies beyond REACH), their
    // centres, and the box that holds them, widened by the tube's radius.
    rows.length = 0;
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let row = 0; row <= CABLE_SEGMENTS; row++) {
      const distance = (span * row) / CABLE_SEGMENTS;
      if (distance > REACH) break;
      const point = chord.cable.points[row].clone().applyMatrix4(chord.line.matrix);
      rows.push(point);
      for (let axis = 0; axis < 3; axis++) {
        lo[axis] = Math.min(lo[axis], point.getComponent(axis));
        hi[axis] = Math.max(hi[axis], point.getComponent(axis));
      }
    }
    // A triangle the website would test for some row lies within CABLE_RADIUS
    // (the largest clearance) of that box; the others it always skips.
    const near = [];
    for (let f = 0; f < index.length; f += 3) {
      const o = 2 * f;
      if (
        B[o] - CABLE_RADIUS > hi[0] ||
        B[o + 3] + CABLE_RADIUS < lo[0] ||
        B[o + 1] - CABLE_RADIUS > hi[1] ||
        B[o + 4] + CABLE_RADIUS < lo[1] ||
        B[o + 2] - CABLE_RADIUS > hi[2] ||
        B[o + 5] + CABLE_RADIUS < lo[2]
      )
        continue;
      near.push(f);
    }
    rows.forEach((point, row) => {
      centre.copy(point);
      let clearance = CABLE_RADIUS;
      for (const f of near) {
        const o = 2 * f;
        if (
          centre.x < B[o] - clearance ||
          centre.x > B[o + 3] + clearance ||
          centre.y < B[o + 1] - clearance ||
          centre.y > B[o + 4] + clearance ||
          centre.z < B[o + 2] - clearance ||
          centre.z > B[o + 5] + clearance
        )
          continue;
        triangle.set(setPoint(a, P, index[f]), setPoint(b, P, index[f + 1]), setPoint(c, P, index[f + 2]));
        // Collapsed commissural triangles have no sheet clearance. Their
        // closest-point division can produce NaN at a terminal insertion.
        if (triangle.getArea() < 1e-18) continue;
        triangle.closestPointToPoint(centre, closest);
        clearance = Math.min(clearance, centre.distanceTo(closest));
      }
      const scale = row === 0 ? 0 : Math.min(1, (clearance * 0.9) / CABLE_RADIUS);
      const localCentre = chord.cable.points[row];
      for (let j = 0; j <= CABLE_SIDES; j++) {
        const i = row * (CABLE_SIDES + 1) + j;
        vertex.fromBufferAttribute(p, i).sub(localCentre).multiplyScalar(scale).add(localCentre);
        p.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
    });
    p.needsUpdate = true;
    // Recompute a small tube's normals after tapering; use the two identical
    // seam vertices' average so the seam remains smooth.
    computeNormals(geometry);
    const n = geometry.attributes.normal;
    for (let row = 0; row <= CABLE_SEGMENTS; row++) {
      const first = row * (CABLE_SIDES + 1),
        last = first + CABLE_SIDES;
      vertex.fromBufferAttribute(n, first).add(closest.fromBufferAttribute(n, last)).normalize();
      n.setXYZ(first, vertex.x, vertex.y, vertex.z);
      n.setXYZ(last, vertex.x, vertex.y, vertex.z);
    }
  }
}
