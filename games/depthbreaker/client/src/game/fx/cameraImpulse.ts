// Camera shake impulse channel. A decaying scalar that combat events add to and
// the CameraRig samples each frame, injecting a small random positional offset on
// top of the follow target. Purely additive, so it never fights the fixed Diablo
// camera. Crits and taking damage kick it — the cheapest way to give hits weight.

let shake = 0;
const MAX_SHAKE = 0.55;
const DECAY_PER_SECOND = 3.2;

/** Add a shake impulse (amplitude in world units), clamped so it never spikes. */
export function addShake(amount: number): void {
  shake = Math.min(MAX_SHAKE, shake + Math.max(0, amount));
}

const out = { x: 0, y: 0, z: 0 };

/** Sample this frame's camera offset and decay the impulse. Reuses one object. */
export function sampleShake(delta: number): { x: number; y: number; z: number } {
  if (shake <= 0.0005) {
    out.x = out.y = out.z = 0;
    return out;
  }
  const a = shake;
  shake = Math.max(0, shake - delta * DECAY_PER_SECOND);
  out.x = (Math.random() * 2 - 1) * a;
  out.y = (Math.random() * 2 - 1) * a * 0.6;
  out.z = (Math.random() * 2 - 1) * a;
  return out;
}
