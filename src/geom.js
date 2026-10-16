import * as THREE from 'three';

// Shared geometry helpers for the procedural cars.

// Smooth (cosine) interpolation through [z, value] keyframes, in any order.
export function keys(list) {
  const k = [...list].sort((a, b) => a[0] - b[0]);
  return (z) => {
    if (z <= k[0][0]) return k[0][1];
    if (z >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 1;
    while (k[i][0] < z) i++;
    const [z0, v0] = k[i - 1], [z1, v1] = k[i];
    const t = (1 - Math.cos(((z - z0) / (z1 - z0)) * Math.PI)) / 2;
    return v0 + (v1 - v0) * t;
  };
}

// Loft a closed, left/right-symmetric surface through cross-sections along z.
// section(z) returns the right half as [x, y] points from the bottom centre
// (x = 0) round to the top centre (x = 0). Ends are capped. Smooth normals.
export function loft(zs, section) {
  const pos = [], idx = [];
  let ring = 0;
  for (const z of zs) {
    const half = section(z);
    const full = [...half];
    for (let i = half.length - 2; i >= 1; i--) full.push([-half[i][0], half[i][1]]);
    ring = full.length;
    for (const [x, y] of full) pos.push(x, y, z);
  }
  const n = zs.length;
  for (let s = 0; s < n - 1; s++) {
    for (let i = 0; i < ring; i++) {
      const a = s * ring + i, b = s * ring + ((i + 1) % ring), c = (s + 1) * ring + i, d = (s + 1) * ring + ((i + 1) % ring);
      idx.push(a, c, b, b, c, d);
    }
  }
  // End caps: fan around the centroid of each end ring.
  for (const s of [0, n - 1]) {
    let cx = 0, cy = 0;
    for (let i = 0; i < ring; i++) { cx += pos[(s * ring + i) * 3]; cy += pos[(s * ring + i) * 3 + 1]; }
    const centre = pos.length / 3;
    pos.push(cx / ring, cy / ring, zs[s]);
    for (let i = 0; i < ring; i++) {
      const a = s * ring + i, b = s * ring + ((i + 1) % ring);
      if (s === 0) idx.push(centre, a, b); else idx.push(centre, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure the surface faces outward: the widest vertex should have a normal pointing out.
  let best = 0, bestX = -Infinity;
  for (let i = 0; i < ring * n; i++) if (pos[i * 3] > bestX) { bestX = pos[i * 3]; best = i; }
  if (g.getAttribute('normal').getX(best) < 0) {
    const ix = g.getIndex().array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

// Evenly spaced values from a to b (inclusive), with extra density near given points.
export function stations(a, b, step, dense = [], denseStep = step / 3, denseR = 0.5) {
  const out = [];
  let z = a;
  const dir = Math.sign(b - a);
  while ((b - z) * dir > 1e-6) {
    out.push(z);
    const near = dense.some((d) => Math.abs(z - d) < denseR);
    z += dir * (near ? denseStep : step);
  }
  out.push(b);
  return out;
}

// A twill carbon-fibre texture.
export function carbonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) for (let x = 0; x < 64; x += 8) {
    const odd = ((x + y) / 8) % 2;
    const g = ctx.createLinearGradient(x, y, x + 8, y + 8);
    g.addColorStop(0, odd ? '#1d1e22' : '#121316');
    g.addColorStop(1, odd ? '#2a2b30' : '#18191c');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
