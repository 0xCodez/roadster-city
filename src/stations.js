import * as THREE from 'three';

// Air stations styled after modern EV charging sites: a red-painted lot with
// white bay lines, a row of slim white stalls with a glowing red slot, and a
// tall pylon. Pull into the lot and the tanks refill fast.

let shared = null;
function materials() {
  if (shared) return shared;
  shared = {
    stall: new THREE.MeshPhysicalMaterial({ color: 0xf4f4f2, roughness: 0.25, clearcoat: 0.6 }),
    red: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2a1f, emissiveIntensity: 3 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 }),
    lot: new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.6 }),
    label: glowText(labelTexture('AIR')),
    pylon: glowText(labelTexture('AIR · CHARGE', true)),
  };
  return shared;
}

export function addAirStation(scene, { x, z, r, yaw = 0 }) {
  const M = materials();
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;

  // Lot: 6 bays, 3 m wide, 6 m deep.
  const bays = 6, bayW = 3, depth = 6.5;
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(bays * bayW + 1, depth).rotateX(-Math.PI / 2), M.lot);
  lot.position.set(0, 0.05, 0);
  lot.receiveShadow = true;
  g.add(lot);

  // Stall shape: a rounded slab with a slot through it.
  const w = 0.42, h = 1.6, t = 0.24;
  const outer = new THREE.Shape();
  outer.moveTo(-w / 2, 0);
  outer.lineTo(w / 2, 0);
  outer.lineTo(w / 2, h - w / 2);
  outer.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
  outer.lineTo(-w / 2, 0);
  const slot = new THREE.Path();
  slot.moveTo(-0.07, 0.35);
  slot.lineTo(0.07, 0.35);
  slot.lineTo(0.07, h - 0.3);
  slot.lineTo(-0.07, h - 0.3);
  slot.lineTo(-0.07, 0.35);
  outer.holes.push(slot);
  const stallGeo = new THREE.ExtrudeGeometry(outer, { depth: t, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 16 }).translate(0, 0, -t / 2);
  const glowGeo = new THREE.BoxGeometry(0.1, h - 0.68, 0.06);
  const labelGeo = new THREE.PlaneGeometry(0.34, 0.12);
  const cableGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.18, 1.1, 0.05), new THREE.Vector3(0.3, 0.6, 0.25), new THREE.Vector3(0.25, 0.25, 0.4), new THREE.Vector3(0.12, 0.85, 0.16),
  ]), 20, 0.022, 6, false);
  for (let i = 0; i < bays; i++) {
    const sx = (i - (bays - 1) / 2) * bayW;
    const stall = new THREE.Group();
    stall.position.set(sx, 0, -depth / 2 + 0.6);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.5), M.concrete);
    base.position.y = 0.07;
    const body = new THREE.Mesh(stallGeo, M.stall);
    body.position.y = 0.14;
    const glow = new THREE.Mesh(glowGeo, M.red);
    glow.position.set(0, 0.14 + (0.35 + h - 0.3) / 2, 0);
    const label = new THREE.Mesh(labelGeo, M.label);
    label.position.set(0, 0.14 + h - 0.12, t / 2 + 0.03);
    const cable = new THREE.Mesh(cableGeo, M.cable);
    stall.add(base, body, glow, label, cable);
    stall.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.add(stall);
  }

  // Tall pylon at the end of the row.
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.1, 6, 0.4), M.stall);
  pylon.position.set((bays / 2) * bayW + 2, 3, -depth / 2 + 0.6);
  pylon.castShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 5.2), M.pylon);
  face.position.set(pylon.position.x, 3, pylon.position.z + 0.21);
  g.add(pylon, face);

  scene.add(g);
  return { x, z, r: Math.max(r, (bays * bayW) / 2 + 1) };
}

// Hook for the atmosphere: brighter red glow at night.
export function setStationLights(level) {
  const M = materials();
  M.red.emissiveIntensity = level;
  M.label.emissiveIntensity = level * 0.9;
  M.pylon.emissiveIntensity = level * 0.9;
}

// Red letters on a transparent background that glow (the panel behind gives the white).
function glowText(tex) {
  return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 2.5, transparent: true, depthWrite: false });
}

function lotTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 352;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a3241d';
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  ctx.fillStyle = '#f2f2f2';
  const bays = 6, bw = c.width / (bays + 1 / 3);
  for (let i = 0; i <= bays; i++) ctx.fillRect(bw / 6 + i * bw - 4, 30, 8, c.height - 30);
  ctx.fillRect(0, c.height - 10, c.width, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function labelTexture(text, vertical = false) {
  const c = document.createElement('canvas');
  c.width = vertical ? 128 : 256;
  c.height = vertical ? 832 : 96;
  const ctx = c.getContext('2d');
    ctx.fillStyle = '#e8261c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (vertical) {
    ctx.font = '600 84px system-ui, sans-serif';
    const letters = [...text.replace(/ /g, '')];
    letters.forEach((ch, i) => ctx.fillText(ch, 64, 60 + i * ((c.height - 100) / (letters.length - 1))));
  } else {
    ctx.font = '600 70px system-ui, sans-serif';
    ctx.fillText(text, c.width / 2, c.height / 2 + 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
