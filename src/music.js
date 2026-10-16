// In-car radio: three stations of original, procedurally generated music.
// Everything is synthesised with WebAudio, so there are no audio files and no
// licensing to worry about. A small step sequencer schedules notes ~120 ms ahead.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const STATIONS = [
  { name: 'WAVE 103.5', genre: 'Synthwave', bpm: 100 },
  { name: 'PALM FM', genre: 'Chill', bpm: 80 },
  { name: 'NEON 122', genre: 'House', bpm: 122 },
];

export class Radio {
  constructor() {
    this.ctx = null;
    this.station = -1; // -1 = off
    this.volume = 0.32;
  }

  // Called once the AudioContext exists (after the first click).
  attach(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(destination);

    // Shared effects: a plate-ish reverb and a dotted-eighth delay.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 2.6, 2.8);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.45;
    this.reverb.connect(revGain).connect(this.out);

    this.delay = ctx.createDelay(1);
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.3;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(delayOut).connect(this.out);

    this.noise = noiseBuffer(ctx);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  // Next station, wrapping through "off". Returns the new station or null for off.
  next() {
    const n = this.station + 1 >= STATIONS.length ? -1 : this.station + 1;
    this.play(n);
    return n >= 0 ? STATIONS[n] : null;
  }

  play(index) {
    if (!this.ctx) { this.station = index; return; }
    // Fade the old station's bus and start a fresh one.
    if (this.bus) {
      const old = this.bus;
      old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      setTimeout(() => old.disconnect(), 1500);
    }
    this.station = index;
    if (index < 0) { this.bus = null; return; }
    this.bus = this.ctx.createGain();
    this.bus.connect(this.out);
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.motif = makeMotif(index);
    if (index === 1) this.startCrackle();
  }

  schedule() {
    if (!this.ctx || this.station < 0 || !this.bus) return;
    const st = STATIONS[this.station];
    const sixteenth = 60 / st.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      let t = this.nextTime;
      // Lo-fi swing: push the off-beat sixteenths late.
      if (this.station === 1 && this.step % 2 === 1) t += sixteenth * 0.3;
      [this.synthwave, this.chill, this.house][this.station].call(this, this.step, this.bar, t, sixteenth);
      this.nextTime += sixteenth;
      this.step++;
      if (this.step === 16) {
        this.step = 0;
        this.bar++;
        if (this.bar % 8 === 0) this.motif = makeMotif(this.station);
      }
    }
  }

  // ---------------- stations ----------------

