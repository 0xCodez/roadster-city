// Points, the stunt streak and tasks. Stunts, rings, drifts and landings score
// points; chaining them within a few seconds lights up to five stars, and the
// stars multiply the points. Tasks are one-off goals with a bonus.
// Tricks in one jump build a combo (each extra trick adds x0.5, up to x8) that
// is banked when you land on your wheels and lost if you crash.
// Best score and finished tasks are remembered.

export const TASKS = [
  { id: 'wall', title: 'Climb the wall', bonus: 1000 },
  { id: 'wallPerfect', title: 'Perfect landing after the wall', bonus: 1500 },
  { id: 'kickflip', title: 'Kickflip over the five vehicles', bonus: 1000 },
  { id: 'double', title: 'Land a double kickflip', bonus: 2500 },
  { id: 'rings5', title: 'Fly through 5 rings', bonus: 1000, goal: 5 },
  { id: 'ringsAll', title: 'Collect every ring', bonus: 5000, goal: 15 },
  { id: 'rooftop', title: 'Land on a rooftop', bonus: 800 },
  { id: 'drift', title: 'Score 2,000 in one drift', bonus: 800 },
  { id: 'speed', title: 'Hit 300 km/h', bonus: 500 },
  { id: 'refuel', title: 'Refill at an AIR station', bonus: 200 },
  { id: 'stars5', title: 'Reach a five-star streak', bonus: 3000 },
  { id: 'launch', title: '0-100 km/h in under 1 s (hold Shift)', bonus: 800 },
  { id: 'flip', title: 'Land a front or back flip', bonus: 1000 },
  { id: 'hang', title: '6 seconds in the air (no Rocket flight)', bonus: 1000 },
  { id: 'combo', title: 'Bank a x3 combo', bonus: 2000 },
];

const STREAK_TIME = 12; // seconds to land the next stunt and keep the streak

export class Score {
  constructor() {
    this.points = 0;
    this.best = 0;
    this.done = new Set();
    this.progress = {};
    try {
      this.best = Number(localStorage.getItem('rr-best') || 0);
      this.points = Math.max(0, Number(localStorage.getItem('rr-points') || 0)) || 0; // the score survives a page reload
      this.done = new Set(JSON.parse(localStorage.getItem('rr-tasks') || '[]'));
    } catch {}
    this.drift = 0;
    this.driftIdle = 0;
    this.streak = 0; // number of stunts in the current streak
    this.streakTimer = 0;
    this.tricks = []; // tricks in the current jump
    this.pending = 0;
    this.slowmo = { t: 0, scale: 1, cool: 0 };
    this.slowmoOn = true;
    try { this.slowmoOn = localStorage.getItem('rr-slowmo') !== '0'; } catch {}
    this.el = {
      score: document.getElementById('score'),
      value: document.querySelector('#score .score-value'),
      best: document.querySelector('#topinfo .score-best'),
      stars: document.getElementById('stars'),
      toasts: document.getElementById('toasts'),
      drift: document.getElementById('drift-meter'),
      combo: document.getElementById('combo'),
      pending: document.getElementById('combo-pts'),
      mult: document.getElementById('combo-mult'),
      feed: document.getElementById('trick-feed'),
    };
    this.render();
  }

  get stars() { return Math.min(5, Math.ceil(this.streak / 2)); }
  get comboMult() { return Math.min(8, 1 + Math.max(0, this.tricks.length - 1) * 0.5); }
  get timeScale() { return this.slowmo.t > 0 ? this.slowmo.scale : 1; }

  // A trick in the air: added to the combo, paid out on landing.
  callTrick(name, points) {
    this.tricks.push(name);
    this.pending += points;
    const item = document.createElement('div');
    item.className = 'trick';
    item.innerHTML = `<span></span><b>+${points.toLocaleString('en-US')}</b>`;
    item.firstChild.textContent = name;
    this.feed(item, 2.2);
    this.renderCombo();
    this.onTrick?.(name);
  }

  // Landed on the wheels: pay the combo (times the streak stars).
  bank(label) {
    if (this.pending > 0) {
      const mult = this.comboMult;
      const total = Math.round(this.pending * mult);
      if (mult >= 3) this.task('combo');
      const item = document.createElement('div');
      item.className = 'trick banked';
      item.innerHTML = `<span></span><b>+${total.toLocaleString('en-US')}</b>`;
      item.firstChild.textContent = label;
      this.feed(item, 1.8);
      this.stunt(total, mult > 1 ? `${label} · combo x${mult.toFixed(1)}` : label);
    }
    this.tricks = [];
    this.pending = 0;
    this.renderCombo();
  }

  // Crashed: the combo and the streak are gone.
  lose() {
    if (this.pending > 0) {
      const item = document.createElement('div');
      item.className = 'trick lost';
      item.textContent = 'COMBO LOST';
      this.feed(item, 1.8);
    }
    this.tricks = [];
    this.pending = 0;
    this.streak = 0;
    this.renderCombo();
    this.renderStars();
  }

  // Brief slow motion for the big moments (can be turned off in Settings).
  requestSlowmo(seconds = 1, scale = 0.35) {
    if (!this.slowmoOn || this.slowmo.cool > 0) return;
    this.slowmo = { t: seconds, scale, cool: 3.5 };
  }

