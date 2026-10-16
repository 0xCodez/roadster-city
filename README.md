# Roadster City

A fan-made browser driving game with an electric hypercar on a Vice City-style island: a beach,
Ocean Drive's Art Deco hotels, a downtown skyline, and stunts inspired by the 2026 Roadster reveal —
the wall climb, the kickflip and flight on the thrusters.

Fan-made project. Not affiliated with or endorsed by Tesla, Inc.

## Run locally

Needs Python 3 (any static server works; this one disables caching for development):

```bash
python tools/dev_server.py 5173
```

Then open http://localhost:5173.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Throttle / brake, reverse | W / S or arrows | ▲ / ▼ |
| Steer | A / D or arrows | Joystick |
| Jump (tap) · lift thrusters (hold) · Rocket mode: lift | Space | LIFT |
| Rear thrust boost (ground and air) | Shift | BOOST |
| Drift (handbrake) | Q / E | DRIFT |
| Burnout | W + S at a standstill | both pedals |
| In the air: front / back flip · roll · spin | W / S · A / D · Q / E | ▲ / ▼ · joystick · DRIFT |
| Descend faster (Rocket mode) | X | release LIFT |
| Gamepad | RT / LT drive, left stick steer and flip, A lift, RB boost, B drift, Y camera, Start menu | |
| Camera: chase / cockpit | C / V or the camera button | camera |
| Mode: Road / Track / Rocket | T or the switch above the speedometer | car / top bar |
| Reset car | R | — |
| Go to the wall climb | 2 | WALL |
| Go to the kickflip | 3 | FLIP |
| Rocket mode on the runway | 4 | FLY |
| Time of day: day / dusk / night | N | menu |
| Rain on/off | U | menu |
| Radio: next station / off | F | menu |
| Horn | H | horn |
| Pause menu: map + warps, tasks, settings | Esc / P | ☰ |
| Tasks list | J | menu |
| Sound on/off | M | SND |

## Thrusters, tricks and combos

The thrusters work in every mode and run on the same air tank (5,500 psi, refills on the ground
when you aren't boosting, fast at AIR stations):
- **Space** — tap on the ground to hop ~3.4 m; hold in the air for the lift thrusters, which brake a
  fall at up to 3.3 G and then climb gently. They push along the car's up axis, so upside down they push you down.
- **Shift** — rear thrust: 0–100 km/h in under a second from a standstill (a timer shows your time),
  and a push forward in the air.

In the air you have full control: **W/S** front/back flip, **A/D** roll (kickflip), **Q/E** spin.
Let go and the car levels itself after a moment. Every full turn is a trick (KICKFLIP 800,
FRONTFLIP / BACKFLIP 700, 360 SPIN 400, more for doubles); air time and a clean landing add to it.
Tricks in one jump build a combo, ×0.5 per extra trick up to ×8, paid out when you land on your
wheels and multiplied by the streak stars. Land on the roof or side and you're **WRECKED**: the combo
and the streak are lost, the car tumbles and the thrusters put it back on its wheels.
Big moments (the wall release, the kickflip apex) go briefly into slow motion; turn it off in Settings.

## Wall climb

Hit the curved wall at 95+ km/h. The suction fans hold the car while it climbs past vertical to
172° at ~63 m, then it lets go and rights itself (or flip it yourself). From that height, holding the
thrusters all the way down runs the tanks dry — free-fall and fire below ~30 m.
Space in the air fires the corner thrusters: hold it all the way down for an easy float,
or free-fall and fire low for the hard 3.3 G stop from the reveal. Land under 4 m/s for a perfect landing.
Thrusters run on compressed air (5,500 psi) that refills on the ground.

## Kickflip

Five parked vehicles stand across a lane in the east zone, with an orange launch line on each side.
Cross a line toward the row at 60+ km/h and the thrusters throw the car ~7 m up while it rolls
a full turn around its long axis on its own. Below ~73 km/h you won't clear the last car. Roll with
A / D yourself for a double kickflip — stop in time, or you'll land on the roof.
From 7 m the landing is hard unless you fire the thrusters (Space) just before touchdown.

## Rocket mode

The one-seat flight variant. On the ground it's the quickest car (0–100 km/h in ~1.1 s on the
rear thrusters). Hold lift to take off and climb, release it and the car settles gently at
2.5 m/s, hold X to drop faster. Throttle pushes you forward up to ~250 km/h (Shift boosts), and
the car banks into turns. Ceiling is 140 m.

Flight runs on the air tanks: about 16 seconds from full. Below 20% you get a warning; at zero
the thrusters cut and you fall. The onboard compressor refills slowly on the ground, and the
three AIR stations (red charging lots: runway, kickflip zone, wall zone) fill you up in about 2 seconds.
You can land on rooftops and drive off the edge to drop back down. In Rocket
mode you can also catch the car on the thrusters after the wall release.

## Real car models

