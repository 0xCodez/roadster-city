import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Street-level detail: grass tufts that sway in the wind, bushes, benches and
// bins, zebra crossings, and working traffic lights at every city junction.
// Everything is instanced, so it costs a handful of draw calls.

const LIGHT_CYCLE = 20; // s: x-axis green 0–8, amber 8–10, then z-axis green 10–18, amber 18–20

// 'green' | 'amber' | 'red' for traffic moving along the x or z axis.
export function lightState(axis, t) {
  const p = ((t % LIGHT_CYCLE) + LIGHT_CYCLE) % LIGHT_CYCLE;
  const q = axis === 'x' ? p : (p + 10) % LIGHT_CYCLE;
  return q < 8 ? 'green' : q < 10 ? 'amber' : 'red';
}

export function buildDetails(scene, world, quality, rand) {
  const high = quality === 'high';
  const L = world.layout;
  const G = world.cityGrid;
  const wind = { value: 0 };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), s = new THREE.Vector3();

  // ---------- Grass tufts on the lawns ----------
  const inRect = (x, z, r, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
  const onRingRoad = (x, z) => {
    const dx = Math.abs(x) - L.ring.hx, dz = Math.abs(z) - L.ring.hz;
    const d = Math.max(dx, dz);
    return Math.abs(d) < L.ring.width / 2 + 3;
  };
  const paved = (x, z) =>
    x < -L.ring.hx - L.ring.width / 2 - 1 || // beach
    inRect(x, z, L.city, 3) || inRect(x, z, L.kickflip, 2) || inRect(x, z, L.wall, 2) || inRect(x, z, L.runway, 4) ||
    onRingRoad(x, z) || Math.abs(x) > L.island.hx - 3 || Math.abs(z) > L.island.hz - 3 ||
    world.airStations.some((st) => Math.hypot(x - st.x, z - st.z) < st.r + 4);
  const blades = grassGeometry();
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = instanceMatrix * vec4(position, 1.0);
        float sway = sin(uWind * 1.7 + wp.x * 0.15 + wp.z * 0.11) * 0.12 * uv.y;
        transformed.x += sway; transformed.z += sway * 0.6;`);
  };
  const nGrass = high ? 5200 : 1600;
  const grass = new THREE.InstancedMesh(blades, grassMat, nGrass);
  let placed = 0, tries = 0;
  while (placed < nGrass && tries < nGrass * 6) {
    tries++;
    const x = (rand() * 2 - 1) * L.island.hx, z = (rand() * 2 - 1) * L.island.hz;
    if (paved(x, z)) continue;
    const sc = 0.7 + rand() * 0.8;
    m.compose(v.set(x, 0, z), q.setFromAxisAngle(up, rand() * Math.PI), s.set(sc, sc * (0.8 + rand() * 0.6), sc));
    grass.setMatrixAt(placed++, m);
  }
  grass.count = placed;
  grass.receiveShadow = true;
  scene.add(grass);

  // ---------- Bushes along the city sidewalks and the ring road ----------
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  const bp = bushGeo.getAttribute('position');
  for (let i = 0; i < bp.count; i++) { v.fromBufferAttribute(bp, i); v.multiplyScalar(0.85 + Math.random() * 0.3); v.y *= 0.7; bp.setXYZ(i, v.x, v.y + 0.45, v.z); }
  bushGeo.computeVertexNormals();
  const bushSpots = [];
  for (const b of world.cityBlocks) {
    for (let k = 0; k < 6; k++) {
      const side = Math.floor(rand() * 4), t = 6 + rand() * (b.w - 12);
      const [x, z] = [[b.x + t, b.z + 3.1], [b.x + t, b.z + b.d - 3.1], [b.x + 3.1, b.z + t], [b.x + b.w - 3.1, b.z + t]][side]; // against the facades
      bushSpots.push([x, 0.2, z, 0.6 + rand() * 0.4]);
    }
  }
  for (let i = 0; i < (high ? 160 : 60); i++) {
    const x = (rand() * 2 - 1) * L.island.hx, z = (rand() * 2 - 1) * L.island.hz;
    if (!paved(x, z)) bushSpots.push([x, 0, z, 0.8 + rand() * 0.9]);
  }
  const bushes = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.9, flatShading: true }), bushSpots.length);
  const col = new THREE.Color();
  bushSpots.forEach(([x, y, z, sc], i) => {
    m.compose(v.set(x, y, z), q.setFromAxisAngle(up, rand() * 6), s.set(sc * 1.3, sc, sc * 1.1));
    bushes.setMatrixAt(i, m);
    bushes.setColorAt(i, col.setHSL(0.27 + rand() * 0.06, 0.45, 0.24 + rand() * 0.1));
  });
  bushes.castShadow = bushes.receiveShadow = true;
  scene.add(bushes);

  // ---------- Benches and bins on the sidewalks ----------
  const bench = mergeGeometries([
    new THREE.BoxGeometry(1.6, 0.06, 0.45).translate(0, 0.45, 0),
    new THREE.BoxGeometry(1.6, 0.4, 0.06).translate(0, 0.72, -0.2),
    new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(0.7, 0.22, 0),
    new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(-0.7, 0.22, 0),
  ].map((g) => g.toNonIndexed()));
  const bin = new THREE.CylinderGeometry(0.28, 0.24, 0.9, 10).translate(0, 0.45, 0);
  const furn = [];
  for (const b of world.cityBlocks) {
    for (const [x, z, yaw] of [[b.x + b.w / 2, b.z + 1.2, 0], [b.x + b.w / 2, b.z + b.d - 1.2, Math.PI], [b.x + 1.2, b.z + b.d / 2, Math.PI / 2], [b.x + b.w - 1.2, b.z + b.d / 2, -Math.PI / 2]]) {
      if (rand() < 0.65) furn.push({ x, z, yaw });
    }
  }
  const benches = new THREE.InstancedMesh(bench, new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.8 }), furn.length);
  const bins = new THREE.InstancedMesh(bin, new THREE.MeshStandardMaterial({ color: 0x2f4f3a, roughness: 0.6, metalness: 0.3 }), furn.length);
  furn.forEach((f, i) => {
    q.setFromAxisAngle(up, f.yaw);
    m.compose(v.set(f.x, 0.2, f.z), q, s.set(1, 1, 1));
    benches.setMatrixAt(i, m);
    m.compose(v.set(f.x + Math.cos(f.yaw) * 1.4, 0.2, f.z - Math.sin(f.yaw) * 1.4), q, s.set(1, 1, 1));
    bins.setMatrixAt(i, m);
  });
  benches.castShadow = bins.castShadow = true;
  scene.add(benches, bins);

  // ---------- Junctions: zebra crossings and traffic lights ----------
  const nodes = [];
  for (let i = 0; i <= G.nx; i++) for (let j = 0; j <= G.nz; j++) nodes.push([G.ox - G.street / 2 + i * G.pitch, G.oz - G.street / 2 + j * G.pitch]);
  const zebraMat = new THREE.MeshStandardMaterial({ map: zebraTexture(), transparent: true, roughness: 0.7, depthWrite: false });
  const zebraGeo = new THREE.PlaneGeometry(G.street - 2, 3).rotateX(-Math.PI / 2);
  const zebras = new THREE.InstancedMesh(zebraGeo, zebraMat, nodes.length * 4);
  let zi = 0;
  for (const [x, z] of nodes) {
    for (const [dx, dz, yaw] of [[11, 0, Math.PI / 2], [-11, 0, Math.PI / 2], [0, 11, 0], [0, -11, 0]]) {
      m.compose(v.set(x + dx, 0.045, z + dz), q.setFromAxisAngle(up, yaw), s.set(1, 1, 1));
      zebras.setMatrixAt(zi++, m);
    }
  }
  zebras.renderOrder = 1;
  scene.add(zebras);

  // Two signal poles per junction: one shows the x-axis lights, one the z-axis.
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.14, 5.6, 8).translate(0, 2.8, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.12, 0.12, 4.2).translate(0, 5.5, 2.1).toNonIndexed(),
    new THREE.BoxGeometry(0.42, 1.2, 0.34).translate(0, 5.0, 4.0).toNonIndexed(),
  ].map((g) => { g.deleteAttribute('uv'); return g; }));
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.5, roughness: 0.5 }), nodes.length * 2);
  const lampGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nodes.length * 2 * 3 * 2);
  const signals = []; // { axis, base: instance index of red lamp (both faces) }
  let pi = 0, li = 0;
  for (const [x, z] of nodes) {
    // Pole on the far-right corner for each approach direction, arm reaching over the road.
    for (const [cx, cz, yaw, axis] of [[x + 10, z - 10, -Math.PI / 2, 'x'], [x - 10, z - 10, 0, 'z']]) {
      q.setFromAxisAngle(up, yaw);
      m.compose(v.set(cx, 0, cz), q, s.set(1, 1, 1));
      poles.setMatrixAt(pi++, m);
      const base = li;
      // Three lamps on both faces of the head (red top, amber, green bottom).
      for (const face of [1, -1]) for (let k = 0; k < 3; k++) {
        const local = new THREE.Vector3(0, 5.4 - k * 0.38, 4.0 + face * 0.18).applyQuaternion(q);
        m.compose(v.set(cx + local.x, local.y, cz + local.z), q, s.set(1, 1, 1));
        lamps.setMatrixAt(li++, m);
      }
      signals.push({ axis, base });
      world.colliders.push({ minX: cx - 0.25, maxX: cx + 0.25, minZ: cz - 0.25, maxZ: cz + 0.25, h: 5.6 });
    }
  }
  poles.castShadow = true;
  scene.add(poles, lamps);
  const OFF = new THREE.Color(0x1a1a1a);
  const ON = { red: new THREE.Color(0xff2a1a).multiplyScalar(6), amber: new THREE.Color(0xffa31a).multiplyScalar(6), green: new THREE.Color(0x22ff66).multiplyScalar(6) };
  const ORDER = ['red', 'amber', 'green'];
  let clock = 0, lastKey = '';

  const api = {
    update(dt) {
      clock += dt;
      wind.value = clock;
      const key = lightState('x', clock) + lightState('z', clock);
      if (key === lastKey) return;
      lastKey = key;
      for (const sg of signals) {
        const st = lightState(sg.axis, clock);
        for (let face = 0; face < 2; face++) for (let k = 0; k < 3; k++) lamps.setColorAt(sg.base + face * 3 + k, ORDER[k] === st ? ON[st] : OFF);
      }
      lamps.instanceColor.needsUpdate = true;
    },
    time: () => clock,
  };
  api.update(0); // colour the lamps before the first frame so the shader includes instance colours
  return api;
}

function grassGeometry() {
  // Three crossed quads, rooted at y = 0.
  const parts = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => new THREE.PlaneGeometry(0.7, 0.55).translate(0, 0.275, 0).rotateY(a));
  return mergeGeometries(parts);
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 26; i++) {
    const x = 8 + Math.random() * 112, h = 60 + Math.random() * 64, lean = (Math.random() - 0.5) * 30;
    ctx.strokeStyle = `hsl(${85 + Math.random() * 20}, ${45 + Math.random() * 20}%, ${28 + Math.random() * 18}%)`;
    ctx.lineWidth = 3 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function zebraTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 32);
  ctx.fillStyle = 'rgba(240,240,232,0.9)';
  for (let x = 4; x < 256; x += 22) ctx.fillRect(x, 0, 12, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
