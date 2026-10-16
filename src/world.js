import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createRamp } from './ramp.js';
import { carGeometry, carMesh, semiMesh } from './carModels.js';
import { addAirStation } from './stations.js';
import { addStyledBuilding, PASTELS } from './buildings.js';
import { buildVice, waterNormalMap } from './vice.js';

// Map layout in world metres. X = east, Z = south (matches the top-down mockup).
export const LAYOUT = {
  island: { hx: 420, hz: 270 },
  ring: { hx: 350, hz: 215, r: 60, width: 16 },
  city: { x0: -315, x1: -10, z0: -180, z1: 88 },
  kickflip: { x0: 47, x1: 315, z0: -180, z1: -64 },
  wall: { x0: 47, x1: 315, z0: -29, z1: 88 },
  runway: { x0: -300, x1: 300, z0: 118, z1: 172 },
  start: { x: -350, z: 0, yaw: Math.PI }, // on the west side of the ring, heading north
  wallRamp: { x: 240, z: 40, yaw: Math.PI / 2, radius: 31.8 }, // arc starts here, car drives east (+x); ~63 m tall
  wallApproach: { x: 120, z: 40, yaw: Math.PI / 2 },
  // Five parked vehicles across a lane at z = -122; launch pads on both sides.
  kickflipRow: { x: 197, z: -122, laneHalf: 6, padOffset: 37 },
  kickflipApproach: { x: 70, z: -122, yaw: Math.PI / 2 },
  rocketStart: { x: -270, z: 145, yaw: Math.PI / 2 }, // west end of the runway
  airStations: [
    { x: -285, z: 145, r: 7 },
    { x: 85, z: -95, r: 7 },
    { x: 95, z: 72, r: 7 },
  ],
};


// ---------- Kickflip zone ----------
// Generic vehicle shapes (no brands): robotaxi, steel pickup, semi, crossover, sedan.
const ROW_VEHICLES = [
  { model: 'robotaxi', c: 0xe8e8e8, name: 'robotaxi' },
  { model: 'steelpickup', c: 0xa7acb2, name: 'pickup' },
  { model: 'semi', c: 0xf2f2f2, name: 'semi' },
  { model: 'suv', c: 0x1d1f24, name: 'crossover' },
  { model: 'sedan', c: 0x8a1c22, name: 'sedan' },
].map((v) => {
  if (v.model === 'semi') return { ...v, len: 16, w: 2.6, h: 4.05 };
  const g = carGeometry(v.model);
  return { ...v, len: g.L, w: g.W, h: g.H };
});

function buildKickflip(scene, colliders, models) {
  const K = LAYOUT.kickflipRow;
  const gap = 3.2;
  const total = ROW_VEHICLES.reduce((s, v) => s + v.w, 0) + gap * (ROW_VEHICLES.length - 1);

  // Lane across the whole zone.
  const x0 = LAYOUT.kickflip.x0 + 13, x1 = LAYOUT.kickflip.x1;
  const laneTex = roadTexture(true);
  laneTex.repeat.set(1, (x1 - x0) / 24);
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(K.laneHalf * 2, x1 - x0).rotateX(-Math.PI / 2).rotateY(Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.85 })
  );
  lane.position.set((x0 + x1) / 2, 0.03, K.z);
  lane.receiveShadow = true;
  scene.add(lane);

  let vx = K.x - total / 2;
  for (const v of ROW_VEHICLES) {
    const cx = vx + v.w / 2;
    // Parked across the lane, nose pointing south. A loaded model replaces the built-in one.
    const real = models.byUse['row:' + v.name];
    let m;
    if (real && v.name === 'semi') {
      // Real tractor in front of the built-in trailer.
      m = semiMesh(v.c);
      m.children.filter((c) => c.userData.cab).forEach((c) => (c.visible = false));
      const tractor = real.root.clone();
      tractor.position.z = 4.3 + real.size.L / 2;
      m.add(tractor);
    } else if (real) m = real.root.clone();
    else m = v.model === 'semi' ? semiMesh(v.c) : carMesh(v.model, v.c);
    m.position.set(cx, 0, K.z);
    scene.add(m);
    // Collider from the actual shape. Height lets the car fly over it; on the ground it's a wall.
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    colliders.push({ minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z, h: bb.max.y, name: v.name });
    vx += v.w + gap;
  }

  // Launch pads: the thrusters fire when you cross the line heading at the row.
  const lines = [
    { x: K.x - K.padOffset, dir: 1 },
    { x: K.x + K.padOffset, dir: -1 },
  ];
  const padTex = launchPadTexture();
  const glow = new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff9a2a, emissiveIntensity: 7 });
  for (const L of lines) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(8, K.laneHalf * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.7, transparent: true }));
    pad.position.set(L.x - L.dir * 4, 0.04, K.z);
    if (L.dir < 0) pad.rotation.y = Math.PI;
    pad.receiveShadow = true;
    scene.add(pad);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, K.laneHalf * 2), glow);
    bar.position.set(L.x, 0.05, K.z);
    scene.add(bar);
  }
  addSign(scene, 'KICKFLIP →', LAYOUT.kickflip.x0 + 20, K.z - K.laneHalf - 4, -Math.PI / 2);

  return { row: { x: K.x, z: K.z, halfLen: total / 2 }, laneHalf: K.laneHalf, lines };
}

function launchPadTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 384;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 384);
  ctx.fillStyle = 'rgba(255,154,42,0.9)';
  // Chevrons pointing toward +x of the plane (the row side when dir = +1).
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 70;
    ctx.beginPath();
    ctx.moveTo(x, 40); ctx.lineTo(x + 40, 192); ctx.lineTo(x, 344);
    ctx.lineTo(x + 20, 344); ctx.lineTo(x + 60, 192); ctx.lineTo(x + 20, 40);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const rand = mulberry32(1337);

export function buildWorld(scene, renderer, quality, models = { byUse: {} }) {
  const colliders = []; // { minX, maxX, minZ, maxZ, h? } — no h means infinitely tall
  const roofs = []; // colliders whose top you can land and drive on
  const cityBlocks = [];
  const buildings = []; // for neon signs
  // lamps: { x, z, yaw } — yaw points the head out over the road

  // ---------- Sky, sun, environment ----------
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.003;
  u.mieDirectionalG.value = 0.82;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(215));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Environment map from the sky so the paint and glass reflect it.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(10000);
  envSky.material.uniforms.turbidity.value = 4;
  envSky.material.uniforms.rayleigh.value = 1.2;
  envSky.material.uniforms.mieCoefficient.value = 0.003;
  envSky.material.uniforms.mieDirectionalG.value = 0.82;
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(5000, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3a3c }));
  ground.position.y = -1;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  // pmrem and envScene stay alive: the atmosphere rebuilds the reflections for night and dusk.

  scene.fog = new THREE.Fog(0x8fa3b8, 400, 1800);

  const sun = new THREE.DirectionalLight(0xffe2c4, 5);
  sun.position.copy(sunDir).multiplyScalar(200);
  sun.castShadow = quality === 'high';
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a443c, 0.6);
  scene.add(hemi);

  // ---------- Water and island ----------
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1a6a86, roughness: 0.06, metalness: 0.2, normalMap: waterNormalMap(), normalScale: new THREE.Vector2(0.35, 0.35) })
  );
  water.position.y = -1.2;
  scene.add(water);

  const { hx, hz } = LAYOUT.island;
  // Lawns between the roads and pads (the paved areas sit on top).
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x7f9a55, roughness: 0.95, map: noiseTexture(512, 0x7f9a55, 34, 60) });
  islandMat.map.repeat.set(70, 45);
  const island = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 6, hz * 2), islandMat);
  island.position.y = -3;
  island.receiveShadow = true;
  scene.add(island);
  // Invisible walls at the shore.
  colliders.push(
    { minX: -hx - 5, maxX: -hx + 2, minZ: -hz, maxZ: hz },
    { minX: hx - 2, maxX: hx + 5, minZ: -hz, maxZ: hz },
    { minX: -hx, maxX: hx, minZ: -hz - 5, maxZ: -hz + 2 },
    { minX: -hx, maxX: hx, minZ: hz - 2, maxZ: hz + 5 }
  );

  // ---------- Ring road ----------
  const ringPts = roundedRectPath(LAYOUT.ring.hx, LAYOUT.ring.hz, LAYOUT.ring.r, 14);
  const road = roadStrip(ringPts, LAYOUT.ring.width, roadTexture(true), 0.03, true);
  road.receiveShadow = true;
  scene.add(road);

  // Connectors from the ring into the zones (east side).
  addFlatRoad(scene, -10, 47, 0, 16, 0.025); // city <-> wall zone
  addFlatRoad(scene, LAYOUT.ring.hx - 8, LAYOUT.kickflip.x1, -122, 16, 0.025); // ring -> kickflip
  addFlatRoad(scene, LAYOUT.ring.hx - 8, LAYOUT.wall.x1, 30, 16, 0.025); // ring -> wall zone

  // Street lights along the ring.
  const lamps = ringLampPoles(ringPts, LAYOUT.ring.width / 2 + 3);

  // ---------- City ----------
  const C = LAYOUT.city;
  const cityGround = new THREE.Mesh(
    new THREE.PlaneGeometry(C.x1 - C.x0, C.z1 - C.z0).rotateX(-Math.PI / 2),
    asphaltMaterial(C.x1 - C.x0, C.z1 - C.z0)
  );
  cityGround.position.set((C.x0 + C.x1) / 2, 0.02, (C.z0 + C.z1) / 2);
  cityGround.receiveShadow = true;
  scene.add(cityGround);

  const block = 46, street = 18, pitch = block + street;
  const nx = Math.floor((C.x1 - C.x0 - street) / pitch);
  const nz = Math.floor((C.z1 - C.z0 - street) / pitch);
  const ox = C.x0 + (C.x1 - C.x0 - (nx * pitch - street)) / 2;
  const oz = C.z0 + (C.z1 - C.z0 - (nz * pitch - street)) / 2;
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.9 });
  const pinkWalkMat = new THREE.MeshStandardMaterial({ color: 0xe6b9b4, roughness: 0.9 });
  let roundPlaced = false;

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const bx = ox + i * pitch, bz = oz + j * pitch;
      // Ocean Drive's pink sidewalks on the beach side.
      const walk = new THREE.Mesh(new THREE.BoxGeometry(block, 0.2, block), i === 0 ? pinkWalkMat : sidewalkMat);
      walk.position.set(bx + block / 2, 0.1, bz + block / 2);
      walk.receiveShadow = true;
      scene.add(walk);
      colliders.push({ minX: bx, maxX: bx + block, minZ: bz, maxZ: bz + block, h: 0.2 }); // kerb
      cityBlocks.push({ x: bx, z: bz, w: block, d: block });

      // 1, 2 or 4 buildings per block.
      const mid = i === Math.floor(nx / 2) && j === Math.floor(nz / 2);
      const split = mid ? 1 : rand() < 0.35 ? 1 : rand() < 0.5 ? 2 : 4;
      const parts = split === 1 ? [[0, 0, 1, 1]] : split === 2 ? [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] : [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
      const central = Math.hypot(bx + block / 2 - (C.x0 + C.x1) / 2, bz + block / 2 - (C.z0 + C.z1) / 2);
      // Ocean Drive (the west column) is low pastel Art Deco; downtown gets condos and towers.
      const oceanFront = i === 0;
      const roundHere = !roundPlaced && mid && !oceanFront;
      if (roundHere) roundPlaced = true;
      for (const [px, pz, pw, pd] of parts) {
        const inset = 3;
        const w = block * pw - inset * 2, d = block * pd - inset * 2;
        const tall = 1 - Math.min(central / 180, 1);
        // Downtown skyline: the closer to the centre, the taller.
        let h = 16 + rand() * 30 + tall * tall * 130 * (0.5 + rand() * 0.5);
        let style;
        if (oceanFront) { style = 'deco'; h = 10 + rand() * 12; }
        else if (roundHere) { style = 'round'; h = 70 + rand() * 30; }
        else if (h > 60) style = rand() < 0.6 ? 'glass' : 'condo';
        else style = h < 26 ? 'deco' : 'condo';
        const tint = style === 'glass' ? 0xffffff : style === 'deco' ? PASTELS[Math.floor(rand() * PASTELS.length)] : rand() < 0.7 ? 0xf3f1ec : PASTELS[Math.floor(rand() * PASTELS.length)];
        const cx = bx + block * px + inset + w / 2, cz = bz + block * pz + inset + d / 2;
        // Street-facing side, for the deco entrance and neon.
        const dxb = cx - (bx + block / 2), dzb = cz - (bz + block / 2);
        const face = oceanFront ? [-1, 0] : Math.abs(dxb) > Math.abs(dzb) ? [Math.sign(dxb) || 1, 0] : [0, Math.sign(dzb) || 1];
        const roofH = addStyledBuilding(scene, { style, cx, cz, w, d, h, tint, rand, face });
        // Walls up to the roof; the roof itself can be landed on.
        const roof = { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h: roofH };
        colliders.push(roof);
        roofs.push(roof);
        buildings.push({ cx, cz, w, d, h: roofH, style, blockCx: bx + block / 2, blockCz: bz + block / 2 });
      }
      // A street lamp on each corner of the block, leaning over the street.
      for (const [sx, sz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const lx = bx + sx * block + (sx ? 1 : -1) * 1.2, lz = bz + sz * block + (sz ? 1 : -1) * 1.2;
        lamps.push({ x: lx, z: lz, yaw: Math.atan2(sx ? 1 : -1, sz ? 1 : -1) });
      }
    }
  }

  // ---------- Stunt zones (placeholders for the next step) ----------
  const padMat = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.85, map: noiseTexture(256, 0xa9a59c, 14, 20) });
  padMat.map.repeat.set(20, 10);
  for (const z of [LAYOUT.kickflip, LAYOUT.wall]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.z1 - z.z0).rotateX(-Math.PI / 2), padMat);
    pad.position.set((z.x0 + z.x1) / 2, 0.015, (z.z0 + z.z1) / 2);
    pad.receiveShadow = true;
    scene.add(pad);
  }

  const kickflip = buildKickflip(scene, colliders, models);

  // The curved wall: ~63 m tall, approached from the west along z = 40.
  const W = LAYOUT.wallRamp;
  const ramp = createRamp(scene, colliders, { origin: new THREE.Vector3(W.x, 0, W.z), yaw: W.yaw, radius: W.radius });
  const laneLen = W.x - ramp.L0 - 60;
  const laneTex = roadTexture(true);
  laneTex.repeat.set(1, laneLen / 24);
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(ramp.width, laneLen).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.85 }));
  lane.position.set(60 + laneLen / 2, 0.03, W.z);
  lane.receiveShadow = true;
  scene.add(lane);
  addSign(scene, 'WALL CLIMB →', 70, W.z + 8, -Math.PI / 2);

  // Runway.
  const R = LAYOUT.runway;
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0).rotateX(-Math.PI / 2), runwayMaterial(R.x1 - R.x0, R.z1 - R.z0));
  runway.position.set((R.x0 + R.x1) / 2, 0.02, (R.z0 + R.z1) / 2);
  runway.receiveShadow = true;
  scene.add(runway);
  addSign(scene, 'ROCKET · TAKE OFF HERE', -250, 108, 0);

  // Air stations: the onboard compressor is slow, these refill the tanks fast.
  const airStations = LAYOUT.airStations.map((s) => addAirStation(scene, s));

  const vice = buildVice(scene, { island: LAYOUT.island, ring: LAYOUT.ring, city: C, cityBlocks, buildings, colliders, quality, rand });

  const lampMat = placeLamps(scene, lamps);

  // Ground-like (rough) materials get wet in the rain. Collected before the car exists.
  const wetMaterials = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.isMeshStandardMaterial && m.roughness >= 0.75 && !m.emissiveMap) wetMaterials.add(m);
    }
  });

  return {
    sun,
    sunDir,
    sky,
    envSky,
    envScene,
    pmrem,
    hemi,
    water,
    lamps,
    lampMat,
    buildings,
    vice,
    layout: LAYOUT,
    wetMaterials: [...wetMaterials],
    cityGrid: { ox, oz, nx, nz, pitch, block, street },
    colliders,
    roofs,
    cityBlocks,
    ringPts,
    ramp,
    kickflip,
    airStations,
    // Ground is flat at 0, except on rooftops (and the tower).
    groundHeight(x, z) {
      let h = 0;
      for (const r of roofs) {
        if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && r.h > h) h = r.h;
      }
      return h;
    },
    followShadow(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDir, 200);
    },
  };
}

