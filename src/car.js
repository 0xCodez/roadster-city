import * as THREE from 'three';
import { keys, loft, stations, carbonTexture } from './geom.js';

// Procedural roadster, lofted from cross-sections: a low wedge with fenders
// that rise above the hood, a raked dark-gold canopy, hidden headlights in a
// full-width light bar, an active rear wing and four main nozzles in the diffuser.
// Local axes: +Z forward, +Y up, +X is the car's left side (driver sits at +X).

export const DIM = {
  wheelBase: 2.7,
  track: 1.68,
  wheelR: 0.34,
  length: 4.45,
  width: 1.98,
};

const FZ = DIM.wheelBase / 2, RZ = -DIM.wheelBase / 2, WR = DIM.wheelR, ARCH = 0.4;

// Body shape along the car (z from tail -2.24 to nose +2.22).
const HW = keys([[2.22, 0.74], [2.1, 0.86], [1.8, 0.95], [1.35, 0.99], [0.8, 0.965], [0.2, 0.94], [-0.5, 0.95], [-1.0, 0.99], [-1.35, 1.0], [-1.9, 0.98], [-2.24, 0.92]]);
const YT = keys([[2.22, 0.4], [2.12, 0.47], [1.8, 0.55], [1.2, 0.63], [0.8, 0.69], [0.5, 0.735], [-0.3, 0.8], [-1.0, 0.84], [-1.7, 0.86], [-2.1, 0.84], [-2.24, 0.64]]);
const YW = keys([[2.22, 0.33], [1.6, 0.44], [0, 0.5], [-1.6, 0.55], [-2.24, 0.5]]);
const YB = keys([[2.22, 0.21], [2.0, 0.2], [0, 0.22], [-1.9, 0.26], [-2.24, 0.3]]);
const CT = keys([[0.95, 0.735], [0.7, 0.86], [0.35, 1.0], [0.0, 1.09], [-0.35, 1.12], [-0.75, 1.11], [-1.15, 1.02], [-1.5, 0.94], [-1.8, 0.86]]);

function archTop(z) {
  for (const wz of [FZ, RZ]) {
    const dz = z - wz;
    if (Math.abs(dz) < ARCH) return WR + Math.sqrt(ARCH * ARCH - dz * dz);
  }
  return 0;
}

function bodySection(z) {
  const hw = HW(z), yt = YT(z), base = YB(z), arch = archTop(z);
  const lip = Math.max(base + 0.04, arch);
  const yw = Math.max(YW(z), lip + 0.03);
  const yf = Math.max(yt, arch + 0.07, yw + 0.04); // fender line, above the hood near the wheels
  return [
    [0, base],
    [hw * 0.58, base],
    [hw * 0.62, Math.max(base, arch)], // inner wall of the wheel well
    [hw * 0.97, lip], // rocker / fender lip
    [hw, yw],
    [hw * 0.985, yw + (yf - yw) * 0.55],
    [hw * 0.9, yf], // shoulder crease
    [hw * 0.62, (yf + yt) / 2 + 0.008],
    [hw * 0.3, yt + 0.006],
    [0, yt + 0.01],
  ];
}

function canopySection(z) {
  const base = YT(z) - 0.02, top = Math.max(CT(z), base + 0.004), h = top - base;
  const cw = Math.min(HW(z) * 0.8, 0.78) * (0.92 + 0.08 * Math.min(1, h / 0.3));
  return [[0, base], [cw, base], [cw * 0.985, base + h * 0.25], [cw * 0.9, base + h * 0.7], [cw * 0.62, base + h * 0.96], [0, top]];
}

