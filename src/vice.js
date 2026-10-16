import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BILLBOARDS } from './config.js';
import { PASTELS } from './buildings.js';

// The Vice City dressing: a beach on the west shore with turquoise shallows,
// waves on the sea, palm trees everywhere, umbrellas and lifeguard towers,
// clouds that take the colour of the sky, and billboards around the island.

export function buildVice(scene, { island, ring, city, cityBlocks, buildings, colliders, quality, rand }) {
  const high = quality === 'high';
  const out = { cloudMat: [], billboardMats: [], update: () => {} };

  // ---------- Beach and shallows (west shore) ----------
  const beachX0 = -island.hx, beachX1 = -ring.hx - ring.width / 2 - 0.5;
  const sand = new THREE.MeshStandardMaterial({ color: 0xead7a8, roughness: 1, map: noiseTex(256, '#ead7a8', 22, 30) });
  sand.map.repeat.set(10, 60);
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(beachX1 - beachX0, island.hz * 2).rotateX(-Math.PI / 2), sand);
  beach.position.set((beachX0 + beachX1) / 2, 0.025, 0);
  beach.receiveShadow = true;
  scene.add(beach);
  // The sand runs gently down into the sea instead of ending at a cliff.
  const slope = new THREE.Mesh(new THREE.PlaneGeometry(60, island.hz * 2).rotateX(-Math.PI / 2), sand);
  slope.rotation.z = Math.atan2(1.8, 60);
  slope.position.set(beachX0 - 30, -0.9, 0);
  slope.receiveShadow = true;
  scene.add(slope);
  const shallow = new THREE.Mesh(new THREE.PlaneGeometry(160, island.hz * 2 + 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: gradientTex(['rgba(64,224,208,0.85)', 'rgba(64,200,220,0.35)', 'rgba(40,140,190,0)']), transparent: true, depthWrite: false }));
  shallow.position.set(beachX0 - 80, -1.15, 0);
  shallow.rotation.y = 0;
  scene.add(shallow);

  // ---------- Palms ----------
  const spots = [];
  const jitter = (v, a) => v + (rand() - 0.5) * a;
  for (let z = -island.hz + 25; z < island.hz - 25; z += 44) {
    spots.push([jitter(-385, 14), jitter(z, 10)]);
    if (z > city.z0 && z < city.z1) spots.push([-334, jitter(z + 20, 3)]); // Ocean Drive median
  }
  for (const b of cityBlocks) for (const [sx, sz] of [[0, 0], [1, 1]]) {
    spots.push([b.x + (sx ? b.w - 1.6 : 1.6), b.z + (sz ? b.d - 1.6 : 1.6)]);
  }
  for (let x = -260; x <= 260; x += 90) spots.push([x, 110], [x + 45, 180]);
  for (let x = 70; x <= 310; x += 80) spots.push([x, -58], [x + 40, 94]);
  for (let z = -150; z <= 80; z += 75) spots.push([20, z]);
  const maxPalms = high ? 75 : 40;
  const palms = spots.slice(0, maxPalms);
  const { trunkGeo, crownGeo, trunkMat, crownMat } = palmParts();
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palms.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  palms.forEach(([x, z], i) => {
    const s = 0.55 + rand() * 0.3; // smaller palms
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, h: 9 * s });
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // ---------- Umbrellas and lifeguard towers ----------
  const nU = high ? 60 : 24;
  const cone = new THREE.ConeGeometry(1.5, 0.55, 12, 1, true).translate(0, 2.3, 0);
  const pole = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 5).translate(0, 1.15, 0);
  const umb = new THREE.InstancedMesh(cone, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), nU);
  const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }), nU);
  const col = new THREE.Color();
  const umbColors = [0xffd84a, 0x4aa8ff, 0xff6b8a, 0xffffff, 0x5ad1b8];
  for (let i = 0; i < nU; i++) {
    const cluster = Math.floor(i / 6);
    const z = -230 + cluster * 48 + (rand() - 0.5) * 18, x = -412 + rand() * 14;
    m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rand() - 0.5) * 0.25), new THREE.Vector3(1, 1, 1));
    umb.setMatrixAt(i, m);
    poles.setMatrixAt(i, m);
    umb.setColorAt(i, col.set(umbColors[cluster % umbColors.length]));
  }
  umb.castShadow = true;
  scene.add(umb, poles);
  for (const z of [-180, -60, 60, 180]) scene.add(lifeguardTower(-405, z, PASTELS[Math.floor(rand() * PASTELS.length)]));

  // ---------- Clouds ----------
  const cloudTex = cloudTexture();
  const clouds = [];
  const nC = high ? 34 : 16;
  for (let i = 0; i < nC; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    const s = new THREE.Sprite(mat);
    const a = rand() * Math.PI * 2, r = 300 + rand() * 1400;
    s.position.set(Math.cos(a) * r, 230 + rand() * 200, Math.sin(a) * r);
    const sc = 160 + rand() * 180;
    s.scale.set(sc, sc * 0.42, 1);
    scene.add(s);
    clouds.push(s);
    out.cloudMat.push(mat);
  }

  // ---------- Billboards ----------
  const spotsB = [
    { x: -366, z: -120, yaw: Math.PI / 2 }, // Ocean Drive, facing the road
    { x: -366, z: 40, yaw: Math.PI / 2 },
    { x: -120, z: -230, yaw: 0 },
    { x: 140, z: -230, yaw: 0 },
    { x: 366, z: -20, yaw: -Math.PI / 2 },
    { x: 60, z: 230, yaw: Math.PI },
    { x: -150, z: 230, yaw: Math.PI },
  ];
  // Two on rooftops downtown.
  const roofy = buildings.filter((b) => b.style !== 'round' && b.h > 30 && b.h < 80 && b.w > 14).slice(0, 2);
  roofy.forEach((b) => spotsB.push({ x: b.cx, z: b.cz, yaw: Math.PI, y: b.h, roof: true }));
  spotsB.forEach((s, i) => {
    const ad = BILLBOARDS[i % BILLBOARDS.length];
    const bb = billboard(ad, s.roof);
    bb.group.position.set(s.x, s.y || 0, s.z);
    bb.group.rotation.y = s.yaw;
    scene.add(bb.group);
    out.billboardMats.push(bb.mat);
    if (!s.roof) {
      // Two posts block the car.
      for (const side of [-5, 5]) {
        const px = s.x + Math.cos(s.yaw) * side, pz = s.z - Math.sin(s.yaw) * side;
        colliders.push({ minX: px - 0.4, maxX: px + 0.4, minZ: pz - 0.4, maxZ: pz + 0.4, h: 9 });
      }
    }
  });

  // ---------- LED screen on a downtown tower, cycling the ads ----------
  const host = buildings.filter((b) => b.style === 'glass' || b.style === 'condo').sort((a, b) => b.h - a.h)[0];
  let led = null;
  if (host) {
    led = ledScreen();
    // On the south face, high up.
    led.mesh.position.set(host.cx, Math.min(host.h - 10, 46), host.cz + host.d / 2 + (host.style === 'condo' ? 1.8 : 0.4));
    scene.add(led.mesh);
  }

  // ---------- Per-frame: drift the clouds, roll the waves, run the screen ----------
  out.update = (dt, water) => {
    led?.update(dt);
    for (const c of clouds) {
      c.position.x += dt * 3;
      if (c.position.x > 1800) c.position.x = -1800;
    }
    if (water?.material.normalMap) {
      water.material.normalMap.offset.x += dt * 0.004;
      water.material.normalMap.offset.y += dt * 0.0025;
    }
  };
  return out;
}

