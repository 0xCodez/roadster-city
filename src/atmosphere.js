import * as THREE from 'three';

// Time of day (day / dusk / night) and rain: sky, lights, fog, reflections,
// lit windows and lamps, stars and moon, wet roads, rain streaks, lightning.

const deg = THREE.MathUtils.degToRad;

const PRESETS = {
  day: {
    sky: 'sun', elev: 16, az: 215, turbidity: 4, rayleigh: 1.2, mie: 0.003,
    light: 0xffe2c4, lightI: 5, hemiSky: 0xcfe3ff, hemiGround: 0x4a443c, hemiI: 0.6,
    fog: 0x8fa3b8, fogNear: 400, fogFar: 1800, exposure: 0.5,
    windows: 0.15, lamps: 0.4, pools: 0, neon: 0.8, carLights: false, stars: 0, water: 0x1a6a86, clouds: [0xffffff, 0.9],
    rainFog: 0x7d8792, rainDome: [0x6f7a86, 0x9aa3ad],
  },
  dusk: {
    sky: 'sun', elev: 2.5, az: 250, turbidity: 8, rayleigh: 2.6, mie: 0.006,
    light: 0xff9a5a, lightI: 3.2, hemiSky: 0xffb08a, hemiGround: 0x3a3040, hemiI: 0.45,
    fog: 0xb98270, fogNear: 300, fogFar: 1500, exposure: 0.58,
    windows: 0.55, lamps: 6, pools: 0.5, neon: 4, carLights: true, stars: 0, water: 0x3a3048, clouds: [0xffa894, 0.95],
    rainFog: 0x5d5257, rainDome: [0x3c3640, 0x6e5f60],
  },
  night: {
    sky: 'dome', dome: [0x02040b, 0x16233d], moonElev: 38, moonAz: 140,
    light: 0x9db8ff, lightI: 0.6, hemiSky: 0x2e4673, hemiGround: 0x14141c, hemiI: 0.45,
    fog: 0x0b111d, fogNear: 220, fogFar: 1200, exposure: 0.85,
    windows: 0.9, lamps: 9, pools: 0.85, neon: 8, carLights: true, stars: 1, water: 0x04070d, clouds: [0x26304a, 0.5],
    rainFog: 0x0b1018, rainDome: [0x05070c, 0x121822],
  },
};
export const TIMES = ['day', 'dusk', 'night'];

export class Atmosphere {
  constructor({ scene, renderer, world, car, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.world = world;
    this.car = car;
    this.quality = quality;
    this.time = 'day';
    this.rain = false;
    this.flash = 0;
    this.nextBolt = 8;
    this.listeners = [];

    // Gradient dome for night and overcast skies (shared by the scene and the reflection scene).
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, flash: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float flash; varying vec3 vDir; void main(){ float t = clamp(vDir.y * 1.6 + 0.08, 0.0, 1.0); vec3 c = mix(bottom, top, t) + flash * vec3(0.55,0.6,0.75); gl_FragColor = vec4(c, 1.0); }',
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4800, 32, 16), this.domeMat);
    this.envDome = new THREE.Mesh(this.dome.geometry, this.domeMat);
    scene.add(this.dome);
    world.envScene.add(this.envDome);