// ---------------- helpers ----------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRectPath(hx, hz, r, seg) {
  const pts = [];
  const corners = [
    [hx - r, -hz + r, -Math.PI / 2],
    [hx - r, hz - r, 0],
    [-hx + r, hz - r, Math.PI / 2],
    [-hx + r, -hz + r, Math.PI],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
    }
  }
  return pts;
}

function roadStrip(pts, width, tex, y, closed) {
  const pos = [], uv = [], idx = [];
  const n = pts.length;
  let dist = 0;
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n];
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    const dir = new THREE.Vector2().subVectors(next, prev).normalize();
    const nrm = new THREE.Vector2(-dir.y, dir.x);
    if (i > 0) dist += p.distanceTo(pts[(i - 1) % n]);
    pos.push(p.x + nrm.x * width / 2, y, p.y + nrm.y * width / 2, p.x - nrm.x * width / 2, y, p.y - nrm.y * width / 2);
    uv.push(0, dist / 24, 1, dist / 24);
    if (i < n || !closed) {
      const a = i * 2;
      if (i < n) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure normals point up regardless of winding.
  const nrmAttr = g.getAttribute('normal');
  for (let i = 0; i < nrmAttr.count; i++) nrmAttr.setXYZ(i, 0, 1, 0);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
}

