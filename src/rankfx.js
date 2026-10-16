// Leaderboard moments: climbing into or within the top 10 sets off a celebration
// (gold flash, glowing edges, a rank number that rolls down to your new place,
// confetti and a fanfare); the podium gets its own colours. Being overtaken while
// in the top 10 gets a short warning instead.

const COLORS = ['#f5c542', '#ff3fb4', '#3fd8ff', '#ffffff', '#ff9a3c'];
const THEMES = {
  1: { cls: 'gold', kicker: '👑 KING OF ROADSTER CITY' },
  2: { cls: 'silver', kicker: 'PODIUM · SECOND PLACE' },
  3: { cls: 'bronze', kicker: 'PODIUM · THIRD PLACE' },
};

export class RankFx {
  constructor({ audio, touch }) {
    this.audio = audio;
    this.root = document.getElementById('rankfx');
    this.card = this.root.querySelector('.rf-card');
    this.kicker = this.root.querySelector('.rf-kicker');
    this.num = this.root.querySelector('.rf-rank');
    this.sub = this.root.querySelector('.rf-sub');
    this.canvas = document.getElementById('confetti');
    this.ctx = this.canvas.getContext('2d');
    this.max = touch ? 90 : 170;
    this.bits = [];
    this.running = false;
    this.hideTimer = 0;
  }

  // You moved up to `rank` (<= 10) from `from` (a number, or null if you weren't ranked).
  celebrate({ rank, from, passed }) {
    const theme = THEMES[rank] || { cls: 'top10', kicker: from && from <= 10 ? 'CLIMBING THE TOP 10' : 'YOU MADE THE TOP 10' };
    this.root.className = `show ${theme.cls}`;
    this.kicker.textContent = theme.kicker;
    this.sub.textContent = passed ? `You passed ${passed}${from ? ` · #${from} → #${rank}` : ''}` : from ? `#${from} → #${rank}` : `#${rank} on the leaderboard`;
    void this.card.offsetWidth; // restart the CSS animations
    this.card.classList.remove('go');
    void this.card.offsetWidth;
    this.card.classList.add('go');
    this.rollNumber(from && from > rank ? Math.min(from, 99) : rank + 3, rank);
    this.confetti(rank <= 3 ? this.max : Math.round(this.max * 0.7));
    this.fanfare(rank);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.root.classList.remove('show'), rank <= 3 ? 4200 : 3300);
  }

  // Somebody pushed you down while you were in the top 10.
  overtaken({ rank, by }) {
    this.root.className = 'show warn';
    this.kicker.textContent = 'OVERTAKEN!';
    this.sub.textContent = by ? `${by} took your place · now #${rank}` : `Now #${rank} · get it back`;
    this.num.textContent = `#${rank}`;
    this.card.classList.remove('go');
    void this.card.offsetWidth;
    this.card.classList.add('go');
    this.audio?.thump?.(6);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.root.classList.remove('show'), 2400);
  }

  // Count down from the old place to the new one, slowing at the end.
  rollNumber(from, to) {
    this.num.textContent = `#${from}`;
    const t0 = performance.now(), dur = 900;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      this.num.textContent = `#${Math.round(from + (to - from) * e)}`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  fanfare(rank) {
    const a = this.audio;
    if (!a?.chime) return;
    const steps = rank === 1 ? [0, 4, 7, 12, 16] : rank <= 3 ? [0, 4, 7, 12] : [0, 5, 9];
    steps.forEach((s, i) => setTimeout(() => a.chime(s), i * 110));
    a.thump?.(8);
  }

  confetti(n) {
    const W = (this.canvas.width = innerWidth), H = (this.canvas.height = innerHeight);
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      this.bits.push({
        x: left ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.35),
        vx: (left ? 1 : -1) * (250 + Math.random() * 520), vy: -(380 + Math.random() * 620),
        w: 6 + Math.random() * 7, h: 3 + Math.random() * 5, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 14,
        c: COLORS[i % COLORS.length], life: 2.6 + Math.random() * 1.2,
      });
    }
    if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame((t) => this.tick(t)); }
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this.bits = this.bits.filter((b) => (b.life -= dt) > 0 && b.y < H + 40);
    for (const b of this.bits) {
      b.vy += 900 * dt; // gravity
      b.vx *= Math.exp(-1.6 * dt); // air
      b.vy *= Math.exp(-0.6 * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.va * dt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life * 1.5);
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.scale(1, Math.abs(Math.cos(b.a * 1.7)) * 0.8 + 0.2); // tumbling paper
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (this.bits.length) requestAnimationFrame((t) => this.tick(t));
    else { this.running = false; ctx.clearRect(0, 0, W, H); }
  }
}
