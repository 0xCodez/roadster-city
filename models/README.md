# Car models

Put real car models here as `.glb` (or `.gltf` + its files). The game loads any of these
names at startup and falls back to its built-in cars for the rest:

| File | Used as |
| --- | --- |
| `roadster.glb` | your car |
| `model3.glb` | sedans in traffic and parked; the sedan in the kickflip row |
| `modely.glb` | crossovers in traffic and parked; the crossover in the row |
| `cybertruck.glb` | pickups in traffic; the pickup in the row |
| `cybercab.glb` | the robotaxi in the row |
| `semi.glb` | the tractor of the semi in the row (the game adds the trailer) |

The game scales each model to its real length, turns it to face forward and puts it on the
ground. If a model faces the wrong way, set `yaw` (90, 180 or -90) for it in `src/config.js`.
Wheels spin and steer when their parts are named like "wheel", "tire", "tyre" or "rim".

Tips:
- Check the licence allows use in a published game (CC-BY needs credit — add it to the README).
- Under ~100k triangles per car keeps phones happy; Draco-compressed .glb files work.
- In traffic (High graphics only) every part of a model is one draw call per car type, so
  models with fewer separate parts run faster.
