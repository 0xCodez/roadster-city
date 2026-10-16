import * as THREE from 'three';

// Glowing rings in the air. Fly (or jump) through one to collect it.
// Each ring counts once; collect them all for a bonus and they reset.

// [x, y, z, yaw] — yaw turns the ring's opening; 0 means you fly through it along z.
function layout(world) {
  const G = world.cityGrid;
  const node = (i, j) => [G.ox - G.street / 2 + i * G.pitch, G.oz - G.street / 2 + j * G.pitch];
  const [ax, az] = node(1, 1), [bx, bz] = node(2, 2), [cx, cz] = node(3, 1);
  return [
    [-240, 30, 145, Math.PI / 2], [-120, 45, 145, Math.PI / 2], [0, 60, 145, Math.PI / 2], [130, 40, 145, Math.PI / 2], // runway
    [-395, 45, -60, 0], [-395, 60, 80, 0], // over the beach
    [ax, 70, az, Math.PI / 2], [bx, 110, bz, 0], [cx, 90, cz, Math.PI / 2], // downtown, above the junctions
    [170, 48, 40, Math.PI / 2], // on the way down from the wall
    [258, 95, 40, Math.PI / 2], // above the wall (Rocket)
    [192, 8, -122, Math.PI / 2], // over the kickflip row
    [270, 35, -122, Math.PI / 2],
    [0, 75, -232, Math.PI / 2], [360, 65, 0, 0], // over the ring road
  ];
}
const R = 6.5;

export function buildRings(scene, world) {
  const geo = new THREE.TorusGeometry(R, 0.42, 12, 48);
  const rings = layout(world).map(([x, y, z, yaw]) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a0f2e, emissive: 0xb46bff, emissiveIntensity: 3, roughness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return { mesh, mat, normal, center: mesh.position.clone(), taken: false, pop: 0 };
  });
  const prev = new THREE.Vector3();
  let havePrev = false;
  const tmp = new THREE.Vector3();

  return {
    rings,
    total: rings.length,
    get collected() { return rings.filter((r) => r.taken).length; },
    // Returns the rings passed this frame.
    update(dt, pos, time) {
      const passed = [];
      for (const r of rings) {
        // Gentle bob and spin of the glow; a collected ring pops and fades.
        if (r.taken) {
          if (r.pop < 1) {
            r.pop = Math.min(1, r.pop + dt * 2);
            r.mesh.scale.setScalar(1 + r.pop * 0.6);
            r.mat.emissiveIntensity = 3 * (1 - r.pop);
            r.mesh.visible = r.pop < 1;
          }
          continue;
        }
        r.mat.emissiveIntensity = 2.6 + Math.sin(time * 3 + r.center.x) * 0.6;
        if (!havePrev) continue;
        const a = tmp.subVectors(prev, r.center).dot(r.normal);
        const b = tmp.subVectors(pos, r.center).dot(r.normal);
        if (Math.sign(a) === Math.sign(b) || a === b) continue;
        // Where the path crosses the ring's plane:
        const t = a / (a - b);
        const hit = new THREE.Vector3().lerpVectors(prev, pos, t);
        if (hit.distanceTo(r.center) < R - 0.6) {
          r.taken = true;
          r.pop = 0;
          passed.push(r);
        }
      }
      prev.copy(pos);
      havePrev = true;
      if (rings.every((r) => r.taken && r.pop >= 1)) {
        // All collected: bring them back for another run.
        for (const r of rings) { r.taken = false; r.mesh.visible = true; r.mesh.scale.setScalar(1); }
      }
      return passed;
    },
    // Teleports (reset, warps) shouldn't count as flying through a ring.
    jump() { havePrev = false; },
  };
}
