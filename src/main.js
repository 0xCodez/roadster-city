import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { buildWorld, LAYOUT } from './world.js';
import { buildCar } from './car.js';
import { Vehicle } from './vehicle.js';
import { CameraRig } from './camera.js';
import { createInput } from './input.js';
import { Hud } from './hud.js';
import { Smoke } from './effects.js';
import { CarAudio } from './audio.js';
import { Atmosphere, TIMES } from './atmosphere.js';
import { buildNeon } from './neon.js';
import { buildTraffic } from './traffic.js';
import { STATIONS } from './music.js';
import { setNeonBands } from './buildings.js';
import { setStationLights } from './stations.js';
import { buildRings } from './rings.js';
import { Score } from './score.js';
import { buildDetails } from './details.js';
import { buildPedestrians } from './pedestrians.js';
import { Menu } from './menu.js';
import { loadModels, rigWheels } from './models.js';
import { X_HANDLE } from './config.js';

// ?touch forces the phone layout (handy for testing on a desktop).
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || new URLSearchParams(location.search).has('touch');
if (isTouch) document.body.classList.add('touch');

// Quality: remembered per device, defaults to low on phones.
let quality = 'high';
try { quality = localStorage.getItem('rr-quality') || (isTouch ? 'low' : 'high'); } catch { quality = isTouch ? 'low' : 'high'; }
document.querySelector(`input[name="q"][value="${quality}"]`).checked = true;
document.querySelectorAll('input[name="q"]').forEach((el) =>
  el.addEventListener('change', () => {
    try { localStorage.setItem('rr-quality', el.value); } catch {}
    location.reload();
  })
);

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.25));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = quality === 'high';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 6000);

// Real car models from models/ (optional). Missing files just keep the built-in cars.
const playBtnEl = document.getElementById('btn-play');
const models = await loadModels((done, total) => { playBtnEl.textContent = `Loading models ${done}/${total}…`; });
const world = buildWorld(scene, renderer, quality, models);
const car = buildCar();
if (models.byUse.player) car.useModel(models.byUse.player, rigWheels(models.byUse.player));
scene.add(car.group);
const vehicle = new Vehicle(world, LAYOUT.start);
const rig = new CameraRig(camera, world);
const smoke = new Smoke(scene, quality === 'high' ? 80 : 40);
const audio = new CarAudio();
const hud = new Hud(world);
const neon = buildNeon(scene, world.buildings, quality);
const rings = buildRings(scene, world);
const score = new Score();
score.onTask = (t) => { audio.chime(5); hud.bigBanner('TASK COMPLETE', t.title, `+${t.bonus.toLocaleString('en-US')}`); };
hud.setRings(rings);
const traffic = buildTraffic(scene, world, quality, models);
const details = buildDetails(scene, world, quality, Math.random);
const peds = buildPedestrians(scene, world, quality, Math.random);
let honked = false;
function honk() { audio.horn(); honked = true; }

// Time of day and rain, remembered between visits.
const atmosphere = new Atmosphere({ scene, renderer, world, car, quality });
atmosphere.onChange((levels, info) => {
  if (info.thunder) { audio.thunder(info.thunder); return; }
  neon.set(levels.neon, info.rain && levels.night ? 1 : 0);
  setNeonBands(levels.neon * 0.6);
  setStationLights(levels.night ? 6 : 2.5);
  traffic.setLights(levels.carLights);
  audio.setRain(info.rain);
  hud.setSky(info);
});
let savedTime = 'day', savedRain = false;
try {
  savedTime = TIMES.includes(localStorage.getItem('rr-time')) ? localStorage.getItem('rr-time') : 'day';
  savedRain = localStorage.getItem('rr-rain') === '1';
} catch {}
atmosphere.set({ time: savedTime, rain: savedRain });
function setSky(change) {
  atmosphere.set(change);
  try {
    localStorage.setItem('rr-time', atmosphere.time);
    localStorage.setItem('rr-rain', atmosphere.rain ? '1' : '0');
  } catch {}
}
const cycleTime = () => setSky({ time: TIMES[(TIMES.indexOf(atmosphere.time) + 1) % TIMES.length] });
const toggleRain = () => setSky({ rain: !atmosphere.rain });

let composer = null;
if (quality === 'high') {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.35, 4));
  composer.addPass(new OutputPass());
}

