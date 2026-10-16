// Things you may want to change without touching the game code.

// Your handle on X, shown on a billboard in the city.
export const X_HANDLE = '@0xMovez';

// Optional 3D models (.glb / .gltf). Drop the files into the models/ folder
// with these names; any that are missing fall back to the built-in cars.
//   length — real length in metres; the model is scaled to it
//   yaw    — extra turn in degrees if the model doesn't face forward (try 90, 180, -90)
//   uses   — where it appears: player car, traffic/parked types, kickflip row slots
export const MODELS = {
  roadster: { file: 'models/roadster.glb', length: 4.45, yaw: 0, uses: ['player'] },
  model3: { file: 'models/model3.glb', length: 4.72, yaw: 0, uses: ['sedan', 'row:sedan'] },
  modely: { file: 'models/modely.glb', length: 4.75, yaw: 0, uses: ['suv', 'row:crossover'] },
  cybertruck: { file: 'models/cybertruck.glb', length: 5.68, yaw: 0, uses: ['pickup', 'row:pickup'] },
  cybercab: { file: 'models/cybercab.glb', length: 4.1, yaw: 0, uses: ['row:robotaxi'] },
  // A Semi tractor on its own is ~7 m; the game adds the trailer behind it.
  semi: { file: 'models/semi.glb', length: 7.2, yaw: 0, uses: ['row:semi'] },
};

// Billboard ads around the city. An ad is either an image (16:9 works best,
// cropped to the board) or a text design: headline, tagline, colours.
export const BILLBOARDS = [
  { image: 'assets/ads/grokbot.webp', title: 'Grok Bot' },
  { image: 'assets/ads/spacex.webp', title: 'SpaceX' },
  { title: 'FOLLOW ME ON X', tagline: X_HANDLE, bg: '#000000', fg: '#ffffff', accent: '#e7e9ea' },
  { title: 'SpaceXAI', tagline: 'Intelligence for the stars', bg: '#05070c', fg: '#f2f2f2', accent: '#58a6ff' },
  { title: 'ROADSTER CITY', tagline: '0–100 in under 1 s. Then up.', bg: '#f2efe8', fg: '#141414', accent: '#d42a2a' },
  { title: 'OCEAN DRIVE FM', tagline: 'Synthwave all night · 103.5', bg: '#2a0b3a', fg: '#ffd0f4', accent: '#ff2fd0' },
  { title: 'NEON NOODLES', tagline: 'Open 24/7 on 5th Street', bg: '#101a14', fg: '#7dff5a', accent: '#ffb02f' },
];