function addFlatRoad(scene, x0, x1, zc, width, y) {
  const len = Math.abs(x1 - x0);
  const tex = roadTexture(false);
  tex.repeat.set(1, len / 24);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  m.position.set((x0 + x1) / 2, y, zc);
  m.receiveShadow = true;
  scene.add(m);
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

function speckle(ctx, w, h, amount, count) {
  for (let i = 0; i < count * 100; i++) {
    const v = (Math.random() - 0.5) * amount;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

function noiseTexture(size, base, amount, count) {
  return canvasTex(size, size, (ctx, w, h) => {
    ctx.fillStyle = hex(base);
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, amount, count);
  });
}

function roadTexture(withEdges) {
  return canvasTex(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2c2d30';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 30, 60);
    ctx.fillStyle = '#e9e6dc';
    if (withEdges) {
      ctx.fillRect(10, 0, 6, h);
      ctx.fillRect(w - 16, 0, 6, h);
    }
    ctx.fillRect(w / 2 - 3, 0, 6, h * 0.45);
  });
}

function asphaltMaterial(w, d) {
  const tex = canvasTex(512, 512, (ctx, cw, ch) => {
    ctx.fillStyle = '#323337';
    ctx.fillRect(0, 0, cw, ch);
    speckle(ctx, cw, ch, 26, 80);
  });
  tex.repeat.set(w / 16, d / 16);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82 });
}