const MODE_ORDER = ['road', 'track', 'rocket'];
function setMode(m) {
  if (m === vehicle.mode) return;
  if (vehicle.state !== 'ground') { hud.banner('Land first', 'Modes switch on the ground', 1.6); return; }
  vehicle.mode = m;
  car.setMode(m);
  hud.setMode(m);
  if (m === 'rocket') {
    hud.banner('Rocket mode', isTouch ? 'Hold LIFT to take off · ▲ ▼ thrust · BOOST · joystick turns' : 'Space — lift · X — descend · W/S — thrust · Shift — boost · A/D — turn', 3.5);
  }
}
function warpToRocket() {
  vehicle.reset(LAYOUT.rocketStart);
  vehicle.mode = 'rocket';
  car.setMode('rocket');
  hud.setMode('rocket');
  rig.snap();
  hud.banner('Rocket mode', isTouch ? 'Hold LIFT to take off. Release to settle back down.' : 'Hold Space to take off, release to settle. X drops faster.', 4);
}
function toggleCamera() {
  const m = rig.toggle();
  car.setInterior(m === 'cockpit');
  hud.setCamera(m);
}

function warpToWall() {
  vehicle.reset(LAYOUT.wallApproach);
  rig.snap();
  hud.banner('Wall climb', `Full throttle into the wall. On the way down, hold ${isTouch ? 'LIFT' : 'Space'} for the thrusters.`, 4);
}

function warpToKickflip() {
  vehicle.reset(LAYOUT.kickflipApproach);
  rig.snap();
  hud.banner('Kickflip', isTouch ? 'Hit the orange launch line at 60+ km/h. The stick rolls you in the air.' : 'Hit the orange launch line at 60+ km/h. A / D roll, W / S flip in the air.', 4);
}

