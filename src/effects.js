import * as THREE from 'three';

// Tyre smoke while drifting, vapour under the thrusters, and a burst on landing.
export class Smoke {
  constructor(scene, count = 70) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(235,235,235,0.9)');
    g.addColorStop(0.5, 'rgba(220,220,220,0.35)');
    g.addColorStop(1, 'rgba(210,210,210,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.pool = [];
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.userData = { life: 0, max: 1, vel: new THREE.Vector3(), grow: 5, strength: 1 };
      scene.add(s);
      this.pool.push(s);
    }
    this.next = 0;
    this.acc = 0;
    this.thrustAcc = 0;
    this._p = new THREE.Vector3();
  }

  emit(pos, strength, vel, max = 1.2 + Math.random() * 0.8, grow = 5) {
    const s = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    s.position.copy(pos);
    s.visible = true;
    Object.assign(s.userData, { life: 0, max, strength, grow });
    s.userData.vel.copy(vel);
    s.material.rotation = Math.random() * Math.PI * 2;
  }

  burst(pos, n = 24, strength = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
      const p = pos.clone();
      p.y += 0.3;
      this.emit(p, strength, new THREE.Vector3(Math.cos(a) * sp, 0.5 + Math.random() * 1.5, Math.sin(a) * sp), 1.6 + Math.random(), 7);
    }
  }

  update(dt, vehicle, car) {
    // Tyre smoke.
    const sliding = vehicle.state === 'ground' && vehicle.speed > 6 ? Math.min(1, (vehicle.drift - 7) / 20) : 0;
    const intensity = Math.max(sliding, vehicle.state === 'ground' ? vehicle.burnout : 0); // burnouts smoke too
    if (intensity > 0) {
      this.acc += dt * 40 * intensity;
      while (this.acc > 1) {
        this.acc -= 1;
        const side = Math.random() < 0.5 ? 1 : -1;
        this._p.set(side * 0.86, 0.25, -1.35).applyMatrix4(car.group.matrixWorld);
        this.emit(this._p, intensity, new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5));
      }
    }
    // Cold-gas vapour below the corner thrusters.
    if (vehicle.thrust > 0.2) {
      this.thrustAcc += dt * 30 * vehicle.thrust;
      while (this.thrustAcc > 1) {
        this.thrustAcc -= 1;
        const sx = Math.random() < 0.5 ? 0.82 : -0.82, sz = Math.random() < 0.5 ? 1.7 : -1.7;
        this._p.set(sx, -1.6, sz).applyMatrix4(car.group.matrixWorld);
        this.emit(this._p, 0.7 * vehicle.thrust, new THREE.Vector3((Math.random() - 0.5) * 2, -3 - Math.random() * 3, (Math.random() - 0.5) * 2), 0.8, 4);
      }
    }
    // Spray off the rear tyres on a wet road.
    if (vehicle.world.wet && vehicle.state === 'ground' && vehicle.speed > 10) {
      this.sprayAcc = (this.sprayAcc || 0) + dt * Math.min(40, vehicle.speed * 0.9);
      while (this.sprayAcc > 1) {
        this.sprayAcc -= 1;
        const side = Math.random() < 0.5 ? 0.86 : -0.86;
        this._p.set(side, 0.3, -1.7).applyMatrix4(car.group.matrixWorld);
        const back = new THREE.Vector3(0, 0, -1).applyQuaternion(car.group.quaternion).multiplyScalar(vehicle.speed * 0.25);
        this.emit(this._p, 0.35, back.add(new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2)), 0.6, 3);
      }
    }
    // Hovering low kicks up a ring of dust under the car.
    const ground = vehicle.world.groundHeight(vehicle.pos.x, vehicle.pos.z);
    const height = vehicle.pos.y - ground;
    if (vehicle.state === 'fly' && height < 7 && vehicle.thrust > 0.2) {
      this.dustAcc = (this.dustAcc || 0) + dt * 24 * (1 - height / 7);
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        this._p.set(vehicle.pos.x + Math.cos(a) * 1.5, ground + 0.3, vehicle.pos.z + Math.sin(a) * 1.5);
        this.emit(this._p, 0.6, new THREE.Vector3(Math.cos(a) * 7, 0.4, Math.sin(a) * 7), 1.4, 5);
      }
    }
    for (const s of this.pool) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life += dt;
      const t = u.life / u.max;
      if (t >= 1) { s.visible = false; continue; }
      s.position.addScaledVector(u.vel, dt);
      if (s.position.y < 0.2) { s.position.y = 0.2; u.vel.y = Math.abs(u.vel.y) * 0.2; }
      u.vel.multiplyScalar(Math.exp(-dt * 1.5));
      s.scale.setScalar(1 + t * u.grow);
      s.material.opacity = (1 - t) * 0.5 * u.strength;
    }
  }
}
