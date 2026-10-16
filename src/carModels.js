import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { keys, loft, stations } from './geom.js';

// Procedural road cars, lofted from cross-sections like the roadster.
// Each type gives separate geometries (paint, glass, head/tail lights) so the
// traffic can draw every car of a type with a few instanced meshes.
// Local axes: +Z forward, +Y up. Generic shapes, no real brands.

const SPECS = {
  sedan: {
    L: 4.7, wb: 2.8, wr: 0.33,
    hw: [[2.35, 0.78], [2.1, 0.88], [0, 0.92], [-2.0, 0.9], [-2.35, 0.82]],
    yt: [[2.35, 0.6], [2.1, 0.74], [1.0, 0.84], [-1.6, 0.9], [-2.2, 0.9], [-2.35, 0.8]],
    yb: 0.25, cabin: [1.0, -1.62],
    gt: [[1.0, 0.84], [0.35, 1.4], [-0.75, 1.42], [-1.62, 0.9]], gw: 0.8,
  },
  hatch: {
    L: 4.1, wb: 2.55, wr: 0.32,
    hw: [[2.05, 0.78], [1.8, 0.86], [0, 0.88], [-1.9, 0.86], [-2.05, 0.82]],
    yt: [[2.05, 0.6], [1.8, 0.74], [0.9, 0.85], [-1.9, 0.95], [-2.05, 0.88]],
    yb: 0.24, cabin: [0.9, -1.95],
    gt: [[0.9, 0.85], [0.3, 1.42], [-1.2, 1.46], [-1.85, 1.28], [-1.95, 0.95]], gw: 0.82,
  },
  suv: {
    L: 4.8, wb: 2.85, wr: 0.38,
    hw: [[2.4, 0.84], [2.15, 0.95], [0, 0.97], [-2.2, 0.95], [-2.4, 0.9]],
    yt: [[2.4, 0.82], [2.15, 0.96], [1.1, 1.05], [-2.25, 1.1], [-2.4, 1.0]],
    yb: 0.32, cabin: [1.1, -2.28],
    gt: [[1.1, 1.05], [0.5, 1.68], [-2.05, 1.72], [-2.28, 1.15]], gw: 0.85,
  },
  van: {
    L: 5.2, wb: 3.25, wr: 0.36,
    hw: [[2.6, 0.86], [2.35, 0.97], [0, 0.99], [-2.6, 0.98]],
    yt: [[2.6, 0.8], [2.35, 1.02], [1.75, 1.18], [-2.6, 1.22]],
    yb: 0.3, cabin: [1.75, -2.56],
    gt: [[1.75, 1.18], [1.15, 1.98], [-2.45, 2.02], [-2.56, 1.3]], gw: 0.93,
  },
  sports: {
    L: 4.5, wb: 2.6, wr: 0.33,
    hw: [[2.25, 0.78], [2.0, 0.9], [1.2, 0.96], [0, 0.92], [-1.2, 0.99], [-2.25, 0.92]],
    yt: [[2.25, 0.48], [1.9, 0.6], [0.7, 0.74], [-1.8, 0.84], [-2.25, 0.78]],
    yb: 0.2, cabin: [0.7, -1.45],
    gt: [[0.7, 0.74], [0.1, 1.1], [-0.6, 1.12], [-1.45, 0.86]], gw: 0.76,
  },
  pickup: {
    L: 5.5, wb: 3.4, wr: 0.4,
    hw: [[2.75, 0.88], [2.5, 0.98], [0, 1.0], [-2.75, 0.98]],
    yt: [[2.75, 0.95], [2.45, 1.08], [1.2, 1.14], [-2.75, 1.14]],
    yb: 0.38, cabin: [1.2, -0.6],
    gt: [[1.2, 1.14], [0.7, 1.78], [-0.42, 1.8], [-0.6, 1.2]], gw: 0.88, bed: [-0.7, -2.65],
  },
  robotaxi: {
    L: 4.0, wb: 2.5, wr: 0.34,
    hw: [[2.0, 0.8], [1.75, 0.9], [0, 0.93], [-1.75, 0.9], [-2.0, 0.82]],
    yt: [[2.0, 0.62], [1.7, 0.8], [1.2, 0.9], [-1.75, 0.95], [-2.0, 0.85]],
    yb: 0.26, cabin: [1.2, -1.85],
    gt: [[1.2, 0.9], [0.55, 1.5], [-1.15, 1.52], [-1.85, 1.0]], gw: 0.86,
  },
  steelpickup: {
    L: 5.7, wb: 3.6, wr: 0.42, faceted: true,
    hw: [[2.85, 0.95], [2.6, 1.0], [-2.85, 1.0]],
    yt: [[2.85, 0.95], [2.55, 1.08], [1.9, 1.1], [-2.85, 1.12]],
    yb: 0.42, cabin: [1.9, -2.85],
    gt: [[1.9, 1.1], [0.2, 1.9], [-2.85, 1.25]], gw: 0.9, linear: true,
  },
};
export const TRAFFIC_TYPES = ['sedan', 'hatch', 'suv', 'van', 'sports', 'pickup'];

