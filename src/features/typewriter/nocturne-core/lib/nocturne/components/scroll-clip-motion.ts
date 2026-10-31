import type {Body} from '../../../app/nocturne/carriage-physics.ts';

// A bounded, critically stopped glide keeps the paper clip attached to caret scrolling while
// preserving its current velocity when the target changes. The typewriter's decorative springs
// remain independent and keep their original motion.
// Keep visible frame-to-frame speed below 1,800 px/s even with compositor timing jitter.
const MAX_SPEED = 1400;
const ACCELERATION = 36000;
const REST_DISTANCE = 0.25;
const REST_SPEED = 25;

export function stepScrollClip(body: Body, target: number, dt: number): Body {
  let {position, velocity} = body;
  let remaining = Math.max(0, Math.min(dt, 0.1));
  while (remaining > 0) {
    const h = Math.min(1 / 240, remaining);
    remaining -= h;
    const offset = target - position;
    if (Math.abs(offset) < REST_DISTANCE && Math.abs(velocity) < REST_SPEED) {
      return {position: target, velocity: 0};
    }
    const direction = Math.sign(offset) || -Math.sign(velocity);
    const desired = direction * Math.min(MAX_SPEED, Math.sqrt(2 * ACCELERATION * Math.abs(offset)));
    const change = Math.max(-ACCELERATION * h, Math.min(ACCELERATION * h, desired - velocity));
    velocity += change;
    const next = position + velocity * h;
    if ((next - target) * (position - target) < 0 || next === target) {
      return {position: target, velocity: 0};
    }
    position = next;
  }
  return {position, velocity};
}