// Waves for the sea: a tiling normal map made from layered noise.
export function waterNormalMap() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const h = new Float32Array(n * n);
  for (const [freq, amp] of [[4, 1], [9, 0.5], [17, 0.25]]) {
    const ph = Math.random() * 10, ph2 = Math.random() * 10;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = (x / n) * Math.PI * 2, v = (y / n) * Math.PI * 2;
      h[y * n + x] += amp * (Math.sin(u * freq + ph + Math.sin(v * 2) * 0.8) + Math.sin(v * freq * 0.8 + ph2 + Math.cos(u * 3)));
    }
  }
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)];
    const dy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x];
    const len = Math.hypot(dx, dy, 2);
    const i = (y * n + x) * 4;
    img.data[i] = (-dx / len * 0.5 + 0.5) * 255;
    img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
    img.data[i + 2] = (2 / len * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(220, 220);
  return t;
}

function palmParts() {
  // Trunk: tapered, gently curved, ringed bark.
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 9, 8, 10).translate(0, 4.5, 0);
  const p = trunkGeo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + 0.9 * (y / 9) ** 2);
  }
  trunkGeo.computeVertexNormals();
  const bark = document.createElement('canvas');
  bark.width = 32; bark.height = 128;
  const bctx = bark.getContext('2d');
  bctx.fillStyle = '#8a7660';
  bctx.fillRect(0, 0, 32, 128);
  for (let y = 0; y < 128; y += 8) { bctx.fillStyle = 'rgba(90,74,58,0.45)'; bctx.fillRect(0, y, 32, 2); }
  const barkTex = new THREE.CanvasTexture(bark);
  barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping;
  barkTex.repeat.set(1, 6);
  barkTex.colorSpace = THREE.SRGBColorSpace;
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95 });

  // Crown: drooping fronds with a leaflet texture (alpha-tested).
  const leaf = document.createElement('canvas');
  leaf.width = 256; leaf.height = 64;
  const lctx = leaf.getContext('2d');
  lctx.clearRect(0, 0, 256, 64);
  lctx.strokeStyle = '#3d6b2a';
  lctx.lineWidth = 3;
  lctx.beginPath(); lctx.moveTo(0, 32); lctx.lineTo(256, 32); lctx.stroke();
  for (let x = 6; x < 250; x += 7) {
    const len = 30 * Math.sin((x / 256) * Math.PI) + 4;
    lctx.strokeStyle = x % 14 ? '#4f8a35' : '#5f9a40';
    lctx.lineWidth = 3;
    lctx.beginPath(); lctx.moveTo(x, 32); lctx.lineTo(x + 10, 32 - len); lctx.stroke();
    lctx.beginPath(); lctx.moveTo(x, 32); lctx.lineTo(x + 10, 32 + len); lctx.stroke();
  }
  const leafTex = new THREE.CanvasTexture(leaf);
  leafTex.colorSpace = THREE.SRGBColorSpace;
  const fronds = [];
  for (let i = 0; i < 9; i++) {
    const g = new THREE.PlaneGeometry(4.4, 1.1, 8, 1).rotateX(-Math.PI / 2).translate(2.2, 0, 0);
    const pp = g.getAttribute('position');
    const lift = 0.5 + (i % 3) * 0.25;
    for (let k = 0; k < pp.count; k++) {
      const x = pp.getX(k);
      pp.setY(k, lift * x * 0.4 - 0.11 * x * x);
    }
    g.rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.2);
    g.translate(0.9, 9, 0);
    g.computeVertexNormals();
    fronds.push(g);
  }
  const crownGeo = mergeGeometries(fronds);
  const crownMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  return { trunkGeo, crownGeo, trunkMat, crownMat };
}