const cache = {};

export function carGeometry(type) {
  if (cache[type]) return cache[type];
  const S = SPECS[type];
  const L2 = S.L / 2, fz = S.wb / 2, rz = -S.wb / 2, arch = S.wr + 0.06;
  const lin = (list) => {
    const k = [...list].sort((a, b) => a[0] - b[0]);
    return (z) => {
      if (z <= k[0][0]) return k[0][1];
      if (z >= k[k.length - 1][0]) return k[k.length - 1][1];
      let i = 1;
      while (k[i][0] < z) i++;
      const t = (z - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * t;
    };
  };
  const f = S.linear ? lin : keys;
  const HW = f(S.hw), YT = f(S.yt), GT = f(S.gt);
  const archTop = (z) => {
    for (const wz of [fz, rz]) { const d = z - wz; if (Math.abs(d) < arch) return S.wr + Math.sqrt(arch * arch - d * d); }
    return 0;
  };
  const section = (z) => {
    const hw = HW(z), yt = YT(z), base = S.yb, a = archTop(z);
    const lip = Math.max(base + 0.04, a);
    const yw = Math.max(base + (yt - base) * 0.45, lip + 0.03);
    const yf = Math.max(yt, yw + 0.04);
    return [[0, base], [hw * 0.6, base], [hw * 0.64, Math.max(base, a)], [hw * 0.97, lip], [hw, yw], [hw * 0.98, yw + (yf - yw) * 0.6], [hw * 0.9, yf], [hw * 0.45, yf + 0.006], [0, yf + 0.01]];
  };
  let body = loft(stations(-L2, L2, 0.12, [fz, rz], 0.04, arch + 0.05), section);

  const [c0, c1] = S.cabin;
  const glassSection = (z) => {
    const base = YT(z) - 0.02, top = Math.max(GT(z), base + 0.004), h = top - base;
    const cw = HW(z) * S.gw;
    return [[0, base], [cw, base], [cw * 0.97, base + h * 0.4], [cw * 0.86, base + h * 0.92], [cw * 0.5, top], [0, top]];
  };
  let glass = loft(stations(c1, c0, 0.1), glassSection);
  if (S.faceted) { body = body.toNonIndexed(); body.computeVertexNormals(); glass = glass.toNonIndexed(); glass.computeVertexNormals(); }
  if (S.bed) {
    const bed = new THREE.BoxGeometry(HW(-1.5) * 1.6, 0.02, S.bed[0] - S.bed[1]).translate(0, YT(-1.5) + 0.004, (S.bed[0] + S.bed[1]) / 2).toNonIndexed();
    bed.deleteAttribute('uv'); // attributes must match the lofted glass
    glass = mergeGeometries([glass.toNonIndexed(), bed]);
  }

  // Lights: a pair of lamps at each end.
  const zf = L2 - 0.08, zr = -L2 + 0.06;
  const yf = YT(zf) - 0.07, yr = YT(zr) - 0.1;
  const lamp = (x, y, z, w) => new THREE.BoxGeometry(w, 0.08, 0.06).translate(x, y, z);
  const hwF = HW(zf), hwR = HW(zr);
  const head = mergeGeometries([lamp(hwF * 0.6, yf, zf, hwF * 0.5), lamp(-hwF * 0.6, yf, zf, hwF * 0.5)]);
  const tail = mergeGeometries([lamp(hwR * 0.62, yr, zr, hwR * 0.55), lamp(-hwR * 0.62, yr, zr, hwR * 0.55)]);

  const res = { body, glass, head, tail, wheels: [[0.9 * HW(fz) * 0.96, fz], [-0.9 * HW(fz) * 0.96, fz], [0.9 * HW(rz) * 0.96, rz], [-0.9 * HW(rz) * 0.96, rz]], wr: S.wr, L: S.L, W: HW(0) * 2, H: GT(0) };
  cache[type] = res;
  return res;
}

// One wheel (tyre + rim) with vertex colours, unit radius; scale per car.
let wheelGeo = null;
export function wheelGeometry() {
  if (wheelGeo) return wheelGeo;
  const tyre = new THREE.TorusGeometry(0.76, 0.24, 10, 28).rotateY(Math.PI / 2).toNonIndexed();
  const rim = new THREE.CylinderGeometry(0.74, 0.74, 0.5, 20).rotateZ(Math.PI / 2).toNonIndexed();
  const paint = (g, hex) => {
    const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g;
  };
  wheelGeo = mergeGeometries([paint(tyre, 0x121212), paint(rim, 0x9a9da3)]);
  return wheelGeo;
}

// A complete standalone car (for the kickflip row and showpieces).
export function carMesh(type, color) {
  const g = carGeometry(type);
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: type === 'steelpickup' ? 0.45 : 0.32, metalness: type === 'steelpickup' ? 0.85 : 0.4, clearcoat: type === 'steelpickup' ? 0 : 0.8, clearcoatRoughness: 0.1 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.06, metalness: 0.85 });
  group.add(new THREE.Mesh(g.body, paint), new THREE.Mesh(g.glass, glassMat));
  group.add(new THREE.Mesh(g.head, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff3d8, emissiveIntensity: 0.6 })));
  group.add(new THREE.Mesh(g.tail, new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0.8 })));
  const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  for (const [x, z] of g.wheels) {
    const w = new THREE.Mesh(wheelGeometry(), wm);
    w.position.set(x, g.wr, z);
    w.scale.setScalar(g.wr);
    group.add(w);
  }
  group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return group;
}

