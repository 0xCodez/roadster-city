import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Vice City-style buildings, all procedural:
//  deco   — low pastel Art Deco hotels with white eyebrow ledges, a rounded corner and neon bands
//  condo  — white Miami condos with a balcony slab and glass rail on every floor
//  glass  — blue-green curtain-wall towers downtown
//  round  — a cylindrical tower ringed with balconies
// Every building gets lit windows for the night (material.userData.windows).

export const PASTELS = [0xf4b6c2, 0xa8e6cf, 0xffd3b6, 0xb5d8f7, 0xd7c4f2, 0xfff1b5, 0xf7d9c4, 0x9fe2e0];
const NEON = [0xff2fd0, 0x2ff3ff, 0xffb02f, 0xff5a7a, 0x9b5cff];

const FLOOR = 3.2;
const texCache = {};

function canvasTex(key, w, h, draw) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache[key] = t;
  return t;
}

// One floor x one bay of facade per texture tile; colour comes from the material.
function facade(style) {
  const color = canvasTex(style + '-c', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) { ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    if (style === 'glass') {
      ctx.fillStyle = '#2f5d6e';
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(180,230,240,0.35)');
      g.addColorStop(1, 'rgba(20,50,70,0.2)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#c9d6da';
      ctx.fillRect(0, 0, w, 6);
      ctx.fillRect(0, 0, 5, h);
    } else if (style === 'condo') {
      ctx.fillStyle = '#20313d';
      ctx.fillRect(8, 30, w - 16, h - 36); // floor-to-ceiling glass
      ctx.fillStyle = 'rgba(170,210,235,0.35)';
      ctx.fillRect(8, 30, w - 16, 20);
      ctx.fillStyle = '#e9e9e9';
      ctx.fillRect(w / 2 - 3, 30, 6, h - 36);
    } else {
      // Deco: two windows with frames and a little eyebrow shadow.
      for (const x of [16, 72]) {
        ctx.fillStyle = '#2b3a46';
        ctx.fillRect(x, 40, 40, 58);
        ctx.fillStyle = 'rgba(170,210,235,0.3)';
        ctx.fillRect(x, 40, 40, 16);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x - 4, 34, 48, 5);
        ctx.strokeStyle = '#f7f7f7';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, 40, 40, 58);
      }
    }
  });
  const lit = canvasTex(style + '-e', 128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const warm = () => (Math.random() < 0.75 ? '#ffd9a0' : '#bfe0ff');
    if (style === 'glass') {
      if (Math.random() < 0.5) { ctx.fillStyle = warm(); ctx.fillRect(6, 8, w - 12, h - 14); }
    } else if (style === 'condo') {
      if (Math.random() < 0.55) { ctx.fillStyle = warm(); ctx.fillRect(8, 30, w - 16, h - 36); }
    } else {
      for (const x of [16, 72]) if (Math.random() < 0.5) { ctx.fillStyle = warm(); ctx.fillRect(x, 40, 40, 58); }
    }
  });
  return { color, lit };
}

function sideMaterial(style, tint, wUnits, hFloors) {
  const f = facade(style);
  const map = f.color.clone(), em = f.lit.clone();
  map.repeat.set(wUnits, hFloors);
  em.repeat.copy(map.repeat);
  map.needsUpdate = em.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({
    map, color: tint, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.15,
    roughness: style === 'glass' ? 0.12 : 0.65, metalness: style === 'glass' ? 0.6 : 0.05,
  });
  m.userData.windows = true;
  return m;
}

const roofMat = new THREE.MeshStandardMaterial({ color: 0x8f8a84, roughness: 0.9 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.55 });
const railMat = new THREE.MeshStandardMaterial({ color: 0x9fd3e6, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45 });
const neonMats = NEON.map((c) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c, emissiveIntensity: 1 }));
neonMats.forEach((m) => (m.userData.neonBand = true));

