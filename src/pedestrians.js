import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// People on the sidewalks and the beach. They stroll around the city blocks
// and along the beach, swing their arms and legs, and jump out of the way of
// a car (or a horn). Drawn with six instanced meshes in total.

const SHIRTS = [0xffffff, 0xf4b6c2, 0x9fe2e0, 0xffd84a, 0x2d6cdf, 0xe24b4a, 0x222222, 0xf2a65a, 0x7dce82, 0xb38be8];
const PANTS = [0x23324a, 0x2b2b2b, 0xd8d0bf, 0x5b6b7a, 0xf2f2f2, 0x6b4a32];
const SKIN = [0xf1c8a8, 0xd9a07a, 0xb07a52, 0x7c4f33, 0x5a3825, 0xf5d5bd];

export function buildPedestrians(scene, world, quality, rand) {
  const count = quality === 'high' ? 150 : 55;

  // ---- Paths: loops around each block's sidewalk, plus beach lines ----
  const paths = [];
  for (const b of world.cityBlocks) {
    const i = 1.9; // inside the kerb, between the benches and the buildings
    const pts = [[b.x + i, b.z + i], [b.x + b.w - i, b.z + i], [b.x + b.w - i, b.z + b.d - i], [b.x + i, b.z + b.d - i]];
    paths.push(loopPath(pts));
  }
  for (const x of [-372, -398]) { const bp = loopPath([[x, -240], [x, 240], [x + 2, 240], [x + 2, -240]]); bp.beach = true; paths.push(bp); }

  // ---- Body parts (local: facing +z, feet at y = 0) ----
  const strip = (g) => { g.deleteAttribute('uv'); return g.toNonIndexed(); };
  const torsoGeo = mergeGeometries([
    strip(new THREE.BoxGeometry(0.42, 0.56, 0.24).translate(0, 1.2, 0)),
    strip(new THREE.BoxGeometry(0.38, 0.18, 0.22).translate(0, 0.88, 0)),
  ]);
  const headGeo = new THREE.SphereGeometry(0.115, 12, 10).translate(0, 1.62, 0);
  const neckGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.1, 6).translate(0, 1.5, 0);
  const headAll = mergeGeometries([strip(headGeo), strip(neckGeo)]);
  const hairGeo = new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.64, -0.01);
  const legGeo = new THREE.BoxGeometry(0.15, 0.84, 0.16).translate(0, -0.42, 0); // pivot at the hip
  const armGeo = new THREE.BoxGeometry(0.1, 0.58, 0.11).translate(0, -0.29, 0); // pivot at the shoulder

  const mk = (geo, n, color) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: color ?? 0xffffff, roughness: 0.8 }), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };
  const torsos = mk(torsoGeo, count), heads = mk(headAll, count), hair = mk(hairGeo, count);
  const legs = mk(legGeo, count * 2), arms = mk(armGeo, count * 2);

  const peds = [];
  const col = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const path = paths[k % paths.length];
    const p = {
      path, s: rand() * path.len, dir: rand() < 0.5 ? 1 : -1, speed: 1.0 + rand() * 0.7,
      side: (rand() - 0.5) * 0.6, y0: path.beach ? 0.03 : 0.2, phase: rand() * 10, h: 0.92 + rand() * 0.16,
      off: new THREE.Vector2(), offV: new THREE.Vector2(), pos: new THREE.Vector3(), yaw: 0, scare: 0,
    };
    peds.push(p);
    torsos.setColorAt(k, col.set(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
    const skin = SKIN[Math.floor(rand() * SKIN.length)];
    heads.setColorAt(k, col.set(skin));
    hair.setColorAt(k, col.setHSL(0.07, 0.4, rand() * 0.25 + 0.05));
    const pants = PANTS[Math.floor(rand() * PANTS.length)];
    for (const side of [0, 1]) {
      legs.setColorAt(k * 2 + side, col.set(pants));
      arms.setColorAt(k * 2 + side, col.set(skin));
    }
  }

  const M = new THREE.Matrix4(), P = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  const tmp = new THREE.Vector2();

  return {
    // honk: true when the player just sounded the horn.
    update(dt, player, honk = false) {
      const pv = player.vel, pspeed = Math.hypot(pv.x, pv.z);
      peds.forEach((p, k) => {
        // Walk along the path.
        const scared = p.scare > 0;
        p.s = (p.s + p.dir * p.speed * (scared ? 2.2 : 1) * dt + p.path.len) % p.path.len;
        const at = p.path.at(p.s);
        const fx = at.dx * p.dir, fz = at.dz * p.dir;
        // Dodge: if a car is coming at them (or honks nearby), leap sideways.
        const rx = at.x - player.pos.x, rz = at.z - player.pos.z, dist = Math.hypot(rx, rz);
        const coming = pspeed > 4 && dist < 9 && (pv.x * rx + pv.z * rz) > 0 && player.pos.y < 3;
        if ((coming || (honk && dist < 18)) && p.scare <= 0) {
          // Jump perpendicular to the car's path, away from it.
          tmp.set(-pv.z, pv.x).normalize();
          if (tmp.x * rx + tmp.y * rz < 0) tmp.multiplyScalar(-1);
          if (!Number.isFinite(tmp.x)) tmp.set(rx, rz).normalize();
          p.offV.copy(tmp).multiplyScalar(6);
          p.scare = 1.2;
        }
        p.scare -= dt;
        p.off.addScaledVector(p.offV, dt);
        p.offV.multiplyScalar(Math.exp(-dt * 4));
        if (p.scare <= 0) p.off.multiplyScalar(Math.exp(-dt * 0.8)); // drift back to the sidewalk
        if (p.off.length() > 4) p.off.setLength(4);
        const x = at.x - fz * p.side + p.off.x, z = at.z + fx * p.side + p.off.y;
        p.pos.set(x, p.y0, z);
        p.yaw = Math.atan2(fx, fz);

        // Pose.
        p.phase += dt * p.speed * (scared ? 9 : 5.5);
        const swing = Math.sin(p.phase) * (scared ? 0.8 : 0.45);
        Q.setFromAxisAngle(UP, p.yaw);
        M.compose(V.set(x, p.y0 + (scared ? Math.abs(Math.sin(p.phase)) * 0.12 : 0), z), Q, S.set(p.h, p.h, p.h));
        torsos.setMatrixAt(k, M);
        heads.setMatrixAt(k, M);
        hair.setMatrixAt(k, M);
        for (const side of [0, 1]) {
          const sx = side ? 0.11 : -0.11, sgn = side ? 1 : -1;
          P.compose(V.set(sx, 0.86, 0), Q2.setFromAxisAngle(X, swing * sgn), S.set(1, 1, 1));
          legs.setMatrixAt(k * 2 + side, P.premultiply(M));
          P.compose(V.set(side ? 0.27 : -0.27, 1.46, 0), Q2.setFromAxisAngle(X, -swing * sgn * 0.9), S.set(1, 1, 1));
          arms.setMatrixAt(k * 2 + side, P.premultiply(M));
        }
      });
      for (const m of [torsos, heads, hair, legs, arms]) m.instanceMatrix.needsUpdate = true;
    },
  };
}

// A closed polyline with lookup by arc length.
function loopPath(pts) {
  const segs = [];
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, l, start: len });
    len += l;
  }
  return {
    len,
    at(s) {
      let seg = segs[segs.length - 1];
      for (const sg of segs) if (s < sg.start + sg.l) { seg = sg; break; }
      const t = (s - seg.start) / seg.l;
      return { x: seg.a[0] + (seg.b[0] - seg.a[0]) * t, z: seg.a[1] + (seg.b[1] - seg.a[1]) * t, dx: (seg.b[0] - seg.a[0]) / seg.l, dz: (seg.b[1] - seg.a[1]) / seg.l };
    },
  };
}