// A semi truck: cab-over tractor and a long box trailer. Length ~16 m along z.
export function semiMesh(color = 0xf2f2f2) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.3, clearcoat: 0.6 });
  const trailerMat = new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.1, metalness: 0.8 });
  const cabH = keys([[8.0, 1.2], [7.7, 2.6], [7.2, 3.4], [5.4, 3.5]]);
  const cab = loft(stations(5.4, 8.0, 0.1), (z) => {
    const top = cabH(z), hw = 1.25;
    return [[0, 0.7], [hw * 0.95, 0.7], [hw, 1.0], [hw, top - 0.3], [hw * 0.9, top], [0, top + 0.02]];
  });
  const cabMesh = new THREE.Mesh(cab, paint);
  cabMesh.userData.cab = true; // tractor parts can be swapped for a real model
  group.add(cabMesh);
  const wind = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 0.05), dark);
  wind.position.set(0, 2.55, 7.83);
  wind.rotation.x = -0.32;
  wind.userData.cab = true;
  group.add(wind);
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.9, 12.8), trailerMat);
  trailer.position.set(0, 2.55, -1.3);
  group.add(trailer);
  const wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  for (const z of [7.0, 4.6, 3.3, -5.4, -6.7]) for (const x of [1.05, -1.05]) {
    const w = new THREE.Mesh(wheelGeometry(), wm);
    w.position.set(x, 0.52, z);
    w.scale.setScalar(0.52);
    w.userData.cab = z > 3;
    group.add(w);
  }
  group.position.z = -0.0;
  group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  // Centre the 16 m rig on its origin.
  group.children.forEach((c) => (c.position.z -= 0.6));
  return group;
}