// Builds one building; returns its meshes' group. (cx, cz) is the centre of the footprint.
export function addStyledBuilding(scene, { style, cx, cz, w, d, h, tint, rand, face }) {
  const g = new THREE.Group();
  g.position.set(cx, 0.2, cz);
  const floors = Math.max(1, Math.round(h / FLOOR));
  h = floors * FLOOR;

  if (style === 'round') {
    const r = Math.min(w, d) / 2;
    const side = sideMaterial('condo', tint, Math.round((2 * Math.PI * r) / 6), floors);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, h, 40, 1, false), [side, roofMat, roofMat]);
    core.position.y = h / 2;
    g.add(core);
    // Ring balconies every floor (merged).
    const slabs = [];
    for (let i = 1; i < floors; i++) {
      const s = new THREE.CylinderGeometry(r, r, 0.22, 40, 1, false).translate(0, i * FLOOR, 0);
      s.deleteAttribute('uv');
      slabs.push(s);
    }
    if (slabs.length) g.add(new THREE.Mesh(mergeGeometries(slabs), whiteMat));
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h - FLOOR, 40, 1, true).translate(0, FLOOR / 2 + h / 2, 0), railMat);
    rail.scale.set(1, 1, 1);
    g.add(rail);
  } else {
    const side = sideMaterial(style === 'deco' ? 'deco' : style, tint, Math.max(1, Math.round(w / 6)), floors);
    const sideD = sideMaterial(style === 'deco' ? 'deco' : style, tint, Math.max(1, Math.round(d / 6)), floors);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideD, sideD, roofMat, roofMat, side, side]);
    box.position.y = h / 2;
    g.add(box);

    if (style === 'deco') {
      // Eyebrow ledges on every floor, a parapet, a rounded corner and neon bands.
      const ledges = [];
      for (let i = 1; i <= floors; i++) {
        const y = i * FLOOR - (i === floors ? 0 : 0.35);
        const t = i === floors ? 0.6 : 0.16;
        const geo = new THREE.BoxGeometry(w + 0.7, t, d + 0.7).translate(0, y, 0);
        geo.deleteAttribute('uv');
        ledges.push(geo);
      }
      g.add(new THREE.Mesh(mergeGeometries(ledges), whiteMat));
      const fx = face?.[0] ?? 1, fz = face?.[1] ?? 0;
      const cr = Math.min(w, d) * 0.18;
      const corner = new THREE.Mesh(new THREE.CylinderGeometry(cr, cr, h + 1.2, 24), new THREE.MeshStandardMaterial({ color: tint, roughness: 0.6 }));
      corner.position.set((fx || 1) * (w / 2 - cr * 0.6), (h + 1.2) / 2, (fz || 1) * (d / 2 - cr * 0.6));
      g.add(corner);
      // Neon tubes along every ledge on the street side, and up the rounded corner.
      const nm = neonMats[Math.floor(rand() * neonMats.length)];
      const tubes = [];
      for (let i = 1; i <= floors; i++) {
        const tube = new THREE.BoxGeometry(fx ? 0.16 : w + 0.8, 0.14, fz ? 0.16 : d + 0.8)
          .translate(fx * (w / 2 + 0.4), i * FLOOR - (i === floors ? 0.2 : 0.5), fz * (d / 2 + 0.4));
        tube.deleteAttribute('uv');
        tubes.push(tube);
      }
      const up = new THREE.BoxGeometry(0.16, h + 1.2, 0.16)
        .translate((fx || 1) * (w / 2 - cr * 0.6) + (fx || 1) * cr * 0.72, (h + 1.2) / 2, (fz || 1) * (d / 2 - cr * 0.6) + (fz || 1) * cr * 0.72);
      up.deleteAttribute('uv');
      tubes.push(up);
      g.add(new THREE.Mesh(mergeGeometries(tubes), nm));
      // Vertical fin over the entrance.
      const fin = new THREE.Mesh(new THREE.BoxGeometry(fx ? 0.5 : 1.2, h * 0.8, fz ? 0.5 : 1.2), whiteMat);
      fin.position.set(fx * (w / 2 + 0.3), h * 0.55, fz * (d / 2 + 0.3));
      g.add(fin);
    } else if (style === 'condo') {
      // Balcony slab + glass rail on every floor, on the two long faces.
      const slabs = [], rails = [];
      for (let i = 1; i < floors; i++) {
        const y = i * FLOOR;
        for (const s of [1, -1]) {
          const a = new THREE.BoxGeometry(w + 0.4, 0.2, 1.6).translate(0, y, s * (d / 2 + 0.8));
          a.deleteAttribute('uv');
          slabs.push(a);
          const b = new THREE.BoxGeometry(w + 0.4, 1.0, 0.04).translate(0, y + 0.6, s * (d / 2 + 1.58));
          b.deleteAttribute('uv');
          rails.push(b);
        }
      }
      if (slabs.length) {
        g.add(new THREE.Mesh(mergeGeometries(slabs), whiteMat));
        g.add(new THREE.Mesh(mergeGeometries(rails), railMat));
      }
    } else if (style === 'glass') {
      // A crown on top.
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 4, d * 0.7), whiteMat);
      crown.position.y = h + 2;
      g.add(crown);
    }

    // Roof clutter: AC units and a water tank.
    const clutter = [];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.BoxGeometry(1.6, 1.0, 1.2).translate((rand() - 0.5) * (w - 3), h + 0.5, (rand() - 0.5) * (d - 3));
      b.deleteAttribute('uv');
      clutter.push(b);
    }
    if (style !== 'glass' && rand() < 0.6) {
      const t = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 14).translate((rand() - 0.5) * (w - 4), h + 2.2, (rand() - 0.5) * (d - 4));
      t.deleteAttribute('uv');
      clutter.push(t);
    }
    g.add(new THREE.Mesh(mergeGeometries(clutter), roofMat));
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  return h + 0.2; // roof height
}

// Neon bands are brighter at night: the atmosphere calls this.
export function setNeonBands(level) {
  for (const m of neonMats) m.emissiveIntensity = level;
}
