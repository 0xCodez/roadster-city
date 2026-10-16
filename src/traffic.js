import * as THREE from 'three';
import { carGeometry, wheelGeometry, TRAFFIC_TYPES } from './carModels.js';
import { lightState } from './details.js';
import { modelParts } from './models.js';

// AI traffic. City cars roam the street grid and pick a turn at every
// junction; ring cars lap the circuit in both directions. They keep their
// distance, brake for the player, and stall for a moment if you hit them.
// Parked cars line the city kerbs. Each car type is drawn with a few
// InstancedMeshes, so all of it costs a few dozen draw calls.

// Vice City palette: pastels, whites and a few loud ones.
const PAINT = [0xf2f2f0, 0x16181c, 0x9aa0a6, 0x8f1d24, 0x1f4f8a, 0xe8c547, 0x47c6c9, 0xf08fb8, 0xb04a1f, 0x6b4fa8, 0xd9d2c3];
const CITY_LANE = 3.2, RING_LANE = 4;
const BRAKE = 10; // m/s²
const LOOK_AHEAD = 40; // m

export function buildTraffic(scene, world, quality, models = { byUse: {} }) {
  // Real models replace built-in types (on High; phones keep the light built-in cars).
  const realFor = (name) => (quality === 'high' ? models.byUse[name] : null);
  const cityCount = quality === 'high' ? 18 : 8;
  const ringCount = quality === 'high' ? 14 : 6;
  const total = cityCount + ringCount;
  const rand = mulberry32(9);

  // ---- Street grid ----
  const G = world.cityGrid;
  const xs = [], zs = [];
  for (let i = 0; i <= G.nx; i++) xs.push(G.ox - G.street / 2 + i * G.pitch);
  for (let j = 0; j <= G.nz; j++) zs.push(G.oz - G.street / 2 + j * G.pitch);
  const node = (i, j) => ({ i, j, x: xs[i], z: zs[j] });
  const neighbours = (n) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([di, dj]) => [n.i + di, n.j + dj])
    .filter(([i, j]) => i >= 0 && j >= 0 && i <= G.nx && j <= G.nz)
    .map(([i, j]) => node(i, j));

  // ---- Ring polyline with cumulative length ----
  const ring = world.ringPts;
  const cum = [0];
  for (let i = 1; i <= ring.length; i++) cum.push(cum[i - 1] + ring[i - 1].distanceTo(ring[i % ring.length]));
  const ringLen = cum[ring.length];
  function sampleRing(s) {
    s = ((s % ringLen) + ringLen) % ringLen;
    let lo = 0, hi = ring.length;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = ring[lo], b = ring[(lo + 1) % ring.length];
    const t = (s - cum[lo]) / (cum[lo + 1] - cum[lo]);
    return { x: a.x + (b.x - a.x) * t, z: a.y + (b.y - a.y) * t, dx: b.x - a.x, dz: b.y - a.y };
  }

  // ---- Cars ----
  const cars = [];
  const newCar = (typeName) => {
    const geo = carGeometry(typeName);
    const real = realFor(typeName);
    const dims = real ? { len: real.size.L, w: real.size.W, h: real.size.H } : { len: geo.L, w: geo.W, h: geo.H };
    const car = {
      typeName, geo, type: { len: dims.len, w: dims.w }, color: PAINT[Math.floor(rand() * PAINT.length)],
      speed: 0, stall: 0, x: 0, z: 0, yaw: 0, dx: 0, dz: 0, init: false,
      collider: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, h: dims.h, name: 'traffic', ref: null },
    };
    car.collider.ref = car;
    cars.push(car);
    return car;
  };
  for (let k = 0; k < total; k++) {
    const car = newCar(TRAFFIC_TYPES[Math.floor(rand() * TRAFFIC_TYPES.length)]);
    if (k < cityCount) {
      car.kind = 'city';
      car.cruise = 10 + rand() * 4;
      car.from = node(Math.floor(rand() * (G.nx + 1)), Math.floor(rand() * (G.nz + 1)));
      const nb = neighbours(car.from);
      car.to = nb[Math.floor(rand() * nb.length)];
      car.dist = rand() * G.pitch * 0.8;
    } else {
      car.kind = 'ring';
      car.dir = k % 2 ? 1 : -1;
      car.cruise = 17 + rand() * 7;
      car.s = (k / ringCount) * ringLen + rand() * 20;
    }
  }

  // ---- Parked cars along the city kerbs ----
  const parkedMax = quality === 'high' ? 44 : 16;
  let parked = 0;
  const lampNear = (x, z) => world.lamps.some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < 36);
  for (const b of world.cityBlocks) {
    const sides = [
      { x0: b.x, z0: b.z - 1.4, dx: 1, dz: 0, len: b.w },
      { x0: b.x, z0: b.z + b.d + 1.4, dx: 1, dz: 0, len: b.w },
      { x0: b.x - 1.4, z0: b.z, dx: 0, dz: 1, len: b.d },
      { x0: b.x + b.w + 1.4, z0: b.z, dx: 0, dz: 1, len: b.d },
    ];
    for (const s of sides) {
      for (let d = 7; d < s.len - 6 && parked < parkedMax; d += 6.5) {
        if (rand() < 0.45) continue;
        const x = s.x0 + s.dx * d, z = s.z0 + s.dz * d;
        if (lampNear(x, z)) continue;
        const car = newCar(TRAFFIC_TYPES[Math.floor(rand() * 5)]); // no pickups at the kerb
        car.kind = 'parked';
        car.x = x; car.z = z;
        car.yaw = Math.atan2(s.dx, s.dz) + (rand() < 0.5 ? Math.PI : 0);
        car.dx = Math.sin(car.yaw); car.dz = Math.cos(car.yaw);
        car.init = true;
        parked++;
      }
    }
  }

  // ---- Instanced meshes, one set per car type ----
  const bodyMat = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d1014, roughness: 0.06, metalness: 0.85 });
  const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff3d8, emissiveIntensity: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 0.6 });
  const mk = (geo, mat, n, shadow = true) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const sets = {};
  for (const name of TRAFFIC_TYPES) {
    const list = cars.filter((c) => c.typeName === name);
    if (!list.length) continue;
    const real = realFor(name);
    if (real) {
      // One instanced mesh per part of the model, keeping its own materials and colours.
      const set = { parts: modelParts(real).map((p) => ({ mesh: mk(p.geometry, p.material, list.length), matrix: p.matrix })) };
      list.forEach((c, i) => { c.slot = i; c.set = set; });
      sets[name] = set;
      continue;
    }
    const g = carGeometry(name);
    const set = {
      body: mk(g.body, bodyMat, list.length),
      glass: mk(g.glass, glassMat, list.length),
      head: mk(g.head, headMat, list.length, false),
      tail: mk(g.tail, tailMat, list.length, false),
      wheels: mk(wheelGeometry(), wheelMat, list.length * 4),
    };
    const col = new THREE.Color();
    list.forEach((c, i) => { c.slot = i; c.set = set; set.body.setColorAt(i, col.set(c.color)); });
    sets[name] = set;
  }

  const M = new THREE.Matrix4(), P = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const carM = new THREE.Matrix4(), carQ = new THREE.Quaternion();
  function writeCar(c) {
    const s = c.set, g = c.geo;
    carQ.setFromAxisAngle(UP, c.yaw);
    carM.compose(V.set(c.x, 0, c.z), carQ, S.set(1, 1, 1));
    if (s.parts) {
      for (const p of s.parts) p.mesh.setMatrixAt(c.slot, M.multiplyMatrices(carM, p.matrix));
      return;
    }
    s.body.setMatrixAt(c.slot, carM);
    s.glass.setMatrixAt(c.slot, carM);
    s.head.setMatrixAt(c.slot, carM);
    s.tail.setMatrixAt(c.slot, carM);
    g.wheels.forEach(([wx, wz], k) => {
      P.compose(V.set(wx, g.wr, wz), Q.identity(), S.setScalar(g.wr));
      s.wheels.setMatrixAt(c.slot * 4 + k, M.multiplyMatrices(carM, P));
    });
  }
  function collider(c) {
    const t = c.type, ex = Math.abs(c.dz) * t.w / 2 + Math.abs(c.dx) * t.len / 2, ez = Math.abs(c.dx) * t.w / 2 + Math.abs(c.dz) * t.len / 2;
    const cl = c.collider;
    cl.minX = c.x - ex; cl.maxX = c.x + ex; cl.minZ = c.z - ez; cl.maxZ = c.z + ez;
  }
  for (const c of cars) if (c.kind === 'parked') { writeCar(c); collider(c); }

  const moving = cars.filter((c) => c.kind !== 'parked');
  world.dynamicColliders = cars.map((c) => c.collider);

  function truePose(c) {
    if (c.kind === 'city') {
      const len = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
      const dx = (c.to.x - c.from.x) / len, dz = (c.to.z - c.from.z) / len;
      const rx = -dz, rz = dx; // right of travel
      return { x: c.from.x + dx * c.dist + rx * CITY_LANE, z: c.from.z + dz * c.dist + rz * CITY_LANE, dx, dz, len };
    }
    const p = sampleRing(c.s);
    let l = Math.hypot(p.dx, p.dz), dx = p.dx / l * c.dir, dz = p.dz / l * c.dir;
    return { x: p.x - dz * RING_LANE, z: p.z + dx * RING_LANE, dx, dz };
  }

  return {
    cars,
    setLights(on) {
      headMat.emissiveIntensity = on ? 4.5 : 0.3;
      tailMat.emissiveIntensity = on ? 5 : 0.6;
    },
    update(dt, player, lightTime = null) {
      for (const c of moving) {
        // Speed limit from the car ahead and from the player.
        let limit = c.cruise;
        if (c.stall > 0) { c.stall -= dt; limit = 0; }
        const fx = c.dx, fz = c.dz;
        // Speed from which the car can still stop before the gap closes.
        const stopSpeed = (gap) => Math.sqrt(2 * BRAKE * Math.max(0, gap));
        // Traffic lights: stop at the line (~10 m before the junction centre) unless already over it.
        if (c.kind === 'city' && lightTime !== null) {
          const len = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
          const left = len - c.dist;
          const axis = Math.abs(c.to.x - c.from.x) > Math.abs(c.to.z - c.from.z) ? 'x' : 'z';
          // Stop with the front bumper before the zebra crossing (centre ~13.5 m from the junction).
          if (left > 12 && left < 45 && lightState(axis, lightTime) !== 'green') limit = Math.min(limit, stopSpeed(left - 13.5));
        }
        for (const o of cars) {
          if (o === c) continue;
          const rx = o.x - c.x, rz = o.z - c.z;
          const ahead = rx * fx + rz * fz;
          if (ahead <= 0 || ahead > LOOK_AHEAD) continue;
          const lat = Math.abs(rx * -fz + rz * fx);
          if (lat > 2.2) continue;
          if (fx * o.dx + fz * o.dz < 0.3) continue; // oncoming or crossing: ignore
          limit = Math.min(limit, o.speed + stopSpeed(ahead - 8));
        }
        if (player.pos.y < 3) {
          const rx = player.pos.x - c.x, rz = player.pos.z - c.z;
          const ahead = rx * fx + rz * fz;
          const lat = Math.abs(rx * -fz + rz * fx);
          if (ahead > 0 && ahead < LOOK_AHEAD && lat < 2.8) limit = Math.min(limit, stopSpeed(ahead - 7));
          // Too close to stop in time: emergency stop rather than drive through the player.
          if (ahead > 0 && ahead < 5.5 && lat < 2.4) { c.speed = 0; c.stall = Math.max(c.stall, 1); }
        }
        const acc = limit > c.speed ? 3 : BRAKE;
        c.speed += Math.max(-acc * dt, Math.min(acc * dt, limit - c.speed));

        // Advance along the path.
        if (c.kind === 'city') {
          c.dist += c.speed * dt;
          let len = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
          while (c.dist >= len) {
            c.dist -= len;
            const prev = c.from;
            c.from = c.to;
            const options = neighbours(c.from).filter((n) => !(n.i === prev.i && n.j === prev.j));
            c.to = options[Math.floor(Math.random() * options.length)];
            len = Math.hypot(c.to.x - c.from.x, c.to.z - c.from.z);
          }
        } else {
          c.s += c.speed * dt * c.dir;
        }

        // Smooth the drawn pose so lane changes at junctions aren't jumps.
        const p = truePose(c);
        if (!c.init) { c.x = p.x; c.z = p.z; c.yaw = Math.atan2(p.dx, p.dz); c.init = true; }
        const k = 1 - Math.exp(-dt * 7);
        c.x += (p.x - c.x) * k;
        c.z += (p.z - c.z) * k;
        let dy = Math.atan2(p.dx, p.dz) - c.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yaw += dy * (1 - Math.exp(-dt * 6));
        c.dx = Math.sin(c.yaw);
        c.dz = Math.cos(c.yaw);

        collider(c);
        writeCar(c);
      }
      for (const s of Object.values(sets)) {
        if (s.parts) for (const p of s.parts) p.mesh.instanceMatrix.needsUpdate = true;
        else for (const m of Object.values(s)) m.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