export function buildCar() {
  const carbon = carbonTexture();
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color: 0xebebe7, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1a1406, roughness: 0.03, metalness: 0.45, transparent: true, opacity: 0.88, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.45, metalness: 0.3 }),
    trim2: new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.28, metalness: 0.9 }),
    spoke: new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: 0.22, metalness: 1 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.45, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xb3181c, roughness: 0.4, metalness: 0.3 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc9a046, roughness: 0.25, metalness: 1 }),
    front: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xe4f3ff, emissiveIntensity: 6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 8 }),
    seat: new THREE.MeshStandardMaterial({ color: 0xeeeeef, roughness: 0.62 }),
    seatDark: new THREE.MeshStandardMaterial({ color: 0xd8d8da, roughness: 0.7 }),
    dash: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 }),
    carbon: new THREE.MeshStandardMaterial({ map: carbon, roughness: 0.35, metalness: 0.4 }),
    ambient: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a2a, emissiveIntensity: 5 }),
  };

  const group = new THREE.Group();
  const chassis = new THREE.Group(); // tilts with pitch/roll
  group.add(chassis);
  const proc = []; // the built-in exterior, hidden when a real model is loaded

  // ---- Body and canopy ----
  const body = new THREE.Mesh(loft(stations(-2.24, 2.22, 0.06, [FZ, RZ], 0.025, ARCH + 0.05), bodySection), mats.paint);
  body.name = 'Body';
  chassis.add(body);
  proc.push(body);
  const canopy = new THREE.Mesh(loft(stations(-1.8, 0.95, 0.05), canopySection), mats.glass);
  canopy.name = 'Canopy';
  canopy.renderOrder = 2;
  chassis.add(canopy);
  proc.push(canopy);

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    chassis.add(m);
    proc.push(m);
    return m;
  };

  // ---- Details on the body ----
  // Side skirts, rear intakes behind the doors, mirrors, door seams.
  for (const sx of [1, -1]) {
    add(new THREE.BoxGeometry(0.03, 0.07, 1.75), mats.trim, sx * (HW(0) + 0.004), 0.27, 0);
    const intake = new THREE.Shape([new THREE.Vector2(-0.55, 0.4), new THREE.Vector2(-1.08, 0.45), new THREE.Vector2(-1.02, 0.7), new THREE.Vector2(-0.62, 0.63)]);
    const ig = new THREE.ShapeGeometry(intake).rotateY(-Math.PI / 2);
    add(ig, mats.trim2, sx * (HW(-0.8) + 0.004), 0, 0);
    const mirror = add(new THREE.BoxGeometry(0.13, 0.055, 0.15), mats.trim, sx * 0.93, 0.83, 0.52);
    mirror.rotation.y = sx * 0.15;
    const seam = [];
    for (const [z, y] of [[0.62, 0.3], [0.6, 0.62], [0.5, 0.76], [-0.62, 0.8], [-0.66, 0.3]]) seam.push(new THREE.Vector3(sx * (HW(z) + 0.003), y, z));
    const seamLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(seam), new THREE.LineBasicMaterial({ color: 0x2a2a2a }));
    chassis.add(seamLine);
    proc.push(seamLine);
  }
  // Hood vent, front intake and splitter.
  add(new THREE.BoxGeometry(0.62, 0.012, 0.07), mats.trim, 0, YT(1.5) + 0.006, 1.5, -0.1);
  add(new THREE.PlaneGeometry(1.25, 0.1), mats.trim2, 0, 0.29, 2.17);
  add(new THREE.BoxGeometry(1.72, 0.03, 0.26), mats.trim, 0, 0.2, 2.06);
  // Rear: diffuser with fins.
  add(new THREE.BoxGeometry(1.62, 0.28, 0.42), mats.trim, 0, 0.38, -2.05);
  for (const fx of [-0.72, -0.38, 0, 0.38, 0.72]) add(new THREE.BoxGeometry(0.02, 0.2, 0.36), mats.trim, fx, 0.3, -2.1);

  const nozzleGeo = new THREE.TorusGeometry(0.07, 0.02, 8, 20);
  const nozzles = [];
  for (const nx of [-0.55, -0.2, 0.2, 0.55]) {
    const n = new THREE.Mesh(nozzleGeo, mats.gold);
    n.position.set(nx, 0.36, -2.27);
    chassis.add(n);
    nozzles.push(n);
    proc.push(n);
  }

  // Corner thrusters (fire down for landings) and their plumes.
  const plumeMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const coreMat = plumeMat.clone();
  coreMat.color.set(0xffffff);
  // Apex at the nozzle (y = 0), widening downward.
  const plumeGeo = new THREE.ConeGeometry(0.22, 2.2, 14, 1, true).translate(0, -1.1, 0);
  const coreGeo = new THREE.ConeGeometry(0.08, 1.1, 10, 1, true).translate(0, -0.55, 0);
  const diamondGeo = new THREE.SphereGeometry(0.07, 8, 6);
  const plumes = [];
  for (const [px, pz] of [[0.8, 1.75], [-0.8, 1.75], [0.8, -1.8], [-0.8, -1.8]]) {
    const ring = new THREE.Mesh(nozzleGeo, mats.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(px, 0.22, pz);
    chassis.add(ring);
    proc.push(ring);
    const plume = new THREE.Group();
    plume.position.set(px, 0.2, pz);
    plume.add(new THREE.Mesh(plumeGeo, plumeMat), new THREE.Mesh(coreGeo, coreMat));
    for (let i = 1; i <= 3; i++) {
      const dmd = new THREE.Mesh(diamondGeo, coreMat);
      dmd.position.y = -0.45 * i; // shock diamonds
      plume.add(dmd);
    }
    plume.visible = false;
    plume.userData.noExport = true;
    chassis.add(plume);
    plumes.push(plume);
  }

  // Main thrusters in the diffuser, firing backward (Rocket mode).
  const rearMat = plumeMat.clone();
  const rearCoreMat = coreMat.clone();
  const rearPlumeGeo = plumeGeo.clone().rotateX(Math.PI / 2); // -y -> -z
  const rearCoreGeo = coreGeo.clone().rotateX(Math.PI / 2);
  const rearPlumes = [];
  for (const n of nozzles) {
    const plume = new THREE.Group();
    plume.position.copy(n.position);
    plume.add(new THREE.Mesh(rearPlumeGeo, rearMat), new THREE.Mesh(rearCoreGeo, rearCoreMat));
    for (let i = 1; i <= 3; i++) {
      const dmd = new THREE.Mesh(diamondGeo, rearCoreMat);
      dmd.position.z = -0.45 * i;
      plume.add(dmd);
    }
    plume.visible = false;
    plume.userData.noExport = true;
    chassis.add(plume);
    rearPlumes.push(plume);
  }

  // Light bars: hidden headlights in a thin full-width bar, full-width tail light.
  const fz = 2.12, frontW = HW(fz) * 2 * 0.93;
  add(new THREE.BoxGeometry(frontW, 0.012, 0.02), mats.front, 0, YT(fz) - 0.008, fz + 0.015, -0.35);
  const tz = -2.2, tailW = HW(tz) * 2 * 0.96;
  add(new THREE.BoxGeometry(tailW, 0.045, 0.03), mats.tail, 0, YT(tz) - 0.07, tz - 0.035);

  // ---- Active rear wing on swan-neck pylons ----
  const wing = new THREE.Group();
  wing.name = 'RearWing';
  wing.position.set(0, 0.92, -1.98);
  const foil = new THREE.Shape();
  foil.moveTo(0.2, 0);
  foil.quadraticCurveTo(0.05, 0.05, -0.2, 0.015);
  foil.lineTo(-0.2, -0.005);
  foil.quadraticCurveTo(0.05, 0.01, 0.2, 0);
  const foilGeo = new THREE.ExtrudeGeometry(foil, { depth: 1.92, bevelEnabled: false }).translate(0, 0, -0.96).rotateY(Math.PI / 2);
  wing.add(new THREE.Mesh(foilGeo, mats.paint));
  for (const ex of [0.96, -0.96]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.42), mats.trim);
    e.position.set(ex, -0.03, 0);
    wing.add(e);
  }
  const pylons = [];
  for (const px of [0.48, -0.48]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.1), mats.trim);
    chassis.add(p);
    pylons.push(p);
  }
  chassis.add(wing);
  proc.push(wing, ...pylons);

  // ---- Interior ----
  const interior = new THREE.Group();
  interior.name = 'Interior';
  const iadd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz, 'YXZ');
    interior.add(m);
    return m;
  };
  // Carbon tub: floor, door cards, centre tunnel.
  iadd(new THREE.BoxGeometry(1.66, 0.03, 2.3), mats.carbon, 0, 0.3, -0.25);
  for (const sx of [0.83, -0.83]) {
    iadd(new THREE.BoxGeometry(0.04, 0.46, 1.6), mats.carbon, sx, 0.53, -0.15);
    // Red ambient strip sweeping along the door, like the official interior shots.
    iadd(new THREE.BoxGeometry(0.012, 0.018, 1.0), mats.ambient, sx - Math.sign(sx) * 0.025, 0.66, -0.05, 0.12);
  }
  iadd(new THREE.BoxGeometry(0.26, 0.2, 1.4), mats.carbon, 0, 0.4, -0.12);
  // Bucket seats moulded into the chassis: cushion, bolsters, back, head rest.
  for (const sx of [0.4, -0.4]) {
    iadd(new THREE.BoxGeometry(0.44, 0.09, 0.5), mats.seat, sx, 0.37, -0.36, -0.08);
    for (const bx of [0.24, -0.24]) {
      iadd(new THREE.BoxGeometry(0.07, 0.15, 0.5), mats.seatDark, sx + bx, 0.42, -0.36, -0.08);
      iadd(new THREE.BoxGeometry(0.08, 0.5, 0.12), mats.seatDark, sx + bx, 0.68, -0.66, -0.36);
    }
    iadd(new THREE.BoxGeometry(0.42, 0.6, 0.07), mats.seat, sx, 0.68, -0.7, -0.36);
    iadd(new THREE.BoxGeometry(0.26, 0.16, 0.08), mats.seat, sx, 1.0, -0.82, -0.36);
  }
  // Dashboard: one sweeping extrusion across the cabin.
  const dashShape = new THREE.Shape();
  dashShape.moveTo(0.78, 0.7);
  dashShape.quadraticCurveTo(0.6, 0.76, 0.42, 0.71);
  dashShape.lineTo(0.31, 0.63);
  dashShape.quadraticCurveTo(0.34, 0.52, 0.44, 0.46);
  dashShape.lineTo(0.78, 0.44);
  dashShape.closePath();
  const dashGeo = new THREE.ExtrudeGeometry(dashShape, { depth: 1.6, bevelEnabled: false, curveSegments: 8 });
  dashGeo.rotateY(-Math.PI / 2).translate(0.8, 0, 0);
  interior.add(new THREE.Mesh(dashGeo, mats.dash));
  iadd(new THREE.BoxGeometry(1.5, 0.012, 0.012), mats.ambient, 0, 0.635, 0.315);
  // Screens: a large centre touchscreen and two small displays either side of the yoke.
  const screens = makeScreens();
  const centre = iadd(new THREE.PlaneGeometry(0.4, 0.23), screens.centreMat, 0.02, 0.84, 0.44);
  centre.rotation.set(-0.28, 2.66, 0, 'YXZ');
  for (const [i, dx] of [[0, 0.18], [1, -0.18]]) {
    const d = iadd(new THREE.PlaneGeometry(0.15, 0.075), screens.smallMats[i], 0.38 + dx, 0.78, 0.41);
    d.rotation.set(-0.45, Math.PI, 0, 'YXZ');
  }
  // Yoke: open-top grip on a short column.
  const yoke = new THREE.Group();
  const yokePath = new THREE.CatmullRomCurve3([[-0.17, 0.06], [-0.165, -0.05], [-0.09, -0.1], [0.09, -0.1], [0.165, -0.05], [0.17, 0.06]].map(([x, y]) => new THREE.Vector3(x, y, 0)));
  yoke.add(new THREE.Mesh(new THREE.TubeGeometry(yokePath, 32, 0.02, 10, false), mats.seat));
  for (const gx of [-0.17, 0.17]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 10), mats.dash);
    grip.position.set(gx, 0.0, 0);
    yoke.add(grip);
  }
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.04), mats.dash);
  hub.position.set(0, -0.03, 0.01);
  yoke.add(hub);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 10).rotateX(Math.PI / 2).translate(0, 0, 0.11), mats.dash);
  yoke.add(column);
  // Top of the yoke leans toward the dash; the column runs forward and down into it.
  yoke.position.set(0.38, 0.72, 0.22);
  yoke.rotation.x = 0.45;
  interior.add(yoke);
  // Pedals.
  for (const px of [0.3, 0.46]) iadd(new THREE.BoxGeometry(0.06, 0.1, 0.02), mats.spoke, px, 0.38, 0.62, -0.5);
  chassis.add(interior);

  // Headlights: one spot for both lamps keeps it cheap. Off by day.
  const headlight = new THREE.SpotLight(0xeaf4ff, 0, 90, 0.45, 0.6, 1.4);
  headlight.position.set(0, 0.5, 2.1);
  headlight.target.position.set(0, -0.6, 14);
  headlight.userData.noExport = headlight.target.userData.noExport = true;
  chassis.add(headlight, headlight.target);

  const cockpit = new THREE.Object3D();
  cockpit.position.set(0.4, 1.0, -0.36);
  cockpit.userData.noExport = true;
  chassis.add(cockpit);

  // The body is a closed shell, so in the cockpit view we clip the cabin
  // volume out of it. Planes are defined in chassis space (normals point out
  // of the cabin box) and moved to world space every frame.
  const cabinLocal = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.82),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), -0.82),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.34),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.6),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), -1.12),
  ];
  const cabinWorld = cabinLocal.map((p) => p.clone());

  // ---- Wheels: low-profile tyres, dark aero rims, red calipers ----
  const wheels = [];
  const tireGeo = new THREE.TorusGeometry(0.265, 0.078, 14, 40).rotateY(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.255, 0.255, 0.2, 36).rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.014, 0.19, 0.03).translate(0, 0.125, 0);
  const capGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.03, 28).rotateZ(Math.PI / 2);
  const caliperGeo = new THREE.BoxGeometry(0.06, 0.12, 0.08);
  for (const [wx, wz, front] of [[1, FZ, true], [-1, FZ, true], [1, RZ, false], [-1, RZ, false]]) {
    const steer = new THREE.Group();
    steer.name = `Wheel_${front ? 'F' : 'R'}${wx > 0 ? 'L' : 'R'}`; // +X is the car's left
    steer.position.set(wx * DIM.track / 2, WR, wz);
    const spin = new THREE.Group();
    steer.add(spin);
    spin.add(new THREE.Mesh(tireGeo, mats.tire), new THREE.Mesh(rimGeo, mats.rim), new THREE.Mesh(discGeo, mats.disc));
    for (let i = 0; i < 10; i++) {
      // Five twin spokes.
      const sp = new THREE.Mesh(spokeGeo, mats.spoke);
      sp.position.x = wx * 0.103;
      sp.rotation.x = (Math.floor(i / 2) / 5) * Math.PI * 2 + (i % 2 ? 0.12 : -0.12);
      spin.add(sp);
    }
    const cap = new THREE.Mesh(capGeo, mats.trim);
    cap.position.x = wx * 0.11;
    spin.add(cap);
    const caliper = new THREE.Mesh(caliperGeo, mats.caliper);
    caliper.position.set(-wx * 0.02, 0.15, front ? -0.08 : 0.08);
    steer.add(caliper);
    group.add(steer);
    proc.push(steer);
    wheels.push({ steer, spin, front, side: wx });
  }

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  canopy.receiveShadow = false;
  for (const p of [...plumes, ...rearPlumes]) p.traverse((o) => { o.castShadow = o.receiveShadow = false; });

  // ---- Animation state ----
  const anim = { wingUp: 1, ride: 0, pitch: 0, roll: 0, steer: 0, spin: 0 };
  let mode = 'track';
  const deckY = YT(-1.98);
  let model = null, modelWheels = [], inside = false;

  return {
    group,
    chassis,
    cockpit,
    mats,
    nozzles,
    setMode(m) { mode = m; },
    setHeadlights(on) {
      // Intensity only: toggling visibility would recompile every shader.
      headlight.intensity = on ? 280 : 0;
      mats.front.emissiveIntensity = on ? 9 : 6;
    },
    setInterior(v) {
      inside = v;
      mats.glass.opacity = inside ? 0.12 : 0.88;
      canopy.material.depthWrite = !inside;
      const clipped = model ? [mats.paint, ...model.materials] : [mats.paint];
      for (const m of clipped) {
        m.clippingPlanes = inside ? cabinWorld : null;
        m.clipIntersection = true;
        m.needsUpdate = true;
      }
      // With a real model, our interior only shows from the driver's seat.
      if (model) interior.visible = inside;
    },
    // Swap the built-in body for a loaded model (see models.js).
    useModel(m, wheelRig) {
      model = m;
      for (const o of proc) o.visible = false;
      chassis.add(m.root);
      modelWheels = wheelRig || [];
      interior.visible = inside;
    },
    get hasModel() { return !!model; },
    // Call after the car's world matrix is up to date.
    updateClip() {
      if (!mats.paint.clippingPlanes) return;
      for (let i = 0; i < cabinLocal.length; i++) cabinWorld[i].copy(cabinLocal[i]).applyMatrix4(chassis.matrixWorld);
    },
    // Live info on the dashboard screens (called a few times a second).
    updateScreens(info) { screens.draw(info); },
    update(dt, s) {
      const k = 1 - Math.exp(-dt * 6);
      const wantWing = mode === 'road' ? 0 : 1;
      anim.wingUp += (wantWing - anim.wingUp) * (1 - Math.exp(-dt * 3));
      const wy = deckY + 0.05 + anim.wingUp * 0.34;
      wing.position.y = wy;
      wing.rotation.x = anim.wingUp * 0.12;
      for (const p of pylons) {
        const h = Math.max(0.01, wy - deckY);
        p.scale.y = h;
        p.position.set(p === pylons[0] ? 0.48 : -0.48, deckY + h / 2, -1.96);
        p.visible = !model && anim.wingUp > 0.03;
      }
      // Track and Rocket sit lower.
      const wantRide = mode === 'road' ? 0 : -0.035;
      anim.ride += (wantRide - anim.ride) * k;
      anim.pitch += (s.pitch - anim.pitch) * k;
      anim.roll += (s.roll - anim.roll) * k;
      chassis.position.y = anim.ride + s.bounce;
      chassis.rotation.set(anim.pitch, 0, anim.roll);

      anim.steer += (s.steerAngle - anim.steer) * (1 - Math.exp(-dt * 12));
      anim.spin += (s.wheelSpeed / WR) * dt;
      for (const w of wheels) {
        w.steer.rotation.y = w.front ? anim.steer : 0;
        w.spin.rotation.x = anim.spin;
      }
      for (const w of modelWheels) {
        w.pivot.rotation.y = w.front ? anim.steer : 0;
        w.spin.rotation.x = anim.spin * (WR / Math.max(0.2, w.r));
      }
      yoke.rotation.z = -anim.steer * 3;
      mats.tail.emissiveIntensity = s.braking ? 22 : 8;

      // Thruster plumes flicker and stretch with thrust.
      const t = s.thrust || 0;
      plumeMat.opacity = t * 0.35;
      coreMat.opacity = t * 0.9;
      for (const p of plumes) {
        p.visible = t > 0.02;
        p.scale.set(1, (0.6 + t * 0.6) * (0.9 + Math.random() * 0.2), 1);
      }
      const rt = s.rearThrust || 0;
      rearMat.opacity = rt * 0.35;
      rearCoreMat.opacity = rt * 0.9;
      for (const p of rearPlumes) {
        p.visible = rt > 0.02;
        p.scale.set(1, 1, (0.7 + rt * 0.8) * (0.9 + Math.random() * 0.2));
      }
    },
  };
}

