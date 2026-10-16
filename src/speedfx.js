// Nitro speed lines: streaks rushing out from the middle of the screen while the
// boost is on, stronger the faster you go. The middle stays clear for the car.
// Drawn on a 2D canvas over the game at CSS-pixel size (streaks don't need more).

const TAU = Math.PI * 2;

export class SpeedLines {
  constructor(touch) {
    this.c = document.getElementById('speedfx');
    this.ctx = this.c.getContext('2d');
    this.level = 0;
    this.drawn = false;
    this.lines = Array.from({ length: touch ? 28 : 52 }, () => this.spawn(true));
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.c.width = innerWidth;
    this.c.height = innerHeight;
    this.drawn = true; // force a clear on the next frame
  }

  spawn(anywhere) {
    return { a: Math.random() * TAU, r: anywhere ? Math.random() : 0.18 + Math.random() * 0.2, v: 0.8 + Math.random() * 1.3, w: 1 + Math.random() * 2.2 };
  }

  update(dt, vehicle) {
    const want = vehicle.boosting ? Math.min(1, 0.35 + vehicle.speed / 90) : 0;
    this.level += (want - this.level) * (1 - Math.exp(-dt * (want > this.level ? 8 : 3)));
    const ctx = this.ctx, W = this.c.width, H = this.c.height;
    if (this.level < 0.01) {
      if (this.drawn) { ctx.clearRect(0, 0, W, H); this.drawn = false; }
      return;
    }
    this.drawn = true;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.48, R = Math.hypot(W, H) * 0.6;
    ctx.lineCap = 'round';
    for (const L of this.lines) {
      L.r += L.v * dt * (0.8 + this.level * 1.6);
      if (L.r > 1.1) Object.assign(L, this.spawn(false));
      const alpha = Math.min(1, (L.r - 0.18) * 2.2) * 0.8 * this.level;
      if (alpha <= 0) continue;
      const r0 = L.r * R, len = (0.08 + 0.2 * this.level) * R * L.r;
      const ca = Math.cos(L.a), sa = Math.sin(L.a);
      ctx.strokeStyle = `rgba(205, 232, 255, ${alpha.toFixed(3)})`;
      ctx.lineWidth = L.w * (0.7 + L.r * 1.3);
      ctx.shadowColor = 'rgba(0, 20, 40, 0.5)'; // a dark edge keeps them visible against a bright sky
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.moveTo(cx + ca * r0, cy + sa * r0);
      ctx.lineTo(cx + ca * (r0 + len), cy + sa * (r0 + len));
      ctx.stroke();
    }
  }
}