  synthwave(s, bar, t, q) {
    // Am - F - C - G
    const roots = [45, 41, 48, 43], quals = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
    const ch = bar % 4, root = roots[ch], chord = quals[ch];
    if (s % 8 === 0) this.kick(t, 1);
    if (s === 4 || s === 12) this.snare(t, 0.55, true);
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.09 : 0.05, 0.04);
    if (s % 2 === 0) this.bass(t, midi(root + (s % 4 === 2 ? 12 : 0)), q * 1.8, 0.32, 'sawtooth', 520);
    if (s === 0) this.pad(t, chord.map((i) => midi(root + 24 + i)), q * 16, 0.07);
    const arp = [0, 1, 2, 1];
    this.pluck(t, midi(root + 36 + chord[arp[s % 4]] + (s >= 8 ? 12 : 0)), q * 0.9, 0.05, 'square', 2600, true);
    if (bar % 8 >= 4) this.melody(s, t, q, 69, 'sawtooth', 0.07);
  }

  chill(s, bar, t, q) {
    // Dm9 - G13 - Cmaj9 - Am7
    const chords = [[50, [0, 3, 7, 10, 14]], [43, [0, 4, 10, 14, 21]], [48, [0, 4, 7, 11, 14]], [45, [0, 3, 7, 10, 15]]];
    const [root, ivs] = chords[bar % 4];
    if (s === 0 || s === 10) this.kick(t, 0.7);
    if (s === 4 || s === 12) this.snare(t, 0.3, true);
    if (s % 2 === 0) this.hat(t, 0.035, 0.03);
    if (s === 0 || s === 7) this.ep(t, ivs.map((i) => midi(root + 12 + i)), q * (s === 0 ? 7 : 8), 0.07);
    if (s === 0 || s === 8 || s === 11) this.bass(t, midi(root - (s === 11 ? 5 : 0)), q * 3, 0.38, 'sine', 400);
    if (bar % 8 >= 4) this.melody(s, t, q, 74, 'triangle', 0.06);
  }

  house(s, bar, t, q) {
    // Fm7 - Ebmaj7 - Dbmaj7 - Cm7
    const chords = [[41, [0, 3, 7, 10]], [39, [0, 4, 7, 11]], [37, [0, 4, 7, 11]], [36, [0, 3, 7, 10]]];
    const [root, ivs] = chords[bar % 4];
    if (s % 4 === 0) this.kick(t, 1);
    if (s === 4 || s === 12) this.clap(t, 0.4);
    if (s % 4 === 2) this.hat(t, 0.09, 0.18);
    else if (s % 2 === 1) this.hat(t, 0.03, 0.03);
    if (s % 4 === 2) this.bass(t, midi(root + 12), q * 1.5, 0.35, 'square', 700);
    if (s === 3 || s === 6 || s === 11) this.stab(t, ivs.map((i) => midi(root + 24 + i)), q * 1.2, 0.06);
    if (bar % 8 >= 4) this.melody(s, t, q, 72, 'square', 0.04);
  }

  melody(s, t, q, base, type, gain) {
    const n = this.motif[s];
    if (n !== null) this.pluck(t, midi(base + n), q * 2.2, gain, type, 3200, true);
  }

  // ---------------- instruments ----------------

  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  osc(type, f, t, stop) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.start(t);
    o.stop(stop);
    return o;
  }

  kick(t, v) {
    const o = this.osc('sine', 150, t, t + 0.4), g = this.ctx.createGain();
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.002, 0.9 * v, 0.35);
    o.connect(g).connect(this.bus);
  }

  noiseHit(t, filterType, freq, peak, dur, toReverb) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, 0.001, peak, dur);
    src.connect(f).connect(g).connect(this.bus);
    if (toReverb) g.connect(this.reverb);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  snare(t, v, verb) {
    this.noiseHit(t, 'highpass', 1400, 0.5 * v, 0.2, verb);
    const o = this.osc('triangle', 190, t, t + 0.12), g = this.ctx.createGain();
    this.env(g, t, 0.001, 0.35 * v, 0.1);
    o.connect(g).connect(this.bus);
  }

  clap(t, v) {
    for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.012, 'bandpass', 1500, 0.5 * v, 0.09 + i * 0.03, i === 2);
  }

  hat(t, v, dur) { this.noiseHit(t, 'highpass', 7500, v, dur, false); }

  bass(t, f, dur, v, type, cutoff) {
    const o = this.osc(type, f, t, t + dur + 0.05), lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 2, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.6, t + dur);
    this.env(g, t, 0.005, v, dur);
    o.connect(lp).connect(g).connect(this.bus);
  }

  pluck(t, f, dur, v, type, cutoff, echo) {
    const o = this.osc(type, f, t, t + dur + 0.05), lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + dur);
    this.env(g, t, 0.004, v, dur);
    o.connect(lp).connect(g).connect(this.bus);
    if (echo) { g.connect(this.delay); this.delay.delayTime.value = (60 / STATIONS[this.station].bpm) * 0.75; }
  }

  pad(t, freqs, dur, v) {
    const lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.5);
    g.gain.setValueAtTime(v, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    for (const f of freqs) for (const det of [-7, 7]) {
      const o = this.osc('sawtooth', f, t, t + dur + 0.7);
      o.detune.value = det;
      o.connect(lp);
    }
    lp.connect(g).connect(this.bus);
    g.connect(this.reverb);
  }

  ep(t, freqs, dur, v) {
    // Electric-piano-ish: sine + quiet octave, quick attack, long decay.
    const g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    this.env(g, t, 0.01, v, dur);
    for (const f of freqs) {
      this.osc('sine', f, t, t + dur + 0.1).connect(lp);
      const o2 = this.osc('triangle', f * 2, t, t + dur + 0.1), g2 = this.ctx.createGain();
      g2.gain.value = 0.15;
      o2.connect(g2).connect(lp);
    }
    lp.connect(g).connect(this.bus);
    g.connect(this.reverb);
  }

  stab(t, freqs, dur, v) {
    const g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + dur);
    this.env(g, t, 0.003, v, dur);
    for (const f of freqs) this.osc('sawtooth', f, t, t + dur + 0.05).connect(lp);
    lp.connect(g).connect(this.bus);
    g.connect(this.reverb);
  }

  startCrackle() {
    // Vinyl crackle for the chill station: sparse clicks in looped noise.
    const ctx = this.ctx, len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.015;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(g).connect(this.bus);
    src.start();
  }
}

// A one-bar melody (16 steps) on a pentatonic scale; null = rest.
function makeMotif(station) {
  const scales = [[0, 3, 5, 7, 10, 12], [0, 2, 3, 7, 9, 12], [0, 3, 5, 7, 10, 12]];
  const scale = scales[station] || scales[0];
  const density = [0.38, 0.25, 0.3][station] || 0.3;
  const m = [];
  let last = 2;
  for (let i = 0; i < 16; i++) {
    if (Math.random() < density || i === 0) {
      last = Math.max(0, Math.min(scale.length - 1, last + Math.floor(Math.random() * 3) - 1));
      m.push(scale[last]);
    } else m.push(null);
  }
  return m;
}

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function impulse(ctx, seconds, decay) {
  const len = ctx.sampleRate * seconds, buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
