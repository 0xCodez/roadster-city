// Keyboard, touch and gamepad input merged into one analog state.
//
// On the ground: W/S drive, A/D steer, Q/E drift, Space hops on the thrusters,
// Shift fires the rear thrusters. In the air: W/S flip, A/D roll, Q/E spin,
// Space holds the lift thrusters, Shift pushes forward.

// Pointer capture keeps a held button pressed when the finger slides off it.
// It can throw if the pointer is already gone, which is harmless.
function capture(el, id) {
  try { el.setPointerCapture(id); } catch {}
}

export function createInput({ onCamera, onMode, onReset, onSound, onWall, onKickflip, onRocket, onTime, onRain, onRadio, onTasks, onHorn, onMenu }) {
  const keys = new Set();
  const touch = { steer: 0, gas: false, brake: false, drift: false, lift: false, boost: false };
  let steer = 0;
  let liftWas = false;
  const padWas = {};

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyC' || e.code === 'KeyV') onCamera();
    if (e.code === 'KeyT') onMode();
    if (e.code === 'KeyR') onReset();
    if (e.code === 'KeyM') onSound();
    if (e.code === 'Digit2') onWall();
    if (e.code === 'Digit3') onKickflip();
    if (e.code === 'Digit4') onRocket();
    if (e.code === 'KeyN') onTime();
    if (e.code === 'KeyU') onRain();
    if (e.code === 'KeyF') onRadio();
    if (e.code === 'KeyJ') onTasks();
    if (e.code === 'KeyH') onHorn();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // ---- Touch: joystick ----
  const stick = document.getElementById('stick');
  const knob = document.getElementById('knob');
  let stickId = null, cx = 0;
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    capture(stick, e.pointerId);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    touch.steer = 0;
    knob.style.transform = '';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  function moveStick(e) {
    const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 50));
    touch.steer = -dx;
    knob.style.transform = `translateX(${dx * 38}px)`;
  }

  // ---- Touch: buttons ----
  const hold = (id, key) => {
    const el = document.getElementById(id);
    const on = (e) => { e.preventDefault(); touch[key] = true; el.classList.add('pressed'); capture(el, e.pointerId); };
    const off = () => { touch[key] = false; el.classList.remove('pressed'); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('lostpointercapture', off);
  };
  hold('tb-gas', 'gas');
  hold('tb-brake', 'brake');
  hold('tb-drift', 'drift');
  hold('tb-lift', 'lift');
  hold('tb-boost', 'boost');
  document.getElementById('tb-cam').addEventListener('pointerdown', (e) => { e.preventDefault(); onCamera(); });

  // ---- Gamepad (standard mapping) ----
  function readPad(out) {
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
    if (!pad) return;
    const axis = (i) => (Math.abs(pad.axes[i] || 0) > 0.12 ? pad.axes[i] : 0);
    const val = (i) => pad.buttons[i]?.value || 0;
    const btn = (i) => !!pad.buttons[i]?.pressed;
    // Edge-triggered buttons: Y camera, Start menu, Back mode.
    for (const [i, fn] of [[3, onCamera], [9, onMenu], [8, onMode]]) {
      if (btn(i) && !padWas[i]) fn?.();
      padWas[i] = btn(i);
    }
    out.throttle = Math.max(out.throttle, val(7));
    out.brake = Math.max(out.brake, val(6));
    if (axis(0)) out.steer = -axis(0);
    out.pitch = -axis(1); // left stick up = front flip in the air
    out.lift ||= btn(0); // A
    out.boost ||= btn(5) || btn(2); // RB or X
    out.drift ||= btn(1) || btn(4); // B or LB
    if (btn(4)) out.yaw = 1;
    else if (btn(1)) out.yaw = -1;
  }

  return {
    read(dt) {
      const left = keys.has('KeyA') || keys.has('ArrowLeft');
      const right = keys.has('KeyD') || keys.has('ArrowRight');
      const target = (left ? 1 : 0) - (right ? 1 : 0);
      // Keyboard steering eases in so taps aren't twitchy.
      const rate = target === 0 ? 8 : 5;
      steer += Math.max(-rate * dt, Math.min(rate * dt, target - steer));
      const kbSteer = Math.abs(steer) < 0.01 ? 0 : steer;
      const out = {
        throttle: keys.has('KeyW') || keys.has('ArrowUp') || touch.gas ? 1 : 0,
        brake: keys.has('KeyS') || keys.has('ArrowDown') || touch.brake ? 1 : 0,
        steer: Math.abs(touch.steer) > 0.02 ? touch.steer : kbSteer,
        drift: keys.has('KeyQ') || keys.has('KeyE') || touch.drift,
        yaw: (keys.has('KeyQ') || touch.drift ? 1 : 0) - (keys.has('KeyE') ? 1 : 0), // spin in the air
        lift: keys.has('Space') || touch.lift,
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.boost,
        descend: keys.has('KeyX'),
        pitch: 0,
      };
      readPad(out);
      // In the air the stick's vertical axis flips the car.
      if (out.pitch > 0) out.throttle = Math.max(out.throttle, out.pitch);
      else if (out.pitch < 0) out.brake = Math.max(out.brake, -out.pitch);
      out.liftPressed = out.lift && !liftWas;
      liftWas = out.lift;
      return out;
    },
  };
}
