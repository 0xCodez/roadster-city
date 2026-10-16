import * as THREE from 'three';

// Neon signs on street-facing facades, neon strips along some roof edges, and
// faint coloured streaks on the ground below each sign that show up when the
// street is wet at night (a cheap stand-in for real reflections).

const WORDS = ['HOTEL', 'BAR', 'NOODLES', '24/7', 'CLUB', 'ARCADE', 'GARAGE', 'CAFE', 'DRIVE', 'VOLT', 'CHARGE', 'PIXEL', 'KARAOKE', 'RAMEN', 'DINER', 'MOTEL'];
const COLORS = [0xff2fd0, 0x2ff3ff, 0xffb02f, 0xff3b4f, 0x9b5cff, 0x7dff5a];

export function buildNeon(scene, buildings, quality) {
  const rand = mulberry32(77);
  const maxSigns = quality === 'high' ? 30 : 14;
  const signMats = [];
  const stripMats = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c, emissiveIntensity: 1 }));
  const decalTex = gradientTexture();
  const decalMats = COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, map: decalTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const stripGroup = new THREE.Group();
  scene.add(stripGroup);

  let signs = 0;
  for (const b of buildings) {
    // Face that looks out of the block, toward the street.
    const dx = b.cx - b.blockCx, dz = b.cz - b.blockCz;
    let nx = 0, nz = 0;
    if (Math.abs(dx) < 1 && Math.abs(dz) < 1) {
      const k = Math.floor(rand() * 4);
      [nx, nz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][k];
    } else if (Math.abs(dx) > Math.abs(dz)) nx = Math.sign(dx);
    else nz = Math.sign(dz);
    const half = nx ? b.w / 2 : b.d / 2; // distance from centre to that face
    const span = nx ? b.d : b.w; // width of the face
    const yaw = Math.atan2(nx, nz); // local +z -> face normal

    if (signs < maxSigns && rand() < 0.75) {
      signs++;
      const color = Math.floor(rand() * COLORS.length);
      const word = WORDS[Math.floor(rand() * WORDS.length)];
      const vertical = rand() < 0.5;
      const sw = vertical ? 1.5 : Math.min(span - 3, 4 + word.length * 0.7);
      const sh = vertical ? Math.min(b.h - 6, 1.3 + word.length * 1.1) : 1.6;
      const tex = signTexture(word, COLORS[color], vertical);
      const mat = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1, roughness: 0.4 });
      signMats.push(mat);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
      const along = (rand() - 0.5) * Math.max(0, span - sw - 4);
      const y = 4.5 + sh / 2 + rand() * Math.max(0, Math.min(b.h - sh - 8, 14));
      sign.position.set(b.cx + nx * (half + 0.25) + (nz ? along : 0), y, b.cz + nz * (half + 0.25) + (nx ? along : 0));
      sign.rotation.y = yaw;
      scene.add(sign);

      // Glow streak on the street below, brightest at the kerb.
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.5, 9).rotateX(-Math.PI / 2), decalMats[color]);
      decal.position.set(sign.position.x + nx * 7.5, 0.07, sign.position.z + nz * 7.5);
      decal.rotation.y = yaw;
      decal.renderOrder = 1;
      scene.add(decal);
    }

    // Neon trim around some roofs.
    if (rand() < 0.35) {
      const mat = stripMats[Math.floor(rand() * stripMats.length)];
      const t = 0.22, y = b.h + 0.12;
      for (const [w, d, ox, oz] of [[b.w, t, 0, b.d / 2], [b.w, t, 0, -b.d / 2], [t, b.d, b.w / 2, 0], [t, b.d, -b.w / 2, 0]]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat);
        s.position.set(b.cx + ox, y, b.cz + oz);
        stripGroup.add(s);
      }
    }
  }

  return {
    // level: emissive intensity for signs/strips; wetNight: 0..1 for the street streaks.
    set(level, wetNight) {
      for (const m of signMats) m.emissiveIntensity = level;
      for (const m of stripMats) m.emissiveIntensity = level * 0.8;
      for (const m of decalMats) m.opacity = 0.18 * wetNight;
    },
  };
}

function signTexture(word, color, vertical) {
  const c = document.createElement('canvas');
  c.width = vertical ? 96 : 512;
  c.height = vertical ? 96 * Math.max(3, word.length) : 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  const css = '#' + color.toString(16).padStart(6, '0');
  ctx.strokeStyle = css;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
  ctx.fillStyle = css;
  ctx.shadowColor = css;
  ctx.shadowBlur = 14;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (vertical) {
    ctx.font = '600 64px system-ui, sans-serif';
    [...word].forEach((ch, i) => ctx.fillText(ch, c.width / 2, (i + 0.5) * (c.height / word.length)));
  } else {
    ctx.font = '600 76px system-ui, sans-serif';
    ctx.fillText(word, c.width / 2, c.height / 2 + 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gradientTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const ctx = c.getContext('2d');
  // Bright near the facade (top of the texture), fading toward the road centre.
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 128);
  // Soft side edges.
  const e = ctx.createLinearGradient(0, 0, 32, 0);
  e.addColorStop(0, 'rgba(0,0,0,1)');
  e.addColorStop(0.3, 'rgba(0,0,0,0)');
  e.addColorStop(0.7, 'rgba(0,0,0,0)');
  e.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(c);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
