import { LAYOUT } from './world.js';

// GTA-style HUD: a rotating radar with condition / air / streak bars (bottom
// left), clock + score + streak stars (top right), an arc speedometer (bottom
// right), stunt banners, a gold "task complete" banner and the radio name.

const RADAR_SCALE = 0.9; // radar pixels per metre
const MAX_KMH = 360;

export class Hud {
  constructor(world) {
    const $ = (id) => document.getElementById(id);
    this.el = {
      speed: $('speed'), badge: $('mode-badge'), airtext: $('airtext'), fps: $('fps'), hint: $('hint'),
      pitch: $('t-pitch'), alt: $('t-alt'), down: $('t-down'), g: $('t-g'), telemetry: $('telemetry'),
      banner: $('banner'), big: $('bigbanner'), radio: $('radio-name'), clock: $('clock'),
      hp: $('bar-hp'), air: $('bar-air'), combo: $('bar-combo'), arc: $('arc-fg'),
      lift: $('ind-lift'), boost: $('ind-boost'), wrecked: $('wrecked'),
    };
    this.wreckTimer = 0;
    this.bannerTimer = 0;
    this.bigTimer = 0;
    this.radioTimer = 0;
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.map = renderStaticMap(world, RADAR_SCALE);
    this.rings = null;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.clockMin = 13 * 60;
    buildSpeedo();
    setTimeout(() => (this.el.hint.style.opacity = '0'), 10000);
  }

  setRings(rings) { this.rings = rings; }

  setMode(mode) {
    for (const b of document.querySelectorAll('#quickbar .mode')) b.classList.toggle('active', b.dataset.mode === mode);
    this.el.badge.textContent = mode.toUpperCase();
    this.el.badge.className = 'mode-badge ' + mode;
  }

  // Crash: GTA-style "wrecked" card while the thrusters right the car.
  wrecked() {
    this.el.wrecked.classList.remove('show');
    void this.el.wrecked.offsetWidth;
    this.el.wrecked.classList.add('show');
    document.body.classList.add('wrecked');
    this.wreckTimer = 2;
  }

  setCamera(mode) { document.getElementById('cam-label').textContent = mode === 'chase' ? 'CHASE' : 'COCKPIT'; }
  setSound() {}

  // The clock jumps to a fitting hour when the time of day changes, then runs.
  setSky({ time }) {
    this.clockMin = { day: 13 * 60 + 20, dusk: 19 * 60 + 35, night: 23 * 60 + 50 }[time] ?? this.clockMin;
  }

  banner(text, sub = '', seconds = 2.2) {
    this.el.banner.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      this.el.banner.appendChild(s);
    }
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth; // restart the pop animation
    this.el.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  // The big gold one, for finished tasks.
  bigBanner(title, sub = '', bonus = '') {
    const b = this.el.big;
    b.querySelector('.big-title').textContent = title;
    b.querySelector('.big-sub').textContent = sub;
    b.querySelector('.big-bonus').textContent = bonus;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    this.bigTimer = 3.2;
  }

  radioName(name, genre) {
    this.el.radio.innerHTML = '';
    this.el.radio.append(name);
    if (genre) { const s = document.createElement('small'); s.textContent = genre; this.el.radio.appendChild(s); }
    this.el.radio.classList.add('show');
    this.radioTimer = 2.5;
  }