function lifeguardTower(x, z, color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 });
  const hut = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2, 2.6), paint);
  hut.position.y = 3;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1, 4), white);
  roof.position.y = 4.5;
  roof.rotation.y = Math.PI / 4;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 3.6), white);
  deck.position.y = 1.95;
  g.add(hut, roof, deck);
  for (const [lx, lz] of [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2, 6), white);
    leg.position.set(lx, 1, lz);
    g.add(leg);
  }
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 4), white);
  ramp.position.set(0, 1, 3.4);
  ramp.rotation.x = -0.45;
  g.add(ramp);
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI / 2;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function billboard(ad, onRoof) {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, metalness: 0.2, roughness: 0.5 });
  const H = onRoof ? 3 : 9, W = 14, PH = 5.2, cy = H + 2.8;
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
  // Two posts with cross-braces, a lattice back and a catwalk.
  for (const side of [-5, 5]) add(new THREE.CylinderGeometry(0.25, 0.32, H, 10), steel, side, H / 2, -0.4);
  add(new THREE.BoxGeometry(10.6, 0.18, 0.18), steel, 0, H * 0.55, -0.4);
  add(new THREE.BoxGeometry(W + 0.6, PH + 0.6, 0.25), steel, 0, cy, -0.32);
  for (let x = -6; x <= 6; x += 2) add(new THREE.BoxGeometry(0.08, PH + 0.4, 0.12), steel, x, cy, -0.5);
  add(new THREE.BoxGeometry(W, 0.08, 1.1), steel, 0, H - 0.04, 0.35);
  // White frame around the panel.
  for (const [w, h, x, y] of [[W + 0.5, 0.25, 0, cy + PH / 2 + 0.12], [W + 0.5, 0.25, 0, cy - PH / 2 - 0.12], [0.25, PH, W / 2 + 0.12, cy], [0.25, PH, -W / 2 - 0.12, cy]]) {
    add(new THREE.BoxGeometry(w, h, 0.18), white, x, y, -0.1);
  }
  // Three lamps on arms that light the board at night.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff2d6, emissiveIntensity: 0.2 });
  for (const x of [-4.6, 0, 4.6]) {
    add(new THREE.BoxGeometry(0.06, 0.06, 1.3), steel, x, cy + PH / 2 + 0.4, 0.5);
    const head = add(new THREE.BoxGeometry(0.6, 0.12, 0.3), lampMat, x, cy + PH / 2 + 0.35, 1.15);
    head.rotation.x = 0.5;
  }
  const tex = ad.image ? imageTexture(ad.image, W / PH) : adTexture(ad);
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.5 });
  mat.userData.lamps = lampMat;
  add(new THREE.PlaneGeometry(W, PH), mat, 0, cy, -0.08);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group, mat };
}

