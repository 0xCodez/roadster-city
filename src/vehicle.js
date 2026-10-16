import * as THREE from 'three';
import { DIM } from './car.js';

// Arcade vehicle with these states:
//  ground  — point mass with heading, separate forward/lateral velocity, drift,
//            burnouts, rear-thrust boost and a thruster hop
//  ramp    — locked to the curved wall's path, held on by the suction fans
//  air     — ballistic with full attitude control: W/S flip, A/D roll, Q/E spin;
//            the lift thrusters brake the fall, the rear ones push forward, and
//            the car levels itself when you let go of the controls
//  fly     — Rocket mode: hover and fly on the thrusters until the air runs out
//  crashed — landed on the roof or side: tumble, then the thrusters right the car

const MODES = {
  road: { accel: 15, top: 86, grip: 7.5, steer: 0.55, brake: 30 },
  track: { accel: 18, top: 102, grip: 10.5, steer: 0.6, brake: 36 },
  rocket: { accel: 26, top: 103, grip: 11, steer: 0.6, brake: 38 }, // rear thrusters help: 0-100 in ~1 s
};

// Rocket-mode flight.
const FLY_ACCEL = 16; // m/s², rear thrusters
const FLY_DRAG = 16 / (70 * 70); // top speed ~70 m/s (250 km/h) in the air
const FLY_CLIMB = 9; // m/s while holding lift
const FLY_SINK = 2.5; // m/s with lift released: a gentle settle, safe to land
const FLY_DESCEND = 9; // m/s while holding descend
const LIFT_G = 2.2; // corner thrusters, max upward
const CEILING = 140; // m
const AIR_LIFT = 380; // psi/s at full lift (hover is ~45%)
const AIR_FWD = 160; // psi/s at full forward thrust
const AIR_STATION = 2500; // psi/s on an air station pad
const AIR_TAKEOFF_MIN = 400; // psi needed to lift off, so an empty tank can't hop

const G = 9.81;
const MASS = 1700; // kg, for the telemetry readout
const FAN_G = 2; // suction fans, as claimed at the reveal
const RAMP_TRACTION = 0.2; // share of engine force usable on the wall: you need ~90 km/h of momentum
const RAMP_VMAX = 48; // m/s, fans and grip limit on the wall
const THRUST_G = 3.3; // corner thrusters, peak upward braking (reveal telemetry)
const SINK_TARGET = -3; // m/s, descent rate the thrusters hold
const RAMP_ENTRY_MAX = 50; // m/s, entry speed the wall accepts
const AIR_MAX = 5500; // psi
const AIR_USE = 1400; // psi per second at full thrust
const AIR_REFILL = 900; // psi per second on the ground (onboard compressor), not while boosting
const KICK_MIN_SPEED = 16.7; // m/s (60 km/h) needed on the launch line
const KICK_MAX_SPEED = 30; // m/s, thrusters trim anything faster so you land on the pad
const KICK_VY = 10.5; // m/s upward at the end of the boost: ~7 m apex, as at the reveal
const KICK_BOOST_T = 0.3; // s of full thrust at launch
const KICK_ROLL_RATE = 3.4; // rad/s, the assisted roll: one full turn in a normal jump

// Thrusters in every mode.
const HOP_VY = 8.2; // m/s, tap lift on the ground: a ~3.4 m hop
const HOP_AIR = 330; // psi per hop
const LIFT_VY = 2.5; // m/s, holding lift in the air climbs gently (it brakes any fall first)
const BOOST_BASE = 6.5; // m/s², rear thrust at speed
const BOOST_LAUNCH = 19.5; // extra m/s² from a standstill, gone by 40 m/s: 0-100 km/h in under 1 s
const BOOST_TOP = 105; // m/s, rear thrust stops adding speed here (~380 km/h)
const BOOST_USE = 825; // psi/s
const AIR_BOOST = 9; // m/s², rear thrust in the air
const RCS_USE = 165; // psi/s while steering in the air

// Attitude control in the air (rad/s at full input).
const PITCH_RATE = 5.4;
const YAW_RATE = 4.4;
const ROLL_RATE = 7.6;
const LEVEL_DELAY = 0.3; // s without input before the car levels itself
const TRICK_SLACK = 0.55; // rad short of a full turn that still counts
const CRASH_T = 1.35; // s of tumbling before the thrusters right the car
const RECOVER_T = 0.6; // s to right it
const CRASH_TILT = 55; // degrees: land more tilted than this and you crash