  update(dt, vehicle, { condition = 1, combo = 0 } = {}) {
    const kmh = vehicle.speed * 3.6;
    this.el.speed.textContent = Math.round(kmh);
    const f = Math.min(1, kmh / MAX_KMH);
    this.el.arc.style.strokeDashoffset = String(ARC_LEN * (1 - f));
    this.el.arc.style.stroke = f > 0.8 ? '#ff4a3c' : f > 0.55 ? '#ffd34a' : '#ffffff';
    this.el.airtext.textContent = 'AIR ' + Math.round(vehicle.air);

    this.el.hp.style.width = (condition * 100).toFixed(1) + '%';
    this.el.air.style.width = (vehicle.airFrac * 100).toFixed(1) + '%';
    this.el.air.style.background = vehicle.airFrac < 0.2 ? '#ff4a3c' : '';
    this.el.combo.style.width = (combo * 100).toFixed(1) + '%';
    this.el.lift.classList.toggle('on', vehicle.thrust > 0.15);
    this.el.boost.classList.toggle('on', vehicle.rearThrust > 0.15);
    if (this.wreckTimer > 0) {
      this.wreckTimer -= dt;
      if (this.wreckTimer <= 0) { this.el.wrecked.classList.remove('show'); document.body.classList.remove('wrecked'); }
    }

    // Stunt telemetry only while something is happening.
    const stunting = vehicle.state !== 'ground';
    this.el.telemetry.classList.toggle('hidden', !stunting);
    if (stunting) {
      this.el.pitch.textContent = Math.round(vehicle.pitchDeg) + '°';
      this.el.alt.textContent = vehicle.alt.toFixed(1) + ' m';
      this.el.down.textContent = Math.round(vehicle.downforce / 10) * 10 + ' kg';
      this.el.g.textContent = vehicle.gForce.toFixed(1);
    }

    // Clock: one game minute per real second.
    this.clockMin = (this.clockMin + dt) % (24 * 60);
    const h = Math.floor(this.clockMin / 60), m = Math.floor(this.clockMin % 60);
    this.el.clock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    for (const [timer, el] of [['bannerTimer', this.el.banner], ['bigTimer', this.el.big], ['radioTimer', this.el.radio]]) {
      if (this[timer] > 0) { this[timer] -= dt; if (this[timer] <= 0) el.classList.remove('show'); }
    }
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc > 0.5) {
      this.el.fps.textContent = Math.round(this.fpsFrames / this.fpsAcc) + ' FPS';
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    this.drawRadar(vehicle);
  }