    // Stars and moon.
    const n = 1600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(4200, Math.acos(Math.random() * 0.95), Math.random() * Math.PI * 2);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 12), new THREE.MeshBasicMaterial({ color: 0xdfe7ff, fog: false }));
    scene.add(this.moon);

    // Pools of light under the street lamps (cheap stand-in for real lights).
    const pc = document.createElement('canvas');
    pc.width = pc.height = 128;
    const pctx = pc.getContext('2d');
    const grd = pctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,214,150,1)');
    grd.addColorStop(0.45, 'rgba(255,190,120,0.45)');
    grd.addColorStop(1, 'rgba(255,170,100,0)');
    pctx.fillStyle = grd;
    pctx.fillRect(0, 0, 128, 128);
    this.poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const lamps = world.lamps;
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2), this.poolMat, lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      m.makeTranslation(l.x + Math.sin(l.yaw) * 2, 0.06 + (i % 7) * 0.002, l.z + Math.cos(l.yaw) * 2);
      this.pools.setMatrixAt(i, m);
    });
    this.pools.renderOrder = 1;
    scene.add(this.pools);

    // Lit-window materials on the buildings.
    this.windowMats = new Set();
    scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) if (mat.userData.windows) this.windowMats.add(mat);
    });

    // Remember the dry look of every wet-able material.
    for (const mat of world.wetMaterials) {
      mat.userData.dry = { roughness: mat.roughness, color: mat.color.clone(), envMapIntensity: mat.envMapIntensity, metalness: mat.metalness };
    }

    // Rain streaks, kept in a box that follows the camera.
    this.dropCount = quality === 'high' ? 2600 : 1100;
    this.box = new THREE.Vector3(70, 40, 70);
    this.drops = new Float32Array(this.dropCount * 3);
    for (let i = 0; i < this.dropCount; i++) {
      this.drops[i * 3] = Math.random() * this.box.x;
      this.drops[i * 3 + 1] = Math.random() * this.box.y;
      this.drops[i * 3 + 2] = Math.random() * this.box.z;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.dropCount * 6), 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xb9c6d6, transparent: true, opacity: 0.4, depthWrite: false });
    this.rainLines = new THREE.LineSegments(rg, this.rainMat);
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    scene.add(this.rainLines);
  }

  onChange(fn) { this.listeners.push(fn); }

  set({ time = this.time, rain = this.rain } = {}) {
    this.time = time;
    this.rain = rain;
    const P = PRESETS[time];
    const w = this.world;

    // Sky.
    const useDome = P.sky === 'dome' || rain;
    w.sky.visible = w.envSky.visible = !useDome;
    this.dome.visible = this.envDome.visible = useDome;
    const domeCols = rain ? P.rainDome : P.dome;
    if (useDome) {
      this.domeMat.uniforms.top.value.set(domeCols[0]);
      this.domeMat.uniforms.bottom.value.set(domeCols[1]);
    }

    // Key light: the sun by day and dusk, the moon at night.
    const lightDir = new THREE.Vector3();
    if (P.sky === 'sun') {
      lightDir.setFromSphericalCoords(1, deg(90 - P.elev), deg(P.az));
      for (const s of [w.sky, w.envSky]) {
        const u = s.material.uniforms;
        u.turbidity.value = P.turbidity;
        u.rayleigh.value = P.rayleigh;
        u.mieCoefficient.value = P.mie;
        u.sunPosition.value.copy(lightDir);
      }
    } else {
      lightDir.setFromSphericalCoords(1, deg(90 - P.moonElev), deg(P.moonAz));
    }
    w.sunDir.copy(lightDir);
    this.moon.visible = P.sky === 'dome' && !rain;
    this.moon.position.copy(lightDir).multiplyScalar(4000);
    w.sun.color.set(P.light);
    this.baseLightI = P.lightI * (rain ? 0.35 : 1);
    w.sun.intensity = this.baseLightI;
    w.hemi.color.set(P.hemiSky);
    w.hemi.groundColor.set(P.hemiGround);
    this.baseHemiI = P.hemiI * (rain ? 0.85 : 1);
    w.hemi.intensity = this.baseHemiI;

    // Fog and exposure.
    this.scene.fog.color.set(rain ? P.rainFog : P.fog);
    this.scene.fog.near = rain ? 40 : P.fogNear;
    this.scene.fog.far = rain ? 650 : P.fogFar;
    this.renderer.toneMappingExposure = P.exposure;
    w.water.material.color.set(P.water);

    // City lights.
    for (const mat of this.windowMats) mat.emissiveIntensity = P.windows;
    w.lampMat.emissiveIntensity = P.lamps;
    this.poolMat.opacity = P.pools * (rain ? 1.5 : 1);
    this.stars.material.opacity = rain ? 0 : P.stars;
    this.car.setHeadlights(P.carLights);
    this.levels = { neon: P.neon, carLights: P.carLights, night: time !== 'day' };
    for (const m of w.vice?.cloudMat || []) { m.color.set(P.clouds[0]); m.opacity = rain ? 0 : P.clouds[1]; }
    for (const m of w.vice?.billboardMats || []) {
      m.emissiveIntensity = time === 'day' ? 0.12 : time === 'dusk' ? 0.6 : 1.1;
      if (m.userData.lamps) m.userData.lamps.emissiveIntensity = time === 'day' ? 0.2 : 7;
    }

    // Wet surfaces: darker and glossy so they reflect the sky and the lights.
    for (const mat of w.wetMaterials) {
      const d = mat.userData.dry;
      mat.roughness = rain ? 0.14 : d.roughness;
      mat.metalness = rain ? Math.min(1, d.metalness + 0.15) : d.metalness;
      mat.envMapIntensity = rain ? 1.6 : d.envMapIntensity;
      mat.color.copy(d.color);
      if (rain) mat.color.multiplyScalar(0.55);
    }
    w.wet = rain;
    this.rainLines.visible = rain;
    this.rainMat.opacity = time === 'night' ? 0.28 : 0.42;

    // Reflections follow the new sky.
    const old = this.scene.environment;
    this.scene.environment = w.pmrem.fromScene(w.envScene, 0.02).texture;
    old?.dispose();

    for (const fn of this.listeners) fn(this.levels, { time, rain });
  }

  update(dt, camera) {
    if (!this.rain) return;
    // Streaks fall and wrap inside a box around the camera.
    const attr = this.rainLines.geometry.getAttribute('position');
    const a = attr.array, d = this.drops, B = this.box;
    const ox = camera.position.x - B.x / 2, oy = camera.position.y - B.y / 2, oz = camera.position.z - B.z / 2;
    const fall = 26 * dt, windX = 2.5 * dt;
    for (let i = 0; i < this.dropCount; i++) {
      let y = d[i * 3 + 1] - fall;
      let x = d[i * 3] + windX;
      if (y < 0) y += B.y;
      if (x > B.x) x -= B.x;
      d[i * 3 + 1] = y;
      d[i * 3] = x;
      // Wrap relative to the camera so the box moves with it.
      const wx = ox + ((x - ox) % B.x + B.x) % B.x;
      const wz = oz + ((d[i * 3 + 2] - oz) % B.z + B.z) % B.z;
      const wy = oy + y;
      const j = i * 6;
      a[j] = wx; a[j + 1] = wy; a[j + 2] = wz;
      a[j + 3] = wx - 0.12; a[j + 4] = wy + 1.1; a[j + 5] = wz;
    }
    attr.needsUpdate = true;

    // Lightning now and then.
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = 9 + Math.random() * 16;
      this.flash = 1;
      this.boltTime = 0;
      for (const fn of this.listeners) fn(null, { thunder: 0.6 + Math.random() * 1.4 });
    }
    if (this.flash > 0) {
      this.boltTime += dt;
      // Two quick pulses.
      const t = this.boltTime;
      const f = t < 0.08 ? 1 : t < 0.16 ? 0.15 : t < 0.24 ? 0.8 : Math.max(0, 0.8 - (t - 0.24) * 4);
      this.flash = f;
      this.world.hemi.intensity = this.baseHemiI + f * 2.5;
      this.domeMat.uniforms.flash.value = f * (this.time === 'night' ? 0.6 : 0.25);
      if (t > 0.5) { this.flash = 0; this.world.hemi.intensity = this.baseHemiI; this.domeMat.uniforms.flash.value = 0; }
    }
  }
}