// An image ad cropped to cover a board of the given aspect ratio.
const loader = new THREE.TextureLoader();
const imageCache = {};
function imageTexture(url, aspect) {
  const t = loader.load(url, (tx) => {
    const ia = tx.image.width / tx.image.height;
    if (ia < aspect) { tx.repeat.set(1, ia / aspect); tx.offset.set(0, (1 - ia / aspect) / 2); }
    else { tx.repeat.set(aspect / ia, 1); tx.offset.set((1 - aspect / ia) / 2, 0); }
    tx.needsUpdate = true;
  });
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function loadImage(url) {
  if (!imageCache[url]) { const img = new Image(); img.src = url; imageCache[url] = img; }
  return imageCache[url];
}

// A big LED screen that slides from one ad to the next every few seconds.
function ledScreen() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 576;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.4, roughness: 0.3 });
  const group = new THREE.Group();
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(24, 13.5), frameMat);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(25, 14.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.5 }));
  bezel.position.z = -0.3;
  group.add(bezel, screen);
  const ads = BILLBOARDS;
  const slides = ads.map((ad) => (ad.image ? { img: loadImage(ad.image) } : { canvas: adCanvas(ad) }));
  let i = 0, t = 0;
  const drawSlide = (sl, x) => {
    if (sl.img) {
      if (sl.img.complete && sl.img.naturalWidth) ctx.drawImage(sl.img, x, 0, c.width, c.height);
    } else ctx.drawImage(sl.canvas, 0, 0, sl.canvas.width, sl.canvas.height, x, 0, c.width, c.height);
  };
  const draw = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    const hold = 6, slide = 0.7;
    const k = t < hold ? 0 : Math.min(1, (t - hold) / slide);
    const e = k * k * (3 - 2 * k);
    drawSlide(slides[i], -e * c.width);
    if (k > 0) drawSlide(slides[(i + 1) % slides.length], c.width - e * c.width);
    // LED pixel grid.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < c.height; y += 4) ctx.fillRect(0, y, c.width, 1);
    tex.needsUpdate = true;
  };
  let acc = 0;
  return {
    mesh: group,
    frameMat,
    update(dt) {
      t += dt;
      if (t > 6.7) { t = 0; i = (i + 1) % slides.length; }
      acc += dt;
      // Redraw ~15 times a second (smooth enough for the slide, cheap on phones).
      if (acc > 1 / 15) { acc = 0; draw(); }
    },
  };
}

function adCanvas(ad) {
  return adTexture(ad).image;
}

function adTexture(ad) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 380;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ad.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  // Accent: a diagonal light streak and a stripe.
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = ad.accent;
  ctx.fillRect(60, 300, 180, 10);
  ctx.fillStyle = ad.fg;
  ctx.textBaseline = 'alphabetic';
  let size = 150;
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  while (ctx.measureText(ad.title).width > c.width - 120 && size > 60) { size -= 6; ctx.font = `700 ${size}px system-ui, sans-serif`; }
  ctx.fillText(ad.title, 60, 200);
  ctx.font = '400 52px system-ui, sans-serif';
  ctx.fillStyle = ad.accent;
  ctx.fillText(ad.tagline, 60, 280);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 216;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 80 + Math.random() * 352, y = 110 + (Math.random() - 0.5) * 60, r = 40 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseTex(size, base, amount, count) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count * 100; i++) {
    const v = (Math.random() - 0.5) * amount;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Horizontal gradient: colours from the beach (right, u = 1) out to sea (left).
function gradientTex(stops) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 4;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(256, 0, 0, 0);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
