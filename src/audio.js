import { Radio } from './music.js';

// Synthesised sound: EV motor whine, tyre squeal, suction fans and thrusters,
// plus the radio. No audio files needed.
export class CarAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.radio = new Radio();
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(ctx.destination);
    this.radio.setVolume(0.7);
    this.radio.attach(ctx, this.master);
    if (this.radio.station >= 0) this.radio.play(this.radio.station);

    // Motor: two detuned oscillators through a lowpass.
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sine';
    this.osc1.connect(lp);
    this.osc2.connect(lp);
    lp.connect(this.motorGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Shared noise source for tyres and thrusters.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    noise.start();

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 2.5;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    noise.connect(bp).connect(this.tyreGain).connect(this.master);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    noise.connect(hp).connect(this.thrustGain).connect(this.master);

    // Rain: soft, low-passed noise.
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 1400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = this.raining ? 0.09 : 0;
    noise.connect(lp2).connect(this.rainGain).connect(this.master);
    this.noiseBuf = buf;

    // Suction fans: a high whine.
    this.fan = ctx.createOscillator();
    this.fan.type = 'triangle';
    this.fan.frequency.value = 620;
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    this.fan.connect(this.fanGain).connect(this.master);
    this.fan.start();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
    return this.enabled;
  }

  setRain(on) {
    this.raining = on;
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, 0.5);
  }

  // Distant thunder: a low rumble that swells and fades.
  thunder(delay = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 2.7);
  }

  // Bright two-note chime for rings and bonuses.
  chime(step = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [0, 7].forEach((semi, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 880 * Math.pow(2, (semi + step) / 12);
      g.gain.setValueAtTime(0.0001, t + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.5);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.55);
    });
  }

  // Two-tone car horn.
  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.setValueAtTime(0.22, t + 0.38);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.46);
    }
    lp.connect(g).connect(this.master);
  }

  // A short thump for landings and hits.
  thump(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    g.gain.setValueAtTime(Math.min(0.6, 0.15 + strength * 0.04), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.45);
  }

  update(vehicle, input) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const spd = vehicle.speed;
    const f = 70 + spd * 9;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
    const load = input.throttle ? 0.11 : 0.05;
    const motorOn = (vehicle.state === 'ground' || vehicle.state === 'ramp') && (spd > 0.5 || input.throttle);
    this.motorGain.gain.setTargetAtTime(motorOn ? load + Math.min(spd, 80) * 0.0008 : 0, t, 0.1);
    const squeal = vehicle.state === 'ground' && spd > 6 ? Math.min(1, Math.max(0, (vehicle.drift - 8) / 25)) : 0;
    this.tyreGain.gain.setTargetAtTime(squeal * 0.12, t, 0.06);
    this.thrustGain.gain.setTargetAtTime(Math.max(vehicle.thrust, vehicle.rearThrust * 0.8) * 0.35, t, 0.03);
    const fans = vehicle.state === 'ramp';
    this.fanGain.gain.setTargetAtTime(fans ? 0.05 : 0, t, 0.15);
    this.fan.frequency.setTargetAtTime(fans ? 620 + spd * 6 : 400, t, 0.2);
  }
}