// Dashboard screens drawn to canvases: the centre touchscreen shows the drive
// mode, dynamics, air and radio; the small displays show speed and air pressure.
function makeScreens() {
  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.15 });
    return { c, ctx: c.getContext('2d'), tex, mat };
  };
  const centre = mk(640, 368), left = mk(256, 128), right = mk(256, 128);
  const draw = (info = {}) => {
    const { speed = 0, mode = 'track', air = 1, station = '', alt = 0 } = info;
    let g = centre.ctx;
    g.fillStyle = '#07080a';
    g.fillRect(0, 0, 640, 368);
    g.fillStyle = '#9aa0a6';
    g.font = '24px sans-serif';
    g.fillText('MODE', 36, 52);
    g.fillStyle = '#ffffff';
    g.font = '600 46px sans-serif';
    g.fillText(mode.toUpperCase(), 36, 104);
    g.fillStyle = '#9aa0a6';
    g.font = '24px sans-serif';
    g.fillText('DYNAMICS', 360, 52);
    g.fillStyle = '#ffffff';
    g.font = '28px sans-serif';
    ['Front wing', 'Rear wing', 'Max Grip'].forEach((t, i) => {
      g.fillText(t, 360, 100 + i * 50);
      g.fillStyle = '#2f6fe0';
      g.fillRect(360, 110 + i * 50, (mode === 'road' ? 60 : 200) - i * 30, 6);
      g.fillStyle = '#ffffff';
    });
    // Air tank gauge.
    g.fillStyle = '#9aa0a6';
    g.font = '24px sans-serif';
    g.fillText('AIR', 36, 180);
    g.fillStyle = '#26282d';
    g.fillRect(36, 196, 280, 18);
    g.fillStyle = air < 0.2 ? '#e24b4a' : '#e0b04a';
    g.fillRect(36, 196, 280 * air, 18);
    g.fillStyle = '#ffffff';
    g.font = '26px sans-serif';
    g.fillText(Math.round(air * 5500) + ' psi', 36, 248);
    // Radio.
    g.fillStyle = '#9aa0a6';
    g.font = '24px sans-serif';
    g.fillText('RADIO', 36, 310);
    g.fillStyle = '#ffffff';
    g.font = '28px sans-serif';
    g.fillText(station || 'Off', 130, 310);
    g.fillStyle = '#ff3b30';
    g.beginPath();
    g.arc(600, 40, 8, 0, Math.PI * 2);
    g.fill();
    centre.tex.needsUpdate = true;

    g = left.ctx;
    g.fillStyle = '#050607';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ffffff';
    g.font = '600 64px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(Math.round(speed)), 128, 78);
    g.font = '20px sans-serif';
    g.fillStyle = '#9aa0a6';
    g.fillText('km/h', 128, 112);
    g.textAlign = 'left';
    left.tex.needsUpdate = true;

    g = right.ctx;
    g.fillStyle = '#050607';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#e0b04a';
    g.font = '600 44px sans-serif';
    g.textAlign = 'center';
    g.fillText(alt > 0.5 ? alt.toFixed(0) + ' m' : 'P R N D', 128, 74);
    g.font = '20px sans-serif';
    g.fillStyle = '#9aa0a6';
    g.fillText(alt > 0.5 ? 'altitude' : 'drive', 128, 110);
    g.textAlign = 'left';
    right.tex.needsUpdate = true;
  };
  draw();
  return { centreMat: centre.mat, smallMats: [left.mat, right.mat], draw };
}