Drop `.glb` models into `models/` (roadster, model3, modely, cybertruck, cybercab, semi) and the
game uses them for your car, traffic, parked cars and the kickflip row; see `models/README.md`.
Names, lengths and orientation fixes are in `MODELS` in `src/config.js`.

Your car, `models/roadster.glb`, is the Blender Roadster "RDSTR" (`tools/build_roadster.py`;
the original scene is `export/roadster_rdstr.blend`). To rebuild it after changing the script
(Blender 4.2 or newer):

```
blender --background --factory-startup --python tools/build_roadster.py --python tools/blend_to_glb.py
```

`build_roadster.py` builds the car and saves its .blend next to itself (or into `--out <dir>`
given after `--`); `blend_to_glb.py` then exports the car for the game: wing stowed, no stage,
flat carbon, emission toned down for bloom, facing the game's forward.

## Points, rings and tasks

Stunts, rings, drifts and landings score points (top centre); your best score is remembered.
15 glowing rings hang over the island — over the runway, the beach, downtown junctions, on the
way down from the wall and over the kickflip row. Ten one-off tasks give big bonuses
(climb the wall, double kickflip, collect every ring, land on a rooftop, 300 km/h, and more);
open the list with J or by tapping the score.

## HUD and streaks

GTA-style HUD: a rotating radar with three bars under it (green: car condition, blue: air,
yellow: stunt streak), the clock, score and five streak stars top right, and an arc speedometer.
Chain stunts within 12 s to light up to five stars — the stars multiply the points.
Esc opens the pause menu: a big map you can warp from, the tasks, settings and controls.

## Street life

Pedestrians walk the sidewalks and the beach and jump out of the way of cars (and the horn).
Every junction has working traffic lights; city traffic stops at red. Grass sways in the wind;
there are bushes, benches, bins and zebra crossings.

## Radio

Three stations of original music generated in the browser (no audio files): WAVE 103.5
(synthwave), PALM FM (chill) and NEON 122 (house). F or RADIO switches station or turns it off.

## Billboards and your handle

Billboard ads and your X handle live in `src/config.js` — change `X_HANDLE` and the list there.
Image ads live in `assets/ads/` (Grok Bot and SpaceX logos supplied by the project owner); the rest are text designs.
A big LED screen downtown cycles through all of them. Third-party names and logos belong to their owners.

## Publish

It's a static site with no build step: upload the folder as is (without `tools/` and `.claude/`).
Three.js is loaded from the jsDelivr CDN.

- **GitHub Pages:** push to a repo, then Settings → Pages → deploy from the `main` branch root.
- **Netlify / Vercel:** drag and drop the folder, or connect the repo with no build command.
- **itch.io:** zip the folder, upload as an HTML game, tick "This file will be played in the browser".

## City, weather and traffic

- **Time of day:** day, dusk and night. At dusk and night the windows and street lamps come on
  (with pools of light on the road), the car's headlights switch on, and at night there are stars
  and a moon. The choice is remembered.
- **Neon:** signs on street-facing facades and neon trim on some rooftops. They glow brightest at night.
- **Rain:** rain streaks, glossy wet roads that reflect the sky, neon streaks on wet streets at
  night, tyre spray, rain sound, and lightning with thunder. Wet roads cut grip, so the car slides sooner.
- **Traffic:** cars roam the city grid and pick a turn at every junction; more cars lap the
  ring road in both directions. They keep their distance, brake for you, and stop for a moment
  if you hit them. All traffic is drawn with a few instanced meshes.

## Code map

- `src/main.js` — renderer, post-processing, game loop, start screen
- `src/config.js` — billboard ads and your X handle
- `src/world.js` — map layout, sky, island, ring road, city blocks, stunt zones
- `src/buildings.js` — Art Deco hotels, condos, glass towers, the round tower
- `src/vice.js` — beach, shallows, waves, palms, umbrellas, clouds, billboards
- `src/stations.js` — AIR stations
- `src/car.js` — the roadster: lofted body, interior and live screens, animation
- `src/carModels.js` — road cars, the kickflip row, the semi
- `src/geom.js` — loft and other geometry helpers
- `src/rings.js`, `src/score.js` — rings, points, streak and tasks
- `src/menu.js` — pause menu
- `src/models.js` — loading, fitting and rigging real car models
- `src/details.js` — grass, bushes, street furniture, zebras, traffic lights
- `src/pedestrians.js` — people on the sidewalks and the beach
- `src/music.js` — the radio
- `src/vehicle.js` — driving physics (ground / wall / air states), thrusters, landings
- `src/ramp.js` — the curved wall: geometry and the path the car follows
- `src/atmosphere.js` — time of day, rain, lightning, lamps, wet roads
- `src/neon.js` — neon signs, roof trim, wet-street glow
- `src/traffic.js` — AI traffic on the city grid and the ring road, parked cars
- `src/camera.js` — chase and cockpit cameras
- `src/input.js` — keyboard and touch controls
- `src/hud.js` — speedometer, telemetry, minimap
- `src/effects.js`, `src/audio.js` — tyre smoke, synthesised motor and tyre sound
