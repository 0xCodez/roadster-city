import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MODELS } from './config.js';

// Optional real car models. Every file listed in config.MODELS that exists in
// models/ is loaded, scaled to its real length, turned to face +Z, centred and
// put on the ground. Missing files are skipped and the built-in cars stay.

const WHEEL_RE = /wheel|tire|tyre|rim|rad(?!io)|reifen|roue|колес/i;

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);

  const found = {};
  const entries = Object.entries(MODELS);
  let done = 0;
  await Promise.all(entries.map(async ([id, spec]) => {
    try {
      // Cheap existence check first, so a missing file is just skipped.
      const head = await fetch(spec.file, { method: 'HEAD' });
      if (!head.ok) return;
      const gltf = await loader.loadAsync(spec.file);
      found[id] = prepareModel(gltf.scene, spec);
    } catch (err) {
      console.warn(`Model ${spec.file} could not be loaded:`, err);
    } finally {
      onProgress?.(++done, entries.length);
    }
  }));

  // Index by where each model is used.
  const byUse = {};
  for (const [id, model] of Object.entries(found)) for (const use of MODELS[id].uses || []) byUse[use] = model;
  return { found, byUse };
}

// Normalise a model: face +Z, real length, centred on x/z, wheels on the ground.
export function prepareModel(scene, spec) {
  const inner = scene;
  inner.rotation.y = THREE.MathUtils.degToRad(spec.yaw || 0);
  const root = new THREE.Group();
  root.add(inner);
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(inner);
  let size = box.getSize(new THREE.Vector3());
  // A car is longer than it is wide; if it's lying along X, turn it.
  if (size.x > size.z * 1.15) {
    inner.rotation.y += Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(inner);
    size = box.getSize(new THREE.Vector3());
  }
  const s = spec.length / size.z;
  inner.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  inner.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  size = box.getSize(new THREE.Vector3());

  const materials = new Set();
  inner.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      if (m.isMeshStandardMaterial) m.envMapIntensity = Math.max(m.envMapIntensity ?? 1, 1);
    }
  });
  return { root, inner, size: { L: size.z, W: size.x, H: size.y }, materials: [...materials], spec };
}

// Wheels: nodes named like wheels, re-parented under pivots at their centres so
// they can spin about the car's axle and the front pair can steer.
export function rigWheels(model) {
  const { root } = model;
  root.updateMatrixWorld(true);
  const cands = [];
  root.traverse((o) => {
    if (o === root || !WHEEL_RE.test(o.name || '')) return;
    // Skip a match inside one we already have (e.g. "Wheel_FL/Rim").
    for (let p = o.parent; p; p = p.parent) if (cands.includes(p)) return;
    const b = new THREE.Box3().setFromObject(o);
    const sz = b.getSize(new THREE.Vector3());
    if (sz.y > 0.15 && sz.y < model.size.H * 0.7) cands.push(o);
  });
  const wheels = [];
  for (const node of cands) {
    const b = new THREE.Box3().setFromObject(node);
    const centre = b.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(root.worldToLocal(centre.clone()));
    root.add(pivot);
    pivot.updateMatrixWorld(true);
    const spin = new THREE.Group();
    pivot.add(spin);
    spin.updateMatrixWorld(true);
    spin.attach(node); // keeps its world transform
    wheels.push({ pivot, spin, front: pivot.position.z > 0, r: b.getSize(new THREE.Vector3()).y / 2 });
  }
  return wheels;
}

// Flatten a model into (geometry, material, matrix) parts for instancing.
export function modelParts(model) {
  const parts = [];
  model.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.root.matrixWorld).invert();
  model.root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const matrix = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (mats.length === 1) parts.push({ geometry: o.geometry, material: mats[0], matrix });
    else {
      // Split multi-material meshes by group.
      for (const g of o.geometry.groups) {
        const geo = o.geometry.clone();
        geo.clearGroups();
        geo.setDrawRange(g.start, g.count);
        parts.push({ geometry: geo, material: mats[g.materialIndex], matrix });
      }
    }
  });
  return parts;
}
