import * as THREE from 'three';

// The curved wall from the reveal: a short flat lead-in, then a circular arc
// that goes past vertical until the car hangs upside down at ~21 m.
// The path is parametrised by arc length s; the car rides it in 'ramp' state.

const UP = new THREE.Vector3(0, 1, 0);

export function createRamp(scene, colliders, { origin, yaw, radius = 10.6, width = 8, leadIn = 3, maxAngleDeg = 172 }) {
  const d = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // forward along the ramp
  const l = new THREE.Vector3().crossVectors(UP, d); // left
  const R = radius, L0 = leadIn, thetaMax = THREE.MathUtils.degToRad(maxAngleDeg);
  const length = L0 + R * thetaMax;

  const ramp = {
    origin: origin.clone(), d, l, yaw, R, L0, width, thetaMax, length,
    // Point, tangent and surface normal at arc length s.
    sample(s, out = { pos: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3(), theta: 0 }) {
      if (s < L0) {
        out.theta = 0;
        out.pos.copy(origin).addScaledVector(d, s - L0);
        out.T.copy(d);
        out.N.copy(UP);
      } else {
        const th = (s - L0) / R;
        out.theta = th;
        const sn = Math.sin(th), cs = Math.cos(th);
        out.pos.copy(origin).addScaledVector(d, R * sn).addScaledVector(UP, R * (1 - cs));
        out.T.copy(d).multiplyScalar(cs).addScaledVector(UP, sn);
        out.N.copy(d).multiplyScalar(-sn).addScaledVector(UP, cs);
      }
      return out;
    },
    // Local coords of a ground point relative to the ramp start.
    local(p) {
      const rx = p.x - origin.x, rz = p.z - origin.z;
      return { u: rx * d.x + rz * d.z, lat: rx * l.x + rz * l.z };
    },
  };

  const group = new THREE.Group();

  // ---- Driving surface ----
  const pos = [], nrm = [], uv = [], idx = [];
  const tmp = { pos: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3(), theta: 0 };
  const steps = Math.ceil(length / 0.5);
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * length;
    ramp.sample(s, tmp);
    for (const side of [1, -1]) {
      const p = tmp.pos.clone().addScaledVector(l, side * width / 2).addScaledVector(tmp.N, 0.03);
      pos.push(p.x, p.y, p.z);
      nrm.push(tmp.N.x, tmp.N.y, tmp.N.z);
      uv.push(side > 0 ? 0 : 1, s / 8);
    }
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surfGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  surfGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  surfGeo.setIndex(idx);
  const surface = new THREE.Mesh(surfGeo, new THREE.MeshStandardMaterial({ map: surfaceTexture(), roughness: 0.75, side: THREE.DoubleSide }));
  surface.receiveShadow = true;
  surface.castShadow = true;
  group.add(surface);

  // ---- Side plates: a thick curved band on each side of the arc ----
  const band = Math.max(1.4, R * 0.09), thick = 0.4;
  const shape = new THREE.Shape();
  const seg = 48;
  shape.moveTo(-L0, 0);
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * thetaMax;
    shape.lineTo(R * Math.sin(th), R * (1 - Math.cos(th)));
  }
  for (let i = seg; i >= 0; i--) {
    const th = (i / seg) * thetaMax;
    const rr = R + band;
    shape.lineTo(rr * Math.sin(th), Math.max(0, R - rr * Math.cos(th)));
  }
  shape.lineTo(-L0, 0);
  const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
  // Local x -> d, y -> up, z -> -l (right-handed basis).
  const basis = new THREE.Matrix4().makeBasis(d, UP, l.clone().negate());
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(plateGeo, plateMat);
    const o = origin.clone().addScaledVector(l, side > 0 ? width / 2 + thick : -width / 2);
    m.matrixAutoUpdate = false;
    m.matrix.copy(basis).setPosition(o);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // ---- Back frame: a braced steel tower behind the arc ----
  // Everything stands behind the arc so it never blocks the side view.
  const steel = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.5, metalness: 0.7 });
  const H = 2 * R + 1.6;
  const back = R + band + 0.6;
  const colW = Math.max(0.8, R * 0.04);
  const at = (u, lat, y) => origin.clone().addScaledVector(d, u).addScaledVector(l, lat).setY(y);
  const box = (sx, sy, sz, p, rotY = yaw, rotX = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), steel);
    m.position.copy(p);
    m.rotation.set(rotX, rotY, 0, 'YXZ');
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const latC = width / 2 + 0.8;
  for (const side of [1, -1]) box(colW, H, colW, at(back, side * latC, H / 2));
  // Cross beams and X braces between the two columns, every ~10 m.
  const levels = Math.max(2, Math.round(H / 10));
  for (let i = 1; i <= levels; i++) {
    const y = (i / levels) * H;
    // Local z of a box points along d after rotating by yaw; +90° turns it across the ramp.
    box(0.5, 0.5, latC * 2, at(back, 0, y), yaw + Math.PI / 2);
    const y0 = ((i - 1) / levels) * H, dy = y - y0, len = Math.hypot(dy, latC * 2);
    const ang = Math.atan2(dy, latC * 2);
    for (const s of [1, -1]) box(0.25, 0.25, len, at(back, 0, (y0 + y) / 2), yaw + Math.PI / 2, s * ang);
  }
  // Horizontal struts from the outside of the arc back to the tower.
  const rr = R + band;
  for (let y = 6; y < 2 * R - 2; y += 10) {
    const u = Math.sqrt(Math.max(0, rr * rr - (R - y) * (R - y)));
    const len = back - u;
    if (len < 0.5) continue;
    for (const side of [1, -1]) box(0.4, 0.4, len, at(u + len / 2, side * latC, y));
  }
  // Red aviation lights on top.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 9 });
  for (const side of [1, -1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), lampMat);
    lamp.position.copy(at(back, side * latC, H + 0.7));
    group.add(lamp);
  }

  scene.add(group);

  // Footprint blocks the car on the ground; the lead-in stays open so the
  // car can switch onto the ramp before touching it.
  const corners = [];
  for (const u of [1.5, R + band + 0.9]) for (const s of [1, -1]) {
    corners.push(origin.clone().addScaledVector(d, u).addScaledVector(l, s * (width / 2 + 1.0)));
  }
  colliders.push({
    minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)),
    minZ: Math.min(...corners.map((c) => c.z)), maxZ: Math.max(...corners.map((c) => c.z)),
    h: 2 * R + 2,
    wallStunt: true, // ignored during the wall stunt: the car lets go from inside this footprint
  });

  return ramp;
}

function surfaceTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2b2f';
  ctx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
  }
  // Red/white kerbs on both edges, white centre arrows.
  for (let y = 0; y < 512; y += 64) {
    ctx.fillStyle = (y / 64) % 2 ? '#e8e6e0' : '#c8241c';
    ctx.fillRect(0, y, 18, 64);
    ctx.fillRect(238, y, 18, 64);
  }
  ctx.fillStyle = 'rgba(240,240,235,0.85)';
  for (let y = 40; y < 512; y += 256) {
    ctx.beginPath();
    ctx.moveTo(128, y);
    ctx.lineTo(178, y + 60);
    ctx.lineTo(158, y + 60);
    ctx.lineTo(128, y + 25);
    ctx.lineTo(98, y + 60);
    ctx.lineTo(78, y + 60);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