const TAU = Math.PI * 2;
const BODY_CIRCLES = [1.25, 0, -1.25];
const BODY_R = 1.0;
const UP = new THREE.Vector3(0, 1, 0);
// Body corners and wheels (car space), for ground contact while tumbling.
const HULL = [];
for (const x of [-0.92, 0.92]) for (const z of [-2.15, 2.15]) for (const y of [0.15, 1.05]) HULL.push(new THREE.Vector3(x, y, z));
HULL.push(new THREE.Vector3(0, 1.15, -0.2));

export class Vehicle {
  constructor(world, start) {
    this.world = world;
    this.start = start;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.mode = 'track';
    this.events = [];
    this._sample = { pos: new THREE.Vector3(), T: new THREE.Vector3(), N: new THREE.Vector3(), theta: 0 };
    this._m = new THREE.Matrix4();
    this._dq = new THREE.Quaternion();
    this._lvl = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.reset();
  }

  reset(at = this.start) {
    this.pos.set(at.x, 0, at.z);
    this.vel.set(0, 0, 0);
    this.yaw = at.yaw;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.accelLong = 0;
    this.accelLat = 0;
    this.braking = false;
    this.impact = 0;
    this.drift = 0;
    this.state = 'ground';
    this.air = AIR_MAX;
    this.thrust = 0;
    this.pitchDeg = 0;
    this.downforce = 0;
    this.wheelSpeed = 0;
    this.airTime = 0;
    this.stunt = null; // 'wall' | 'kickflip' while a stunt is in progress
    this.boost = 0;
    this.rollDir = 1;
    this.angVel = new THREE.Vector3(); // car space: x pitch, y yaw, z roll
    this.rot = { roll: 0, pitch: 0, yaw: 0 }; // turns made in this jump, for trick callouts
    this.tricksCalled = { roll: 0, pitch: 0, yaw: 0 };
    this.lastInputT = 0;
    this.burnout = 0;
    this.boosting = false;
    this.susp = 0; // suspension compression (m), a spring for the landing bounce
    this.suspV = 0;
    this.crashT = 0;
    this.recoverT = 0;
    this.rearThrust = 0;
    this.flyPitch = 0;
    this.flyRoll = 0;
    this.atStation = false;
    this.lowAirWarned = false;
    this.pos.y = this.world.groundHeight(this.pos.x, this.pos.z);
    this.quat.setFromAxisAngle(UP, this.yaw);
  }

  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get right() { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }
  get up() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat); }
  get nose() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat); }
  get speed() { return this.vel.length(); }
  get alt() { return this.pos.y; }
  get airFrac() { return this.air / AIR_MAX; }
  get gForce() { return Math.hypot(this.accelLong, this.accelLat) / G; }

  step(dt, input) {
    if (this.state === 'ramp') this.stepRamp(dt, input);
    else if (this.state === 'air') this.stepAir(dt, input);
    else if (this.state === 'fly') this.stepFly(dt, input);
    else if (this.state === 'crashed') this.stepCrashed(dt);
    else this.stepGround(dt, input);
    // Suspension spring (visual only).
    this.suspV += (-180 * this.susp - 16 * this.suspV) * dt;
    this.susp += this.suspV * dt;
  }

  // Leave the ground: start a fresh jump for the trick counter.
  enterAir() {
    this.state = 'air';
    this.airTime = 0;
    this.rot = { roll: 0, pitch: 0, yaw: 0 };
    this.tricksCalled = { roll: 0, pitch: 0, yaw: 0 };
    this.angVel.set(0, this.yawRate * 0.8, 0); // a spinning car keeps spinning
    this.lastInputT = 0;
    this.thrust = 0;
  }

  // ---------------- ground ----------------
  stepGround(dt, input) {
    const rocket = this.mode === 'rocket';
    if (rocket && input.lift && this.air > AIR_TAKEOFF_MIN) {
      // Lift-off: in Rocket mode holding lift takes off and flies.
      this.takeOff();
      this.stepFly(dt, input);
      return;
    }
    const P = MODES[this.mode];
    const f = this.forward, r = this.right;
    let vF = this.vel.dot(f);
    let vR = this.vel.dot(r);

    // Burnout: throttle and brake together at a standstill spins the rear tyres.
    const burn = input.throttle > 0.5 && input.brake > 0.5 && Math.abs(vF) < 4;
    this.burnout = THREE.MathUtils.clamp(this.burnout + (burn ? 3 : -3) * dt, 0, 1);

    let a = 0;
    this.braking = false;
    this.boosting = false;
    if (burn) {
      vF *= Math.exp(-6 * dt);
    } else {
      if (input.throttle > 0) {
        if (vF < -0.5) { a += P.brake * input.throttle; this.braking = true; }
        else a += P.accel * (this.world.wet ? 0.85 : 1) * input.throttle * Math.max(0, 1 - (vF / P.top) ** 2);
      }
      if (input.brake > 0) {
        if (vF > 0.5) { a -= P.brake * input.brake; this.braking = true; }
        else if (vF > -16) a -= 9 * input.brake;
      }
      // Rear thrusters: brutal off the line, still a push at speed.
      if (input.boost && this.air > 50 && vF > -1) {
        a += (BOOST_BASE + BOOST_LAUNCH * Math.max(0, 1 - Math.abs(vF) / 40)) * THREE.MathUtils.clamp((BOOST_TOP - vF) / 10, 0, 1);
        this.air = Math.max(0, this.air - BOOST_USE * dt);
        this.boosting = true;
      }
    }
    a -= Math.sign(vF) * (0.5 + 0.00032 * vF * vF);
    const before = vF;
    vF += a * dt;
    if (Math.sign(before) !== Math.sign(vF) && !input.throttle && !input.brake) vF = 0;
    if (!input.throttle && !input.brake && !this.boosting && Math.abs(vF) < 0.3) vF = 0;

    // Wet roads: less grip, so the tail steps out sooner.
    const wet = this.world.wet ? 0.7 : 1;
    const grip = (input.drift ? 1.3 : P.grip) * wet;
    vR *= Math.exp(-grip * dt);
    if (input.drift) vF *= Math.exp(-0.5 * dt);

    const spd = Math.abs(vF);
    this.steerAngle = input.steer * P.steer / (1 + spd / 20);
    let targetYaw = (vF * Math.tan(this.steerAngle)) / DIM.wheelBase;
    if (input.drift && spd > 5) targetYaw *= 1.6;
    if (burn) targetYaw = input.steer * 2.2; // pivot on the front wheels
    const yawResp = input.drift ? 5 : 9;
    this.yawRate += (targetYaw - this.yawRate) * (1 - Math.exp(-yawResp * dt));
    this.yaw += this.yawRate * dt;

    this.vel.set(f.x * vF + r.x * vR, 0, f.z * vF + r.z * vR);
    const prevX = this.pos.x;
    this.pos.addScaledVector(this.vel, dt);

    this.collide();

    // Drove off a roof edge: fall.
    const h = this.world.groundHeight(this.pos.x, this.pos.z);
    if (h < this.pos.y - 0.3) {
      this.enterAir();
      this.stunt = null;
      this.vel.y = 0;
    } else {
      if (h > this.pos.y + 0.01) this.susp -= (h - this.pos.y) * 0.6; // kerb bump
      this.pos.y = h;
    }

    this.accelLong = a;
    this.accelLat = vF * this.yawRate;
    this.wheelSpeed = burn ? 40 * this.burnout : vF;
    this.drift = spd > 4 ? THREE.MathUtils.radToDeg(Math.atan2(Math.abs(vR), spd)) : 0;
    this.thrust = 0;
    this.rearThrust = this.boosting ? 1 : rocket && input.throttle && vF > 0 && vF < P.top ? input.throttle : 0;
    this.pitchDeg = 0;
    this.downforce = this.mode === 'road' ? 0.5 * vF * vF : MASS * 0.35 + 0.9 * vF * vF;
    if (!this.boosting) this.refill(dt);
    this.quat.setFromAxisAngle(UP, this.yaw);

    if (this.state !== 'ground') return;
    this.tryEnterRamp(vF);
    if (this.state === 'ground') this.tryLaunch(prevX);
    // Tap lift: the corner thrusters pop the car into the air.
    if (this.state === 'ground' && !rocket && input.liftPressed && this.air > AIR_TAKEOFF_MIN) {
      this.enterAir();
      this.stunt = null;
      this.vel.y = HOP_VY;
      this.air -= HOP_AIR;
      this.events.push({ type: 'hop' });
    }
  }

  // Onboard compressor everywhere on the ground, fast on an air station pad.
  refill(dt) {
    let rate = AIR_REFILL, at = false;
    for (const s of this.world.airStations || []) {
      if ((this.pos.x - s.x) ** 2 + (this.pos.z - s.z) ** 2 < s.r * s.r && this.pos.y < 0.5) { rate = AIR_STATION; at = true; }
    }
    if (at && !this.atStation && this.air < AIR_MAX - 1) this.events.push({ type: 'refill' });
    this.atStation = at;
    this.air = Math.min(AIR_MAX, this.air + rate * dt);
    if (this.air > AIR_MAX * 0.3) this.lowAirWarned = false;
  }

  takeOff() {
    this.state = 'fly';
    this.stunt = null;
    this.airTime = 0;
    this.vel.y = Math.max(this.vel.y, 1);
    this.flyPitch = this.flyRoll = 0;
    this.events.push({ type: 'takeoff' });
  }

  // ---------------- fly (Rocket mode) ----------------
  stepFly(dt, input) {
    this.airTime += dt;
    if (this.air <= 0) {
      // Out of air: the thrusters cut and the car falls.
      this.enterAir();
      this.thrust = this.rearThrust = 0;
      this.events.push({ type: 'airout' });
      return;
    }
    const f = this.forward, r = this.right;

    // Vertical: hold lift to climb, release to settle gently, descend to drop faster.
    let vyT = input.lift ? FLY_CLIMB : input.descend ? -FLY_DESCEND : -FLY_SINK;
    if (this.pos.y > CEILING - 15) vyT = Math.min(vyT, (CEILING - this.pos.y) * 0.6);
    const lift = THREE.MathUtils.clamp(G + 4 * (vyT - this.vel.y), 0, LIFT_G * G);
    this.thrust = lift / (LIFT_G * G);
    const ay = lift - G;

    // Horizontal: rear thrusters push along the heading, the car slides a little.
    let vF = this.vel.dot(f), vR = this.vel.dot(r);
    const push = input.throttle - input.brake * 0.7 + (input.boost ? 1 : 0); // Shift: rear boost
    const aF = push * FLY_ACCEL - FLY_DRAG * vF * Math.abs(vF) - (push === 0 ? vF * 0.25 : 0);
    vF += aF * dt;
    vR *= Math.exp(-1.6 * dt);
    this.rearThrust = Math.max(0, push);

    const targetYaw = input.steer * 1.5 / (1 + Math.abs(vF) / 60);
    this.yawRate += (targetYaw - this.yawRate) * (1 - Math.exp(-4 * dt));
    this.yaw += this.yawRate * dt;

    this.vel.set(f.x * vF + r.x * vR, this.vel.y + ay * dt, f.z * vF + r.z * vR);
    this.pos.addScaledVector(this.vel, dt);
    // Touching down on a roof comes before wall collisions, or the walls would push the car off it.
    const groundH = this.world.groundHeight(this.pos.x, this.pos.z);
    if (!(this.pos.y <= groundH && this.vel.y <= 0)) this.collide(true);

    this.air = Math.max(0, this.air - (this.thrust * AIR_LIFT + Math.abs(push) * AIR_FWD) * dt);
    if (this.air < AIR_MAX * 0.2 && !this.lowAirWarned) {
      this.lowAirWarned = true;
      this.events.push({ type: 'lowair' });
    }

    // Bank into turns, dip the nose under thrust.
    const k = 1 - Math.exp(-dt * 4);
    this.flyRoll += (THREE.MathUtils.clamp(-this.yawRate * vF * 0.025, -0.45, 0.45) - this.flyRoll) * k;
    this.flyPitch += (THREE.MathUtils.clamp(aF * 0.015, -0.22, 0.22) - this.flyPitch) * k;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.flyPitch, 0, this.flyRoll, 'YXZ'));
    this.quat.setFromAxisAngle(UP, this.yaw).multiply(tilt);

    this.accelLong = aF;
    this.accelLat = vF * this.yawRate;
    this.wheelSpeed *= Math.exp(-dt * 0.5);
    this.steerAngle = 0;
    this.braking = false;
    this.drift = 0;
    this.downforce = 0;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quat);
    this.pitchDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));

    const h = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= h && this.vel.y <= 0) {
      if (this.airTime > 1.5) {
        this.stunt = 'flight';
        this.land(h, new THREE.Vector3(0, 1, 0));
      } else {
        this.pos.y = h;
        this.vel.y = 0;
        this.state = 'ground';
      }
      this.thrust = this.rearThrust = 0;
    }
  }

  // Crossing a kickflip launch line toward the row fires the thrusters.
  tryLaunch(prevX) {
    const k = this.world.kickflip;
    if (!k || Math.abs(this.pos.z - k.row.z) > k.laneHalf) return;
    for (const L of k.lines) {
      const crossed = L.dir > 0 ? prevX < L.x && this.pos.x >= L.x : prevX > L.x && this.pos.x <= L.x;
      if (!crossed) continue;
      const along = this.vel.x * L.dir;
      const headingOk = Math.sin(this.yaw) * L.dir > Math.cos(THREE.MathUtils.degToRad(35));
      if (along <= 0 || !headingOk) return;
      if (along < KICK_MIN_SPEED) { this.events.push({ type: 'nolaunch' }); return; }
      const h = Math.hypot(this.vel.x, this.vel.z);
      if (h > KICK_MAX_SPEED) this.vel.multiplyScalar(KICK_MAX_SPEED / h);
      this.yawRate = 0;
      this.enterAir();
      this.stunt = 'kickflip';
      this.boost = KICK_BOOST_T;
      this.rollDir = 1;
      this.events.push({ type: 'launch' });
      return;
    }
  }

  tryEnterRamp(vF) {
    const ramp = this.world.ramp;
    if (!ramp) return;
    const { u, lat } = ramp.local(this.pos);
    if (u < -ramp.L0 - 0.5 || u > -ramp.L0 + 2.5 || Math.abs(lat) > ramp.width / 2 - 0.7) return;
    const along = this.vel.x * ramp.d.x + this.vel.z * ramp.d.z;
    let dy = this.yaw - ramp.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (along < 3 || Math.abs(dy) > THREE.MathUtils.degToRad(30) || vF < 0) return;
    this.state = 'ramp';
    this.stunt = 'wall';
    this.rampS = Math.max(0, u + ramp.L0);
    // The fans scrub off excess speed at the foot of the wall.
    this.rampV = Math.min(along, RAMP_ENTRY_MAX);
    this.rampLat = lat;
    this.yaw = ramp.yaw;
    this.yawRate = 0;
    this.drift = 0;
    this.events.push({ type: 'fans' });
  }

  // ---------------- ramp ----------------
  stepRamp(dt, input) {
    const P = MODES[this.mode];
    const ramp = this.world.ramp;
    const s0 = ramp.sample(this.rampS, this._sample);
    const th = s0.theta;

    let a = -G * Math.sin(th);
    this.braking = false;
    if (input.throttle > 0) a += P.accel * RAMP_TRACTION * input.throttle;
    if (input.brake > 0 && this.rampV > 0) { a -= P.brake * 0.5 * input.brake; this.braking = true; }
    if (this.rampV > RAMP_VMAX) a -= (this.rampV - RAMP_VMAX) * 3;
    this.rampV += a * dt;
    this.rampS += this.rampV * dt;

    const latLimit = ramp.width / 2 - 1.1;
    this.rampLat = THREE.MathUtils.clamp(this.rampLat + input.steer * Math.min(Math.abs(this.rampV), 20) * 0.22 * dt, -latLimit, latLimit);
    this.steerAngle = input.steer * 0.15;

    if (this.rampS < 0) {
      // Rolled back off the bottom.
      this.state = 'ground';
      this.stunt = null;
      this.vel.copy(ramp.d).multiplyScalar(this.rampV);
      this.events.push({ type: 'slipped' });
      return;
    }

    const s = ramp.sample(Math.min(this.rampS, ramp.length), this._sample);
    this.pos.copy(s.pos).addScaledVector(ramp.l, this.rampLat);
    this.vel.copy(s.T).multiplyScalar(this.rampV);
    const left = new THREE.Vector3().crossVectors(s.N, s.T);
    this._m.makeBasis(left, s.N, s.T);
    this.quat.setFromRotationMatrix(this._m);

    this.accelLong = a;
    this.accelLat = this.rampV * this.rampV / ramp.R;
    this.wheelSpeed = this.rampV;
    this.pitchDeg = THREE.MathUtils.radToDeg(s.theta);
    // Fan suction plus aero, in kg, as on the reveal's telemetry (~4 700 kg at the top).
    this.downforce = MASS * FAN_G + 3 * this.rampV * this.rampV;
    this.thrust = 0;

    if (this.rampS >= ramp.length) {
      // Top of the wall: let go.
      this.yawRate = 0;
      this.enterAir();
      this.events.push({ type: 'release' });
    }
  }

  // ---------------- air ----------------
  stepAir(dt, input) {
    this.airTime += dt;
    // In Rocket mode you can catch a fall (or a wall release) on the thrusters.
    if (this.mode === 'rocket' && input.lift && this.air > AIR_TAKEOFF_MIN && this.stunt !== 'kickflip') {
      this.state = 'fly';
      this.stunt = null;
      this.flyPitch = this.flyRoll = 0;
      this.stepFly(dt, input);
      return;
    }
    const up = this.up, nose = this.nose;
    const acc = new THREE.Vector3(0, -G, 0);

    // Lift thrusters (Space) push along the car's up axis: they brake a fall hard
    // (up to 3.3 G, as at the reveal), then climb gently. Upside down they push you down.
    let level = 0;
    if (input.lift && this.air > 0) {
      level = up.y > 0.25 ? THREE.MathUtils.clamp((G + 6 * (LIFT_VY - this.vel.y)) / (up.y * THRUST_G * G), 0, 1) : 0.5;
    }
    this.thrust += (level - this.thrust) * (1 - Math.exp(-dt * 14));
    if (this.boost > 0) {
      // Kickflip launch: a short full-power burst straight up.
      this.boost -= dt;
      this.thrust = this.boost > 0 ? 1 : 0; // cut cleanly so the apex stays ~7 m
      acc.y += KICK_VY / KICK_BOOST_T + G;
      this.air = Math.max(0, this.air - AIR_USE * dt);
    } else if (this.thrust > 0.01) {
      acc.addScaledVector(up, THRUST_G * G * this.thrust);
      this.air = Math.max(0, this.air - AIR_USE * this.thrust * dt);
    }
    // Rear thrusters (Shift) push along the nose.
    this.rearThrust = 0;
    if (input.boost && this.air > 0) {
      acc.addScaledVector(nose, AIR_BOOST);
      this.air = Math.max(0, this.air - BOOST_USE * dt);
      this.rearThrust = 1;
    }
    const vyBefore = this.vel.y;
    this.vel.addScaledVector(acc, dt);
    if (this.stunt === 'kickflip' && vyBefore > 0 && this.vel.y <= 0) this.events.push({ type: 'apex' });
    // Light air drag. The wall stunt keeps its stronger braking so you come down near
    // the run-up, and braking thrust bleeds some horizontal speed.
    const wall = this.stunt === 'wall', kick = this.stunt === 'kickflip';
    const thrustDrag = this.boost > 0 ? 0 : this.thrust * (kick ? 0.3 : wall ? 0.6 : 0.15);
    const hDamp = Math.exp(-((wall ? 0.25 : 0.05) + thrustDrag) * dt);
    this.vel.x *= hDamp;
    this.vel.z *= hDamp;
    this.pos.addScaledVector(this.vel, dt);
    const groundH = this.world.groundHeight(this.pos.x, this.pos.z);
    if (!(this.pos.y <= groundH && this.vel.y <= 0)) this.collide(true);

    this.attitude(dt, input);

    this.accelLong = acc.dot(nose) + G * nose.y;
    this.accelLat = 0;
    this.wheelSpeed *= Math.exp(-dt * 0.5);
    this.steerAngle = 0;
    this.braking = false;
    const upNow = this.up;
    this.pitchDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(upNow.y, -1, 1)));
    this.downforce = 0;

    const h = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= h && this.vel.y <= 0 && this.airTime > 0.15) this.land(h, upNow);
  }

  // Attitude thrusters: W/S pitch (front/back flip), A/D roll (kickflip), Q/E spin.
  // After a kickflip launch the car finishes its roll on its own. With no input
  // for a moment it levels itself, keeping its heading.
  attitude(dt, input) {
    const target = new THREE.Vector3(
      (input.throttle - input.brake) * PITCH_RATE,
      (input.yaw || 0) * YAW_RATE,
      -input.steer * ROLL_RATE,
    );
    let active = target.lengthSq() > 1e-4;
    if (active) this.air = Math.max(0, this.air - RCS_USE * dt);
    if (this.stunt === 'kickflip' && Math.abs(input.steer) < 0.05) {
      // Assisted roll: complete the current turn.
      const r = Math.abs(this.rot.roll);
      const left = Math.max(1, Math.ceil((r - 0.6) / TAU)) * TAU - r;
      if (left > 0.03) {
        target.z = (Math.sign(this.rot.roll) || this.rollDir) * Math.min(KICK_ROLL_RATE, 0.6 + left * 5);
        active = true;
      }
    }
    this.lastInputT = active ? 0 : this.lastInputT + dt;
    for (const k of ['x', 'y', 'z']) {
      const rate = Math.abs(target[k]) > 0.01 ? 7.5 : 2.2;
      this.angVel[k] += (target[k] - this.angVel[k]) * Math.min(1, dt * rate);
    }
    const w = this.angVel.length();
    if (w > 1e-6) {
      this._dq.setFromAxisAngle(this._axis.copy(this.angVel).divideScalar(w), w * dt);
      this.quat.multiply(this._dq).normalize();
    }
    this.rot.pitch += this.angVel.x * dt;
    this.rot.yaw += this.angVel.y * dt;
    this.rot.roll += this.angVel.z * dt;
    for (const axis of ['roll', 'pitch', 'yaw']) {
      const n = Math.floor((Math.abs(this.rot[axis]) + TRICK_SLACK) / TAU);
      if (n > this.tricksCalled[axis]) {
        this.tricksCalled[axis] = n;
        this.events.push({ type: 'trick', axis, count: n, sign: Math.sign(this.rot[axis]) });
      }
    }
    // Heading follows the nose while it points roughly sideways.
    const fwd = this.nose;
    fwd.y = 0;
    if (fwd.lengthSq() > 0.09) this.yaw = Math.atan2(fwd.x, fwd.z);
    if (this.lastInputT > LEVEL_DELAY) {
      const upY = this.up.y;
      this._lvl.setFromAxisAngle(UP, this.yaw);
      this.quat.slerp(this._lvl, 1 - Math.exp(-dt * (upY > 0.2 ? 2.4 : 1.4)));
      this.angVel.multiplyScalar(Math.exp(-dt * 2));
    }
  }

  land(h, up) {
    const vy = -this.vel.y;
    const tilt = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
    let grade;
    if (tilt > CRASH_TILT) grade = 'crash';
    else if (vy < 4 && tilt < 15) grade = 'perfect';
    else if (vy < 9) grade = 'good';
    else grade = 'hard';
    const ok = grade !== 'crash';
    const turns = (a) => (ok ? Math.floor((Math.abs(this.rot[a]) + TRICK_SLACK) / TAU) : 0);
    this.events.push({
      type: 'land', grade, vy, airTime: this.airTime, stunt: this.stunt, hit: this.hitName,
      flips: turns('roll'), pitchFlips: turns('pitch'), spins: turns('yaw'), clean: ok && tilt < 20,
    });
    this.stunt = null;
    this.hitName = null;
    this.pos.y = h;
    if (!ok) { this.crash(vy); return; }
    this.vel.y = 0;
    this.vel.multiplyScalar(0.85);
    this.impact = grade === 'perfect' ? 0.5 : vy * 0.9;
    this.susp = -Math.min(0.12, vy * 0.008);
    this.suspV = -vy * 0.15;
    this.state = 'ground';
    this.thrust = 0;
    this.yawRate = this.angVel.y * 0.5;
    this.angVel.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, this.yaw);
  }

  // Landed on the roof or the side: tumble, then the thrusters right the car.
  crash(vy) {
    this.state = 'crashed';
    this.crashT = CRASH_T;
    this.recoverT = 0;
    this.vel.y = Math.abs(vy) * 0.3;
    this.vel.x *= 0.55;
    this.vel.z *= 0.55;
    this.angVel.multiplyScalar(0.4);
    this.angVel.x += (Math.random() - 0.5) * 3;
    this.angVel.z += (Math.random() - 0.5) * 3;
    this.thrust = this.rearThrust = 0;
    this.impact = Math.max(8, vy);
    this.events.push({ type: 'crash', vy });
  }

  stepCrashed(dt) {
    const h = this.world.groundHeight(this.pos.x, this.pos.z);
    if (this.crashT > 0) {
      this.crashT -= dt;
      this.vel.y -= G * dt;
      const w = this.angVel.length();
      if (w > 1e-6) {
        this._dq.setFromAxisAngle(this._axis.copy(this.angVel).divideScalar(w), w * dt);
        this.quat.multiply(this._dq).normalize();
      }
      this.angVel.multiplyScalar(Math.exp(-1.8 * dt));
      this.thrust = 0;
    } else {
      // The thrusters lift the car and turn it back onto its wheels.
      this.recoverT += dt;
      const fwd = this.nose;
      fwd.y = 0;
      if (fwd.lengthSq() > 0.01) this.yaw = Math.atan2(fwd.x, fwd.z);
      this._lvl.setFromAxisAngle(UP, this.yaw);
      this.quat.slerp(this._lvl, 1 - Math.exp(-dt * 7));
      this.vel.y = Math.min(0, this.vel.y);
      this.pos.y = Math.max(h, this.pos.y - 2 * dt);
      this.thrust = 0.6;
    }
    this.pos.addScaledVector(this.vel, dt);
    // Keep every corner of the body above the ground.
    let pen = 0;
    for (const c of HULL) pen = Math.max(pen, h - this._p.copy(c).applyQuaternion(this.quat).add(this.pos).y);
    if (pen > 0) {
      this.pos.y += pen;
      if (this.vel.y < 0) {
        if (this.vel.y < -3) this.impact = Math.max(this.impact, -this.vel.y * 0.6);
        this.vel.y *= -0.25;
      }
      const k = Math.exp(-3 * dt);
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.collide(true);
    if (this.recoverT >= RECOVER_T) {
      this.state = 'ground';
      this.pos.y = h;
      this.vel.y = 0;
      this.quat.setFromAxisAngle(UP, this.yaw);
      this.angVel.set(0, 0, 0);
      this.thrust = 0;
      this.yawRate = 0;
      this.events.push({ type: 'recover' });
    }
    this.wheelSpeed *= Math.exp(-dt);
    this.steerAngle = 0;
    this.braking = false;
    this.drift = 0;
    this.downforce = 0;
    this.accelLong = this.accelLat = 0;
    this.pitchDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(this.up.y, -1, 1)));
  }

  // Boxes with a height (vehicles, buildings, kerbs) only block below their top,
  // so the car can fly over them and drive on roofs.
  collide(airborne = false) {
    const f = this.forward;
    const lists = this.world.dynamicColliders ? [this.world.colliders, this.world.dynamicColliders] : [this.world.colliders];
    for (const off of BODY_CIRCLES) {
      const cx = this.pos.x + f.x * off, cz = this.pos.z + f.z * off;
      for (const list of lists) for (const b of list) {
        if (this.pos.y >= (b.h ?? Infinity) - 0.01) continue;
        if (b.wallStunt && this.stunt === 'wall') continue;
        const px = Math.max(b.minX, Math.min(cx, b.maxX));
        const pz = Math.max(b.minZ, Math.min(cz, b.maxZ));
        let dx = cx - px, dz = cz - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= BODY_R * BODY_R) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Circle centre inside the box: push out along the shortest axis.
          const ex = Math.min(cx - b.minX, b.maxX - cx), ez = Math.min(cz - b.minZ, b.maxZ - cz);
          if (ex < ez) { dx = cx - b.minX < b.maxX - cx ? -1 : 1; dz = 0; }
          else { dz = cz - b.minZ < b.maxZ - cz ? -1 : 1; dx = 0; }
          const push = BODY_R + Math.min(ex, ez);
          this.pos.x += dx * push; this.pos.z += dz * push;
        } else {
          dx /= d; dz /= d;
          const push = BODY_R - d;
          this.pos.x += dx * push; this.pos.z += dz * push;
        }
        const vn = this.vel.x * dx + this.vel.z * dz;
        if (vn < 0) {
          this.vel.x -= dx * vn * 1.25;
          this.vel.z -= dz * vn * 1.25;
          this.vel.x *= 0.92; this.vel.z *= 0.92;
          this.impact = Math.max(this.impact, -vn);
          this.yawRate *= 0.5;
          if (b.ref) {
            b.ref.stall = 2.5; // traffic car stops after a hit
            if (-vn > 4) this.events.push({ type: 'bump', speed: -vn });
          }
          if (airborne && b.name && !this.hitName) {
            this.hitName = b.name;
            this.events.push({ type: 'hit', name: b.name });
          }
        }
      }
    }
  }

  // Visual hints for the car model.
  visualState(time) {
    const ground = this.state === 'ground';
    const spd = this.speed;
    return {
      pitch: ground ? THREE.MathUtils.clamp(-this.accelLong * 0.0035, -0.05, 0.05) : 0,
      roll: ground ? THREE.MathUtils.clamp(this.accelLat * 0.0045, -0.06, 0.06) : 0,
      bounce: (ground ? Math.sin(time * 13) * Math.min(spd, 40) * 0.00012 : 0) + this.susp,
      steerAngle: this.steerAngle * 1.6,
      wheelSpeed: this.wheelSpeed,
      braking: this.braking,
      thrust: this.thrust,
      rearThrust: this.rearThrust,
      airborne: this.state === 'air' || this.state === 'fly' || this.state === 'crashed',
    };
  }
}