  drawRadar(vehicle) {
    const ctx = this.mctx, W = this.mini.width, H = this.mini.height;
    const cx = W / 2, cy = H * 0.62; // the player sits a little below centre, like GTA
    ctx.fillStyle = '#2b5f86';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(vehicle.yaw - Math.PI);
    const { hx, hz } = LAYOUT.island;
    ctx.drawImage(this.map, (-hx - vehicle.pos.x) * RADAR_SCALE, (-hz - vehicle.pos.z) * RADAR_SCALE);
    // Rings still to collect.
    if (this.rings) {
      for (const r of this.rings.rings) {
        if (r.taken) continue;
        const x = (r.center.x - vehicle.pos.x) * RADAR_SCALE, y = (r.center.z - vehicle.pos.z) * RADAR_SCALE;
        ctx.fillStyle = '#c38bff';
        ctx.strokeStyle = '#1a0f2e';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
    // Player arrow, always pointing up.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 13); ctx.lineTo(cx + 9, cy + 10); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 9, cy + 10);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // North marker on the edge.
    // World north (-z) after the radar's rotation by (yaw - π).
    const a = vehicle.yaw - Math.PI - Math.PI / 2;
    const nx = cx + Math.cos(a) * 200, ny = cy + Math.sin(a) * 200;
    const px = Math.max(14, Math.min(W - 14, nx)), py = Math.max(14, Math.min(H - 14, ny));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px Oswald, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', px, py + 1);
  }
}

// ---------- Speedometer drawing ----------
const R = 80, CX = 100, CY = 100, A0 = (135 * Math.PI) / 180, SWEEP = (270 * Math.PI) / 180;
const ARC_LEN = R * SWEEP;
function polar(a, r = R) { return [CX + Math.cos(a) * r, CY + Math.sin(a) * r]; }
function buildSpeedo() {
  const [x0, y0] = polar(A0), [x1, y1] = polar(A0 + SWEEP);
  const d = `M ${x0} ${y0} A ${R} ${R} 0 1 1 ${x1} ${y1}`;
  document.getElementById('arc-bg').setAttribute('d', d);
  const fg = document.getElementById('arc-fg');
  fg.setAttribute('d', d);
  fg.style.strokeDasharray = String(ARC_LEN);
  fg.style.strokeDashoffset = String(ARC_LEN);
  const ticks = document.getElementById('ticks');
  const ns = 'http://www.w3.org/2000/svg';
  for (let k = 0; k <= 12; k++) {
    const a = A0 + (k / 12) * SWEEP;
    const [ax, ay] = polar(a, R + 9), [bx, by] = polar(a, R + (k % 2 ? 13 : 17));
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', ax); line.setAttribute('y1', ay); line.setAttribute('x2', bx); line.setAttribute('y2', by);
    ticks.appendChild(line);
    if (k % 2 === 0) {
      const [tx, ty] = polar(a, R - 16);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', tx); t.setAttribute('y', ty);
      t.textContent = String((k / 12) * MAX_KMH);
      ticks.appendChild(t);
    }
  }
}

// ---------- Static map (radar and pause menu) ----------
export function renderStaticMap(world, scale, { labels = false } = {}) {
  const { hx, hz } = LAYOUT.island;
  const c = document.createElement('canvas');
  c.width = Math.ceil(hx * 2 * scale);
  c.height = Math.ceil(hz * 2 * scale);
  const ctx = c.getContext('2d');
  const X = (x) => (x + hx) * scale, Z = (z) => (z + hz) * scale;
  const rect = (x0, z0, x1, z1, color) => { ctx.fillStyle = color; ctx.fillRect(X(x0), Z(z0), (x1 - x0) * scale, (z1 - z0) * scale); };

  rect(-hx, -hz, hx, hz, '#4d6a45'); // lawns
  rect(-hx, -hz, -LAYOUT.ring.hx - LAYOUT.ring.width / 2, hz, '#cdb98a'); // beach
  const z = (r, color) => rect(r.x0, r.z0, r.x1, r.z1, color);
  z(LAYOUT.city, '#3b3f45');
  z(LAYOUT.kickflip, '#6b6a66');
  z(LAYOUT.wall, '#6b6a66');
  z(LAYOUT.runway, '#4a4b4f');
  ctx.fillStyle = '#9aa0aa';
  for (const b of world.cityBlocks) ctx.fillRect(X(b.x) + 1, Z(b.z) + 1, b.w * scale - 2, b.d * scale - 2);
  // Roads.
  ctx.strokeStyle = '#dcdcdc';
  ctx.lineWidth = LAYOUT.ring.width * scale;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  world.ringPts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.y)) : ctx.moveTo(X(p.x), Z(p.y))));
  ctx.closePath();
  ctx.stroke();
  const r = world.ramp;
  if (r) {
    rect(60, r.origin.z - r.width / 2, r.origin.x, r.origin.z + r.width / 2, '#dcdcdc');
    rect(r.origin.x, r.origin.z - r.width / 2, r.origin.x + r.R + 3, r.origin.z + r.width / 2, '#ff9a2a');
  }
  const k = world.kickflip;
  if (k) {
    rect(LAYOUT.kickflip.x0 + 13, k.row.z - k.laneHalf, LAYOUT.kickflip.x1, k.row.z + k.laneHalf, '#dcdcdc');
    rect(k.row.x - k.row.halfLen, k.row.z - 4, k.row.x + k.row.halfLen, k.row.z + 4, '#ff9a2a');
  }
  // Air stations: red bolts.
  for (const s of world.airStations || []) {
    ctx.fillStyle = '#e8261c';
    ctx.beginPath(); ctx.arc(X(s.x), Z(s.z), Math.max(5, 6 * scale), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.max(8, 8 * scale)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('A', X(s.x), Z(s.z) + 0.5);
  }
  if (labels) {
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.round(12 * scale)}px Oswald, sans-serif`;
    ctx.textAlign = 'center';
    const lab = (t, x, zz) => { ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3; ctx.strokeText(t, X(x), Z(zz)); ctx.fillText(t, X(x), Z(zz)); };
    lab('OCEAN DRIVE', -385, 0);
    lab('DOWNTOWN', (LAYOUT.city.x0 + LAYOUT.city.x1) / 2, LAYOUT.city.z0 - 8);
    lab('KICKFLIP', 180, -160);
    lab('THE WALL', 200, 70);
    lab('RUNWAY', 0, 160);
  }
  return c;
}