const input = createInput({
  onCamera: toggleCamera,
  onMode: () => nextMode(),
  onRocket: warpToRocket,
  onTime: cycleTime,
  onRain: toggleRain,
  onReset: () => { vehicle.reset(); rig.snap(); },
  onSound: () => hud.setSound(audio.toggle()),
  onRadio: () => nextStation(),
  onTasks: () => menu.toggle('tasks', vehicle),
  onHorn: honk,
  onWall: warpToWall,
  onKickflip: warpToKickflip,
  onMenu: () => { if (playing) menu.toggle('map', vehicle); },
});
const nextMode = () => setMode(MODE_ORDER[(MODE_ORDER.indexOf(vehicle.mode) + 1) % MODE_ORDER.length]);
const tap = (id, fn) => document.getElementById(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
tap('tb-mode', nextMode);
tap('tb-horn', honk);
document.getElementById('btn-menu').addEventListener('click', () => menu.toggle('map', vehicle));
document.querySelector('#menu .resume').addEventListener('click', () => menu.close());
// Mode switch and camera button on the main screen.
document.querySelectorAll('#quickbar .mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.getElementById('btn-cam').addEventListener('click', toggleCamera);

// HUD buttons never keep keyboard focus, so Space (lift) can't press them.
document.querySelectorAll('#hud button, #touch button').forEach((b) => {
  b.tabIndex = -1;
  b.addEventListener('mousedown', (e) => e.preventDefault());
});

// Stunt events from the vehicle -> score, HUD, effects, sound.
const LIFT_KEY = isTouch ? 'LIFT' : 'Space';
const LANDING = {
  perfect: ['Perfect landing', 'Thrusters nailed it'],
  good: ['Good landing', `Hold ${LIFT_KEY} longer for a perfect one`],
  hard: ['Hard landing', `Hold ${LIFT_KEY} (thrusters) before touchdown`],
  crash: ['Crash landing', 'Land on your wheels'],
};
const VEHICLE_NAMES = { robotaxi: 'the robotaxi', pickup: 'the pickup', semi: 'the semi', crossover: 'the crossover', sedan: 'the sedan' };

// Name and points of a trick from a full turn around one axis.
function trickOf(e) {
  const n = e.count;
  if (e.axis === 'roll') return [n === 1 ? 'KICKFLIP' : n === 2 ? 'DOUBLE KICKFLIP' : `${n}x KICKFLIP`, 800 * n];
  if (e.axis === 'pitch') return [`${n > 1 ? `${n}x ` : ''}${e.sign > 0 ? 'FRONTFLIP' : 'BACKFLIP'}`, 700 * n];
  return [`${360 * n} SPIN`, 400 * n];
}

function scoreEvent(e) {
  if (e.type === 'release') { score.callTrick('WALL CLIMB', 500); score.task('wall'); score.requestSlowmo(1.1, 0.35); }
  else if (e.type === 'apex') score.requestSlowmo(1.0, 0.4);
  else if (e.type === 'refill') score.task('refuel');
  else if (e.type === 'trick') score.callTrick(...trickOf(e));
  else if (e.type === 'land') {
    if (e.grade === 'crash') { score.lose(); condition -= 0.35; return; }
    const flight = e.stunt === 'flight';
    // Air time and a clean landing only pay with a trick or a long jump, so plain hops can't farm points.
    const worthIt = score.pending > 0 || e.airTime > 2.2;
    if (!flight && worthIt && e.airTime > 0.8) score.callTrick(`AIR ${e.airTime.toFixed(1)} S`, Math.round(e.airTime * 150));
    if (!flight && e.airTime >= 6) score.task('hang');
    if (e.stunt === 'wall') {
      if (e.grade === 'perfect') { score.callTrick('PERFECT LANDING', 800); score.task('wallPerfect'); }
      else if (e.grade === 'good') score.callTrick('GOOD LANDING', 300);
    } else if (e.stunt === 'kickflip' && e.flips >= 1 && !e.hit) {
      score.callTrick('LINEUP CLEARED', 1000);
      score.task('kickflip');
      if (e.flips >= 2) score.task('double');
    } else if (!flight && worthIt && e.clean && e.grade !== 'hard') score.callTrick('CLEAN LANDING', 300);
    if (e.pitchFlips >= 1) score.task('flip');
    // Rough landings dent the car.
    if (e.grade === 'hard') condition -= 0.15;
    score.bank(e.grade === 'perfect' ? 'PERFECT' : e.grade === 'hard' ? 'HARD LANDING' : 'LANDED');
  } else if (e.type === 'bump') condition -= Math.min(0.3, e.speed * 0.015);
}

// 0-100 km/h timer: starts when you pull away from a standstill.
let launchT = null, prevSpeed = 0;
function launchTimer(dt, ctl) {
  const kmh = vehicle.speed * 3.6;
  const pushing = vehicle.state === 'ground' && (ctl.throttle > 0.5 || ctl.boost);
  if (prevSpeed < 0.3 && pushing && launchT === null) launchT = 0;
  if (launchT !== null) {
    if (!pushing || launchT > 6) launchT = null;
    else {
      launchT += dt;
      if (kmh >= 100) {
        hud.banner('0-100 km/h', `${launchT.toFixed(2)} s`, 2.2);
        if (launchT < 1) score.task('launch');
        launchT = null;
      }
    }
  }
  prevSpeed = vehicle.speed;
}

function handleEvents() {
  for (const e of vehicle.events) {
    scoreEvent(e);
    if (e.type === 'fans') hud.banner('Fans · max grip', '', 1.6);
    else if (e.type === 'release') hud.banner('Release', `Hold ${LIFT_KEY} — thrusters`, 1.8);
    else if (e.type === 'slipped') hud.banner('Not enough speed', 'Come in faster', 2);
    else if (e.type === 'nolaunch') hud.banner('Too slow to launch', 'You need 60+ km/h on the line', 2);
    else if (e.type === 'takeoff') { smoke.burst(vehicle.pos, 14, 0.7); }
    else if (e.type === 'hop') { smoke.burst(vehicle.pos, 10, 0.6); audio.thump(3); vehicle.impact = 2; }
    else if (e.type === 'lowair') hud.banner('Low air', 'Land and refill at an AIR station', 2.5);
    else if (e.type === 'airout') hud.banner('Air empty', 'Thrusters out — brace for landing', 2.5);
    else if (e.type === 'refill') hud.banner('Refilling air', '', 1.4);
    else if (e.type === 'bump') audio.thump(e.speed);
    else if (e.type === 'crash') {
      hud.wrecked();
      smoke.burst(vehicle.pos, 26, 1);
      audio.thump(14);
    } else if (e.type === 'land' && e.grade === 'crash') {
      // The crash event above does the show.
    } else if (e.type === 'land' && e.stunt === 'flight') {
      // Settling on the thrusters is routine; only call out the rough ones.
      if (e.grade !== 'perfect') hud.banner(LANDING[e.grade][0], `${e.vy.toFixed(1)} m/s`, 2.5);
      else hud.banner('Touchdown', `${e.airTime.toFixed(1)} s flight`, 1.6);
      smoke.burst(vehicle.pos, 12, 0.8);
      if (e.grade !== 'perfect') audio.thump(e.vy);
    } else if (e.type === 'launch') {
      hud.banner('Thrusters', isTouch ? 'Stick rolls · LIFT softens the landing' : 'A / D roll · W / S flip · Space softens the landing', 1.8);
      smoke.burst(vehicle.pos, 16, 0.9);
      audio.thump(4);
    } else if (e.type === 'hit') {
      hud.banner(`Clipped ${VEHICLE_NAMES[e.name] || 'a car'}`, 'More speed next time', 2);
      audio.thump(8);
    } else if (e.type === 'land' && (e.stunt === 'wall' || e.stunt === 'kickflip')) {
      const [title, sub] = LANDING[e.grade];
      hud.banner(title, `${sub} · ${e.vy.toFixed(1)} m/s`, 2.5);
      smoke.burst(vehicle.pos, e.grade === 'perfect' ? 30 : 18, 1);
      audio.thump(e.vy);
    } else if (e.type === 'land') {
      // Everyday hops: the trick feed says enough; only a hard landing gets a banner.
      if (e.grade === 'hard') hud.banner(LANDING.hard[0], `${LANDING.hard[1]} · ${e.vy.toFixed(1)} m/s`, 2.2);
      smoke.burst(vehicle.pos, e.airTime > 1 ? 16 : 8, 0.8);
      audio.thump(e.vy);
    }
  }
  vehicle.events.length = 0;
}

// Radio: F / RADIO cycles the stations and off. The last choice is remembered.
let savedStation = 0;
try { const s = localStorage.getItem('rr-radio'); if (s !== null) savedStation = Number(s); } catch {}
audio.radio.station = savedStation;
function nextStation() {
  const st = audio.radio.next();
  try { localStorage.setItem('rr-radio', String(audio.radio.station)); } catch {}
  hud.radioName(st ? st.name : 'RADIO OFF', st ? st.genre : '');
}

// ---- Pause menu ----
let condition = 1; // car condition 0..1: dents from hits and rough landings, repairs itself
const menu = new Menu({
  world, score,
  onWarp(w) {
    if (!w) { vehicle.reset(); rig.snap(); return; }
    if (w.id === 'wall') warpToWall();
    else if (w.id === 'kickflip') warpToKickflip();
    else if (w.id === 'runway') warpToRocket();
    else { vehicle.reset(w.at()); rig.snap(); }
  },
  onSet(key, val) {
    if (key === 'time') setSky({ time: val });
    else if (key === 'rain') setSky({ rain: val });
    else if (key === 'radio') {
      audio.radio.play(val);
      try { localStorage.setItem('rr-radio', String(val)); } catch {}
    } else if (key === 'sound') { if (audio.enabled !== val) audio.toggle(); }
    else if (key === 'camera') { if (rig.mode !== val) toggleCamera(); }
    else if (key === 'mode') setMode(val);
    else if (key === 'slowmo') { score.slowmoOn = val; try { localStorage.setItem('rr-slowmo', val ? '1' : '0'); } catch {} }
    else if (key === 'quality' && val !== quality) { try { localStorage.setItem('rr-quality', val); } catch {} location.reload(); }
  },
  getState: () => ({ time: atmosphere.time, rain: atmosphere.rain, radio: audio.radio.station, sound: audio.enabled, camera: rig.mode, mode: vehicle.mode, quality, slowmo: score.slowmoOn }),
});
addEventListener('keydown', (e) => {
  if (!playing) return;
  if (e.code === 'Escape' || e.code === 'KeyP') menu.toggle('map', vehicle);
});

// The canvas is sized by CSS; follow it (covers rotation and browser UI changes).
new ResizeObserver(() => {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
}).observe(canvas);

// ---- Share on X ----
// Opens X's post composer with the best score and a link back to the game.
function shareOnX() {
  const best = score.best;
  const text = best > 0
    ? `I scored ${best.toLocaleString('en-US')} in Roadster City: wall climbs, kickflips and thruster flight in the browser`
    : 'Roadster City: wall climbs, kickflips and thruster flight, free in the browser';
  const url = location.origin + location.pathname;
  const via = X_HANDLE.replace(/^@/, '');
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&via=${encodeURIComponent(via)}`, '_blank', 'noopener');
}
document.querySelectorAll('.share-x').forEach((b) => b.addEventListener('click', shareOnX));

// ---- Start screen ----
const playBtn = document.getElementById('btn-play');
playBtn.disabled = false;
playBtn.textContent = 'Drive';
let playing = false;
playBtn.addEventListener('click', () => {
  document.getElementById('start').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  document.body.classList.add('playing');
  audio.start();
  playing = true;
  if (audio.radio.station >= 0) hud.radioName(STATIONS[audio.radio.station].name, STATIONS[audio.radio.station].genre);
  if (isTouch) {
    document.getElementById('touch').classList.remove('hidden');
    // Best effort: some browsers refuse or never answer, so don't wait on it.
    Promise.resolve(document.documentElement.requestFullscreen?.())
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
});

// ---- Loop ----
const IDLE = { throttle: 0, brake: 0, steer: 0, pitch: 0, drift: false, yaw: 0, lift: false, liftPressed: false, boost: false, descend: false };
const clock = new THREE.Clock();
const STEP = 1 / 120;
let acc = 0, time = 0, screenTimer = 0;
const lastPos = new THREE.Vector3();
let wasOnRoof = false;
const roofsVisited = new Set();
const shadowTarget = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  if (window.__game?.paused) return; // debugging: lets a script drive the simulation
  // The pause menu freezes the game but keeps drawing it behind the overlay.
  if (!menu.open) tick(dt, playing ? input.read(dt) : IDLE);
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// One frame of game logic (no rendering), so tests can drive it too.
function tick(realDt, ctl) {
  ctl = { ...IDLE, ...ctl };
  // Slow motion: the simulation and the world run on scaled time, the HUD on real time.
  const dt = realDt * score.timeScale;
  time += dt;
  acc += dt;
  while (acc >= STEP) {
    vehicle.step(STEP, ctl);
    ctl.liftPressed = false; // a tap is one hop, not one per sub-step
    acc -= STEP;
  }

  handleEvents();
  car.group.position.copy(vehicle.pos);
  car.group.quaternion.copy(vehicle.quat);
  car.update(dt, vehicle.visualState(time));
  car.group.updateMatrixWorld();
  car.updateClip();

  if (!playing) {
    // Slow orbit behind the start screen.
    const a = time * 0.15;
    camera.position.set(vehicle.pos.x + Math.sin(a) * 7.5, 1.6, vehicle.pos.z + Math.cos(a) * 7.5);
    camera.lookAt(vehicle.pos.x, 0.7, vehicle.pos.z);
  } else {
    rig.update(dt, vehicle, car);
  }

  details.update(dt);
  traffic.update(dt, vehicle, details.time());
  peds.update(dt, vehicle, honked);
  honked = false;
  atmosphere.update(dt, camera);
  if (playing) {
    // Teleports (reset, warps) don't count as flying through rings.
    if (vehicle.pos.distanceTo(lastPos) > 25) rings.jump();
    lastPos.copy(vehicle.pos);
    for (const r of rings.update(dt, vehicle.pos, time)) {
      score.stunt(250, `Ring ${rings.collected}/${rings.total}`);
      audio.chime(rings.collected % 5);
      score.task('rings5');
      score.task('ringsAll');
    }
    score.update(realDt, vehicle);
    launchTimer(dt, ctl);
    condition = Math.min(1, Math.max(0, condition) + dt * 0.04);
    // A battered car smokes from under the hood.
    if (condition < 0.3 && Math.random() < dt * 20) {
      const p = new THREE.Vector3(0, 0.8, 1.4).applyMatrix4(car.group.matrixWorld);
      smoke.emit(p, 0.6, new THREE.Vector3((Math.random() - 0.5), 1.6, (Math.random() - 0.5)), 1.4, 4);
    }
    // Rooftop landings: the first touchdown on each roof.
    const onRoof = vehicle.state === 'ground' && vehicle.pos.y > 1;
    if (onRoof && !wasOnRoof) {
      const key = Math.round(vehicle.pos.y * 10);
      if (!roofsVisited.has(key)) { roofsVisited.add(key); score.stunt(500, 'Rooftop landing'); score.task('rooftop'); }
    }
    wasOnRoof = onRoof;
  }
  world.vice.update(dt, world.water);
  screenTimer -= dt;
  if (screenTimer <= 0 && rig.mode === 'cockpit') {
    screenTimer = 0.2;
    const st = audio.radio.station >= 0 ? STATIONS[audio.radio.station].name : '';
    car.updateScreens({ speed: vehicle.speed * 3.6, mode: vehicle.mode, air: vehicle.airFrac, station: st, alt: vehicle.state === 'ground' ? 0 : vehicle.alt });
  }
  smoke.update(dt, vehicle, car);
  audio.update(vehicle, ctl);
  if (playing) hud.update(realDt, vehicle, { condition, combo: score.streakFrac });

  shadowTarget.copy(vehicle.pos);
  world.followShadow(shadowTarget);
}
frame();

// Handy for debugging from the console.
window.__game = { models, menu, details, peds, honk, vehicle, car, world, rig, scene, camera, renderer, hud, smoke, traffic, atmosphere, neon, rings, score, tick, start: () => playBtn.click(), render: () => (composer ? composer.render() : renderer.render(scene, camera)) };