function runwayMaterial(w, d) {
  const tex = canvasTex(1024, 128, (ctx, cw, ch) => {
    ctx.fillStyle = '#2a2b2e';
    ctx.fillRect(0, 0, cw, ch);
    speckle(ctx, cw, ch, 26, 60);
    ctx.fillStyle = '#efece4';
    ctx.fillRect(0, 6, cw, 3);
    ctx.fillRect(0, ch - 9, cw, 3);
    for (let x = 60; x < cw - 60; x += 48) ctx.fillRect(x, ch / 2 - 2, 26, 4);
    for (let i = 0; i < 6; i++) { ctx.fillRect(14, 20 + i * 15, 30, 7); ctx.fillRect(cw - 44, 20 + i * 15, 30, 7); }
  });
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
}



function ringLampPoles(pts, offset) {
  const poles = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const seg = a.distanceTo(b);
    const dir = new THREE.Vector2().subVectors(b, a).normalize();
    const nrm = new THREE.Vector2(-dir.y, dir.x);
    for (let t = 0; t < seg; t += 1) {
      acc += 1;
      if (acc >= 36) {
        acc = 0;
        const p = new THREE.Vector2().copy(a).addScaledVector(dir, t);
        poles.push({ x: p.x - nrm.x * offset, z: p.y - nrm.y * offset, yaw: Math.atan2(nrm.x, nrm.y) });
      }
    }
  }
  return poles;
}

// All street lamps as two instanced meshes. Returns the head material so the
// atmosphere can switch the lamps on at night.
function placeLamps(scene, poles) {
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 8, 6).translate(0, 4, 0);
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.6).translate(0, 8, 0.7);
  const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.4 }), poles.length);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 0.4 });
  headMat.userData.lamp = true;
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, poles.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  poles.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(1, 1, 1));
    poleMesh.setMatrixAt(i, m);
    headMesh.setMatrixAt(i, m);
  });
  poleMesh.castShadow = true;
  scene.add(poleMesh, headMesh);
  return headMat;
}


function addSign(scene, text, x, z, yaw, width = 12) {
  const tex = canvasTex(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#111215';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2f2f2';
    ctx.font = '500 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
  board.position.set(x, 5, z);
  board.rotation.y = yaw;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 6), new THREE.MeshStandardMaterial({ color: 0x444444 }));
  post.position.set(x, 2, z);
  scene.add(board, post);
}