  feed(item, seconds) {
    this.el.feed.prepend(item);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => item.classList.add('out'), seconds * 1000);
    setTimeout(() => item.remove(), seconds * 1000 + 600);
  }

  renderCombo() {
    const on = this.pending > 0;
    this.el.combo.classList.toggle('on', on);
    if (!on) return;
    this.el.pending.textContent = this.pending.toLocaleString('en-US');
    const m = this.comboMult;
    this.el.mult.textContent = m > 1 ? `x${m.toFixed(1)}` : '';
  }
  get multiplier() { return Math.max(1, this.stars); }
  get streakFrac() { return this.streak > 0 ? this.streakTimer / STREAK_TIME : 0; }

  // A stunt counts toward the streak and is multiplied by the stars.
  stunt(points, label) {
    const before = this.stars;
    this.streak++;
    this.streakTimer = STREAK_TIME;
    const mult = this.multiplier;
    this.add(Math.round(points * mult), mult > 1 ? `${label} ×${mult}` : label);
    if (this.stars > before) {
      this.el.stars.classList.remove('flash');
      void this.el.stars.offsetWidth;
      this.el.stars.classList.add('flash');
      if (this.stars === 5) this.task('stars5');
    }
  }

  add(points, label, kind = '') {
    if (points <= 0) return;
    this.points += points;
    try { localStorage.setItem('rr-points', String(this.points)); } catch {}
    if (this.points > this.best) {
      this.best = this.points;
      try { localStorage.setItem('rr-best', String(this.best)); } catch {}
    }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = `+${points.toLocaleString('en-US')}`;
    const small = document.createElement('small');
    small.textContent = label;
    t.appendChild(small);
    this.el.toasts.prepend(t);
    setTimeout(() => t.classList.add('fade'), 2000);
    setTimeout(() => t.remove(), 2800);
    while (this.el.toasts.children.length > 4) this.el.toasts.lastChild.remove();
    this.render();
  }

  // Finish a task (once), or advance one with a goal.
  task(id, amount = 1) {
    if (this.done.has(id)) return;
    const def = TASKS.find((t) => t.id === id);
    if (!def) return;
    if (def.goal) {
      this.progress[id] = (this.progress[id] || 0) + amount;
      if (this.progress[id] < def.goal) return;
    }
    this.done.add(id);
    try { localStorage.setItem('rr-tasks', JSON.stringify([...this.done])); } catch {}
    this.add(def.bonus, 'Task complete', 'task');
    this.onTask?.(def);
  }

  update(dt, vehicle) {
    // Slow motion runs on real time.
    this.slowmo.t = Math.max(0, this.slowmo.t - dt);
    this.slowmo.cool = Math.max(0, this.slowmo.cool - dt);
    // Streak timer.
    if (this.streak > 0) {
      this.streakTimer -= dt;
      if (this.streakTimer <= 0) { this.streak = 0; this.renderStars(); }
    }
    // Drift points build up while sliding and bank when the slide ends.
    const sliding = vehicle.state === 'ground' && vehicle.drift > 12 && vehicle.speed > 10;
    if (sliding) {
      this.drift += vehicle.drift * vehicle.speed * dt * 0.25;
      this.driftIdle = 0;
    } else if (this.drift > 0) {
      this.driftIdle += dt;
      if (this.driftIdle > 0.6) {
        const pts = Math.round(this.drift / 10) * 10;
        if (pts >= 100) this.onTrick?.('drift');
        if (pts >= 300) this.stunt(pts, 'Drift');
        else if (pts >= 100) this.add(pts, 'Drift');
        if (pts >= 2000) this.task('drift');
        this.drift = 0;
      }
    }
    if (vehicle.impact > 2 && this.drift > 0) this.drift = 0; // crashing ends the chain
    this.el.drift.textContent = this.drift > 50 ? `DRIFT ${Math.round(this.drift)}` : '';
    if (vehicle.speed * 3.6 >= 300) this.task('speed');
    this.renderStars();
  }

  // Start over from zero (Settings). The best score and finished tasks stay.
  resetPoints() {
    this.points = 0;
    this.streak = 0;
    try { localStorage.setItem('rr-points', '0'); } catch {}
    this.render();
    this.renderStars();
  }

  render() {
    this.el.value.textContent = this.points.toLocaleString('en-US');
    this.el.best.textContent = `BEST ${this.best.toLocaleString('en-US')}  ·  TASKS ${this.done.size}/${TASKS.length}`;
  }

  renderStars() {
    const n = this.stars;
    [...this.el.stars.children].forEach((s, i) => s.classList.toggle('on', i < n));
  }

  renderTasks(container) {
    container.innerHTML = TASKS.map((t) => {
      const ok = this.done.has(t.id);
      const prog = t.goal && !ok ? ` <span class="prog">${this.progress[t.id] || 0}/${t.goal}</span>` : '';
      return `<div class="task ${ok ? 'ok' : ''}"><span class="box">${ok ? '✓' : ''}</span>${t.title}${prog}<span class="bonus">${t.bonus.toLocaleString('en-US')}</span></div>`;
    }).join('') + `<div class="tasks-total">${this.done.size} of ${TASKS.length} done · best score ${this.best.toLocaleString('en-US')}</div>`;
  }
}
