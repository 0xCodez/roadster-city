import { LAYOUT } from './world.js';
import { renderStaticMap } from './hud.js';

// Pause menu in the style of GTA's: a big map you can warp from, the task list,
// settings (time, rain, radio, sound, camera, mode, graphics) and the controls.

export const WARPS = [
  { id: 'start', name: 'Ocean Drive', color: '#ffffff', at: () => LAYOUT.start },
  { id: 'wall', name: 'The Wall', color: '#ff9a2a', at: () => LAYOUT.wallApproach },
  { id: 'kickflip', name: 'Kickflip', color: '#ff9a2a', at: () => LAYOUT.kickflipApproach },
  { id: 'runway', name: 'Runway (Rocket)', color: '#f5c542', at: () => LAYOUT.rocketStart },
  { id: 'beach', name: 'The Beach', color: '#cdb98a', at: () => ({ x: -390, z: 120, yaw: Math.PI }) },
];

export class Menu {
  constructor({ world, score, onWarp, onSet, getState, onOpen, onClose }) {
    this.root = document.getElementById('menu');
    this.score = score;
    this.onWarp = onWarp;
    this.onSet = onSet;
    this.getState = getState;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.open = false;

    this.root.querySelectorAll('.menu-tabs button').forEach((b) => b.addEventListener('click', () => this.tab(b.dataset.tab)));
    this.root.querySelector('.menu-foot').addEventListener('click', () => this.close());

    // Map: static island art plus warp markers.
    this.mapCanvas = document.getElementById('menu-map');
    const sc = this.mapCanvas.width / (LAYOUT.island.hx * 2 + 60);
    this.scale = sc;
    this.mapArt = renderStaticMap(world, sc, { labels: true });
    this.drawMap();
    const list = this.root.querySelector('.warp-list');
    for (const w of WARPS) {
      const b = document.createElement('button');
      b.innerHTML = `<span class="dot" style="background:${w.color}"></span>${w.name}`;
      b.addEventListener('click', () => { this.onWarp(w); this.close(); });
      list.appendChild(b);
    }
    const reset = document.createElement('button');
    reset.textContent = 'Reset car';
    reset.addEventListener('click', () => { this.onWarp(null); this.close(); });
    list.appendChild(reset);
    this.mapCanvas.addEventListener('click', (e) => {
      // Click near a marker to warp there.
      const r = this.mapCanvas.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * this.mapCanvas.width, py = ((e.clientY - r.top) / r.height) * this.mapCanvas.height;
      const hit = WARPS.find((w) => { const [x, y] = this.toMap(w.at()); return Math.hypot(x - px, y - py) < 26; });
      if (hit) { this.onWarp(hit); this.close(); }
    });
  }

  toMap(p) {
    const ox = (this.mapCanvas.width - this.mapArt.width) / 2, oy = (this.mapCanvas.height - this.mapArt.height) / 2;
    return [ox + (p.x + LAYOUT.island.hx) * this.scale, oy + (p.z + LAYOUT.island.hz) * this.scale];
  }

  drawMap(player) {
    const c = this.mapCanvas, ctx = c.getContext('2d');
    ctx.fillStyle = '#2b5f86';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(this.mapArt, (c.width - this.mapArt.width) / 2, (c.height - this.mapArt.height) / 2);
    for (const w of WARPS) {
      const [x, y] = this.toMap(w.at());
      ctx.fillStyle = w.color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '600 15px Oswald, sans-serif';
      ctx.textAlign = 'left';
      ctx.lineWidth = 4;
      ctx.strokeText(w.name, x + 16, y + 5);
      ctx.fillText(w.name, x + 16, y + 5);
    }
    if (player) {
      const [x, y] = this.toMap(player.pos);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI - player.yaw);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 5); ctx.lineTo(-10, 10); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  tab(name) {
    this.root.querySelectorAll('.menu-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    this.root.querySelectorAll('.menu-body section').forEach((s) => s.classList.toggle('active', s.dataset.pane === name));
    if (name === 'tasks') this.score.renderTasks(document.getElementById('menu-tasks'));
    if (name === 'settings') this.renderSettings();
  }

  renderSettings() {
    const st = this.getState();
    const rows = [
      ['time', 'TIME OF DAY', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']]],
      ['rain', 'WEATHER', [[false, 'Clear'], [true, 'Rain']]],
      ['radio', 'RADIO', [[-1, 'Off'], [0, 'WAVE 103.5'], [1, 'PALM FM'], [2, 'NEON 122']]],
      ['sound', 'SOUND', [[true, 'On'], [false, 'Off']]],
      ['camera', 'CAMERA', [['chase', 'Chase'], ['cockpit', 'Cockpit']]],
      ['mode', 'DRIVE MODE', [['road', 'Road'], ['track', 'Track'], ['rocket', 'Rocket']]],
      ['slowmo', 'SLOW MOTION', [[true, 'On'], [false, 'Off']]],
      ['quality', 'GRAPHICS', [['low', 'Low'], ['high', 'High']]],
    ];
    const box = document.getElementById('menu-settings');
    box.innerHTML = '';
    for (const [key, label, opts] of rows) {
      const row = document.createElement('div');
      row.className = 'set-row';
      row.innerHTML = `<span class="label">${label}</span>`;
      for (const [val, text] of opts) {
        const b = document.createElement('button');
        b.textContent = text;
        if (st[key] === val) b.classList.add('active');
        b.addEventListener('click', () => { this.onSet(key, val); this.renderSettings(); });
        row.appendChild(b);
      }
      box.appendChild(row);
    }
  }

  show(tab = 'map', player) {
    this.open = true;
    this.root.classList.remove('hidden');
    this.drawMap(player);
    this.tab(tab);
    this.onOpen?.();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  toggle(tab, player) { if (this.open) this.close(); else this.show(tab, player); }
}
