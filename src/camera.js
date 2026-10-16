import * as THREE from 'three';

// Chase camera that trails the direction of travel, a cockpit camera locked
// to the driver's head, and a broadcast-style side camera for the wall stunt.

const STUNT_HOLD = 1.6; // seconds to keep the stunt camera after landing

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.shake = 0;
    this.first = true;
    this.stuntTimer = 0;
    this.air = 0; // 0..1, eases the chase camera back while airborne
    this._q = new THREE.Quaternion();
    this._flip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07, Math.PI, 0));
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.first = true;
    return this.mode;
  }

  snap() { this.first = true; }

  update(dt, vehicle, car) {
    const cam = this.camera;
    const spd = vehicle.speed;
    this.shake = Math.max(this.shake * Math.exp(-dt * 6), vehicle.impact * 0.02);
    vehicle.impact = 0;

    const stunting = vehicle.state !== 'ground' && vehicle.stunt;
    if (stunting) this.stuntKind = vehicle.stunt;
    this.stuntTimer = stunting ? STUNT_HOLD : Math.max(0, this.stuntTimer - dt);

    if (this.mode === 'cockpit') {
      car.cockpit.getWorldPosition(cam.position);
      car.cockpit.getWorldQuaternion(this._q);
      cam.quaternion.copy(this._q).multiply(this._flip);
      cam.fov += (74 + spd * 0.06 - cam.fov) * (1 - Math.exp(-dt * 3));
    } else if (this.stuntTimer > 0 && this.stuntKind === 'kickflip' && this.world.kickflip) {
      // Low side shot across the row, tracking the car like the reveal broadcast.
      const k = this.world.kickflip.row;
      const x = THREE.MathUtils.clamp(vehicle.pos.x, k.x - 45, k.x + 45);
      const target = new THREE.Vector3(x - Math.sign(vehicle.vel.x || 1) * 6, 4.5, k.z + 24);
      const lookAt = vehicle.pos.clone();
      lookAt.y = Math.max(lookAt.y, 1.5);
      this.pos.lerp(target, 1 - Math.exp(-dt * 3));
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.fov += (55 - cam.fov) * (1 - Math.exp(-dt * 2));
      this.yaw = vehicle.yaw;
    } else if (this.stuntTimer > 0 && this.world.ramp) {
      // Side-on view of the whole wall, like the reveal broadcast.
      // Dolly along with the car as it flies back over the run-up.
      const r = this.world.ramp;
      const { u } = r.local(vehicle.pos);
      // Far enough to the side to keep the whole wall in frame.
      const target = r.origin.clone().addScaledVector(r.d, Math.min(u, 0) * 0.8 - r.R * 0.4).addScaledVector(r.l, -r.R * 2.4);
      target.y = r.R * 0.75;
      const lookAt = vehicle.pos.clone();
      lookAt.y = Math.max(lookAt.y, 3);
      this.pos.lerp(target, 1 - Math.exp(-dt * 2.5));
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 8));
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.fov += (58 - cam.fov) * (1 - Math.exp(-dt * 2));
      this.yaw = vehicle.yaw;
    } else {
      // Follow the heading, but lag a little so drifts look sideways. In the air,
      // follow the direction of travel instead, so flips and spins don't swing the camera.
      const airborne = vehicle.state === 'air' || vehicle.state === 'crashed';
      const hSpeed = Math.hypot(vehicle.vel.x, vehicle.vel.z);
      const want = airborne && hSpeed > 3 ? Math.atan2(vehicle.vel.x, vehicle.vel.z) : vehicle.yaw;
      if (this.first) this.yaw = want;
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * (airborne ? 2.2 : 4)));
      this.air += ((airborne ? 1 : 0) - this.air) * (1 - Math.exp(-dt * 2));
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const dist = 6.6 + Math.min(spd, 100) * 0.018 + this.air * 2.5;
      const target = vehicle.pos.clone().addScaledVector(fwd, -dist);
      target.y += 2.3 + Math.min(spd, 100) * 0.004 + this.air * 1.6;
      const lookAt = vehicle.pos.clone().addScaledVector(fwd, 3);
      lookAt.y += 0.9;
      if (this.first) { this.pos.copy(target); this.look.copy(lookAt); }
      this.pos.lerp(target, 1 - Math.exp(-dt * 8));
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 12));
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.fov += (60 + Math.min(spd, 100) * 0.16 + (vehicle.rearThrust > 0.5 ? 6 : 0) - cam.fov) * (1 - Math.exp(-dt * 3));
    }
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.updateProjectionMatrix();
    this.first = false;
  }
}
